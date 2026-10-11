/**
 * Session ownership store shared across plugin generations.
 *
 * The generation that serves an HTTP request and the generation inside the app directory that
 * runs its session are different plugin instances (one per Location), and either can be replaced
 * at any time. So per-request state is kept by session ID in one store owned by the process
 * runtime (src/runtime.ts): the serving side registers it, the app-directory hook looks it up,
 * and the process-wide event pump dispatches bus events to the request's event sink. Events of
 * sessions that are not registered are dropped before anything is buffered.
 */

import type { PlugRequest } from "../contract.js"
import { errorMessage, logError } from "../log.js"

/** Receives the flattened bus events of one session. The collector implements it. */
export interface EventSink {
  push(event: Record<string, unknown>): void
}

export interface RequestState {
  readonly sessionID: string
  readonly app: string
  readonly requestID: string
  readonly request: PlugRequest
  readonly collector: EventSink
}

export interface SessionStore {
  /** Own a request session; replaces any state registered under the same session ID. */
  register(state: RequestState): void
  lookup(sessionID: string): RequestState | undefined
  /** Route one bus envelope (`{ type, data: { sessionID, ... } }`) to its request's sink, if any. */
  dispatch(event: unknown): void
  /** Stop owning a session; false when it was not registered. */
  release(sessionID: string): boolean
}

export function createSessionStore(): SessionStore {
  const states = new Map<string, RequestState>()
  return {
    register: (state) => void states.set(state.sessionID, state),
    lookup: (sessionID) => states.get(sessionID),
    release: (sessionID) => states.delete(sessionID),
    dispatch(event) {
      const envelope = event as { type?: unknown; data?: Record<string, unknown> } | null
      const sessionID = envelope?.data?.sessionID
      if (typeof sessionID !== "string") return
      const state = states.get(sessionID)
      if (!state) return
      try {
        state.collector.push({ type: envelope?.type, ...envelope?.data })
      } catch (error) {
        logError("session.event_failed", { error: errorMessage(error) })
      }
    },
  }
}
