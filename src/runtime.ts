/**
 * Process runtime: the one owner of everything that outlives a plugin generation.
 *
 * OpenCode loads the plugin once per Location, so many generations exist at once, and the module
 * itself may be re-evaluated per Location or on reload. The runtime therefore lives on
 * `globalThis` under a versioned key and holds:
 *   - the generation list: request handlers, newest last; the newest live one serves requests;
 *   - the HTTP listener lifetime: the first generation binds the port, later ones join; when the
 *     last generation is gone the listener waits a grace period (a config reload recreates every
 *     generation at once) before closing; requests arriving with no live generation get 503;
 *   - the event pump lifetime: one fiber on the host's default runtime, owned by no generation
 *     scope, forwarding bus events of request sessions to the session store;
 *   - the session store (src/session/state.ts), which outlives the listener.
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
import { Effect, Stream } from "effect"
import { errorMessage, log, logError } from "./log.js"
import { createSessionStore, type SessionStore } from "./session/state.js"

export type Handler = (request: IncomingMessage, response: ServerResponse) => void

export interface Registration {
  /** Synchronous; safe in a finalizer. */
  dispose(): void
}

export const GRACE_MS = 10_000

const VERSION = 1
const KEY = Symbol.for("opencode-plugboard.runtime")

interface Listener {
  readonly server: Server
  readonly listen: { readonly host: string; readonly port: number }
  /** JSON of the parsed options of the generation that bound the port; later generations must match it. */
  fingerprint: string
  mismatchLogged: boolean
  bound: boolean
  graceTimer?: ReturnType<typeof setTimeout>
}

interface Runtime {
  readonly version: number
  readonly sessions: SessionStore
  readonly generations: Handler[]
  readonly closeHooks: Map<string, () => void>
  listener?: Listener
  /** Present while a fiber is subscribed to the server event bus. */
  pump?: { readonly stop: () => void }
}

const INERT: Registration = { dispose() {} }

/** Used when a foreign-version runtime owns the process: never registered into, never dispatched to. */
const detachedSessions = createSessionStore()
let foreignVersionLogged = false

/** The process runtime, created on first use; undefined when a different version already owns the process. */
function runtime(): Runtime | undefined {
  const slot = globalThis as Record<symbol, unknown>
  const existing = slot[KEY] as { readonly version: number } | undefined
  if (!existing) {
    const created: Runtime = { version: VERSION, sessions: createSessionStore(), generations: [], closeHooks: new Map() }
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

const unavailable = (response: ServerResponse, message: string) => {
  if (response.headersSent) return response.end()
  const body = JSON.stringify({ error: { message, type: "server_error", code: "unavailable" } })
  response.writeHead(503, { "content-type": "application/json", "content-length": Buffer.byteLength(body) })
  response.end(body)
}

function startListener(rt: Runtime, listen: { host: string; port: number }, fingerprint: string): Listener {
  const listener: Listener = { server: createServer(), listen, fingerprint, mismatchLogged: false, bound: false }
  listener.server.on("request", (request, response) => {
    const current = rt.generations.at(-1)
    if (!current) return unavailable(response, "plugboard is reloading")
    try {
      current(request, response)
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
  for (const hook of rt.closeHooks.values()) {
    try {
      hook()
    } catch {}
  }
  rt.closeHooks.clear()
  listener.server.close()
  listener.server.closeAllConnections()
  if (listener.bound) log("listener.closed")
}

/**
 * Join (or create) the shared listener. The first accepted generation's options are the
 * listener's (`fingerprint`, JSON of the parsed options): a generation whose options differ logs
 * once and stays inert while any generation is live, so a project config entry can never serve
 * with weaker auth than the live one. When none is live (config reload) the next generation's
 * options are adopted. A different `listen` needs a server restart. An inert generation gets a
 * no-op registration, same as an accepted one.
 */
export function registerGeneration(listen: { host: string; port: number }, handler: Handler, fingerprint: string): Registration {
  const rt = runtime()
  if (!rt) return INERT
  const listener = (rt.listener ??= startListener(rt, listen, fingerprint))
  if (listener.listen.host !== listen.host || listener.listen.port !== listen.port) {
    if (!listener.mismatchLogged) {
      listener.mismatchLogged = true
      logError("listener.listen_mismatch", {
        bound: `${listener.listen.host}:${listener.listen.port}`,
        requested: `${listen.host}:${listen.port}`,
        action: "stays inert; restart the server after changing `listen`",
      })
    }
    return INERT
  }
  if (listener.fingerprint !== fingerprint) {
    if (rt.generations.length > 0) {
      if (!listener.mismatchLogged) {
        listener.mismatchLogged = true
        logError("listener.options_mismatch", { action: "this Location stays inert; global config is authoritative" })
      }
      return INERT
    }
    listener.fingerprint = fingerprint
    listener.mismatchLogged = false
  }
  if (listener.graceTimer) clearTimeout(listener.graceTimer)
  listener.graceTimer = undefined
  rt.generations.push(handler)
  return {
    dispose() {
      const index = rt.generations.indexOf(handler)
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

/** Run `hook` when the listener closes (after the grace period). Keyed so generations don't stack hooks. */
export function onListenerClose(key: string, hook: () => void): void {
  const rt = runtime()
  if (rt?.listener) rt.closeHooks.set(key, hook)
}

/**
 * Start the process-wide event pump if it is not running. The bus is server-wide, so the store
 * drops everything that is not a registered request session before it is buffered. The pump is
 * stopped when the listener closes and restarted by the next caller. `subscribe` is the calling
 * generation's bus subscription; it is only invoked when a pump actually starts.
 */
export function ensurePump(subscribe: () => Stream.Stream<unknown, unknown, never>): void {
  const rt = runtime()
  if (!rt || rt.pump) return
  const fiber = Effect.runFork(subscribe().pipe(Stream.runForEach((event) => Effect.sync(() => rt.sessions.dispatch(event)))))
  const pump = { stop: () => void fiber.interruptUnsafe() }
  rt.pump = pump
  fiber.addObserver(() => {
    if (rt.pump === pump) rt.pump = undefined
  })
}
