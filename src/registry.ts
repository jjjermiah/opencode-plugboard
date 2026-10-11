/**
 * Process-wide request registry (spec D17, D20, R11).
 *
 * The generation that serves an HTTP request and the generation inside the app directory that
 * runs its session are different plugin instances (one per Location), and either can be
 * replaced at any time. So per-request state lives on `globalThis`, keyed by session ID:
 * the serving side registers it, the app-directory hook reads it, and one process-wide event
 * pump feeds the request's collector. Events of sessions that are not in the registry are
 * dropped before anything is buffered.
 */

import type { PlugRequest } from "./contract.js"
import type { RequestCollector } from "./backend.js"

const VERSION = 1
const KEY = Symbol.for("opencode-plugboard.registry")

export interface RequestState {
  readonly sessionID: string
  readonly app: string
  readonly requestID: string
  readonly request: PlugRequest
  /** Images attached to the stored prompt, in order; the hook swaps them in for placeholders. */
  readonly images: ReadonlyArray<{ readonly uri: string; readonly name: string }>
  readonly collector: RequestCollector
}

export interface Registry {
  readonly requests: Map<string, RequestState>
  /** Interrupts the event pump fiber; set while the pump runs. */
  stopPump?: () => void
  /** Module version that created this registry and started its pump. */
  readonly version: number
  /** Pump running flag: true while a fiber is subscribed to the server event bus. */
  pumping: boolean
}

export function getRegistry(): Registry {
  const holder = globalThis as Record<symbol, unknown>
  const existing = holder[KEY] as Registry | undefined
  if (existing?.version === VERSION) return existing
  // Left by a different plugin version (upgrade without a server restart): stop its pump and start fresh.
  try {
    existing?.stopPump?.()
  } catch {}
  return (holder[KEY] = { version: VERSION, requests: new Map(), pumping: false } satisfies Registry) as Registry
}

/** Route one bus envelope (`{ type, data: { sessionID, ... } }`) to its request, if any. */
export function dispatch(event: unknown): void {
  const envelope = event as { type?: unknown; data?: Record<string, unknown> } | null
  const sessionID = envelope?.data?.sessionID
  if (typeof sessionID !== "string") return
  const state = getRegistry().requests.get(sessionID)
  if (!state) return
  try {
    state.collector.push({ type: envelope?.type, ...envelope?.data })
  } catch (error) {
    console.error("[opencode-plugboard] event handling failed", error)
  }
}
