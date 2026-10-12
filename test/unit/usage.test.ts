import { describe, expect, test } from "bun:test"
import type { CallContext, CatalogCost, CatalogModel, ModelCaller, PlugEvent } from "../../src/contract.js"
import { isPlugError } from "../../src/contract.js"
import { captureLogs } from "../support/logs.js"
import { collect, ev, events, model, plugRequest, tick } from "../support/fixtures.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { clock, FakeStorage } from "../support/usage.js"
import {
  bucketIndex,
  createUsageRecorder,
  createUsageState,
  emptyDay,
  fromJson,
  percentileMs,
  priceCall,
  resolveRange,
  tokenBreakdown,
  withUsage,
  type UsageRecorder,
  type UsageReport,
  type UsageState,
} from "../../src/usage.js"

const logs = captureLogs()

const COST: CatalogCost = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
const PRICED: CatalogModel = model("test", "echo", { cost: [COST] })
const FREE: CatalogModel = model("other", "free")
const MODELS: ReadonlyArray<CatalogModel> = [PRICED, FREE]
const NOON = "2026-10-11T12:00:00.000Z"
const CHAT = "POST /v1/chat/completions"

function harness(input: { at?: string; storage?: FakeStorage; state?: UsageState; retentionDays?: number; catalog?: ReadonlyArray<CatalogModel> } = {}) {
  const storage = input.storage ?? new FakeStorage()
  const time = clock(input.at ?? NOON)
  const state = input.state ?? createUsageState()
  const recorder: UsageRecorder = createUsageRecorder({
    state,
    storage,
    loadCatalog: async () => input.catalog ?? MODELS,
    retentionDays: input.retentionDays ?? 90,
    now: () => time.at,
  })
  return { storage, time, state, recorder }
}

const request = (app: string, ms: number, outcome: "ok" | "rejected" | "failed" | "timeout" | "disconnected" = "ok", route = CHAT) => ({
  app,
  route,
  status: outcome === "ok" ? 200 : outcome === "rejected" ? 429 : 500,
  outcome,
  ms,
})

async function reportFor(recorder: UsageRecorder, query: Parameters<UsageRecorder["query"]>[0] = {}): Promise<UsageReport> {
  const result = await recorder.query(query)
  if (isPlugError(result)) throw new Error(`query failed: ${result.code}`)
  return result
}

describe("token split and cost math", () => {
  test("the inclusive PlugUsage totals split into the five non-overlapping kinds", () => {
    expect(tokenBreakdown({ inputTokens: 3500, cacheReadTokens: 2000, cacheWriteTokens: 500, outputTokens: 500, reasoningTokens: 100 })).toEqual({
      input: 1000,
      cacheRead: 2000,
      cacheWrite: 500,
      output: 400,
      reasoning: 100,
    })
  })

  test("missing, negative and non-finite counts are zero; cache counts above the input total do not make input negative", () => {
    expect(tokenBreakdown({})).toEqual({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 })
    expect(tokenBreakdown({ inputTokens: 10, cacheReadTokens: 50, outputTokens: Number.NaN })).toEqual({ input: 0, cacheRead: 50, cacheWrite: 0, output: 0, reasoning: 0 })
  })

  test("cost prices uncached input, cache reads and writes, and output with reasoning, per million tokens", () => {
    // 1000 * 3 + (400 + 100) * 15 + 2000 * 0.3 + 500 * 3.75, over 1e6
    expect(priceCall([COST], { input: 1000, cacheRead: 2000, cacheWrite: 500, output: 400, reasoning: 100 })).toBeCloseTo(0.012975, 12)
  })

  test("a context tier applies once the prompt is above its size; the largest such tier wins; at the size itself the base applies", () => {
    const tiered: CatalogCost[] = [
      COST,
      { input: 6, output: 22.5, cacheRead: 0.6, cacheWrite: 7.5, aboveContext: 200_000 },
      { input: 12, output: 45, cacheRead: 1.2, cacheWrite: 15, aboveContext: 500_000 },
    ]
    const prompt = (input: number, cacheRead = 0, cacheWrite = 0) => ({ input, cacheRead, cacheWrite, output: 0, reasoning: 0 })
    expect(priceCall(tiered, prompt(200_000))).toBeCloseTo(0.6, 12) // exactly the size: base
    expect(priceCall(tiered, prompt(200_001))).toBeCloseTo(1.200006, 12) // above 200k: 6 per million
    expect(priceCall(tiered, prompt(100_000, 150_000))).toBeCloseTo(0.69, 12) // the prompt counts cache reads too
    expect(priceCall(tiered, prompt(600_000))).toBeCloseTo(7.2, 12) // above 500k: the 500k tier, not the 200k one
  })

  test("no price is undefined: no cost list, or only tiers the prompt does not reach", () => {
    expect(priceCall(undefined, { input: 1, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 })).toBeUndefined()
    const onlyTier: CatalogCost[] = [{ input: 6, output: 22.5, cacheRead: 0, cacheWrite: 0, aboveContext: 200_000 }]
    expect(priceCall(onlyTier, { input: 10, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 })).toBeUndefined()
  })
})

