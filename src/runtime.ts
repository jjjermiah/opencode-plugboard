/**
 * Process runtime: the one owner of everything that outlives a plugin generation.
 *
 * OpenCode loads the plugin once per Location, so many generations exist at once, and the module
 * itself may be re-evaluated per Location or on reload. The runtime therefore lives on
 * `globalThis` under a versioned key and holds:
 *   - the generation list: the ACCEPTED generations (request handler, catalog loader), newest
 *     last. A generation whose Location is a confirmed plugboard app directory is the preferred
 *     owner: it serves requests and supplies the catalog; without one the newest generation does;
 *   - the confirmed directories: app directories (real paths strictly inside the canonical data
 *     root) that `ensureBackend` has verified asynchronously. Nothing in setup touches the
 *     filesystem, so a Location is unconfirmed, and plugboard's hook and transforms stay no-ops
 *     there, until a request has confirmed its directory (fail closed);
 *   - the HTTP listener lifetime: the first generation binds the port, later ones join; when the
 *     last generation is gone the listener waits a grace period (a config reload recreates every
 *     generation at once) before closing; requests arriving with no live generation get 503;
 *   - the event pump lifetime: one fiber on the host's default runtime, owned by no generation
 *     scope, forwarding bus events of request sessions to the session store. If it dies, the
 *     requests in flight fail with a 502 instead of waiting for their deadline;
 *   - the session store (src/session/state.ts), which outlives the listener and owns the request
 *     guards, their cleanup timers included;
 *  - the history sweep state: every registered request session is indexed in the host's plugin
 *     storage and, at most every `SWEEP_INTERVAL_MS`, a sweep prunes old ones past the `history`
 *     limits (src/session/prune.ts). Both start from request handling (the store's `register`);
 *  - the metrics registry (src/metrics.ts) and the runtime start time, so counters and uptime
 *     outlive any one generation. `processMetrics` / `processStatus` read them for `/metrics`,
 *     `/v1/status` and the discovery pages;
 *   - the request limiter's queues and rate windows (src/limits.ts), so a cap holds across
 *     generations. `processLimits` reads them.
 *
 * Registration is explicit: `registerGeneration` returns whether the generation was accepted. A
 * rejected one (different `listen`, options that differ from the live ones, foreign runtime) never
 * serves and must not install hooks or seeds. `ensureBackend` is the per-directory readiness gate
 * the session caller awaits before creating a session: it confirms the app directory, boots its
 * Location from request handling when no generation is there yet, and fails with
 * `backend_unavailable` (503) when the generation there is rejected or never becomes ready.
 *
 * Version policy: a runtime written by a different version is never touched or replaced; this
 * module then behaves as inert (no listener, no pump, an empty detached session store) and logs
 * once that the server needs a restart.
 *
 * Freeze safety: everything a generation calls from plugin setup or a finalizer here is
 * synchronous and makes no call on the plugin context or the filesystem. `Registration.dispose`
 * only mutates state and arms an unref'd timer; the pump is started lazily by request handling,
 * never awaited. `ensureBackend` and `Registration.refresh` run from request handling only.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { setTimeout as delay } from "node:timers/promises"
import { Cause, Effect, Stream } from "effect"
import stableStringify from "safe-stable-stringify"
import { raceAbort } from "./abort.js"
import { cachedCaller, createCacheStore, type CacheStore } from "./cache.js"
import type { PlugboardOptions } from "./config.js"
import { isPlugError, type CatalogModel, type ModelCaller, type PlugError } from "./contract.js"
import { errorMessage, log, logError, outsideRequest, setLogFormat } from "./log.js"
import { createLimitState, type LimitState } from "./limits.js"
import { createMetrics, type Metrics, type RuntimeSnapshot } from "./metrics.js"
import { ensureAppDir } from "./session/history.js"
import type { HistoryPort } from "./session/host.js"
import { recordSession, sweepHistory, type HistoryLimits } from "./session/prune.js"
import { createSessionStore, type SessionStore } from "./session/state.js"

export type Handler = (request: IncomingMessage, response: ServerResponse) => void

export interface Registration {
  /** False when the generation was rejected: it serves nothing and must not install hooks or seeds. */
  readonly accepted: boolean
  /** Synchronous; safe in a finalizer. */
  dispose(): void
  /**
   * Whether `ensureBackend` has confirmed this generation's Location as a plugboard app directory.
   * Synchronous, no filesystem; false until then. Everything plugboard installs for app
   * directories (context hook, agent deny, seed tools) must be a no-op while this is false.
   */
  confirmed(): boolean
  /** Setup has finished installing the app-directory registrations (the context hook is in place). */
  ready(): void
}

