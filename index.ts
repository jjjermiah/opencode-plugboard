/**
 * opencode-plugboard: an OpenAI-compatible HTTP endpoint served from inside an OpenCode V2
 * server, backed by the server's own providers.
 *
 * Install in the GLOBAL OpenCode config. OpenCode loads the plugin once per Location:
 *   - everywhere, a generation joins the process-wide listener (src/runtime.ts) and serves
 *     requests with the newest live generation;
 *   - only inside the plugboard data root (`.../opencode-plugboard/<app>/`) it also registers the
 *     context hook and the seed tools that make request sessions work. In any other project it
 *     registers nothing else.
 *
 * Freeze safety: this effect only registers and returns. It makes no `ctx` call that waits on
 * location readiness and never blocks, and its finalizer is synchronous and calls nothing on
 * `ctx` (a plugin effect that blocked once froze every prompt in a project).
 */

import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"
import type { IncomingMessage, ServerResponse } from "node:http"
import { errorMessage, logError } from "./src/log.js"
import { ensurePump, registerGeneration } from "./src/runtime.js"
import { createRouter } from "./src/server.js"
import { SEED_PREFIX, SEED_RESULT } from "./src/seeds.js"
import { applyContext, createSessionCaller, isInsideDataRoot, type SessionPort } from "./src/session-backend.js"
// Wires the config, model and OpenAI front-end functions into the `RouteDeps` the router takes.
import { deps } from "./src/deps.js"

type Context = Plugin.Context

/**
 * Promise port over the host's session API. The host's Effect types carry branded IDs and an
 * unconstrained requirements parameter that the structural `SessionPort` does not model, so the
 * cast sites below are the only places that erase them. Invariant at every site: the input is the
 * shape the host's own method takes (checked by the host at runtime), and the effect needs no
 * services (the host provides them).
 */
function sessionPort(ctx: Context): SessionPort {
  const run = <A>(effect: Effect.Effect<A, unknown, unknown>): Promise<A> => Effect.runPromise(effect as Effect.Effect<A>)
  return {
    create: (input) =>
      run(
        ctx.session.create({
          model: input.model,
          title: input.title,
          metadata: input.metadata,
          permissions: input.permissions,
          location: { directory: input.directory },
        } as Parameters<Context["session"]["create"]>[0]),
      ) as Promise<{ id: string }>,
    prompt: (input) => run(ctx.session.prompt(input as Parameters<Context["session"]["prompt"]>[0])),
    interrupt: (sessionID) =>
      run(ctx.session.interrupt({ sessionID } as Parameters<Context["session"]["interrupt"]>[0])).then(() => undefined),
  }
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
        logError("options.invalid", { error: errorMessage(error) })
        return
      }

      // ---- every Location: join the shared listener (sync registration only).
      const startPump = () => ensurePump(() => ctx.event.subscribe())
      const handle = createRouter(deps, {
        options,
        caller: createSessionCaller({ port: sessionPort(ctx), remoteImages: options.remoteImages }),
        loadCatalog: async () => {
          startPump()
          const listed = await Effect.runPromise(ctx.model.list({}))
          return [...(listed.data ?? [])]
        },
      })
      const registration = registerGeneration(options.listen, (request: IncomingMessage, response: ServerResponse) => {
        startPump()
        void handle(request, response)
      }, JSON.stringify(options))
      yield* Effect.addFinalizer(() => Effect.sync(() => registration.dispose()))
      startPump()

      // ---- real projects stop here: no hooks, no tools, no agent changes.
      if (!isInsideDataRoot(ctx.location.directory)) return

      // ---- plugboard app directories only.
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
            // Settles at once so history shows a completed call; plugboard ends the turn itself (see src/seeds.ts).
            execute: () => Effect.succeed({ content: SEED_RESULT }),
          })
        }
      })
    }),
})
