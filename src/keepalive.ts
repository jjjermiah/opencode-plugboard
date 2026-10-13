/**
 * The location keep-alive (#310). OpenCode evicts a Location after 60 minutes without a durable
 * session event that carries it (packages/core/src/location-activity.ts), and eviction closes the
 * Location's scope, which takes plugboard's listener with it. The TTL is fixed upstream, so
 * plugboard keeps its own Location warm: one loop per process, forked from plugin setup into the
 * plugin scope (setup itself still only registers and returns), makes one cheap durable change every
 * 30 minutes on one dedicated session: a rename to the same title. `session.renamed` is durable and
 * the bus stamps it with the publishing fiber's Location, which is this plugin's Location, so the
 * eviction timer restarts for it. The rename also advances the session's `time.updated`.
 *
 * The session is created once, lazily, and its id is kept in plugin storage. It is never prompted,
 * never registered with the session store (so it is not in the history index, never pruned) and
 * never reaches the usage recorder, because only request handling does either.
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
  /** Renames the session. `missing` when the host no longer has it (it was deleted). */
  rename(sessionID: string, title: string): Promise<"renamed" | "missing">
  /** Creates the keep-alive session with its id as text. */
  create(title: string): Promise<string>
}

/**
 * One keep-alive step: rename the stored session, or create and store a new one when none is stored or the
 * stored one was deleted. Returns which of the two happened.
 */
export async function keepAliveOnce(host: KeepAliveHost): Promise<"renamed" | "created"> {
  const held = await host.get(KEEP_ALIVE_KEY)
  if (held !== undefined && (await host.rename(held, KEEP_ALIVE_TITLE)) === "renamed") return "renamed"
  const id = await host.create(KEEP_ALIVE_TITLE)
  await host.put(KEEP_ALIVE_KEY, id)
  return "created"
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
      logDebug("location.keepalive", { outcome: await keepAliveOnce(input.host) })
    } catch (error) {
      logError("location.keepalive_failed", { error: errorMessage(error) })
    }
  })
  return Effect.forever(Effect.sleep(input.intervalMs).pipe(Effect.andThen(tick)))
}