export interface GenerationInput {
  readonly listen: { readonly host: string; readonly port: number }
  /** The parsed options. Generations must agree on them; compared by canonical JSON (key order is irrelevant). */
  readonly options: unknown
  /** This generation's Location directory as the host reports it. Compared as a string with the real path `ensureAppDir` returns; never resolved against the filesystem here. */
  readonly directory: string
  readonly handler: Handler
  /** The enabled models as this generation's Location sees them. */
  readonly loadCatalog: () => Promise<ReadonlyArray<CatalogModel>>
  /**
   * Rebuild what depends on `Registration.confirmed()` (the agent and tool transforms) after it
   * flipped to true for a generation that was set up before. Called from request handling only,
   * never from setup or a finalizer.
   */
  readonly refresh: () => Promise<void>
  /** The host storage and session deletion used to index and prune request sessions, with the configured limits (identical in every accepted generation). */
  readonly history: { readonly port: HistoryPort; readonly limits: HistoryLimits }
}

const GRACE_MS = 10_000
/** Earliest next history sweep after one ran (sweeps are triggered by requests, never by a timer). */
const SWEEP_INTERVAL_MS = 10 * 60_000
/** Earliest next sweep when one left work behind (its budget ran out). */
const SWEEP_BACKLOG_MS = 60_000
/** A sweep stops starting host calls after this long; a hung one stops blocking later sweeps 5 s after. */
const SWEEP_DEADLINE_MS = 60_000
/** How long `ensureBackend` waits for a Location to boot and its generation to become ready. */
const BACKEND_TIMEOUT_MS = 15_000
const BACKEND_POLL_MS = 25

/** How often a listener that could not bind tries again, and how often it repeats the error while it still cannot (#87). */
const BIND_RETRY_MS = 15_000
const BIND_REMINDER_MS = 5 * 60_000

/** 11: the live key set (`keys`, `Runtime.keys`) that a stricter newer generation replaces at once (#90). 10: the response cache store (`src/cache.ts`) lives here too. 9: the request limiter state (`src/limits.ts`) lives here, so the concurrency caps and rate windows survive a generation. 8: `Metrics.render` is async and the registry is @prometheus-io/client's. 7: the options fingerprint comes from safe-stable-stringify, so it must not be compared with an older one. 6: the listener retries a failed bind (new fields on `Listener`). 5: adds the metrics registry and the start time. 4: the history sweep state and the session store's register hook. 3: confirmed directories and rejected generations. */
const VERSION = 11
const KEY = Symbol.for("opencode-plugboard.runtime")

interface Listener {
  readonly server: Server
  readonly listen: { readonly host: string; readonly port: number }
  /** Canonical JSON of the parsed options of the generations the listener serves; later generations must match it. */
  fingerprint: string
  mismatchLogged: boolean
  bound: boolean
  /** Failed bind attempts since the last success: while this is above 0 nothing receives requests on the port. */
  bindFailures: number
  /** When the bind failure was last logged (epoch ms). */
  bindLoggedAt: number
  retryTimer?: ReturnType<typeof setTimeout>
  graceTimer?: ReturnType<typeof setTimeout>
}

