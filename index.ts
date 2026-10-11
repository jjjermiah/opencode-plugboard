/**
 * opencode-plugboard: an OpenAI-compatible HTTP endpoint served from inside an OpenCode V2
 * server, backed by the server's own providers.
 *
 * Install in the GLOBAL OpenCode config. OpenCode loads the plugin once per Location:
 *   - everywhere, a generation asks to join the process-wide listener (src/runtime.ts); an
 *     accepted one can serve requests (a data-root Location is preferred, else the newest), a
 *     rejected one does nothing at all;
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
import { ensurePump, loadServingCatalog, registerGeneration, sessionStore } from "./src/runtime.js"
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
      const ownCatalog = () => loadCatalog(ctx)
      const handle = createOpenAiRoute({
        options,
        caller: createSessionCaller({
          port: createSessionPort(ctx),
          sessions,
          maxTools: options.maxTools,
          remoteImages: options.remoteImages,
        }),
        // The catalog comes from the preferred accepted generation (a data-root Location when there is
        // one), not from whichever Location registered last; this generation's own is the fallback.
        loadCatalog: async () => {
          startPump()
          return loadServingCatalog(ownCatalog)
        },
      })
      const inDataRoot = isInsideDataRoot(ctx.location.directory)
      const registration = registerGeneration({
        listen: options.listen,
        options,
        owner: inDataRoot,
        handler: (request, response) => {
          startPump()
          handle(request, response).catch((error) => {
            logError("request.unhandled", { error: errorMessage(error) })
            if (response.headersSent) return void response.end()
            response.writeHead(500, { "content-type": "application/json" })
            response.end(JSON.stringify({ error: { message: "Internal server error", type: "server_error" } }))
          })
        },
        loadCatalog: ownCatalog,
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => registration.dispose()))

      // ---- a rejected generation (different options or `listen`, foreign runtime) serves nothing and installs nothing.
      if (!registration.accepted) return
      startPump()

      // ---- real projects stop here: no hooks, no tools, no agent changes.
      if (!inDataRoot) return

      // ---- plugboard app directories only: the context hook and the seed tools.
      yield* installSessionHooks(ctx, { maxTools: options.maxTools, sessions })
    }),
})
