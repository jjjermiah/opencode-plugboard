/**
 * opencode-plugboard: an OpenAI-compatible HTTP endpoint served from inside an OpenCode V2
 * server, backed by the server's own providers (spec: homelab
 * .agents/specs/2026-10-11-opencode-openai-adapter-plugin.md).
 *
 * Install in the GLOBAL OpenCode config. OpenCode loads the plugin once per Location:
 *   - everywhere, a generation joins the process-wide listener (src/listener.ts) and serves
 *     requests with the newest live generation (D7, D19);
 *   - only inside the plugboard data root (`.../opencode-plugboard/<app>/`) it also registers the
 *     context hook and the seed tools that make request sessions work (D17, R10). In any other
 *     project it registers nothing else.
 *
 * Freeze safety (D20, R9): this effect only registers and returns; it makes no `ctx` call that
 * waits on location readiness, never blocks, and its finalizer is synchronous.
 */

import { Plugin } from "@opencode/plugin/effect"
import { Effect, Stream } from "effect"
import type { IncomingMessage, ServerResponse } from "node:http"
import { onListenerClose, registerGeneration } from "./src/listener.js"
import { dispatch, getRegistry } from "./src/registry.js"
import { createRouter } from "./src/server.js"
import { SEED_PREFIX } from "./src/seeds.js"
import { applyContext, createSessionCaller, isInsideDataRoot, type SessionPort } from "./src/session-backend.js"
// TEMPORARY: lane-local shim. The orchestrator replaces it with the real config.ts / models.ts /
// openai/*.ts functions (same `RouteDeps` shape) at merge.
import { devDeps as deps } from "./src/dev-front.js"

type AnyRecord = Record<string, any>

/**
 * Process-wide event pump (D20, R11): one fiber on the host's default runtime, not owned by any
 * generation scope, forwards bus events of request sessions to their collectors. The bus is
 * server-wide, so everything else is dropped by `dispatch` before it is buffered.
 */
function ensurePump(ctx: AnyRecord): void {
  const registry = getRegistry()
  if (registry.pumping) return
  registry.pumping = true
  const fiber = Effect.runFork(
    ctx.event.subscribe().pipe(
      Stream.runForEach((event: unknown) => Effect.sync(() => dispatch(event))),
    ) as Effect.Effect<void>,
  )
  registry.stopPump = () => void fiber.interruptUnsafe()
  fiber.addObserver(() => {
    registry.pumping = false
    registry.stopPump = undefined
  })
  onListenerClose("pump", () => registry.stopPump?.())
}

export default Plugin.define({
  id: "opencode-plugboard",
  effect: (ctx) =>
    Effect.gen(function* () {
      let options
      try {
        options = deps.parseOptions(ctx.options)
      } catch (error) {
        // Invalid options: stay inert and say why, instead of failing the Location's plugin load.
        console.error(`[opencode-plugboard] invalid options: ${error instanceof Error ? error.message : String(error)}`)
        return
      }

      // ---- every Location: join the shared listener (sync registration only).
      const run = <A>(effect: Effect.Effect<A, any, any>) => Effect.runPromise(effect as Effect.Effect<A>)
      const port: SessionPort = {
        create: (input) =>
          run(
            ctx.session.create({
              model: input.model,
              title: input.title,
              metadata: input.metadata,
              permissions: input.permissions,
              location: { directory: input.directory },
            } as any) as Effect.Effect<{ id: string }, any>,
          ),
        prompt: (input) => run(ctx.session.prompt(input as any) as Effect.Effect<unknown>),
        interrupt: (sessionID) => run(ctx.session.interrupt({ sessionID } as any) as Effect.Effect<unknown>).then(() => undefined),
      }
      const handle = createRouter(deps, {
        options,
        caller: createSessionCaller({ port }),
        loadCatalog: async () => {
          ensurePump(ctx)
          const listed = (await run(ctx.model.list({} as any) as Effect.Effect<unknown>)) as { data?: unknown[] }
          return listed.data ?? []
        },
      })
      const registration = registerGeneration(options.listen, (request: IncomingMessage, response: ServerResponse) => {
        ensurePump(ctx)
        void handle(request, response)
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => registration.dispose()))
      ensurePump(ctx)

      // ---- real projects stop here (D17): no hooks, no tools, no agent changes.
      if (!isInsideDataRoot(ctx.location.directory)) return

      // ---- plugboard app directories only (R10).
      // Swap in the caller's system/messages/tools for plugboard request sessions only.
      yield* ctx.session.hook("context", (event) => Effect.sync(() => applyContext(event)))

      // Seed pool the hook re-keys onto the caller's tool names. Every agent denies the seeds;
      // request sessions are created with a session permission that allows them again, so a
      // person prompting inside an app directory is never offered them.
      yield* ctx.agent.transform((editor) => {
        for (const agent of editor.list()) {
          editor.update(agent.id, (item) => {
            item.permissions.push({ action: `${SEED_PREFIX}*`, resource: "*", effect: "deny" })
          })
        }
      })
      yield* ctx.tool.transform((editor) => {
        for (let index = 0; index < options.maxTools; index++) {
          editor.add({
            name: `${SEED_PREFIX}${index}`,
            description: "Plugboard placeholder tool.",
            input: { type: "object", properties: {}, additionalProperties: true },
            options: { codemode: false },
            // Blocks until plugboard interrupts the session (see src/seeds.ts).
            execute: (() => Effect.never) as any,
          })
        }
      })
    }),
})
