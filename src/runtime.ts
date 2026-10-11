/**
 * Process runtime: the one owner of everything that outlives a plugin generation.
 *
 * OpenCode loads the plugin once per Location, so many generations exist at once, and the module
 * itself may be re-evaluated per Location or on reload. The runtime therefore lives on
 * `globalThis` under a versioned key and holds:
 *   - the generation list: the ACCEPTED generations (request handler, catalog loader), newest
 *     last. A generation whose Location is inside the plugboard data root is the preferred owner:
 *     it serves requests and supplies the catalog; without one the newest generation does;
 *   - the HTTP listener lifetime: the first generation binds the port, later ones join; when the
 *     last generation is gone the listener waits a grace period (a config reload recreates every
 *     generation at once) before closing; requests arriving with no live generation get 503;
 *   - the event pump lifetime: one fiber on the host's default runtime, owned by no generation
 *     scope, forwarding bus events of request sessions to the session store. If it dies, the
 *     requests in flight fail with a 502 instead of waiting for their deadline;
 *   - the session store (src/session/state.ts), which outlives the listener and owns the request
 *     guards, their cleanup timers included.
 *
 * Registration is explicit: `registerGeneration` returns whether the generation was accepted. A
 * rejected one (different `listen`, options that differ from the live ones, foreign runtime) never
 * serves and must not install hooks or seeds.
 *
 * Version policy: a runtime written by a different version is never touched or replaced; this
 * module then behaves as inert (no listener, no pump, an empty detached session store) and logs
 * once that the server needs a restart.
 *
 * Freeze safety: everything a generation calls from plugin setup or a finalizer here is
 * synchronous and makes no call on the plugin context. `Registration.dispose` only mutates state
 * and arms an unref'd timer; the pump is started lazily by request handling, never awaited.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { Cause, Effect, Stream } from "effect"
import type { CatalogModel } from "./contract.js"
import { errorMessage, log, logError } from "./log.js"
import { createSessionStore, type SessionStore } from "./session/state.js"

export type Handler = (request: IncomingMessage, response: ServerResponse) => void

export interface Registration {
  /** False when the generation was rejected: it serves nothing and must not install hooks or seeds. */
  readonly accepted: boolean
  /** Synchronous; safe in a finalizer. */
  dispose(): void
}

export interface GenerationInput {
  readonly listen: { readonly host: string; readonly port: number }
  /** The parsed options. Generations must agree on them; compared by canonical JSON (key order is irrelevant). */
  readonly options: unknown
  /** True when this generation's Location is inside the plugboard data root (the preferred owner). */
  readonly owner: boolean
  readonly handler: Handler
  /** The enabled models as this generation's Location sees them. */
  readonly loadCatalog: () => Promise<ReadonlyArray<CatalogModel>>
}

const GRACE_MS = 10_000

const VERSION = 2
const KEY = Symbol.for("opencode-plugboard.runtime")

interface Listener {
  readonly server: Server
  readonly listen: { readonly host: string; readonly port: number }
  /** Canonical JSON of the parsed options of the generations the listener serves; later generations must match it. */
  fingerprint: string
  mismatchLogged: boolean
  bound: boolean
  graceTimer?: ReturnType<typeof setTimeout>
}

interface Generation {
  readonly owner: boolean
  readonly handler: Handler
  readonly loadCatalog: GenerationInput["loadCatalog"]
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
  listener?: Listener
  /** Present while a fiber is subscribed to the server event bus. */
  pump?: Pump
}

const REJECTED: Registration = { accepted: false, dispose() {} }

/** Used when a foreign-version runtime owns the process: never registered into, never dispatched to. */
const detachedSessions = createSessionStore()
let foreignVersionLogged = false

/** The process runtime, created on first use; undefined when a different version already owns the process. */
function runtime(): Runtime | undefined {
  const slot = globalThis as Record<symbol, unknown>
  const existing = slot[KEY] as { readonly version: number } | undefined
  if (!existing) {
    const created: Runtime = { version: VERSION, sessions: createSessionStore(), generations: [] }
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

/** The session store shared by every generation in the process. */
export const sessionStore = (): SessionStore => runtime()?.sessions ?? detachedSessions

/** The generation that serves requests and supplies the catalog: the newest data-root one, else the newest. */
function preferred(rt: Runtime): Generation | undefined {
  for (let index = rt.generations.length - 1; index >= 0; index--) if (rt.generations[index]!.owner) return rt.generations[index]
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

/** JSON with object keys sorted at every level, so equal options compare equal whatever their key order. */
function canonicalJson(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical)
    if (typeof item !== "object" || item === null) return item
    return Object.fromEntries(
      Object.entries(item)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    )
  }
  return JSON.stringify(canonical(value))
}

const unavailable = (response: ServerResponse, message: string) => {
  if (response.headersSent) return response.end()
  const body = JSON.stringify({ error: { message, type: "server_error", code: "unavailable" } })
  response.writeHead(503, { "content-type": "application/json", "content-length": Buffer.byteLength(body) })
  response.end(body)
}

function startListener(rt: Runtime, listen: { host: string; port: number }, fingerprint: string): Listener {
  const listener: Listener = { server: createServer(), listen, fingerprint, mismatchLogged: false, bound: false }
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
    // Never bound: another process (or an older runtime) owns the port. Log once, stay inert.
    logError(error.code === "EADDRINUSE" ? "listener.address_in_use" : "listener.failed", {
      listen: `${listen.host}:${listen.port}`,
      error: error.message,
    })
  })
  listener.server.listen(listen.port, listen.host, () => {
    listener.bound = true
    log("listener.listening", { listen: `${listen.host}:${listen.port}` })
  })
  return listener
}

function closeListener(rt: Runtime, listener: Listener): void {
  if (rt.listener !== listener) return
  rt.listener = undefined
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
 */
export function registerGeneration(input: GenerationInput): Registration {
  const rt = runtime()
  if (!rt) return REJECTED
  const { listen } = input
  const fingerprint = canonicalJson(input.options)
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
    return REJECTED
  }
  if (listener.fingerprint !== fingerprint) {
    if (rt.generations.length > 0) {
      if (!listener.mismatchLogged) {
        listener.mismatchLogged = true
        logError("listener.options_mismatch", { action: "this Location is rejected; global config is authoritative" })
      }
      return REJECTED
    }
    listener.fingerprint = fingerprint
    listener.mismatchLogged = false
  }
  if (listener.graceTimer) clearTimeout(listener.graceTimer)
  listener.graceTimer = undefined
  const generation: Generation = { owner: input.owner, handler: input.handler, loadCatalog: input.loadCatalog }
  rt.generations.push(generation)
  return {
    accepted: true,
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
  const fiber = Effect.runFork(subscribe().pipe(Stream.runForEach((event) => Effect.sync(() => rt.sessions.dispatch(event)))))
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
