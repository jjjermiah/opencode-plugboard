/**
 * Process-wide HTTP listener (spec D7, D18, D19, R7, R12).
 *
 * OpenCode loads the plugin once per Location, so many plugin generations exist at once. The
 * first one to load binds the port; later ones join. Generations register a handler; the
 * newest live handler serves requests. When the last generation is gone the listener waits
 * a grace period (config reloads recreate every generation at once) before closing; requests
 * arriving with no live generation get 503.
 *
 * The holder lives on `globalThis` under a versioned key, because the module itself may be
 * re-evaluated per Location or on reload. A holder written by a different version is left
 * alone and this generation stays inert.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

export type Handler = (request: IncomingMessage, response: ServerResponse) => void

const VERSION = 1
const KEY = Symbol.for("opencode-plugboard.listener")
export const GRACE_MS = 10_000

interface Holder {
  readonly version: number
  readonly server: Server
  readonly listen: { readonly host: string; readonly port: number }
  /** JSON of the parsed options of the generation that bound the port; later generations must match it. */
  fingerprint: string | undefined
  mismatchLogged: boolean
  readonly handlers: Handler[]
  readonly closeHooks: Map<string, () => void>
  graceTimer?: ReturnType<typeof setTimeout>
  bound: boolean
}

export interface Registration {
  /** Synchronous; safe in a finalizer (D20). */
  dispose(): void
}

const holderOf = () => (globalThis as Record<symbol, unknown>)[KEY] as Holder | undefined

const unavailable = (response: ServerResponse, message: string) => {
  if (response.headersSent) return response.end()
  const body = JSON.stringify({ error: { message, type: "server_error", code: "unavailable" } })
  response.writeHead(503, { "content-type": "application/json", "content-length": Buffer.byteLength(body) })
  response.end(body)
}

function create(listen: { host: string; port: number }, fingerprint: string): Holder {
  const holder: Holder = {
    version: VERSION,
    server: createServer(),
    listen,
    fingerprint,
    mismatchLogged: false,
    handlers: [],
    closeHooks: new Map(),
    bound: false,
  }
  holder.server.on("request", (request, response) => {
    const current = holder.handlers.at(-1)
    if (!current) return unavailable(response, "plugboard is reloading")
    try {
      current(request, response)
    } catch (error) {
      console.error("[opencode-plugboard] handler failed", error)
      unavailable(response, "plugboard handler failed")
    }
  })
  holder.server.on("error", (error: NodeJS.ErrnoException) => {
    if (holder.bound) return console.error("[opencode-plugboard] listener error", error)
    // Never bound: another process (or an older holder) owns the port. Log once, stay inert.
    console.error(
      error.code === "EADDRINUSE"
        ? `[opencode-plugboard] ${listen.host}:${listen.port} is already in use; this server will not serve plugboard`
        : `[opencode-plugboard] listener failed: ${error.message}`,
    )
  })
  holder.server.listen(listen.port, listen.host, () => {
    holder.bound = true
    console.log(`[opencode-plugboard] listening on http://${listen.host}:${listen.port}`)
  })
  return holder
}

function close(holder: Holder): void {
  if ((globalThis as Record<symbol, unknown>)[KEY] === holder) delete (globalThis as Record<symbol, unknown>)[KEY]
  for (const hook of holder.closeHooks.values()) {
    try {
      hook()
    } catch {}
  }
  holder.closeHooks.clear()
  holder.server.close()
  holder.server.closeAllConnections()
  if (holder.bound) console.log("[opencode-plugboard] listener closed")
}

/**
 * Join (or create) the shared listener. Global config options are authoritative (D19): the
 * live generations fix the options (`fingerprint`, JSON of the parsed options): one whose options
 * differ logs once and stays inert, so a project config entry can never serve with weaker auth
 * than the live one. When none is live (config reload) the next generation's options are
 * adopted. A different `listen` needs a server restart.
 */
export function registerGeneration(listen: { host: string; port: number }, handler: Handler, fingerprint: string): Registration {
  let holder = holderOf()
  if (holder && holder.version !== VERSION) {
    console.error(`[opencode-plugboard] listener holder version ${holder.version} is not ${VERSION}; restart the server`)
    return { dispose() {} }
  }
  holder ??= ((globalThis as Record<symbol, unknown>)[KEY] = create(listen, fingerprint)) as Holder
  const joined = holder
  if (joined.listen.host !== listen.host || joined.listen.port !== listen.port) {
    if (!joined.mismatchLogged) {
      joined.mismatchLogged = true
      console.error(
        `[opencode-plugboard] listener is bound to ${joined.listen.host}:${joined.listen.port}; this Location asks for ${listen.host}:${listen.port} and stays inert. Restart the server after changing \`listen\``,
      )
    }
    return { dispose() {} }
  }
  // Same port, other options: a live generation owns them (global config is authoritative), so
  // this one stays inert. With none live (config reload: all old generations disposed) the new
  // options are adopted. A holder from before fingerprints also lands here and adopts.
  if (joined.fingerprint !== fingerprint) {
    if (joined.handlers.length > 0 && joined.fingerprint !== undefined) {
      if (!joined.mismatchLogged) {
        joined.mismatchLogged = true
        console.error("[opencode-plugboard] plugin options differ from the live listener's (global config is authoritative); this Location stays inert")
      }
      return { dispose() {} }
    }
    joined.fingerprint = fingerprint
    joined.mismatchLogged = false
  }
  if (joined.graceTimer) clearTimeout(joined.graceTimer)
  joined.graceTimer = undefined
  joined.handlers.push(handler)
  return {
    dispose() {
      const index = joined.handlers.indexOf(handler)
      if (index !== -1) joined.handlers.splice(index, 1)
      if (joined.handlers.length > 0 || joined.graceTimer) return
      joined.graceTimer = setTimeout(() => {
        joined.graceTimer = undefined
        if (joined.handlers.length === 0) close(joined)
      }, GRACE_MS)
      joined.graceTimer.unref?.()
    },
  }
}

/** Run `hook` when the listener closes (after the grace period). Keyed so generations don't stack hooks. */
export function onListenerClose(key: string, hook: () => void): void {
  holderOf()?.closeHooks.set(key, hook)
}
