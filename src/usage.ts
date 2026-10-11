/**
 * Per-app usage statistics: one record per app per UTC day.
 *
 * What a day holds (`DayRecord`): HTTP requests on the model routes with their error classes and a
 * latency histogram, the tokens of answered model calls by kind (the same non-overlapping split as
 * `plugboard_tokens_total`), the cost in USD from the catalog's prices, cache hits and misses,
 * fallbacks, 429 refusals, the requests and cost per model, and when the last request ended.
 *
 * Where it lives: the live aggregate is in memory on the process runtime (`src/runtime.ts`), so it
 * survives a plugin generation, and each day is persisted to the plugin's host storage as JSON under
 * `usage/<app>/<YYYY-MM-DD>`. Every write comes from request handling (`withUsage` and the route's
 * request log point), never from plugin setup or a finalizer (docs/architecture.md, I23). A day is
 * written at most every `FLUSH_MS`: a change is persisted by the first request that finds the last
 * write that old, so the stored copy can lag a quiet period behind memory. Queries read memory first,
 * so a report is never stale.
 *
 * Retention: days older than `usage.retentionDays` are deleted from request handling, one bounded
 * page of keys at a time and at most once per `PRUNE_EVERY_MS`.
 *
 * Cost follows OpenCode's own accounting (`calculateCost` in packages/core/src/session/usage.ts): the
 * price entry is the one with the largest `aboveContext` that the prompt (uncached input plus cache
 * reads and writes) exceeds, else the entry without one. A model with no applicable entry is priced
 * at 0 and its call counted in `unpricedRequests`.
 */

import { APP_NAME_PATTERN } from "./config.js"
import { isPlugError, type CallContext, type CatalogCost, type CatalogModel, type ModelCaller, type ModelRef, type PlugError, type PlugEvent, type PlugRequest, type PlugUsage, type ServedModel } from "./contract.js"
import { errorMessage, log, logError } from "./log.js"
import type { Outcome } from "./metrics.js"
import { parseModelRef } from "./models.js"
import type { StoragePort } from "./session/host.js"

/** Upper bounds of the latency buckets in ms; one more bucket holds everything above the last. */
export const LATENCY_BOUNDS_MS: ReadonlyArray<number> = [100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 120_000, 300_000, 600_000]

/** Routes whose requests and model calls are usage: the model endpoints, not discovery, status or the store itself. */
export const GENERATION_ROUTES: ReadonlySet<string> = new Set([
  "POST /v1/chat/completions",
  "POST /v1/completions",
  "POST /v1/responses",
  "POST /v1/messages",
  "POST /v1/models/{model}:generateContent",
  "POST /v1/models/{model}:streamGenerateContent",
  "POST /v1beta/models/{model}:generateContent",
  "POST /v1beta/models/{model}:streamGenerateContent",
])

const DAY_MS = 86_400_000
const KEY_PREFIX = "usage/"
/** A changed day is written at most this often. */
const FLUSH_MS = 10_000
/** Retention runs at most this often, and each run reads one page of keys. */
const PRUNE_EVERY_MS = 10 * 60_000
const PRUNE_PAGE = 200
const QUERY_PAGE = 500
const DEFAULT_RANGE_DAYS = 30
const MAX_RANGE_DAYS = 366
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// ---------------------------------------------------------------- shapes

/** Non-overlapping token counts, the same split as `plugboard_tokens_total`. */
export interface UsageTokens {
  /** Uncached prompt tokens. */
  input: number
  cacheRead: number
  cacheWrite: number
  /** Output tokens excluding reasoning. */
  output: number
  reasoning: number
}

export interface UsageErrors {
  /** 4xx answers, including 429 refusals. */
  client: number
  /** 5xx answers, and errors after the response had started. */
  server: number
  /** The request deadline passed. */
  timeout: number
  /** The client went away before the answer ended. */
  disconnected: number
}

/** Latency as counts per bucket: `buckets[i]` counts requests up to `LATENCY_BOUNDS_MS[i]` ms (and above the bound before it); the last counts those above the last bound. */
export interface LatencyHistogram {
  count: number
  sumMs: number
  buckets: number[]
}

