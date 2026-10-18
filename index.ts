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
import { appHistoryLimits, parseOptions } from "./src/config.js"
import { personaOf } from "./src/models.js"
import { errorMessage, logError } from "./src/log.js"
import { withFallbacks } from "./src/fallback.js"
import { withStopSequences } from "./src/stop.js"
import { withBudgets } from "./src/budgets.js"
import { withLimits } from "./src/limits.js"
import { createOpenAiRoute } from "./src/openai/route.js"
import { ensureBackend, ensurePump, loadServingCatalog, processBudgets, processKeys, processLimits, processMetrics, processUsage, registerGeneration, setConfigError, sessionStore, withResponseCache } from "./src/runtime.js"
import { createSessionCaller } from "./src/session/caller.js"
import { createAffinity } from "./src/session/affinity.js"
import { installSessionHooks } from "./src/session/context.js"
import { createHistoryPort, createKeepAliveHost, createSessionPort, createStoragePort, loadCatalog } from "./src/session/host.js"
import { keepAliveIntervalMs, keepAliveLoop } from "./src/keepalive.js"
import { createKeyStore } from "./src/keys.js"
import { createResponseStore } from "./src/responses/state.js"
import { createFileStore } from "./src/files/state.js"
import { usageHandlers, UsageRpc } from "./src/rpc.js"
import { createUsageRecorder, withUsage } from "./src/usage.js"
import { hostVersion } from "./src/version.js"

export default Plugin.define({
  id: "opencode-plugboard",
  effect: (ctx) =>
    Effect.gen(function* () {
      let options: ReturnType<typeof parseOptions>
      try {
        options = parseOptions(ctx.options)
      } catch (error) {
        // Invalid options fail this setup, so the host lists the plugin as `failed` with the message
        // (opencode packages/core/src/plugin.ts: a failed setup becomes slot.error, then the state).
        // Nothing is registered, so the Location stays inert. The same message goes to the error log,
        // and to `/plugboard/status` and `/readyz` while a listener from an earlier good generation serves (#159).
        const message = errorMessage(error)
        setConfigError(message)
        logError("options.invalid", { error: message })
        return yield* Effect.die(new Error(`plugboard options are invalid: ${message}`))
      }
      setConfigError(undefined)

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
        persona: (model: string) => personaOf(options, model),
        remoteImages: options.remoteImages,
        promptCache: options.promptCache,
        affinity: createAffinity({ storage: createStoragePort(ctx) }),
        historyHidden: options.history.hidden,
        requestTimeoutMs: options.requestTimeoutMs,
        onUsageMissing: (app: string) => {
          if (options.metrics) processMetrics().usageMissing(app, "disconnect")
        },
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
      // Usage (src/usage.ts): built from closures only; it reads and writes storage from request handling.
      const usage = options.usage.enabled
        ? createUsageRecorder({ state: processUsage(), storage: createStoragePort(ctx), loadCatalog: servingCatalog, retentionDays: options.usage.retentionDays })
        : undefined
      const handle = createOpenAiRoute({
        options,
        // The host's own version (`ctx.app`), shown on `/plugboard/status` (#347).
        opencodeVersion: hostVersion(ctx.app?.version),
        // Usage is outermost, so it records the answer the client gets (src/usage.ts).
        // Caps are outside the fallbacks, so one request takes one slot even when it falls back (src/limits.ts).
        // Aliases written as a list retry the next target before the first output (src/fallback.ts).
        // The response cache is outside budgets and limits: a hit spends nothing, takes no slot and counts toward no
        // rate window, and never reaches a provider (src/cache.ts). Only a miss is budgeted and limited.
        caller: withUsage(
          withResponseCache(
            // Budgets sit outside the limiter, so a budget refusal never takes a slot (src/budgets.ts).
            withBudgets(
              withLimits(
                // Stop sequences are applied to the answer where the host run ends, so a cached answer is the one cut (src/stop.ts).
                withFallbacks(withStopSequences(createSessionCaller(callerDeps), (app) => { if (options.metrics) processMetrics().usageMissing(app, "stop") }), {
                  options,
                  loadCatalog: servingCatalog,
                  onFallback: (app) => {
                    if (options.metrics) processMetrics().fallback(app)
                    usage?.fallback(app)
                  },
                }),
                () => limits,
                processLimits(),
                {
                  onLimited: (app, reason) => {
                    if (options.metrics) processMetrics().limited(app, reason)
                    usage?.limited(app)
                  },
                },
              ),
              options.budgets,
              usage,
              processBudgets(),
              {
                onRefused: (app) => {
                  if (options.metrics) processMetrics().limited(app, "budget")
                  usage?.limited(app)
                },
              },
            ),
            options,
          ),
          usage,
        ),
        loadCatalog: servingCatalog,
        usage,
        // Runtime app keys (#55): read from storage on the first authentication, cached on the runtime.
        keys: createKeyStore({ state: processKeys(), storage: createStoragePort(ctx) }),
        // Stored Responses (src/responses/state.ts): read and written from request handling, on the same host storage.
        responses: createResponseStore({ storage: createStoragePort(ctx) }),
        // Uploaded files (src/files/state.ts, since next): same host storage, request handling only.
        files: createFileStore({ storage: createStoragePort(ctx) }),
        // The prompt a count reads (persona, server tools): the same port, persona lookup and backend gate as the session caller (#201).
        session: callerDeps,
      })
      const registration = registerGeneration({
        listen: options.listen,
        options,
        // The host's string, compared with the real path `ensureBackend` confirms; no filesystem access here.
        directory: ctx.location.directory,
        // Rebuild the transforms below once a request has confirmed this Location as an app directory.
        refresh: () => Effect.runPromise(Effect.all([ctx.agent.reload(), ctx.tool.reload()], { discard: true })),
        // Host handles for indexing and pruning request sessions; only called from request handling.
        history: { port: createHistoryPort(ctx), limits: options.history, apps: appHistoryLimits(options) },
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

      // ---- the keep-alive (#310): forked into the plugin scope, never awaited. Only the generation holding the lease ticks (src/keepalive.ts).
      if (options.keepAlive !== false)
        yield* Effect.forkScoped(
          keepAliveLoop({
            host: createKeepAliveHost(ctx, createStoragePort(ctx)),
            intervalMs: keepAliveIntervalMs(),
            isOwner: registration.keepAliveOwner,
          }),
        )

      // ---- the usage RPC (src/rpc.ts): a synchronous registration; its handler reads the store from request time only.
      // Its error channel is `unknown` in the host, so a failed registration is logged and the plugin keeps loading.
      if (usage)
        yield* ctx.rpc.register(UsageRpc, usageHandlers(usage)).pipe(
          Effect.catch((error) => Effect.sync(() => logError("rpc.register_failed", { rpc: UsageRpc.id, error: errorMessage(error) }))),
        )

      // ---- the context hook, the agent deny and the seed tools. Ownership of the Location is only
      // known after an asynchronous check (`ensureBackend`), so all three are no-ops until
      // `registration.confirmed()`: in real projects nothing is ever added or rewritten.
      yield* installSessionHooks(ctx, { maxTools: options.maxTools, apps: options.apps, sessions, active: registration.confirmed })
      registration.ready()
    }),
})
