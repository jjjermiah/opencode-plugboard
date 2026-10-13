/**
 * The location keep-alive (#310, #350). OpenCode evicts a Location after 60 minutes without a durable
 * session event that carries it (packages/core/src/location-activity.ts), and eviction closes the
 * Location's scope, which takes plugboard's listener with it. The TTL is fixed upstream, so
 * plugboard keeps its own Location warm: one loop per process, forked from plugin setup into the
 * plugin scope (setup itself still only registers and returns), makes one durable change every
 * 30 minutes.
 *
 * That change is a `session.create`, not a rename (#350). The eviction timer only counts a durable
 * event whose envelope carries a Location, and the bus takes that Location from the publishing
 * fiber's Location service. Plugin calls run in a fresh fiber without one (the host closes over
 * this plugin's Location instead), so a rename publishes with no Location and does not restart the
 * timer. `session.create` passes its Location explicitly, and the default is this plugin's own, so
 * the create restarts the timer. Each tick creates a fresh keep-alive session and then removes the
 * previous one, so at most two exist at once.
 *
 * The sessions are never prompted, never registered with the session store (so they are not in the
 * history index, never pruned) and never reach the usage recorder, because only request handling does
 * either.
 */

import { Effect } from "effect"
import { errorMessage, logDebug, logError } from "./log.js"

export const KEEP_ALIVE_TITLE = "plugboard keep-alive"
/** Plugin storage key of the keep-alive session id (namespaced by the host, shared by every Location). */
export const KEEP_ALIVE_KEY = "keepalive/session"
/** Half the upstream TTL, so one missed tick still leaves the Location inside the window. */
export const KEEP_ALIVE_INTERVAL_MS = 30 * 60_000

/** The host calls the keep-alive needs, as Promises. The entry builds it from `ctx` (src/session/host.ts). */
export interface KeepAliveHost {
  get(key: string): Promise<string | undefined>
  put(key: string, value: string): Promise<void>
  /** Creates the keep-alive session in this Location and returns its id. This create is the durable event that restarts the eviction timer. */
  create(title: string): Promise<string>
  /** Deletes a session. Resolves when it is gone, including when it was already deleted. */
  remove(sessionID: string): Promise<void>
}

/**
 * One keep-alive step: create a new session (the Location touch), store its id, then remove the session the
 * previous tick stored. A session stored by an older plugboard (renamed, not created) is removed the same way.
 */
export async function keepAliveOnce(host: KeepAliveHost): Promise<void> {
  const previous = await host.get(KEEP_ALIVE_KEY)
  const id = await host.create(KEEP_ALIVE_TITLE)
  await host.put(KEEP_ALIVE_KEY, id)
  if (previous !== undefined) await host.remove(previous)
}

/**
 * The interval in milliseconds. `PLUGBOARD_KEEPALIVE_INTERVAL_MS` shortens it for tests and the dev server only
 * (docs/development.md); a value that is not a positive integer is ignored.
 */
export function keepAliveIntervalMs(): number {
  const raw = Number(process.env.PLUGBOARD_KEEPALIVE_INTERVAL_MS)
  return Number.isInteger(raw) && raw > 0 ? raw : KEEP_ALIVE_INTERVAL_MS
}

/**
 * The loop forked into the plugin scope. Each tick asks `isOwner` first, so only the generation that holds the
 * keep-alive lease touches the Location (src/runtime.ts `keepAliveOwner`). A failed tick is logged and retried at
 * the next interval; it never ends the loop.
 */
export function keepAliveLoop(input: { readonly host: KeepAliveHost; readonly intervalMs: number; readonly isOwner: () => boolean }): Effect.Effect<never> {
  const tick = Effect.promise(async () => {
    if (!input.isOwner()) return
    try {
      await keepAliveOnce(input.host)
      logDebug("location.keepalive", { outcome: "ok" })
    } catch (error) {
      logError("location.keepalive_failed", { error: errorMessage(error) })
    }
  })
  return Effect.forever(Effect.sleep(input.intervalMs).pipe(Effect.andThen(tick)))
}