interface Generation {
  readonly directory: string
  readonly handler: Handler
  readonly loadCatalog: GenerationInput["loadCatalog"]
  readonly refresh: GenerationInput["refresh"]
  readonly history: GenerationInput["history"]
  /** The context hook and transforms are installed (setup got to its end). */
  hooked: boolean
  /** The transforms have been rebuilt since `confirmed` became true for the directory. */
  activated: boolean
  activating?: Promise<void>
}

interface Pump {
  /** Set by `stop`: the end of the fiber is then expected. */
  stopped: boolean
  stop(): void
}

interface Runtime {
  readonly version: number
  readonly sessions: SessionStore
  /** Accepted generations only, newest last. */
  readonly generations: Generation[]
  /** App directories (real paths, strictly inside the canonical data root) confirmed by `ensureBackend`. */
  readonly confirmed: Set<string>
  /** Live rejected generations per directory: tells "rejected" from "no generation yet". */
  readonly rejected: Map<string, number>
  /** History sweep rate limit: no sweep starts before `nextAt` (epoch ms) or while one `running`. */
  readonly sweep: { nextAt: number; running: boolean }
  /** Process-wide counters, shared by every generation (see src/metrics.ts). */
  readonly metrics: Metrics
  /** Concurrency queues and requests-per-minute windows (see src/limits.ts). */
  readonly limits: LimitState
  /** When this runtime was created, epoch ms. */
  readonly startedAt: number
  /**
   * The app keys authentication checks (app name -> key), once a generation has registered. Replaced
   * when a newer generation only revokes or rotates keys (`registerGeneration`, #90). Absent means
   * the handler's own options are used.
   */
  keys?: Readonly<Record<string, string>>
  /** The response cache store (src/cache.ts) and the fingerprint of the config and `apps` policy it was built for. */
  cache?: { readonly fingerprint: string; readonly store: CacheStore }
  listener?: Listener
  /** Present while a fiber is subscribed to the server event bus. */
  pump?: Pump
}

const REJECTED: Registration = { accepted: false, dispose() {}, confirmed: () => false, ready() {} }

/** Used when a foreign-version runtime owns the process: never registered into, never dispatched to. */
const detachedSessions = createSessionStore()
const detachedMetrics = createMetrics()
const detachedStartedAt = Date.now()
const detachedLimits = createLimitState()
let foreignVersionLogged = false

/** The process runtime, created on first use; undefined when a different version already owns the process. */
function runtime(): Runtime | undefined {
  const slot = globalThis as Record<symbol, unknown>
  const existing = slot[KEY] as { readonly version: number } | undefined
  if (!existing) {
    const created: Runtime = {
      version: VERSION,
      sessions: createSessionStore({ onRegister: (state) => trackSession(created, state.app, state.sessionID) }),
      generations: [],
      confirmed: new Set(),
      rejected: new Map(),
      sweep: { nextAt: 0, running: false },
      metrics: createMetrics(),
      limits: createLimitState(),
      startedAt: Date.now(),
    }
    slot[KEY] = created
    return created
  }
  if (existing.version === VERSION) return existing as Runtime
  if (!foreignVersionLogged) {
    foreignVersionLogged = true
    logError("runtime.foreign_version", { found: existing.version, expected: VERSION, action: "restart the server" })
  }
  return undefined
}

/**
 * A request session was just created: index it, then sweep if due. Runs from request handling
 * (the store's `register`), never awaited, never throws. Uses the preferred generation's host
 * handles; the storage and `session.remove` are server-wide, so any live generation works.
 */
function trackSession(rt: Runtime, app: string, sessionID: string): void {
  const history = preferred(rt)?.history
  if (!history) return logError("history.index_skipped", { app, sessionID, reason: "no live generation" })
  // No limits, no index: an unbounded index would grow opencode.db by a row per request forever (#85).
  if (history.limits.maxSessions === undefined && history.limits.maxAgeDays === undefined) return
  // Not about the request that happened to create the session: its log lines carry no request id.
  void outsideRequest(() =>
    recordSession(history.port, app, sessionID, Date.now())
      .catch((error) => logError("history.index_failed", { app, sessionID, error: errorMessage(error) }))
      .then(() => maybeSweep(rt, history)),
  )
}