export interface LatencySummary extends LatencyHistogram {
  /** Estimate: the upper bound of the bucket holding the 50th percentile; null without requests. The overflow bucket reports the largest bound. */
  p50Ms: number | null
  /** As `p50Ms`, for the 95th percentile. */
  p95Ms: number | null
}

export interface ModelUsage {
  /** Answered calls of this model (a cache hit counts; its tokens are 0). */
  requests: number
  /** Total tokens of those calls (the five kinds summed). */
  tokens: number
  costUsd: number
}

/** The counters of one day, of several days, or of one app. */
export interface UsageCounts<Latency = LatencyHistogram> {
  /** HTTP requests on the model routes that reached an authenticated app. */
  requests: number
  errors: UsageErrors
  latency: Latency
  tokens: UsageTokens
  costUsd: number
  cacheHits: number
  cacheMisses: number
  /** Retries on the next target of an alias after a failure before any output. */
  fallbacks: number
  /** Calls refused with 429 by a concurrency cap or a requests-per-minute limit (also counted in `requests` and `errors.client`). */
  limited: number
  /** Answered calls that spent tokens but had no price in the catalog (their cost counts as 0). */
  unpricedRequests: number
  /** ISO 8601 time the last counted request ended. Absent when none did. */
  lastRequestAt?: string
}

/** One stored day, at `usage/<app>/<date>`. */
export interface DayRecord extends UsageCounts {
  perModel: Record<string, ModelUsage>
}

/** Counters with latency percentiles, as a report carries them. */
export type UsageTotals = UsageCounts<LatencySummary>

export interface UsageDay extends UsageTotals {
  /** UTC day, `YYYY-MM-DD`. */
  date: string
  perModel: Record<string, ModelUsage>
}

export interface UsageAppReport {
  /** Sums over the days of the range. */
  totals: UsageTotals
  /** Per model, summed over the range. The key is `provider/model`; the variant is not part of it. */
  models: Record<string, ModelUsage>
  /** Days with any record in the range, oldest first. */
  days: UsageDay[]
}

/** The result of `GET /v1/usage` and of the `opencode-plugboard.usage` RPC (`src/rpc.ts`). */
export interface UsageReport {
  /** First and last UTC day of the range, inclusive. */
  from: string
  to: string
  /** ISO 8601 time the report was built. */
  generatedAt: string
  /** Sums over the apps in `apps`. */
  totals: UsageTotals
  /** Apps with a record in the range. With an `app` filter, that app is always present (empty when it has no records). */
  apps: Record<string, UsageAppReport>
}

export interface UsageQuery {
  /** `YYYY-MM-DD`, UTC. Default: 29 days before `to`. */
  readonly from?: string
  /** `YYYY-MM-DD`, UTC. Default: today. */
  readonly to?: string
  /** One app. Absent: every app. */
  readonly app?: string
}

// ---------------------------------------------------------------- pure helpers

const nonNegative = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0)

/** The UTC calendar day of an epoch-ms instant, `YYYY-MM-DD`. */
export const utcDate = (at: number): string => new Date(at).toISOString().slice(0, 10)

const isDate = (value: string): boolean => {
  if (!DATE_PATTERN.test(value)) return false
  const ms = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(ms) && utcDate(ms) === value
}

/** The UTC day a storage key belongs to, or undefined for a key that is not a usage day. */
const dateOf = (key: string): string | undefined => {
  const parts = key.split("/")
  return parts.length === 3 && parts[0] === "usage" && DATE_PATTERN.test(parts[2] ?? "") ? parts[2] : undefined
}

export function emptyDay(): DayRecord {
  return {
    requests: 0,
    errors: { client: 0, server: 0, timeout: 0, disconnected: 0 },
    latency: { count: 0, sumMs: 0, buckets: Array.from({ length: LATENCY_BOUNDS_MS.length + 1 }, () => 0) },
    tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
    costUsd: 0,
    cacheHits: 0,
    cacheMisses: 0,
    fallbacks: 0,
    limited: 0,
    unpricedRequests: 0,
    perModel: {},
  }
}

