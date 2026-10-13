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
 * timer. `session.create` passes its Location explicitly, and a child create takes its parent's
 * Location (the plugin's own), so either restarts the timer.
 *
 * One long-lived parent, titled `plugboard keep-alive`, is created once in this Location and kept
 * in plugin storage (its id under `KEEP_ALIVE_KEY`). Each tick creates a child under it, so OpenCode
 * lists show one stable row (children are hidden from the root list). The children still to remove
 * are kept in plugin storage (`KEEP_ALIVE_CHILDREN`), so a failed remove or write is retried on a later
 * tick instead of leaking a session.
 *
 * None of these sessions is prompted, registered with the session store (so none is in the history
 * index, pruned, or counted in usage) or reaches the usage recorder, because only request handling does
 * either.
 */

import { Effect } from "effect"
import { errorMessage, logDebug, logError } from "./log.js"

export const KEEP_ALIVE_TITLE = "plugboard keep-alive"
/** Plugin storage key of the parent keep-alive session id (namespaced by the host, shared by every Location). */
export const KEEP_ALIVE_KEY = "keepalive/session"
/** Plugin storage key of the JSON array of child session ids still to be removed, the newest last. */
export const KEEP_ALIVE_CHILDREN = "keepalive/children"
/** Half the upstream TTL, so one missed tick still leaves the Location inside the window. */
export const KEEP_ALIVE_INTERVAL_MS = 30 * 60_000

/** The host calls the keep-alive needs, as Promises. The entry builds it from `ctx` (src/session/host.ts). */
export interface KeepAliveHost {
  get(key: string): Promise<string | undefined>
  put(key: string, value: string): Promise<void>
  /** Creates the parent session in this Location, with the keep-alive's permissions, and returns its id. */
  createRoot(title: string): Promise<string>
  /** Creates a child of `parentID` (in the parent's Location). Resolves `undefined` when the parent no longer exists. */
  createChild(title: string, parentID: string): Promise<string | undefined>
  /** Deletes a session. Resolves when it is gone, including when it was already deleted. Rejects on any other failure. */
  remove(sessionID: string): Promise<void>
}

/** The children still to remove, from storage. A value that is not a JSON array of strings counts as none. */
async function trackedChildren(host: KeepAliveHost): Promise<string[]> {
  const raw = await host.get(KEEP_ALIVE_CHILDREN)
  if (raw === undefined) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string") ? parsed : []
  } catch {
    return []
  }
}

/** Creates the parent in this Location and stores its id. */
async function createParent(host: KeepAliveHost): Promise<string> {
  const id = await host.createRoot(KEEP_ALIVE_TITLE)
  await host.put(KEEP_ALIVE_KEY, id)
  return id
}

/**
 * One keep-alive step: create a child under the stored parent (the Location touch), track it, then remove the children
 * the earlier ticks left. A removal that fails stays tracked for the next tick, and the failure is rethrown after the
 * list is written. A missing parent is created again.
 */
export async function keepAliveOnce(host: KeepAliveHost): Promise<void> {
  let parent = await host.get(KEEP_ALIVE_KEY)
  if (parent === undefined) parent = await createParent(host)
  let child = await host.createChild(KEEP_ALIVE_TITLE, parent)
  if (child === undefined) {
    parent = await createParent(host)
    child = await host.createChild(KEEP_ALIVE_TITLE, parent)
    if (child === undefined) throw new Error("the new keep-alive parent is already gone")
  }
  const stale = await trackedChildren(host)
  // Track the new child before removing anything: if this write fails, the child is removed and nothing leaks.
  try {
    await host.put(KEEP_ALIVE_CHILDREN, JSON.stringify([...stale, child]))
  } catch (error) {
    await host.remove(child).catch(() => undefined)
    throw error
  }
  const kept: string[] = []
  let failure: { readonly error: unknown } | undefined
  for (const id of stale) {
    try {
      await host.remove(id)
    } catch (error) {
      kept.push(id)
      failure ??= { error }
    }
  }
  await host.put(KEEP_ALIVE_CHILDREN, JSON.stringify([...kept, child]))
  if (failure !== undefined) throw failure.error
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