/**
 * Run a history sweep when limits are set, none is running and the rate limit allows. Bounded:
 * see `sweepHistory`. A sweep that leaves work behind is followed up after `SWEEP_BACKLOG_MS`,
 * a complete one after `SWEEP_INTERVAL_MS`. Logs one line with counts only.
 */
async function maybeSweep(rt: Runtime, history: GenerationInput["history"]): Promise<void> {
  const { limits, port } = history
  if (limits.maxSessions === undefined && limits.maxAgeDays === undefined) return
  const now = Date.now()
  if (rt.sweep.running || now < rt.sweep.nextAt) return
  rt.sweep.running = true
  rt.sweep.nextAt = now + SWEEP_INTERVAL_MS
  const deadline = AbortSignal.timeout(SWEEP_DEADLINE_MS)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      sweepHistory({ port, limits, sessions: rt.sessions, now, signal: deadline }),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), SWEEP_DEADLINE_MS + 5_000)
        timer.unref?.()
      }),
    ])
    if (!result) {
      rt.metrics.sweep("timeout", 0)
      return logError("history.sweep_timeout", { limit: SWEEP_DEADLINE_MS })
    }
    if (result.more) rt.sweep.nextAt = Date.now() + SWEEP_BACKLOG_MS
    rt.metrics.sweep("ok", result.removed)
    log("history.swept", { ...result, durationMs: Date.now() - now })
  } catch (error) {
    rt.metrics.sweep("failed", 0)
    logError("history.sweep_failed", { error: errorMessage(error) })
  } finally {
    clearTimeout(timer)
    rt.sweep.running = false
  }
}

/** The session store shared by every generation in the process. */
export const sessionStore = (): SessionStore => runtime()?.sessions ?? detachedSessions

/** The metrics registry shared by every generation in the process (a detached one under a foreign-version runtime). */
export const processMetrics = (): Metrics => runtime()?.metrics ?? detachedMetrics

/** The request limiter's state shared by every generation in the process (detached under a foreign-version runtime). */
export const processLimits = (): LimitState => runtime()?.limits ?? detachedLimits

/**
 * The options authentication reads: `keys` is the live key set, not the serving generation's own
 * (a generation that is still live after a key revocation keeps its old keys otherwise, #90).
 */
export function liveOptions(options: PlugboardOptions): PlugboardOptions {
  const keys = runtime()?.keys
  return keys === undefined || keys === options.keys ? options : { ...options, keys }
}

/**
 * Wraps `caller` with the response cache when option `cache` is set (a no-op without it). The store
 * lives on the runtime, so it survives plugin generations. It is replaced when the cache option or
 * any policy input (`apps`, `models`, `aliases`, `fallbacks`) differs from the one it was built for:
 * the key does not cover policy, and a hit skips the session caller's scope checks. The store is
 * resolved on the first call, not when the wrapper is built: a rejected generation is built too but
 * never serves, and must not replace the live store. Under a foreign-version runtime the store is
 * private to the wrapper.
 */
export function withResponseCache(caller: ModelCaller, options: PlugboardOptions): ModelCaller {
  const config = options.cache
  if (!config) return caller
  let wrapped: ModelCaller | undefined
  const build = (): ModelCaller => {
    const rt = runtime()
    const fingerprint = canonicalJson({
      cache: config,
      apps: options.apps,
      models: options.models,
      aliases: options.aliases,
      fallbacks: options.fallbacks,
    })
    let held = rt?.cache
    if (!held || held.fingerprint !== fingerprint) {
      held = { fingerprint, store: createCacheStore({ ttlMs: config.ttlSeconds * 1000, maxEntries: config.maxEntries, maxBytes: config.maxBytes }) }
      if (rt) rt.cache = held
    }
    const count = options.metrics ? (app: string, result: "hit" | "miss") => processMetrics().cache(app, result) : undefined
    return cachedCaller(caller, config, held.store, count)
  }
  return { stream: (request, context) => (wrapped ??= build()).stream(request, context) }
}

