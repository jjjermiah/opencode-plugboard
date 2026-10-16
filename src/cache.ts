/**
 * Opt-in exact-match response cache, as a `ModelCaller` wrapper.
 *
 * Pollers and bots repeat identical prompts and pay quota every time. With `cache` set, a
 * completed answer is kept in memory, and the same request from the same app within the TTL is
 * answered from it without creating a session or touching the provider.
 *
 * What is cached: a turn that streamed to the end and finished `stop` or `length`, with some text
 * or reasoning and no tool call and no error. Everything else passes through untouched: tool calls
 * need the caller's tool results, structured output arrives as a forced tool call (so it is not
 * cached), and errors and aborted turns are never answers. A hit replays what the miss sent: the
 * `PlugEvent` sequence (same-kind deltas coalesced), the `onServed` and `onPolicy` notes, and a
 * `finish` with zero usage, because the call spent no tokens and `plugboard_tokens_total` must not
 * count it. No history record is written on a hit.
 *
 * The key is a SHA-256 of the app and the resolved request: provider, model id, variant, system,
 * messages, tools, tool choice and sampling parameters. The `model` string the caller sent (an
 * alias, say) is not part of it, so two names for one model share entries. Apps never share
 * entries. The store is process-wide (`src/runtime.ts`), so it survives plugin generations, is
 * reset when the cache option or the `apps` policy changes, and is lost on restart.
 *
 * Policy that the key does not see (a system prompt part, a tool strip, a model scope) is applied
 * after the key is built. That is safe because the store is reset whenever `apps` changes, so an
 * entry always comes from the same policy as the request that replays it.
 *
 * Fan-out (`n` above 1, prompt arrays) calls the caller once per choice with the same request, so
 * the fan-out sets `noCache`: every choice must be a fresh sample.
 *
 * A persona (a skill alias or an `agent/<name>` id, `bypass`) is never cached: its answer depends on
 * the skill's content or the agent's prompt, which the key does not see, and a skill edit must not be
 * masked by an old entry.
 */

import { createHash } from "node:crypto"
import type { ServerResponse } from "node:http"
import { LRUCache } from "lru-cache"
import stableStringify from "safe-stable-stringify"
import type { CallContext, ModelCaller, PlugEvent, PlugFinish, PlugRequest, PolicyNote, ServedModel } from "./contract.js"

/** The `cache` plugin option after defaults and validation (see `parseOptions` in `src/config.ts`). */
export interface CacheConfig {
  /** How long an entry is served after it was stored. */
  readonly ttlSeconds: number
  /** Most entries kept; the least recently used goes first. */
  readonly maxEntries: number
  /** Most bytes kept (the entries as JSON); the least recently used goes first. */
  readonly maxBytes: number
  /** Apps that use the cache. Absent: every app. */
  readonly apps?: ReadonlyArray<string>
}

/** What a miss produced, replayed by a hit. */
export interface Entry {
  readonly events: ReadonlyArray<PlugEvent>
  readonly served?: ServedModel
  readonly policy?: ReadonlyArray<PolicyNote>
}

export interface CacheStore {
  get(key: string): Entry | undefined
  set(key: string, entry: Entry): void
  size(): number
}

export interface CacheLimits {
  readonly ttlMs: number
  readonly maxEntries: number
  readonly maxBytes: number
}

/** Fixed per-entry overhead added to the payload size: the key, the entry object and the array. */
const ENTRY_OVERHEAD = 128

export function createCacheStore(limits: CacheLimits): CacheStore {
  const lru = new LRUCache<string, Entry>({
    max: limits.maxEntries,
    maxSize: limits.maxBytes,
    sizeCalculation: (entry) => Buffer.byteLength(JSON.stringify(entry)) + ENTRY_OVERHEAD,
    ttl: limits.ttlMs,
  })
  return {
    get: (key) => lru.get(key),
    set: (key, entry) => void lru.set(key, entry),
    size: () => lru.size,
  }
}

/** The cache key of one call: the app and the resolved request, object keys sorted. */
export function cacheKey(app: string, request: PlugRequest): string {
  const { ref } = request
  const canonical = stableStringify([app, ref.providerID, ref.id, ref.variant ?? null, request.system, request.messages, request.tools, request.toolChoice ?? null, request.generation])
  return createHash("sha256").update(canonical ?? "").digest("hex")
}

/** Called once per call the cache applies to. */
export type CacheCounter = (app: string, result: "hit" | "miss") => void

/** The response header that says whether the answer came from the cache. */
export const CACHE_HEADER = "x-plugboard-cache"