/** The bucket a latency falls in (see `LatencyHistogram`). */
export function bucketIndex(ms: number): number {
  const index = LATENCY_BOUNDS_MS.findIndex((bound) => ms <= bound)
  return index === -1 ? LATENCY_BOUNDS_MS.length : index
}

/** The upper bound of the bucket holding the `p` quantile; null without requests. */
export function percentileMs(latency: LatencyHistogram, p: number): number | null {
  if (latency.count === 0) return null
  const target = Math.ceil(p * latency.count)
  let seen = 0
  for (let index = 0; index < latency.buckets.length; index++) {
    seen += latency.buckets[index] ?? 0
    if (seen >= target) return LATENCY_BOUNDS_MS[Math.min(index, LATENCY_BOUNDS_MS.length - 1)] ?? null
  }
  return LATENCY_BOUNDS_MS.at(-1) ?? null
}

/** A call's usage as the five non-overlapping kinds (`PlugUsage` totals are inclusive). */
export function tokenBreakdown(usage: PlugUsage): UsageTokens {
  const cacheRead = nonNegative(usage.cacheReadTokens)
  const cacheWrite = nonNegative(usage.cacheWriteTokens)
  const reasoning = nonNegative(usage.reasoningTokens)
  return {
    input: Math.max(0, nonNegative(usage.inputTokens) - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite,
    output: Math.max(0, nonNegative(usage.outputTokens) - reasoning),
    reasoning,
  }
}

const totalTokens = (tokens: UsageTokens): number => tokens.input + tokens.cacheRead + tokens.cacheWrite + tokens.output + tokens.reasoning

/**
 * The USD cost of one call, or undefined when the model has no applicable price. Mirrors OpenCode's
 * `calculateCost`: the prompt is uncached input plus cache reads and writes; the price entry is the
 * one with the largest `aboveContext` below that prompt size (`>`, as the host compares), else the
 * entry without one. Output and reasoning are both priced at the output rate.
 */
export function priceCall(costs: ReadonlyArray<CatalogCost> | undefined, tokens: UsageTokens): number | undefined {
  if (!costs) return undefined
  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite
  const tier = costs
    .filter((cost): cost is CatalogCost & { readonly aboveContext: number } => cost.aboveContext !== undefined && prompt > cost.aboveContext)
    .sort((a, b) => b.aboveContext - a.aboveContext)[0]
  const price = tier ?? costs.find((cost) => cost.aboveContext === undefined)
  if (!price) return undefined
  return (tokens.input * price.input + (tokens.output + tokens.reasoning) * price.output + tokens.cacheRead * price.cacheRead + tokens.cacheWrite * price.cacheWrite) / 1_000_000
}

/** The sum of day records (a new record; the inputs are not changed). */
export function sumDays(parts: ReadonlyArray<DayRecord>): DayRecord {
  const total = emptyDay()
  for (const part of parts) {
    total.requests += part.requests
    total.errors.client += part.errors.client
    total.errors.server += part.errors.server
    total.errors.timeout += part.errors.timeout
    total.errors.disconnected += part.errors.disconnected
    total.latency.count += part.latency.count
    total.latency.sumMs += part.latency.sumMs
    total.latency.buckets = total.latency.buckets.map((value, index) => value + (part.latency.buckets[index] ?? 0))
    total.tokens.input += part.tokens.input
    total.tokens.cacheRead += part.tokens.cacheRead
    total.tokens.cacheWrite += part.tokens.cacheWrite
    total.tokens.output += part.tokens.output
    total.tokens.reasoning += part.tokens.reasoning
    total.costUsd += part.costUsd
    total.cacheHits += part.cacheHits
    total.cacheMisses += part.cacheMisses
    total.fallbacks += part.fallbacks
    total.limited += part.limited
    total.unpricedRequests += part.unpricedRequests
    if (part.lastRequestAt !== undefined && (total.lastRequestAt === undefined || part.lastRequestAt > total.lastRequestAt)) total.lastRequestAt = part.lastRequestAt
    for (const [model, usage] of Object.entries(part.perModel)) {
      const sum = total.perModel[model] ?? { requests: 0, tokens: 0, costUsd: 0 }
      total.perModel[model] = { requests: sum.requests + usage.requests, tokens: sum.tokens + usage.tokens, costUsd: sum.costUsd + usage.costUsd }
    }
  }
  return total
}

/** A day's counters with latency percentiles, as a report carries them. */
export function summaryOf(day: DayRecord): UsageTotals {
  return {
    requests: day.requests,
    errors: { ...day.errors },
    latency: { count: day.latency.count, sumMs: day.latency.sumMs, buckets: [...day.latency.buckets], p50Ms: percentileMs(day.latency, 0.5), p95Ms: percentileMs(day.latency, 0.95) },
    tokens: { ...day.tokens },
    costUsd: day.costUsd,
    cacheHits: day.cacheHits,
    cacheMisses: day.cacheMisses,
    fallbacks: day.fallbacks,
    limited: day.limited,
    unpricedRequests: day.unpricedRequests,
    ...(day.lastRequestAt === undefined ? {} : { lastRequestAt: day.lastRequestAt }),
  }
}

/** Reads a stored day, tolerating missing or mistyped fields (they count as zero), so an older record still reads. */
export function fromJson(value: unknown): DayRecord {
  const object = (item: unknown): Record<string, unknown> => (typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {})
  const raw = object(value)
  const errors = object(raw.errors)
  const latency = object(raw.latency)
  const tokens = object(raw.tokens)
  const buckets: unknown[] = Array.isArray(latency.buckets) ? latency.buckets : []
  const perModel: Record<string, ModelUsage> = {}
  for (const [model, item] of Object.entries(object(raw.perModel))) {
    const usage = object(item)
    perModel[model] = { requests: nonNegative(usage.requests), tokens: nonNegative(usage.tokens), costUsd: nonNegative(usage.costUsd) }
  }
  return {
    requests: nonNegative(raw.requests),
    errors: { client: nonNegative(errors.client), server: nonNegative(errors.server), timeout: nonNegative(errors.timeout), disconnected: nonNegative(errors.disconnected) },
    latency: { count: nonNegative(latency.count), sumMs: nonNegative(latency.sumMs), buckets: emptyDay().latency.buckets.map((_, index) => nonNegative(buckets[index])) },
    tokens: {
      input: nonNegative(tokens.input),
      cacheRead: nonNegative(tokens.cacheRead),
      cacheWrite: nonNegative(tokens.cacheWrite),
      output: nonNegative(tokens.output),
      reasoning: nonNegative(tokens.reasoning),
    },
    costUsd: nonNegative(raw.costUsd),
    cacheHits: nonNegative(raw.cacheHits),
    cacheMisses: nonNegative(raw.cacheMisses),
    fallbacks: nonNegative(raw.fallbacks),
    limited: nonNegative(raw.limited),
    unpricedRequests: nonNegative(raw.unpricedRequests),
    ...(typeof raw.lastRequestAt === "string" ? { lastRequestAt: raw.lastRequestAt } : {}),
    perModel,
  }
}

const dateError = (param: "from" | "to", message: string, code = "invalid_date"): PlugError => ({ status: 400, kind: "invalid_request", code, param, message })

/** Validates `from` and `to` (defaults: the 30 days ending today, UTC) and the size of the range. */
export function resolveRange(query: UsageQuery, at: number): { readonly from: string; readonly to: string } | PlugError {
  const to = query.to ?? utcDate(at)
  if (!isDate(to)) return dateError("to", "`to` must be a UTC date, YYYY-MM-DD")
  const from = query.from ?? utcDate(Date.parse(`${to}T00:00:00Z`) - (DEFAULT_RANGE_DAYS - 1) * DAY_MS)
  if (!isDate(from)) return dateError("from", "`from` must be a UTC date, YYYY-MM-DD")
  if (from > to) return dateError("from", "`from` must not be after `to`", "invalid_range")
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1
  if (days > MAX_RANGE_DAYS) return dateError("from", `The range may span at most ${MAX_RANGE_DAYS} days`, "range_too_long")
  return { from, to }
}

// ---------------------------------------------------------------- the recorder

/** The live state, held on the process runtime (src/runtime.ts) so it outlives a plugin generation. */
export interface UsageState {
  /** Days in memory, keyed by `usage/<app>/<date>`. A day is read from storage on its first access. */
  readonly entries: Map<string, Entry>
  readonly prune: { at: number; running: boolean; after?: string }
}

interface Entry {
  readonly key: string
  readonly app: string
  readonly date: string
  day: DayRecord
  /** Bumped by every change; `flushedVersion` is the version last persisted. */
  version: number
  flushedVersion: number
  flushedAt: number
  flushing?: Promise<void>
}

export const createUsageState = (): UsageState => ({ entries: new Map(), prune: { at: 0, running: false } })

/** One finished HTTP request, from the route's request log point. */
export interface RequestUsage {
  readonly app: string
  readonly route: string
  readonly status: number
  readonly outcome: Outcome
  readonly ms: number
}

/** One model call, when it ended. `answered` when its stream finished with an answer; `cache` when the response cache applied. */
export interface CallUsage {
  readonly app: string
  /** The model that answered, or the requested one when there was no fallback chain. */
  readonly ref?: ModelRef
  readonly answered: boolean
  readonly cache?: "hit" | "miss"
  readonly usage?: PlugUsage
}

export interface UsageRecorder {
  request(input: RequestUsage): void
  limited(app: string): void
  fallback(app: string): void
  call(input: CallUsage): void
  /** A report for the range and app (defaults as `resolveRange`). A bad input is a 400 `PlugError`. */
  query(input: UsageQuery): Promise<UsageReport | PlugError>
}

export interface UsageRecorderDeps {
  readonly state: UsageState
  /** The plugin's host storage (`createStoragePort`). Server-wide, so any live generation's works. */
  readonly storage: StoragePort
  /** The serving Location's catalog, for prices. A failure leaves the call unpriced. */
  readonly loadCatalog: () => Promise<ReadonlyArray<CatalogModel>>
  readonly retentionDays: number
  /** Epoch ms. Tests inject a clock; the default is `Date.now`. */
  readonly now?: () => number
}

const keyOf = (app: string, date: string): string => `${KEY_PREFIX}${app}/${date}`

async function readDay(storage: StoragePort, key: string): Promise<DayRecord | undefined> {
  const raw = await storage.get(key)
  if (raw === undefined) return undefined
  try {
    return fromJson(JSON.parse(raw))
  } catch {
    logError("usage.unreadable", { key })
    return undefined
  }
}

const addTokens = (into: UsageTokens, from: UsageTokens): UsageTokens => ({
  input: into.input + from.input,
  cacheRead: into.cacheRead + from.cacheRead,
  cacheWrite: into.cacheWrite + from.cacheWrite,
  output: into.output + from.output,
  reasoning: into.reasoning + from.reasoning,
})

export function createUsageRecorder(deps: UsageRecorderDeps): UsageRecorder {
  const { state, storage } = deps
  const now = deps.now ?? Date.now

  /** The entry for one day: held in memory, else read from storage (once), else new when `create`. */
  async function load(app: string, date: string, create: boolean): Promise<Entry | undefined> {
    const key = keyOf(app, date)
    const held = state.entries.get(key)
    if (held) return held
    const stored = await readDay(storage, key)
    if (stored === undefined && !create) return undefined
    // Another request may have loaded the day while this one read storage: keep the first entry.
    const current = state.entries.get(key)
    if (current) return current
    const entry: Entry = { key, app, date, day: stored ?? emptyDay(), version: 0, flushedVersion: 0, flushedAt: 0 }
    state.entries.set(key, entry)
    return entry
  }

  /** Persists a changed day when the last write is older than `FLUSH_MS`. The JSON is taken now; a later change waits for the next write. */
  function flushIfDue(entry: Entry, at: number): void {
    if (entry.version === entry.flushedVersion || entry.flushing !== undefined || at - entry.flushedAt < FLUSH_MS) return
    const version = entry.version
    const json = JSON.stringify(entry.day)
    entry.flushedAt = at
    entry.flushing = storage
      .put(entry.key, json)
      .then(
        () => {
          entry.flushedVersion = version
        },
        (error) => logError("usage.flush_failed", { app: entry.app, date: entry.date, error: errorMessage(error) }),
      )
      .finally(() => {
        entry.flushing = undefined
      })
  }

  /** Deletes the days older than the retention window: one page of keys per run, at most once per `PRUNE_EVERY_MS`. */
  function maybePrune(at: number): void {
    const prune = state.prune
    if (prune.running || at - prune.at < PRUNE_EVERY_MS) return
    prune.running = true
    prune.at = at
    const cutoff = utcDate(at - (deps.retentionDays - 1) * DAY_MS)
    void (async () => {
      try {
        const page = await storage.scan({ prefix: KEY_PREFIX, ...(prune.after === undefined ? {} : { after: prune.after }), limit: PRUNE_PAGE })
        let dropped = 0
        for (const key of page.keys) {
          const date = dateOf(key)
          if (date === undefined || date >= cutoff) continue
          await storage.drop(key)
          state.entries.delete(key)
          dropped++
        }
        prune.after = page.next
        if (dropped > 0) log("usage.pruned", { dropped, before: cutoff })
      } catch (error) {
        logError("usage.prune_failed", { error: errorMessage(error) })
      } finally {
        prune.running = false
      }
    })()
  }

  /** Changes one day and persists it when due. Never throws into the request. */
  function record(app: string, at: number, update: (day: DayRecord) => void): void {
    load(app, utcDate(at), true)
      .then((entry) => {
        if (!entry) return
        update(entry.day)
        entry.version++
        flushIfDue(entry, at)
        maybePrune(at)
      })
      .catch((error) => logError("usage.record_failed", { app, error: errorMessage(error) }))
  }

  /** The USD cost of a call's tokens under the serving catalog's price for the model, or undefined when unpriced. */
  async function priceOf(ref: ModelRef, tokens: UsageTokens): Promise<number | undefined> {
    let catalog: ReadonlyArray<CatalogModel>
    try {
      catalog = await deps.loadCatalog()
    } catch {
      return undefined
    }
    const model = catalog.find((item) => item.providerID === ref.providerID && item.id === ref.id)
    return priceCall(model?.cost, tokens)
  }

  return {
    request(input) {
      if (!GENERATION_ROUTES.has(input.route)) return
      const at = now()
      const ms = nonNegative(input.ms)
      record(input.app, at, (day) => {
        day.requests++
        if (input.outcome === "rejected") day.errors.client++
        else if (input.outcome === "failed") day.errors.server++
        else if (input.outcome === "timeout") day.errors.timeout++
        else if (input.outcome === "disconnected") day.errors.disconnected++
        day.latency.count++
        day.latency.sumMs += ms
        day.latency.buckets[bucketIndex(ms)] = (day.latency.buckets[bucketIndex(ms)] ?? 0) + 1
        day.lastRequestAt = new Date(at).toISOString()
      })
    },

    limited(app) {
      record(app, now(), (day) => {
        day.limited++
      })
    },

    fallback(app) {
      record(app, now(), (day) => {
        day.fallbacks++
      })
    },

    call(input) {
      if (!input.answered && input.cache === undefined) return
      const at = now()
      const tokens = input.usage ? tokenBreakdown(input.usage) : { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 }
      void (async () => {
        // A cache hit spent no tokens and is not priced; an answer that spent tokens is priced from the catalog.
        const spent = input.answered && input.cache !== "hit" && totalTokens(tokens) > 0
        const cost = spent && input.ref ? await priceOf(input.ref, tokens) : undefined
        const unpriced = spent && cost === undefined
        record(input.app, at, (day) => {
          if (input.cache === "hit") day.cacheHits++
          else if (input.cache === "miss") day.cacheMisses++
          if (!input.answered) return
          const price = cost ?? 0
          if (input.ref) {
            const model = `${input.ref.providerID}/${input.ref.id}`
            const sum = day.perModel[model] ?? { requests: 0, tokens: 0, costUsd: 0 }
            day.perModel[model] = { requests: sum.requests + 1, tokens: sum.tokens + totalTokens(tokens), costUsd: sum.costUsd + price }
          }
          day.tokens = addTokens(day.tokens, tokens)
          day.costUsd += price
          if (unpriced) day.unpricedRequests++
        })
      })().catch((error) => logError("usage.record_failed", { app: input.app, error: errorMessage(error) }))
    },

    async query(input) {
      const at = now()
      if (input.app !== undefined && !APP_NAME_PATTERN.test(input.app))
        return { status: 400, kind: "invalid_request", code: "invalid_app", param: "app", message: "`app` must be an app name from the keys configuration" }
      const range = resolveRange(input, at)
      if (isPlugError(range)) return range
      const prefix = input.app === undefined ? KEY_PREFIX : keyOf(input.app, "")
      const inRange = (date: string | undefined) => date !== undefined && date >= range.from && date <= range.to

      // The days in range: from storage (page by page), plus memory for days not in storage yet.
      const keys = new Set<string>()
      let after: string | undefined
      for (;;) {
        const page = await storage.scan({ prefix, ...(after === undefined ? {} : { after }), limit: QUERY_PAGE })
        for (const key of page.keys) if (inRange(dateOf(key))) keys.add(key)
        if (page.next === undefined) break
        after = page.next
      }
      for (const entry of state.entries.values()) if (entry.key.startsWith(prefix) && inRange(entry.date)) keys.add(entry.key)

      const byApp = new Map<string, Array<{ readonly date: string; readonly day: DayRecord }>>()
      for (const key of [...keys].sort()) {
        const [, app = "", date = ""] = key.split("/")
        const entry = await load(app, date, false)
        if (!entry) continue
        byApp.set(app, [...(byApp.get(app) ?? []), { date, day: entry.day }])
      }

      const names = [...new Set([...byApp.keys(), ...(input.app === undefined ? [] : [input.app])])].sort()
      const apps: Record<string, UsageAppReport> = {}
      const appTotals: DayRecord[] = []
      for (const app of names) {
        const rows = (byApp.get(app) ?? []).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        const total = sumDays(rows.map((row) => row.day))
        appTotals.push(total)
        const days: UsageDay[] = rows.map((row) => ({ date: row.date, ...summaryOf(row.day), perModel: { ...row.day.perModel } }))
        apps[app] = { totals: summaryOf(total), models: { ...total.perModel }, days }
      }
      return { from: range.from, to: range.to, generatedAt: new Date(at).toISOString(), totals: summaryOf(sumDays(appTotals)), apps }
    },
  }
}

// ---------------------------------------------------------------- the model caller seam

/**
 * Records every model call of one request path: the finish usage, the model that answered (the
 * fallback chain's `onServed`, else the requested ref) and the response cache's answer. Events pass
 * through untouched. Outermost in `index.ts`, so it sees the answer the client gets. With no recorder
 * (option `usage` off) the caller is returned unchanged.
 */
export function withUsage(inner: ModelCaller, recorder: UsageRecorder | undefined): ModelCaller {
  if (!recorder) return inner
  return {
    stream(request: PlugRequest, context: CallContext): AsyncIterable<PlugEvent> {
      let served: ServedModel | undefined
      let cache: "hit" | "miss" | undefined
      const forward: CallContext = {
        ...context,
        onServed: (value) => {
          served ??= value
          context.onServed?.(value)
        },
        onCache: (result) => {
          cache = result
          context.onCache?.(result)
        },
      }
      const events = inner.stream(request, forward)
      return (async function* () {
        let answered = false
        let usage: PlugUsage | undefined
        try {
          for await (const event of events) {
            if (event.type === "finish") {
              answered = event.reason !== "error"
              usage = event.usage
            }
            yield event
          }
        } finally {
          const ref = served ? parseModelRef(served.model) : request.ref
          recorder.call({ app: context.app, ...(ref ? { ref } : {}), answered, ...(cache ? { cache } : {}), ...(usage ? { usage } : {}) })
        }
      })()
    },
  }
}