/** What `/v1/status` and the discovery pages report about the process, besides the model catalog. */
export interface RuntimeStatus extends RuntimeSnapshot {
  readonly runtimeVersion: number
  /** The shared listener's address, and whether it is bound; absent before the first generation registered. */
  readonly listener?: { readonly host: string; readonly port: number; readonly bound: boolean }
  /** The serving generation's Location is a confirmed app directory (else the newest generation serves). */
  readonly servingConfirmed: boolean
}

/** A synchronous snapshot of the runtime: no host call, no filesystem. */
export function processStatus(): RuntimeStatus {
  const rt = runtime()
  if (!rt) return { runtimeVersion: VERSION, generations: 0, pumpRunning: false, guards: detachedSessions.size(), startedAt: detachedStartedAt, servingConfirmed: false }
  const serving = preferred(rt)
  return {
    runtimeVersion: rt.version,
    generations: rt.generations.length,
    pumpRunning: rt.pump !== undefined,
    guards: rt.sessions.size(),
    startedAt: rt.startedAt,
    servingConfirmed: serving !== undefined && rt.confirmed.has(serving.directory),
    ...(rt.listener ? { listener: { host: rt.listener.listen.host, port: rt.listener.listen.port, bound: rt.listener.bound } } : {}),
  }
}

/** The generation that serves requests and supplies the catalog: the newest confirmed app-directory one, else the newest. */
function preferred(rt: Runtime): Generation | undefined {
  for (let index = rt.generations.length - 1; index >= 0; index--) if (rt.confirmed.has(rt.generations[index]!.directory)) return rt.generations[index]
  return rt.generations.at(-1)
}

/**
 * The catalog of the preferred accepted generation. `fallback` (the caller's own loader) is only
 * used when no generation is registered, which a live request does not normally see.
 */
export function loadServingCatalog(fallback: () => Promise<ReadonlyArray<CatalogModel>>): Promise<ReadonlyArray<CatalogModel>> {
  const rt = runtime()
  return (rt ? (preferred(rt)?.loadCatalog ?? fallback) : fallback)()
}

/** JSON with object keys sorted at every level, so equal options compare equal whatever their key order (undefined values are left out, as in `JSON.stringify`). */
function canonicalJson(value: unknown): string {
  return stableStringify(value) ?? ""
}

const unavailable = (response: ServerResponse, message: string) => {
  if (response.headersSent) return response.end()
  const body = JSON.stringify({ error: { message, type: "server_error", code: "unavailable" } })
  response.writeHead(503, { "content-type": "application/json", "content-length": Buffer.byteLength(body) })
  response.end(body)
}

function startListener(rt: Runtime, listen: { host: string; port: number }, fingerprint: string): Listener {
  const listener: Listener = { server: createServer(), listen, fingerprint, mismatchLogged: false, bound: false, bindFailures: 0, bindLoggedAt: 0 }
  listener.server.on("request", (request, response) => {
    const current = preferred(rt)
    if (!current) return unavailable(response, "plugboard is reloading")
    try {
      current.handler(request, response)
    } catch (error) {
      logError("listener.handler_failed", { error: errorMessage(error) })
      unavailable(response, "plugboard handler failed")
    }
  })
  listener.server.on("error", (error: NodeJS.ErrnoException) => {
    if (listener.bound) return logError("listener.error", { code: error.code, error: error.message })
    // Not bound: another process (or an older runtime) owns the port, so nothing here receives
    // requests while clients may be sending their keys and prompts to whoever holds it. Say so
    // loudly (error level, again every few minutes), keep trying, and mention it on every
    // generation that registers meanwhile (`registerGeneration`).
    listener.bindFailures++
    if (Date.now() - listener.bindLoggedAt >= BIND_REMINDER_MS) {
      listener.bindLoggedAt = Date.now()
      logError(error.code === "EADDRINUSE" ? "listener.address_in_use" : "listener.failed", {
        listen: `${listen.host}:${listen.port}`,
        error: error.message,
        status: "not serving: clients of this port reach another process",
        action: "stop the process that holds the port or change `listen`; plugboard retries every 15s",
      })
    }
    listener.retryTimer = setTimeout(() => {
      listener.retryTimer = undefined
      if (rt.listener === listener && !listener.bound) listener.server.listen(listen.port, listen.host)
    }, BIND_RETRY_MS)
    listener.retryTimer.unref?.()
  })
  listener.server.on("listening", () => {
    listener.bound = true
    log("listener.listening", { listen: `${listen.host}:${listen.port}`, ...(listener.bindFailures > 0 ? { recoveredAfterFailedBinds: listener.bindFailures } : {}) })
    listener.bindFailures = 0
  })
  listener.server.listen(listen.port, listen.host)
  return listener
}