/**
 * The `CallContext.onCache` of a route: `x-plugboard-cache: hit|miss` while the headers are still
 * open. The first writer wins, so several choices of one request report once.
 */
export function reportCache(response: ServerResponse): (result: "hit" | "miss") => void {
  return (result) => {
    if (response.headersSent || response.destroyed || response.hasHeader(CACHE_HEADER)) return
    response.setHeader(CACHE_HEADER, result)
  }
}

const CACHEABLE_FINISH: ReadonlySet<PlugFinish> = new Set<PlugFinish>(["stop", "length"])

/** Appends a delta to the list, merging it into the previous event when that is the same kind. */
function append(events: PlugEvent[], event: { readonly type: "text-delta" | "reasoning-delta"; readonly text: string; readonly signature?: string; readonly redactedData?: string }): void {
  // A signature or a redacted payload is its own event, so a replay puts it back after the block it closes (#146, #385).
  if (event.signature !== undefined || event.redactedData !== undefined)
    return void events.push({
      type: event.type,
      text: event.text,
      ...(event.signature === undefined ? {} : { signature: event.signature }),
      ...(event.redactedData === undefined ? {} : { redactedData: event.redactedData }),
    })
  const last = events.at(-1) as { type: string; text: string; signature?: string; redactedData?: string } | undefined
  if (last && last.type === event.type && last.signature === undefined && last.redactedData === undefined) events[events.length - 1] = { type: event.type, text: last.text + event.text }
  else events.push({ type: event.type, text: event.text })
}

/**
 * Wraps `inner`: hits are replayed, misses stream through and are stored when they qualify. `bypass(model, app)`
 * decides per call that the cache is not used: a persona model, or an app whose answers depend on live OpenCode
 * tool output (`serverTools`, #82). Both conditions live in the one predicate the runtime passes.
 */
export function cachedCaller(
  inner: ModelCaller,
  config: CacheConfig,
  store: CacheStore,
  count?: CacheCounter,
  bypass?: (model: string, app: string) => boolean,
): ModelCaller {
  const apps = config.apps ? new Set(config.apps) : undefined
  return {
    async *stream(request: PlugRequest, context: CallContext): AsyncIterable<PlugEvent> {
      if (context.noCache || bypass?.(request.model, context.app) || (apps && !apps.has(context.app))) return yield* inner.stream(request, context)
      const key = cacheKey(context.app, request)
      const hit = store.get(key)
      if (hit) {
        count?.(context.app, "hit")
        context.onCache?.("hit")
        if (hit.served) context.onServed?.(hit.served)
        if (hit.policy) context.onPolicy?.(hit.policy)
        for (const event of hit.events) {
          if (context.signal.aborted) return
          yield event.type === "finish" ? { type: "finish", reason: event.reason, usage: { inputTokens: 0, outputTokens: 0 }, ...(event.stopSequence === undefined ? {} : { stopSequence: event.stopSequence }) } : event
        }
        return
      }
      count?.(context.app, "miss")
      context.onCache?.("miss")
      // What the route is told before the first event is kept for a later hit; the route still gets it.
      let served: ServedModel | undefined
      let policy: ReadonlyArray<PolicyNote> | undefined
      const forward: CallContext = {
        ...context,
        onServed: (value) => {
          served ??= value
          context.onServed?.(value)
        },
        onPolicy: (notes) => {
          policy ??= [...notes]
          context.onPolicy?.(notes)
        },
      }
      const recorded: PlugEvent[] = []
      let storable = true
      // Text bytes seen so far. An answer over `maxBytes` could never be stored, so capture stops there and frees what it kept (#153).
      let captured = 0
      for await (const event of inner.stream(request, forward)) {
        if (event.type === "text-delta" || event.type === "reasoning-delta") {
          captured += Buffer.byteLength(event.text)
          if (captured > config.maxBytes) {
            storable = false
            recorded.length = 0
          } else if (storable) append(recorded, event)
        } else if (event.type === "finish") {
          // Stored before the event is handed on, so a consumer that stops reading at `finish` still fills the cache.
          if (storable && CACHEABLE_FINISH.has(event.reason) && recorded.length > 0 && !context.signal.aborted)
            store.set(key, {
              events: [...recorded, { type: "finish", reason: event.reason, ...(event.stopSequence === undefined ? {} : { stopSequence: event.stopSequence }) }],
              ...(served ? { served } : {}),
              ...(policy?.length ? { policy } : {}),
            })
        } else storable = false
        yield event
      }
    },
  }
}
