/**
 * Helpers for tests of the process runtime (src/runtime.ts), which lives on `globalThis` and
 * owns a real listener. Every runtime test file calls `isolateRuntime()` so each test starts with
 * no runtime and ends with its listener closed, and gets its own data root.
 */
import { afterEach, beforeEach } from "bun:test"
import { mkdirSync } from "node:fs"
import { createServer, type Server } from "node:net"
import { join } from "node:path"
import type { GenerationInput } from "../../src/runtime.js"
import type { HistoryPort } from "../../src/session/host.js"
import { CATALOG } from "./fixtures.js"

/** The runtime's global key (src/runtime.ts `KEY`). */
export const RUNTIME_KEY = Symbol.for("opencode-plugboard.runtime")

interface RuntimeShape {
  listener?: { server: { close(): void; closeAllConnections(): void }; graceTimer?: ReturnType<typeof setTimeout>; retryTimer?: ReturnType<typeof setTimeout> }
  pump?: { stop(): void }
}

const slot = globalThis as Record<symbol, unknown>

/** Closes the listener and pump of the current runtime (if any) and removes it from `globalThis`. */
export function resetRuntime(): void {
  const rt = slot[RUNTIME_KEY] as RuntimeShape | undefined
  if (rt?.listener) {
    clearTimeout(rt.listener.graceTimer)
    clearTimeout(rt.listener.retryTimer)
    rt.listener.server.closeAllConnections()
    rt.listener.server.close()
  }
  try {
    rt?.pump?.stop()
  } catch {}
  delete slot[RUNTIME_KEY]
}

/** Installs a runtime written by another plugboard version. */
export function installForeignRuntime(version: number): void {
  resetRuntime()
  slot[RUNTIME_KEY] = { version }
}

let counter = 0

/** Before each test: no runtime and a fresh, empty `$XDG_DATA_HOME`. After: listener closed. */
export function isolateRuntime(): void {
  beforeEach(() => {
    resetRuntime()
    const base = join(process.env.PLUGBOARD_TEST_SANDBOX!, `data-${process.pid}-${++counter}`)
    mkdirSync(base, { recursive: true })
    process.env.XDG_DATA_HOME = base
  })
  afterEach(() => resetRuntime())
}

/** A port that was free a moment ago (the runtime binds `listen.port` itself). */
export async function freePort(): Promise<number> {
  const server: Server = createServer()
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as { port: number }
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

/** A `HistoryPort` that does nothing (generations need one; pruning is #97's). */
export const NO_HISTORY: HistoryPort = {
  put: async () => {},
  drop: async () => {},
  scan: async () => ({ keys: [] }),
  removeSession: async () => "missing",
}

/** A `GenerationInput` whose handler answers with its `name`, for telling generations apart over HTTP. */
export function generation(name: string, input: Partial<GenerationInput> & { readonly port: number }): GenerationInput {
  const { port, ...rest } = input
  return {
    listen: { host: "127.0.0.1", port },
    options: { models: ["test/*"] },
    directory: `/projects/${name}`,
    handler: (_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" })
      response.end(name)
    },
    loadCatalog: async () => CATALOG,
    refresh: async () => {},
    history: { port: NO_HISTORY, limits: {} },
    ...rest,
  }
}