function closeListener(rt: Runtime, listener: Listener): void {
  if (rt.listener !== listener) return
  rt.listener = undefined
  clearTimeout(listener.retryTimer)
  try {
    rt.pump?.stop()
  } catch {}
  listener.server.close()
  listener.server.closeAllConnections()
  if (listener.bound) log("listener.closed")
}

/**
 * Join (or create) the shared listener. The first accepted generation's options are the
 * listener's (`fingerprint`, canonical JSON of the parsed options): a generation whose options
 * differ is rejected and logs once while any generation is live, so a project config entry can
 * never serve with weaker auth than the live one. When none is live (config reload) the next
 * generation's options are adopted. A different `listen` needs a server restart and is rejected.
 * A rejected generation is not in the generation list: it never serves, supplies no catalog, and
 * the caller must not install hooks or seeds for it.
 *
 * The key set (`keys`) has one more rule (#90). While generations are live, a newer generation whose
 * keys only revoke or rotate those of apps the listener already has (no app added, at least one
 * left) replaces `Runtime.keys` at once, so a Location still on an older generation stops accepting
 * a removed key. Any other key change is rejected like any other option difference. The listener's
 * `fingerprint` covers the options without `keys`.
 */
export function registerGeneration(input: GenerationInput): Registration {
  const rt = runtime()
  if (!rt) return REJECTED
  const { listen, directory } = input
  const reject = (): Registration => {
    rt.rejected.set(directory, (rt.rejected.get(directory) ?? 0) + 1)
    let disposed = false
    return {
      accepted: false,
      confirmed: () => false,
      ready() {},
      dispose() {
        if (disposed) return
        disposed = true
        const left = (rt.rejected.get(directory) ?? 1) - 1
        if (left > 0) rt.rejected.set(directory, left)
        else rt.rejected.delete(directory)
      },
    }
  }
  const fingerprint = canonicalJson({ ...(input.options as Record<string, unknown>), keys: undefined })
  const keys = (input.options as { readonly keys?: Readonly<Record<string, string>> } | null)?.keys ?? {}
  const listener = (rt.listener ??= startListener(rt, listen, fingerprint))
  if (listener.listen.host !== listen.host || listener.listen.port !== listen.port) {
    if (!listener.mismatchLogged) {
      listener.mismatchLogged = true
      logError("listener.listen_mismatch", {
        bound: `${listener.listen.host}:${listener.listen.port}`,
        requested: `${listen.host}:${listen.port}`,
        action: "this Location is rejected; restart the server after changing `listen`",
      })
    }
    return reject()
  }
  const rejectOptions = (): Registration => {
    if (!listener.mismatchLogged) {
      listener.mismatchLogged = true
      logError("listener.options_mismatch", { action: "this Location is rejected; global config is authoritative" })
    }
    return reject()
  }
  if (listener.fingerprint !== fingerprint) {
    if (rt.generations.length > 0) return rejectOptions()
    listener.fingerprint = fingerprint
    listener.mismatchLogged = false
    rt.keys = keys
  } else if (canonicalJson(keys) !== canonicalJson(rt.keys ?? {})) {
    const live = rt.keys ?? {}
    if (rt.generations.length === 0) rt.keys = keys
    else if (revokesOrRotatesOnly(live, keys)) {
      log("listener.keys_updated", {
        removed: Object.keys(live).filter((app) => !Object.hasOwn(keys, app)).length,
        rotated: Object.keys(keys).filter((app) => Object.hasOwn(live, app) && live[app] !== keys[app]).length,
      })
      rt.keys = keys
    } else return rejectOptions()
  }
  if (listener.graceTimer) clearTimeout(listener.graceTimer)
  listener.graceTimer = undefined
  if (listener.bindFailures > 0) {
    logError("listener.not_serving", {
      listen: `${listen.host}:${listen.port}`,
      status: "another process holds the port; this generation serves nothing",
      action: "stop that process or change `listen`",
    })
  }
  const generation: Generation = {
    directory,
    handler: input.handler,
    loadCatalog: input.loadCatalog,
    refresh: input.refresh,
    history: input.history,
    hooked: false,
    // A directory confirmed before this Location booted needs no rebuild: its transforms already read `confirmed()` as true.
    activated: rt.confirmed.has(directory),
  }
  rt.generations.push(generation)
  // Accepted generations share the live options, so this is the live `logFormat` (log lines are process-wide).
  const options = input.options as { readonly logFormat?: unknown } | null
  setLogFormat(options?.logFormat === "json" ? "json" : "text")
  return {
    accepted: true,
    confirmed: () => rt.confirmed.has(directory),
    ready() {
      generation.hooked = true
    },
    dispose() {
      const index = rt.generations.indexOf(generation)
      if (index !== -1) rt.generations.splice(index, 1)
      if (rt.listener !== listener || rt.generations.length > 0 || listener.graceTimer) return
      listener.graceTimer = setTimeout(() => {
        listener.graceTimer = undefined
        if (rt.generations.length === 0) closeListener(rt, listener)
      }, GRACE_MS)
      listener.graceTimer.unref?.()
    },
  }
}

