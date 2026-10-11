/**
 * Forwarding façade: request state is now owned by the session store (src/session/state.ts),
 * which the process runtime (src/runtime.ts) shares across generations. Import from there; this
 * module keeps the old `getRegistry().requests` shape (`get` / `set` / `delete`) over the store
 * so existing callers keep working.
 */

import { sessionStore } from "./runtime.js"
import type { RequestState } from "./session/state.js"

export type { RequestState } from "./session/state.js"

export interface Registry {
  readonly requests: {
    get(sessionID: string): RequestState | undefined
    set(sessionID: string, state: RequestState): void
    delete(sessionID: string): boolean
  }
}

export function getRegistry(): Registry {
  const store = sessionStore()
  return {
    requests: {
      get: (sessionID) => store.lookup(sessionID),
      // The store keys by `state.sessionID`; callers pass the same value as the map key.
      set: (_sessionID, state) => store.register(state),
      delete: (sessionID) => store.release(sessionID),
    },
  }
}

/** Route one bus envelope to its request, if any. */
export function dispatch(event: unknown): void {
  sessionStore().dispatch(event)
}
