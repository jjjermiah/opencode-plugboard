/**
 * Session ownership store shared across plugin generations.
 *
 * The generation that serves an HTTP request and the generation inside the app directory that
 * runs its session are different plugin instances (one per Location), and either can be replaced
 * at any time. So per-request state is kept by session ID in one store owned by the process
 * runtime (src/runtime.ts): the serving side registers it, the app-directory hook looks it up,
 * and the process-wide event pump dispatches bus events to the request's event sink. Events of
 * sessions that are not registered are dropped before anything is buffered.
 *
 * An entry is the request guard: while it exists, the context hook replaces the model request
 * and tools. It outlives the HTTP response. It is released when the host reports the end of the
 * session's execution (`session.execution.*`), or, after the response finished, when the bounded
 * cleanup of `retire` runs out. Timers here are unref'd and owned by the process runtime's store,
 * never by a plugin finalizer.
 */

import type { PlugError, PlugRequest } from "../contract.js"
import { errorMessage, logError } from "../log.js"

/** Receives the flattened bus events of one session. The collector implements it. */
export interface EventSink {
  push(event: Record<string, unknown>): void
}

/** Synthetic event (`{ type, error: PlugError }`) that fails a request from inside the process: lost event stream, preparation mismatch. */
export const FAILURE_EVENT = "plugboard.failure"

export interface RequestState {
  readonly sessionID: string
  readonly app: string
  readonly requestID: string
  readonly request: PlugRequest
  readonly collector: EventSink
  /** System parts placed before the app's and the caller's (a skill's content, option `skill:` alias). Empty or absent for a plain model. */
  readonly prelude?: ReadonlyArray<string>
  /** How many messages the caller transcript took in the last context call; the host's later messages follow them (#417). Set by the context hook. */
  callerMessages?: number
}

export interface Retirement {
  /** How long the guard may outlive the response while the host execution has not ended. */
  readonly timeoutMs: number
  /** Called once if the timeout runs out (the host never confirmed the end of the execution). Must not block. */
  onTimeout(): void
}

export interface SessionStore {
  /** Own a request session; replaces any state registered under the same session ID. */
  register(state: RequestState): void
  lookup(sessionID: string): RequestState | undefined
  /** Route one bus envelope (`{ type, data: { sessionID, ... } }`) to its request's sink, if any. Releases the session when its execution ended. */
  dispatch(event: unknown): void
  /** Stop owning a session; false when it was not registered. */
  release(sessionID: string): boolean
  /**
   * The response is over: keep the guard until the host reports the end of the execution, or
   * until `timeoutMs` passes, which is logged and released after `onTimeout`. No-op when the
   * session is already released.
   */
  retire(sessionID: string, retirement: Retirement): void
  /** Fail every registered request with `error`; returns how many were registered. */
  failAll(error: PlugError): number
  /** How many request guards are outstanding (metrics and status only). */
  size(): number
}

const EXECUTION_END = new Set(["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"])

interface Entry {
  readonly state: RequestState
  readonly startedAt: number
  timer?: ReturnType<typeof setTimeout>
}

export interface SessionStoreOptions {
  /** Called once per `register`, from request handling (the runtime indexes the session for pruning). Must not block; errors are logged. */
  readonly onRegister?: (state: RequestState) => void
}

export function createSessionStore(options: SessionStoreOptions = {}): SessionStore {
  const entries = new Map<string, Entry>()

  const release = (sessionID: string): boolean => {
    const entry = entries.get(sessionID)
    if (!entry) return false
    if (entry.timer) clearTimeout(entry.timer)
    return entries.delete(sessionID)
  }

  return {
    register(state) {
      const previous = entries.get(state.sessionID)
      if (previous?.timer) clearTimeout(previous.timer)
      entries.set(state.sessionID, { state, startedAt: Date.now() })
      try {
        options.onRegister?.(state)
      } catch (error) {
        logError("session.register_hook_failed", { error: errorMessage(error) })
      }
    },
    lookup: (sessionID) => entries.get(sessionID)?.state,
    release,
    dispatch(event) {
      const envelope = event as { type?: unknown; data?: Record<string, unknown> } | null
      const sessionID = envelope?.data?.sessionID
      if (typeof sessionID !== "string") return
      const entry = entries.get(sessionID)
      if (!entry) return
      try {
        entry.state.collector.push({ type: envelope?.type, ...envelope?.data })
      } catch (error) {
        logError("session.event_failed", { error: errorMessage(error) })
      }
      if (typeof envelope?.type === "string" && EXECUTION_END.has(envelope.type)) release(sessionID)
    },
    retire(sessionID, retirement) {
      const entry = entries.get(sessionID)
      if (!entry || entry.timer) return
      entry.timer = setTimeout(() => {
        if (entries.get(sessionID) !== entry) return
        logError("session.cleanup_timeout", {
          sessionID,
          requestID: entry.state.requestID,
          app: entry.state.app,
          model: entry.state.request.model,
          durationMs: Date.now() - entry.startedAt,
          outcome: "execution_end_not_confirmed",
        })
        try {
          retirement.onTimeout()
        } catch (error) {
          logError("session.cleanup_failed", { requestID: entry.state.requestID, error: errorMessage(error) })
        }
        entries.delete(sessionID)
      }, retirement.timeoutMs)
      entry.timer.unref?.()
    },
    failAll(error) {
      for (const entry of entries.values()) {
        try {
          entry.state.collector.push({ type: FAILURE_EVENT, error })
        } catch (cause) {
          logError("session.event_failed", { error: errorMessage(cause) })
        }
      }
      return entries.size
    },
    size: () => entries.size,
  }
}