/** #90: `next` names no app that `live` lacks, and names at least one app: it only removes or changes keys. */
function revokesOrRotatesOnly(live: Readonly<Record<string, string>>, next: Readonly<Record<string, string>>): boolean {
  const apps = Object.keys(next)
  return apps.length > 0 && apps.every((app) => Object.hasOwn(live, app))
}

/**
 * Start the process-wide event pump if it is not running. The bus is server-wide, so the store
 * drops everything that is not a registered request session before it is buffered. The pump is
 * stopped when the listener closes and restarted by the next caller. `subscribe` is the calling
 * generation's bus subscription; it is only invoked when a pump actually starts.
 *
 * If the fiber ends without `stop` (the subscription failed or was closed), no more events
 * reach the store: every registered request is failed with a 502 and the pump is restarted by
 * the next request.
 */
export function ensurePump(subscribe: () => Stream.Stream<unknown, unknown, never>): void {
  const rt = runtime()
  if (!rt || rt.pump) return
  // The pump serves every request; its log lines must not carry the id of the request that started it.
  const fiber = outsideRequest(() => Effect.runFork(subscribe().pipe(Stream.runForEach((event) => Effect.sync(() => rt.sessions.dispatch(event))))))
  const pump: Pump = {
    stopped: false,
    stop: () => {
      pump.stopped = true
      fiber.interruptUnsafe()
    },
  }
  rt.pump = pump
  fiber.addObserver((exit) => {
    if (rt.pump === pump) rt.pump = undefined
    if (pump.stopped) return
    const failed = rt.sessions.failAll({
      status: 502,
      kind: "server",
      code: "event_stream_lost",
      message: "Lost the event stream of the OpenCode server",
    })
    logError("pump.stopped", {
      exit: exit._tag,
      failedRequests: failed,
      ...(exit._tag === "Failure" ? { error: (Cause.pretty(exit.cause).split("\n")[0] ?? "").slice(0, 200) } : {}),
    })
  })
}