describe("latency histogram", () => {
  test("a latency lands in the first bucket whose bound it does not exceed; the last bucket is above every bound", () => {
    expect(bucketIndex(100)).toBe(0)
    expect(bucketIndex(101)).toBe(1)
    expect(bucketIndex(600_000)).toBe(11)
    expect(bucketIndex(600_001)).toBe(12)
  })

  test("p50 and p95 are the upper bound of the bucket holding the quantile; null with no requests", () => {
    const latency = { count: 5, sumMs: 0, buckets: [1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0] }
    expect(percentileMs(latency, 0.5)).toBe(5000)
    expect(percentileMs(latency, 0.95)).toBe(600_000)
    expect(percentileMs({ count: 0, sumMs: 0, buckets: emptyDay().latency.buckets }, 0.5)).toBeNull()
  })
})

describe("aggregation", () => {
  test("requests, error classes and latency per app, with the model routes only", async () => {
    const h = harness()
    h.recorder.request(request("a", 50))
    h.recorder.request(request("a", 700, "rejected"))
    h.recorder.request(request("a", 90_000, "failed"))
    h.recorder.request(request("a", 600_000, "timeout"))
    h.recorder.request(request("a", 3_000, "disconnected"))
    h.recorder.request(request("a", 1, "ok", "GET /v1/models"))
    await tick()
    const day = (await reportFor(h.recorder, { from: "2026-10-11", to: "2026-10-11" })).apps.a!.days[0]!
    expect(day.date).toBe("2026-10-11")
    expect(day.requests).toBe(5)
    expect(day.errors).toEqual({ client: 1, server: 1, timeout: 1, disconnected: 1 })
    expect(day.latency.count).toBe(5)
    expect(day.latency.sumMs).toBe(693_750)
    expect(day.latency.buckets).toEqual([1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0])
    expect(day.latency.p50Ms).toBe(5000)
    expect(day.latency.p95Ms).toBe(600_000)
    expect(day.lastRequestAt).toBe(NOON)
  })

  test("model calls: tokens by kind, cost, per-model sums, unpriced models, cache answers and unanswered calls", async () => {
    const h = harness()
    const usage = { inputTokens: 3500, cacheReadTokens: 2000, cacheWriteTokens: 500, outputTokens: 500, reasoningTokens: 100 }
    h.recorder.call({ app: "a", ref: { providerID: "test", id: "echo" }, answered: true, usage })
    h.recorder.call({ app: "a", ref: { providerID: "other", id: "free" }, answered: true, usage: { inputTokens: 10, outputTokens: 5 } })
    h.recorder.call({ app: "a", ref: { providerID: "test", id: "echo" }, answered: true, cache: "hit", usage: { inputTokens: 0, outputTokens: 0 } })
    h.recorder.call({ app: "a", ref: { providerID: "test", id: "echo" }, answered: false, cache: "miss" })
    await tick()
    const report = await reportFor(h.recorder, { from: "2026-10-11", to: "2026-10-11" })
    const app = report.apps.a!
    expect(app.totals.tokens).toEqual({ input: 1000 + 10, cacheRead: 2000, cacheWrite: 500, output: 400 + 5, reasoning: 100 })
    expect(app.totals.costUsd).toBeCloseTo(0.012975, 12)
    expect(app.totals.unpricedRequests).toBe(1)
    expect(app.totals.cacheHits).toBe(1)
    expect(app.totals.cacheMisses).toBe(1)
    expect(app.models["test/echo"]).toEqual({ requests: 2, tokens: 4000, costUsd: expect.any(Number) })
    expect(app.models["test/echo"]!.costUsd).toBeCloseTo(0.012975, 12)
    expect(app.models["other/free"]).toEqual({ requests: 1, tokens: 15, costUsd: 0 })
    expect(app.totals.requests).toBe(0)
  })

  test("a day's record is reloaded from storage by a fresh recorder (persistence round trip)", async () => {
    const storage = new FakeStorage()
    const first = harness({ storage })
    first.recorder.request(request("a", 40))
    await tick()
    expect(storage.puts).toEqual(["usage/a/2026-10-11"])
    first.recorder.call({ app: "a", ref: { providerID: "test", id: "echo" }, answered: true, usage: { inputTokens: 100, outputTokens: 20 } })
    await tick()
    first.recorder.request(request("a", 40))
    await tick()
    expect(storage.puts).toHaveLength(3)
    const second = harness({ storage, state: createUsageState() })
    const report = await reportFor(second.recorder, { from: "2026-10-11", to: "2026-10-11" })
    expect(report.apps.a!.totals.requests).toBe(2)
    expect(report.apps.a!.totals.tokens.input).toBe(100)
    expect(report.apps.a!.models["test/echo"]!.costUsd).toBeCloseTo(0.0006, 12)
  })

  test("#241 a request that ends in the same instant as its model call is stored with it, so a fresh recorder counts it", async () => {
    // The route records the model call (withUsage) and then the request (its log point) when the response ends.
    const storage = new FakeStorage()
    const first = harness({ storage })
    first.recorder.call({ app: "a", ref: { providerID: "test", id: "echo" }, answered: true, usage: { inputTokens: 100, outputTokens: 20 } })
    first.recorder.request(request("a", 40))
    await tick()
    const second = harness({ storage, state: createUsageState() })
    const totals = (await reportFor(second.recorder, { from: "2026-10-11", to: "2026-10-11" })).apps.a!.totals
    expect(totals.requests).toBe(1)
    expect(totals.lastRequestAt).toBe(NOON)
    expect(totals.tokens.input).toBe(100)
  })

  test("#241 a day stored before `users` and `lastRequestAt` existed keeps its counts when a request adds to it", async () => {
    const storage = new FakeStorage()
    const zero = { client: 0, server: 0, timeout: 0, disconnected: 0 }
    storage.values.set(
      "usage/a/2026-10-11",
      JSON.stringify({
        requests: 3,
        errors: zero,
        latency: { count: 3, sumMs: 300, buckets: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
        tokens: { input: 10, cacheRead: 0, cacheWrite: 0, output: 5, reasoning: 0 },
        costUsd: 0.5,
        cacheHits: 0,
        cacheMisses: 0,
        fallbacks: 0,
        limited: 0,
        unpricedRequests: 0,
        perModel: { "test/echo": { requests: 3, tokens: 15, costUsd: 0.5 } },
      }),
    )
    const h = harness({ storage })
    expect((await reportFor(h.recorder, { from: "2026-10-11", to: "2026-10-11" })).apps.a!.totals.requests).toBe(3)
    h.recorder.request(request("a", 40))
    await tick()
    const stored = JSON.parse(storage.values.get("usage/a/2026-10-11")!)
    expect(stored.requests).toBe(4)
    expect(stored.perModel["test/echo"]).toEqual({ requests: 3, tokens: 15, costUsd: 0.5 })
    expect(stored.users).toEqual({})
  })

  test("a stored day with missing fields reads as zeros for them, and the rest is kept", () => {
    const day = fromJson({ requests: 2, errors: { client: "x" }, perModel: { "a/b": { requests: 1 } } })
    expect(day.requests).toBe(2)
    expect(day.errors.client).toBe(0)
    expect(day.perModel["a/b"]).toEqual({ requests: 1, tokens: 0, costUsd: 0 })
  })
})

describe("flushing to storage", () => {
  test("#241 every finished change is written as it lands, so the stored copy never misses a request", async () => {
    const h = harness()
    h.recorder.request(request("a", 10))
    await tick()
    expect(h.storage.puts).toEqual(["usage/a/2026-10-11"])
    h.time.at += 1_000
    h.recorder.request(request("a", 10))
    await tick()
    expect(h.storage.puts).toHaveLength(2)
    expect(JSON.parse(h.storage.values.get("usage/a/2026-10-11")!).requests).toBe(2)
  })

  test("#241 a change made while a write is in flight is written as soon as that write lands, and writes do not overlap", async () => {
    const storage = new FakeStorage()
    const put = storage.put.bind(storage)
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let puts = 0
    let inFlight = 0
    let maxInFlight = 0
    storage.put = async (key, value) => {
      puts++
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      if (puts === 1) await gate
      await put(key, value)
      inFlight--
    }
    const h = harness({ storage })
    h.recorder.request(request("a", 10))
    await tick()
    h.recorder.request(request("a", 10))
    await tick()
    expect(puts).toBe(1)
    release()
    await tick()
    expect(puts).toBe(2)
    expect(maxInFlight).toBe(1)
    expect(JSON.parse(storage.values.get("usage/a/2026-10-11")!).requests).toBe(2)
  })

  test("a failed write is logged, the day stays in memory, and queries still see it", async () => {
    const h = harness()
    h.storage.failPuts = true
    h.recorder.request(request("a", 10))
    await tick()
    expect(logs.of("usage.flush_failed")).toHaveLength(1)
    expect((await reportFor(h.recorder, { from: "2026-10-11", to: "2026-10-11" })).apps.a!.totals.requests).toBe(1)
  })

  test("a query for a range with no days reports no apps, and an app filter always names the app", async () => {
    const h = harness()
    h.recorder.request(request("a", 10))
    await tick()
    const empty = await reportFor(h.recorder, { from: "2026-10-01", to: "2026-10-02" })
    expect(empty.apps).toEqual({})
    expect(empty.totals.requests).toBe(0)
    const named = await reportFor(h.recorder, { from: "2026-10-01", to: "2026-10-02", app: "zzz" })
    expect(Object.keys(named.apps)).toEqual(["zzz"])
    expect(named.apps.zzz!.days).toEqual([])
  })
})

describe("days, UTC midnight and retention", () => {
  test("a request just before UTC midnight is that day; the next one is the next day", async () => {
    const h = harness({ at: "2026-10-11T23:59:59.500Z" })
    h.recorder.request(request("a", 1))
    h.time.at += 1_000
    h.recorder.request(request("a", 1))
    await tick()
    const report = await reportFor(h.recorder, { from: "2026-10-11", to: "2026-10-12" })
    expect(report.apps.a!.days.map((day) => [day.date, day.requests])).toEqual([
      ["2026-10-11", 1],
      ["2026-10-12", 1],
    ])
  })

  test("retention deletes days older than the window from request handling, and only one page per run", async () => {
    const storage = new FakeStorage()
    for (const date of ["2026-10-06", "2026-10-09", "2026-10-10"]) storage.values.set(`usage/a/${date}`, JSON.stringify(emptyDay()))
    const h = harness({ storage, retentionDays: 2 })
    h.recorder.request(request("a", 1))
    await tick()
    await tick()
    // Two days kept: today and yesterday. The two older days are deleted.
    expect(storage.drops.sort()).toEqual(["usage/a/2026-10-06", "usage/a/2026-10-09"])
    expect(storage.values.has("usage/a/2026-10-10")).toBe(true)

    // A later run waits ten minutes: an old day seeded now survives until then.
    storage.values.set("usage/b/2026-10-01", JSON.stringify(emptyDay()))
    h.time.at += 5 * 60_000
    h.recorder.request(request("a", 1))
    await tick()
    await tick()
    expect(storage.values.has("usage/b/2026-10-01")).toBe(true)
    h.time.at += 6 * 60_000
    h.recorder.request(request("a", 1))
    await tick()
    await tick()
    expect(storage.values.has("usage/b/2026-10-01")).toBe(false)
  })

  test("the default range is the 30 days ending today; invalid dates, reversed ranges, long ranges and bad app names are 400s", async () => {
    const h = harness()
    const report = await reportFor(h.recorder)
    expect([report.from, report.to]).toEqual(["2026-09-12", "2026-10-11"])
    expect(resolveRange({ from: "2026-10-10", to: "2026-10-10" }, Date.parse(NOON))).toEqual({ from: "2026-10-10", to: "2026-10-10" })

    const problem = async (query: Parameters<UsageRecorder["query"]>[0]) => {
      const result = await h.recorder.query(query)
      expect(isPlugError(result)).toBe(true)
      return result as { status: number; code: string; param?: string }
    }
    expect(await problem({ from: "2026-02-30" })).toMatchObject({ status: 400, code: "invalid_date", param: "from" })
    expect(await problem({ to: "2026-1-1" })).toMatchObject({ status: 400, code: "invalid_date", param: "to" })
    expect(await problem({ from: "2026-10-12", to: "2026-10-11" })).toMatchObject({ status: 400, code: "invalid_range" })
    expect(await problem({ from: "2025-10-10", to: "2026-10-11" })).toMatchObject({ status: 400, code: "range_too_long" })
    expect(await problem({ app: "Bad_App" })).toMatchObject({ status: 400, code: "invalid_app", param: "app" })
    expect(isPlugError(await h.recorder.query({ from: "2025-10-11", to: "2026-10-11" }))).toBe(false) // 366 days is the most
  })
})

describe("the model caller seam", () => {
  const signal = () => new AbortController().signal

  test("events pass through untouched and the answer is recorded with the requested model", async () => {
    const h = harness()
    const caller = new FakeModelCaller([ev.text("hi"), ev.finish("stop", { inputTokens: 100, outputTokens: 20 })])
    const wrapped = withUsage(caller, h.recorder)
    const seen = await collect(wrapped.stream(plugRequest(), { app: "a", signal: signal() }))
    expect(seen).toEqual([ev.text("hi"), ev.finish("stop", { inputTokens: 100, outputTokens: 20 })])
    await tick()
    const report = await reportFor(h.recorder, { from: "2026-10-11", to: "2026-10-11" })
    expect(report.apps.a!.models["test/echo"]).toEqual({ requests: 1, tokens: 120, costUsd: expect.any(Number) })
    expect(report.apps.a!.totals.costUsd).toBeCloseTo(0.0006, 12)
  })

  test("the model that answered after a fallback is the one priced and counted", async () => {
    const h = harness({ catalog: [...MODELS, model("other", "model", { cost: [{ input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }] })] })
    const caller: ModelCaller = {
      stream(_request, context: CallContext) {
        return (async function* (): AsyncGenerator<PlugEvent> {
          context.onServed?.({ model: "other/model#high", fallbacks: 1 })
          yield ev.text("a")
          yield ev.finish("stop", { inputTokens: 1_000_000, outputTokens: 0 })
        })()
      },
    }
    await collect(withUsage(caller, h.recorder).stream(plugRequest(), { app: "a", signal: signal() }))
    await tick()
    const app = (await reportFor(h.recorder, { from: "2026-10-11", to: "2026-10-11" })).apps.a!
    expect(Object.keys(app.models)).toEqual(["other/model"])
    expect(app.totals.costUsd).toBeCloseTo(1, 12)
  })

  test("a cache hit is counted without tokens or cost; a call that never finishes records nothing as answered", async () => {
    const h = harness()
    const hit: ModelCaller = {
      stream(_request, context) {
        return (async function* (): AsyncGenerator<PlugEvent> {
          context.onCache?.("hit")
          yield ev.text("cached")
          yield ev.finish("stop", { inputTokens: 0, outputTokens: 0 })
        })()
      },
    }
    await collect(withUsage(hit, h.recorder).stream(plugRequest(), { app: "a", signal: signal() }))
    const failing: ModelCaller = {
      stream: () => events(ev.error()),
    }
    await collect(withUsage(failing, h.recorder).stream(plugRequest(), { app: "a", signal: signal() }))
    await tick()
    const app = (await reportFor(h.recorder, { from: "2026-10-11", to: "2026-10-11" })).apps.a!
    expect(app.totals.cacheHits).toBe(1)
    expect(app.models["test/echo"]).toEqual({ requests: 1, tokens: 0, costUsd: 0 })
    expect(app.totals.unpricedRequests).toBe(0)
  })

  test("with no recorder the caller is returned as it was", () => {
    const caller = new FakeModelCaller([ev.finish()])
    expect(withUsage(caller, undefined)).toBe(caller)
  })
})

describe("logging", () => {
  test("a pruning run is logged with its count only", async () => {
    const storage = new FakeStorage()
    storage.values.set("usage/a/2000-01-01", JSON.stringify(emptyDay()))
    const h = harness({ storage, retentionDays: 1 })
    h.recorder.request(request("a", 1))
    await tick()
    await tick()
    expect(logs.of("usage.pruned")[0]?.fields).toMatchObject({ dropped: "1" })
  })
})
