/**
 * SPIKE: OpenAI-compatible surface (`GET /v1/models`, `POST /v1/chat/completions`)
 * served from inside a running OpenCode V2 server.
 *
 * One HTTP request = one hidden OpenCode session = one model step:
 *   1. create a session pinned to the requested model,
 *   2. rewrite `system` / `messages` / `tools` / generation options in
 *      `session.hook("context")` so the caller's payload replaces OpenCode's,
 *   3. prompt it, and let the seeded placeholder tool stop the turn when the model
 *      calls a caller tool (the call is captured, never executed),
 *   4. collect text + tool calls + finish reason + usage from the server event bus,
 *   5. delete the session.
 */

import { Plugin } from "@opencode/plugin/effect"
import { Effect, Stream, type Scope } from "effect"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { StepCollector, sleep } from "./src/backend.js"
import { parseModelRef, toOpenAIModels } from "./src/models.js"
import { encodeChatCompletion, encodeError, parseChatRequest, type AdapterRequestState } from "./src/openai.js"
import { SEED_COUNT, SEED_PREFIX } from "./src/seeds.js"

const GLOBAL_KEY = "__opencodeOpenAIAdapter"
const DEFAULT_PORT = 4010
const SESSION_TITLE = "opencode-openai-adapter"

type AnyRecord = Record<string, any>
type Respond = (status: number, payload: unknown) => void

type Handler = (request: IncomingMessage, response: ServerResponse) => void

/** Process-wide listener shared by every live plugin generation (one per Location). */
interface Holder {
  readonly server: Server
  /** Live generations, oldest first; the newest one serves requests. */
  readonly handlers: Handler[]
}

const json = (response: ServerResponse, status: number, payload: unknown) => {
  const body = JSON.stringify(payload)
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) })
  response.end(body)
}

const readJson = (request: IncomingMessage) =>
  new Promise<AnyRecord>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > 32 * 1024 * 1024) {
        reject(new Error("request body too large"))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on("error", reject)
    request.on("end", () => {
      try {
        resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch (error) {
        reject(error)
      }
    })
  })