const backendUnavailable = (message: string): PlugError => ({ status: 503, kind: "server", code: "backend_unavailable", message })

/** Waits `ms`, or until `signal` aborts (which resolves, never rejects). */
const sleep = (ms: number, signal: AbortSignal): Promise<void> => delay(ms, undefined, { signal }).catch(() => {})

/** Rebuild the transforms of a generation set up before its directory was confirmed; shared by concurrent requests. */
function activate(generation: Generation): Promise<void> {
  generation.activating ??= generation.refresh().then(
    () => void (generation.activated = true),
    (error) => {
      generation.activating = undefined
      throw error
    },
  )
  return generation.activating
}

/**
 * The per-directory readiness gate (docs/architecture.md): resolves with undefined once an
 * accepted generation in the app directory of `app` is ready to rewrite request sessions, else
 * with a `PlugError`, so the caller never prompts a session that no context hook would rewrite.
 * Only ever called from request handling, never from plugin setup.
 *
 * 1. Create and canonicalize the app directory asynchronously (`ensureAppDir`: symlink
 *    containment, the resolved directory must be strictly inside the canonical data root).
 * 2. Confirm it (before booting, so a Location that boots now sees it at setup).
 * 3. No generation there yet: `boot(directory)` makes the host boot the Location (any host call
 *    scoped to that directory that builds it; the entry passes `ctx.agent.list({ location })`),
 *    which loads the plugin there. Abandoned, not interrupted, when the request ends.
 * 4. Generations set up before the directory was confirmed get their transforms rebuilt
 *    (`GenerationInput.refresh`).
 * 5. Wait, bounded by `signal` and a timeout, until a generation there is accepted (so it runs
 *    with the live options) and has installed its hook. A generation that was rejected (options
 *    or `listen` differ) is a 503 `backend_unavailable` at once.
 */
export async function ensureBackend(
  app: string,
  signal: AbortSignal,
  boot: (directory: string) => Promise<unknown>,
): Promise<PlugError | undefined> {
  const rt = runtime()
  if (!rt) return backendUnavailable("A different plugboard runtime owns this server process; restart the server")
  try {
    const directory = await ensureAppDir(app)
    if (isPlugError(directory)) return directory
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(BACKEND_TIMEOUT_MS)])
    rt.confirmed.add(directory)

    let booted = false
    while (true) {
      if (bounded.aborted)
        return backendUnavailable(
          signal.aborted ? "The request ended before the app directory was ready" : "Timed out waiting for the plugboard app directory to load its backend",
        )
      const here = rt.generations.filter((generation) => generation.directory === directory)
      if (here.length === 0) {
        if ((rt.rejected.get(directory) ?? 0) > 0)
          return backendUnavailable("The plugboard app directory was rejected (its plugin options or `listen` differ from the live ones)")
        if (!booted) {
          booted = true
          try {
            await raceAbort(boot(directory), bounded)
          } catch (error) {
            if (bounded.aborted) continue
            logError("backend.boot_failed", { app, error: errorMessage(error) })
            return backendUnavailable("Could not start the plugboard app directory")
          }
          continue
        }
      } else {
        try {
          await raceAbort(Promise.all(here.filter((generation) => !generation.activated).map(activate)), bounded)
        } catch (error) {
          if (bounded.aborted) continue
          throw error
        }
        if (here.some((generation) => generation.hooked && generation.activated)) return undefined
      }
      await sleep(BACKEND_POLL_MS, bounded)
    }
  } catch (error) {
    if (signal.aborted) return backendUnavailable("The request ended before the app directory was ready")
    logError("backend.check_failed", { app, error: errorMessage(error) })
    return backendUnavailable("Could not prepare the plugboard app directory")
  }
}
