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

function create(listen: { host: string; port: number }): Holder {
  const holder: Holder = {
    version: VERSION,
    server: createServer(),
    listen,
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
 * Join (or create) the shared listener. Global config options are authoritative: the first
 * generation fixes `listen`; `listen` changes need a server restart (D19).
 */
export function registerGeneration(listen: { host: string; port: number }, handler: Handler): Registration {
  let holder = holderOf()
  if (holder && holder.version !== VERSION) {
    console.error(`[opencode-plugboard] listener holder version ${holder.version} is not ${VERSION}; restart the server`)
    return { dispose() {} }
  }
  holder ??= ((globalThis as Record<symbol, unknown>)[KEY] = create(listen)) as Holder
  const joined = holder
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
