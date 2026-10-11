/**
 * opencode-plugboard: an OpenAI-compatible HTTP endpoint served from inside an OpenCode V2
 * server, backed by the server's own providers.
 *
 * Install in the GLOBAL OpenCode config. OpenCode loads the plugin once per Location:
 *   - everywhere, a generation asks to join the process-wide listener (src/runtime.ts); an
 *     accepted one can serve requests (a confirmed app-directory Location is preferred, else the
 *     newest), a rejected one does nothing at all;
 *   - every accepted generation also registers the context hook, the agent deny and the seed
 *     tools, but all three are no-ops until a request has confirmed, asynchronously, that the
 *     Location is a plugboard app directory (`.../opencode-plugboard/<app>/`, real path strictly
 *     inside the data root; `ensureBackend` in src/runtime.ts). Until then, and in every other
 *     project, nothing is rewritten.
 *
 * Freeze safety: this effect only registers and returns. It makes no `ctx` call that waits on
 * location readiness, touches no filesystem and never blocks, and its finalizer is synchronous
 * and calls nothing on `ctx` (a plugin effect that blocked once froze every prompt in a project).
 * The event pump starts lazily from request handling. See docs/architecture.md.
 */

import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"
import { parseOptions } from "./src/config.js"
import { errorMessage, logError } from "./src/log.js"
import { withFallbacks } from "./src/fallback.js"
import { withLimits } from "./src/limits.js"
import { createOpenAiRoute } from "./src/openai/route.js"
import { ensureBackend, ensurePump, loadServingCatalog, processLimits, processMetrics, registerGeneration, sessionStore, withResponseCache } from "./src/runtime.js"
import { createSessionCaller } from "./src/session/caller.js"
import { installSessionHooks } from "./src/session/context.js"
import { createHistoryPort, createSessionPort, loadCatalog } from "./src/session/host.js"

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
      // Started lazily from request handling (handler, catalog load); never from setup.
      const startPump = () => ensurePump(() => ctx.event.subscribe())
      const ownCatalog = () => loadCatalog(ctx)
      // Request handling only: an agent lookup scoped to another directory makes the host build that
      // Location, which loads this plugin there. Plugin setup never calls it.
      const bootLocation = (directory: string) => Effect.runPromise(ctx.agent.list({ location: { directory } }))
      const callerDeps = {
        port: createSessionPort(ctx),
        sessions,
        maxTools: options.maxTools,
        apps: options.apps,
        remoteImages: options.remoteImages,
        // The readiness gate the caller awaits before creating a session (fails closed: 503 `backend_unavailable`).
        ensureBackend: (app: string, signal: AbortSignal) => ensureBackend(app, signal, bootLocation),
      }
      // The catalog comes from the preferred accepted generation (a data-root Location when there is
      // one), not from whichever Location registered last; this generation's own is the fallback.
      const servingCatalog = async () => {
        startPump()
        return loadServingCatalog(ownCatalog)
      }
      const limits = options.limits
      const handle = createOpenAiRoute({
        options,
        // Caps are outermost, so one request takes one slot even when it falls back (src/limits.ts).
        // Aliases written as a list retry the next target before the first output (src/fallback.ts).
        // Limits are outermost (one slot per request, refused calls never reach anything); the response
        // cache sits outside the fallbacks, so a hit never reaches a provider (src/limits.ts, src/cache.ts).
        caller: withLimits(
          withResponseCache(
            withFallbacks(createSessionCaller(callerDeps), {
              options,
              loadCatalog: servingCatalog,
              onFallback: options.metrics ? (app) => processMetrics().fallback(app) : undefined,
            }),
            options,
          ),
          () => limits,
          processLimits(),
          { onLimited: options.metrics ? (app, reason) => processMetrics().limited(app, reason) : undefined },
        ),
        loadCatalog: servingCatalog,
      })
      const registration = registerGeneration({
        listen: options.listen,
        options,
        // The host's string, compared with the real path `ensureBackend` confirms; no filesystem access here.
        directory: ctx.location.directory,
        // Rebuild the transforms below once a request has confirmed this Location as an app directory.
        refresh: () => Effect.runPromise(Effect.all([ctx.agent.reload(), ctx.tool.reload()], { discard: true })),
        // Host handles for indexing and pruning request sessions; only called from request handling.
        history: { port: createHistoryPort(ctx), limits: options.history },
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

      // ---- the context hook, the agent deny and the seed tools. Ownership of the Location is only
      // known after an asynchronous check (`ensureBackend`), so all three are no-ops until
      // `registration.confirmed()`: in real projects nothing is ever added or rewritten.
      yield* installSessionHooks(ctx, { maxTools: options.maxTools, apps: options.apps, sessions, active: registration.confirmed })
      registration.ready()
    }),
})
