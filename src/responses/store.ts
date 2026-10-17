/**
 * The output items of recent Responses answers, so a later request can refer to them with an
 * `item_reference` (#147). The Vercel AI SDK keeps `store: true` by default and sends the earlier
 * assistant turn as references to the items plugboard returned, so without this store its
 * multi-turn chat is refused.
 *
 * Bounded and per app: an app's store holds up to 1000 answers for an hour, and an app reads only
 * its own answers. Nothing is written to disk. The store lives on `globalThis` under a versioned
 * key, as the other process-wide state does (docs/architecture.md, I6), so it outlives a plugin
 * generation that is replaced. A reference to an item that was evicted, expired or never returned
 * is a 400 that suggests `store: false`; it is never a guess.
 *
 * This is not the stored Responses of `previous_response_id` (src/responses/state.ts, durable, per app, kept for the
 * app's history retention). A `DELETE /v1/responses/{id}` also drops the answer here (`forgetAnswer`).
 */
import { LRUCache } from "lru-cache"

type Item = Readonly<Record<string, unknown>>

const TTL_MS = 60 * 60 * 1000
const MAX_ANSWERS = 1000
const SLOT = Symbol.for("opencode-plugboard.responses-items/1")

const holder = globalThis as unknown as Record<symbol, Map<string, LRUCache<string, ReadonlyArray<Item>>> | undefined>

/** The store of one app: answer id -> its output items. */
function storeOf(app: string): LRUCache<string, ReadonlyArray<Item>> {
  const apps = (holder[SLOT] ??= new Map())
  let store = apps.get(app)
  if (store === undefined) {
    store = new LRUCache<string, ReadonlyArray<Item>>({ max: MAX_ANSWERS, ttl: TTL_MS })
    apps.set(app, store)
  }
  return store
}

const isItem = (value: unknown): value is Item => typeof value === "object" && value !== null && typeof (value as Item).id === "string"

/** Keeps the output items of a completed or incomplete answer (a failed one has no items to replay). */
export function rememberAnswer(app: string, response: object): void {
  const { id, output } = response as { id?: unknown; output?: unknown }
  if (typeof id !== "string" || !Array.isArray(output)) return
  const items = output.filter(isItem)
  if (items.length > 0) storeOf(app).set(id, items)
}

/** Drops one answer's items, so a deleted response cannot be referenced either. */
export function forgetAnswer(app: string, id: string): void {
  storeOf(app).delete(id)
}

/** The output item with this id that the app's recent answers returned, if still held. */
export function findItem(app: string, itemId: string): Item | undefined {
  for (const items of storeOf(app).values()) {
    const found = items.find((item) => item.id === itemId)
    if (found !== undefined) return found
  }
  return undefined
}