export default Plugin.define({
  id: "opencode-openai-adapter",
  effect: (ctx) =>
    Effect.gen(function* () {
      const runtime = yield* Effect.context<Scope.Scope>()
      const run = Effect.runPromiseWith(runtime)

      const collectors = new Map<string, StepCollector>()
      const requests = new Map<string, AdapterRequestState>()

      // 1. Fan out the server event bus into per-session collectors. The bus is server-wide, so
      //    events are dropped here unless they belong to a live adapter session; nothing is buffered.
      //    Forked into the plugin scope: setup must return (see the end of this effect).
      yield* Effect.forkScoped(
        ctx.event.subscribe().pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              // Bus envelope: `{ id, type, data: { sessionID, ... } }`; flatten it for the collector.
              const envelope = event as unknown as AnyRecord
              const item = { type: envelope.type, ...(envelope.data ?? {}) }
              const sessionID = String(item.sessionID ?? "")
              const collector = collectors.get(sessionID)
              if (!collector) return
              collector.push(item)
              // The model stream is complete: every tool call is captured. Stop the turn before
              // the (blocked) placeholder tools run and before a second model step can start.
              if (item.type === "session.step.streamed" && collector.toolCalls > 0)
                yield* Effect.forkScoped(ctx.session.interrupt({ sessionID } as any).pipe(Effect.ignore))
            }),
          ),
        ),
      )

      // 2. Rewrite the request for adapter sessions only; every other session is left untouched.
      yield* ctx.session.hook("context", (event) =>
        Effect.sync(() => {
          const session = event as unknown as AnyRecord
          const state = requests.get(String(session.sessionID))
          if (!state) return
          // Swap media placeholders for the Asset-carrying parts the host built from the prompt files.
          const hostMedia = ((session.messages ?? []) as AnyRecord[])
            .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
            .filter((part: AnyRecord) => part?.type === "media")
          const swap = (part: AnyRecord) => (typeof part.__attachment === "number" ? (hostMedia[part.__attachment] ?? { type: "text", text: "[image unavailable]" }) : part)
          session.system = state.system
          session.messages = state.messages.map((message) =>
            Array.isArray(message.content) ? { ...message, content: message.content.map(swap) } : message,
          )
          Object.assign(session.options ?? (session.options = {}), state.options)
          const seeds = Object.entries(session.tools ?? {}).filter(([name]) => name.startsWith(SEED_PREFIX))
          const next: AnyRecord = {}
          let index = 0
          for (const tool of state.tools) {
            const seed = seeds[index++]
            if (!seed) break
            const descriptor = seed[1] as { description: string; input: unknown }
            descriptor.description = tool.description
            descriptor.input = tool.parameters
            next[tool.name] = descriptor
          }
          session.tools = next
        }),
      )

      // 3. Seed pool the context hook re-keys onto the caller's tool names. The tools must be
      //    registered to be advertisable, but no agent may use them unless a session opts in:
      //    every agent denies the seed prefix, and adapter sessions are created with a session
      //    permission that allows it again (session rules are merged after the agent's).
      yield* ctx.agent.transform((editor) => {
        for (const agent of editor.list()) {
          editor.update(agent.id, (item) => {
            item.permissions.push({ action: `${SEED_PREFIX}*`, resource: "*", effect: "deny" })
          })
        }
      })
      yield* ctx.tool.transform((editor) => {
        for (let index = 0; index < SEED_COUNT; index++) {
          editor.add({
            name: `${SEED_PREFIX}${index}`,
            description: "OpenCode OpenAI adapter placeholder tool.",
            input: { type: "object", properties: {}, additionalProperties: true },
            options: { codemode: false },
            // Blocks until the adapter interrupts the session (see seeds.ts).
            execute: (() => Effect.never) as any,
          })
        }
      })

      // 4. One request = one session = one model step.
      const chatCompletion = async (body: AnyRecord, respond: Respond) => {
        const parsed = parseChatRequest(body)
        const ref = parseModelRef(parsed.model)
        if (!ref) {
          respond(400, encodeError(`Unknown model: ${JSON.stringify(parsed.model)}`, "invalid_request_error", "model_not_found"))
          return
        }
        const created = (await run(
          ctx.session.create({
            model: ref as any,
            title: SESSION_TITLE,
            metadata: { "openai-adapter": true } as any,
            permissions: [{ action: `${SEED_PREFIX}*`, resource: "*", effect: "allow" }] as any,
          }),
        )) as { id: string }
        const sessionID = String(created.id)
        const collector = new StepCollector(sessionID)
        collectors.set(sessionID, collector)
        requests.set(sessionID, parsed.state)
        try {
          await run(ctx.session.prompt({ sessionID, text: "run", files: parsed.state.attachments } as any))
          const ended = await Promise.race([collector.executionEnded, sleep(120_000).then(() => "timeout")])
          const payload = encodeChatCompletion(parsed.model, collector.result())
          respond(200, body.x_debug === true ? { ...payload, x_trace: collector.trace, x_session: sessionID, x_steps: collector.steps, x_execution: ended } : payload)
        } finally {
          collectors.delete(sessionID)
          requests.delete(sessionID)
          await run(ctx.session.remove({ sessionID } as any)).catch(() => {})
        }
      }

      const handleRequest = async (request: IncomingMessage, response: ServerResponse) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1")
        try {
          if (request.method === "GET" && url.pathname === "/healthz") return json(response, 200, { ok: true })
          if (request.method === "GET" && url.pathname === "/v1/models") {
            const listed = (await run(ctx.model.list({} as any))) as unknown as { data?: AnyRecord[] }
            return json(response, 200, { object: "list", data: toOpenAIModels(listed.data ?? []) })
          }
          if (request.method === "GET" && url.pathname === "/v1/_debug") {
            return json(response, 200, { location: ctx.location.directory, sessions: [...requests.keys()] })
          }
          if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
            const body = await readJson(request)
            return await chatCompletion(body, (status, payload) => json(response, status, payload))
          }
          return json(response, 404, encodeError(`No route for ${request.method} ${url.pathname}`, "invalid_request_error"))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (!response.headersSent) json(response, 500, encodeError(message, "server_error"))
        }
      }

      // 5. One listener per process, shared by every live plugin generation. The last generation
      //    to unload closes it (config change, dispose), so the port never outlives the plugin.
      const holder: Holder = ((globalThis as AnyRecord)[GLOBAL_KEY] ??= (() => {
        const created: Holder = { server: createServer(), handlers: [] }
        created.server.on("request", (request, response) => {
          const current = created.handlers.at(-1)
          if (!current) return json(response, 503, encodeError("adapter not ready", "server_error"))
          current(request, response)
        })
        created.server.on("error", (error) => console.error("[opencode-openai-adapter] listener error", error))
        const port = Number(ctx.options?.port ?? DEFAULT_PORT)
        created.server.listen(port, "127.0.0.1", () =>
          console.log(`[opencode-openai-adapter] listening on http://127.0.0.1:${port}`),
        )
        return created
      })())

      const handler: Handler = (request, response) => {
        void handleRequest(request, response)
      }
      holder.handlers.push(handler)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          const index = holder.handlers.indexOf(handler)
          if (index !== -1) holder.handlers.splice(index, 1)
          if (holder.handlers.length > 0) return
          if ((globalThis as AnyRecord)[GLOBAL_KEY] === holder) delete (globalThis as AnyRecord)[GLOBAL_KEY]
          holder.server.close()
          holder.server.closeAllConnections()
          console.log("[opencode-openai-adapter] listener closed")
        }),
      )

      console.log(`[opencode-openai-adapter] active for ${ctx.location.directory}`)
      // No `yield* Effect.never` here: the host awaits this effect inside plugin activation
      // (packages/core/src/plugin.ts `load`) while holding the readiness latch, so blocking
      // would stall every session prompt in the Location. Long-lived work is forked above.
    }),
})
