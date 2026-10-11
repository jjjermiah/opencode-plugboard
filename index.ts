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
 * `ctx` (a plugin effect that blocked once froze every prompt in a project). See
 * docs/architecture.md.
 */

import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"
import { parseOptions } from "./src/config.js"
import { errorMessage, logError } from "./src/log.js"
import { createOpenAiRoute } from "./src/openai/route.js"
import { ensurePump, registerGeneration, sessionStore } from "./src/runtime.js"
import { createSessionCaller } from "./src/session/caller.js"
import { installSessionHooks } from "./src/session/context.js"
import { isInsideDataRoot } from "./src/session/history.js"
import { createSessionPort, loadCatalog } from "./src/session/host.js"

export default Plugin.define({
  id: "opencode-plugboard",
  effect: (ctx) =>
    Effect.gen(function* () {
      let options
      try {
        options = parseOptions(ctx.options)
      } catch (error) {
        // Invalid options: stay inert and say why, instead of failing the Location's plugin load.
        logError("options.invalid", { error: errorMessage(error) })
        return
      }

      // ---- every Location: join the shared listener (sync registration only).
      const sessions = sessionStore()
      const startPump = () => ensurePump(() => ctx.event.subscribe())
      const handle = createOpenAiRoute({
        options,
        caller: createSessionCaller({ port: createSessionPort(ctx), sessions, remoteImages: options.remoteImages }),
        loadCatalog: async () => {
          startPump()
          return loadCatalog(ctx)
        },
      })
      const registration = registerGeneration(
        options.listen,
        (request, response) => {
          startPump()
          void handle(request, response)
        },
        JSON.stringify(options),
      )
      yield* Effect.addFinalizer(() => Effect.sync(() => registration.dispose()))
      startPump()

      // ---- real projects stop here: no hooks, no tools, no agent changes.
      if (!isInsideDataRoot(ctx.location.directory)) return

      // ---- plugboard app directories only: the context hook and the seed tools.
      yield* installSessionHooks(ctx, { maxTools: options.maxTools, sessions })
    }),
})
