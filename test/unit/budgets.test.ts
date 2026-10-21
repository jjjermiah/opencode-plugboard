import { describe, expect, test } from "bun:test"
import { budgetFor, budgetStatus, createBudgetState, withBudgets, windowAt } from "../../src/budgets.js"
import type { Budget, Budgets } from "../../src/config.js"
import type { CatalogModel, ModelCaller, PlugEvent } from "../../src/contract.js"
import { createLimitState, withLimits } from "../../src/limits.js"
import { createMetrics } from "../../src/metrics.js"
import { createUsageRecorder, createUsageState, type UsageRecorder, type UsageReport } from "../../src/usage.js"
import { CATALOG, collect, ev, model, plugRequest, tick, until } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { FakeStorage } from "../support/usage.js"

const logs = captureLogs()

/** Sunday 2026-10-11 12:00 UTC: the day, week and month all started before it. */
const T0 = Date.parse("2026-10-11T12:00:00Z")
const TOMORROW = "2026-10-12T00:00:00.000Z"
/** The paid model: 2 USD per million input tokens. */
const PRICED: CatalogModel = model("test", "priced", { cost: [{ input: 2, output: 2, cacheRead: 0, cacheWrite: 0 }] })

const signal = () => new AbortController().signal
const start = (caller: ModelCaller, app: string) => collect(caller.stream(plugRequest(), { app, signal: signal() }))

/** The refusal a call over `what` gets, with its Retry-After. */
const refused = (app: string, what: string, retryAfterSeconds: number): PlugEvent => ({
  type: "error",
  error: { status: 429, kind: "rate_limit", code: "budget_exceeded", message: `Budget for ${app} exceeded: ${what}`, retryAfterSeconds },
})

/** The usage of one app, as the recorder counts it: each request of `app` (the route counts the request when it ends). */
async function requestsOf(usage: UsageRecorder, app: string): Promise<number> {
  return ((await usage.query({ app })) as UsageReport).apps[app]?.totals.requests ?? 0
}

/** Records `n` requests of `app` and waits until the recorder holds them. */
async function requested(usage: UsageRecorder, app: string, n = 1): Promise<void> {
  const before = await requestsOf(usage, app)
  for (let i = 0; i < n; i++) usage.request({ app, route: "POST /v1/chat/completions", status: 200, outcome: "ok", ms: 1 })
  await until(async () => (await requestsOf(usage, app)) === before + n, 1_000, `${n} request(s) of ${app}`)
}

/** One harness: a recorder on a clock the test moves, a fake model, and the budgets wrapper on the same clock. */
function harness(budgets: Budgets | undefined, options: { storage?: FakeStorage } = {}) {
  const clock = { at: T0 }
  const storage = options.storage ?? new FakeStorage()
  const usage = createUsageRecorder({
    state: createUsageState(),
    storage,
    loadCatalog: async () => [...CATALOG, PRICED],
    retentionDays: 90,
    now: () => clock.at,
  })
  const fake = new FakeModelCaller(() => [ev.text("hi"), ev.finish("stop")])
  const seen: string[] = []
  const state = createBudgetState()
  const caller = withBudgets(fake, budgets, usage, state, { now: () => clock.at, onRefused: (app) => seen.push(app) })
  return { clock, usage, fake, caller, seen, state }
}

describe("#60 windows start at their UTC boundary: day at midnight, week on Monday, month on the 1st", () => {
  test.each([
    ["day", "2026-10-11T23:59:59.999Z", "2026-10-11", "2026-10-12T00:00:00.000Z"],
    ["day", "2026-10-12T00:00:00.000Z", "2026-10-12", "2026-10-13T00:00:00.000Z"],
    ["week", "2026-10-11T23:59:59.999Z", "2026-10-05", "2026-10-12T00:00:00.000Z"],
    ["week", "2026-10-12T00:00:00.000Z", "2026-10-12", "2026-10-19T00:00:00.000Z"],
    ["month", "2026-10-31T23:59:59.999Z", "2026-10-01", "2026-11-01T00:00:00.000Z"],
    ["month", "2026-11-01T00:00:00.000Z", "2026-11-01", "2026-12-01T00:00:00.000Z"],
    ["month", "2026-12-31T10:00:00.000Z", "2026-12-01", "2027-01-01T00:00:00.000Z"],
  ] as const)("%s at %s starts %s and resets %s", (window, at, start, resetsAt) => {
    const found = windowAt(window, Date.parse(at))
    expect(found.start).toBe(start)
    expect(new Date(found.resetsAt).toISOString()).toBe(resetsAt)
  })
})

describe("#60 the app's budget: apps replaces perApp metric by metric", () => {
  const perApp: Budget = { requests: { day: 10 }, tokens: { day: 100 } }

  test("perApp applies to every app", () => {
    expect(budgetFor({ perApp }, "beta")).toEqual(perApp)
  })

  test("an apps entry replaces the metrics it sets and keeps the rest of perApp", () => {
    const budgets: Budgets = { perApp, apps: { alpha: { requests: { day: 2 } } } }
    expect(budgetFor(budgets, "alpha")).toEqual({ requests: { day: 2 }, tokens: { day: 100 } })
    expect(budgetFor(budgets, "beta")).toEqual(perApp)
  })

  test("no budget for an app with no ceiling", () => {
    expect(budgetFor({}, "alpha")).toBeUndefined()
    expect(budgetFor({ apps: { beta: { tokens: { day: 1 } } } }, "alpha")).toBeUndefined()
  })
})

describe("#60 a refused call: 429 budget_exceeded with Retry-After until the window resets", () => {
  test("a call is served until the ceiling is reached, then refused for the rest of the day", async () => {
    const h = harness({ perApp: { requests: { day: 2 } } })
    await requested(h.usage, "alpha", 1)
    expect(await start(h.caller, "alpha")).toEqual([ev.text("hi"), ev.finish("stop")])
    await requested(h.usage, "alpha", 1)
    // 12:00 UTC: twelve hours to the next day.
    expect(await start(h.caller, "alpha")).toEqual([refused("alpha", "requests day", 43_200)])
    expect(h.fake.calls.length).toBe(1)
    expect(h.seen).toEqual(["alpha"])
    expect(logs.of("request.budget_exceeded").map((line) => line.fields)).toEqual([{ app: "alpha", budgets: "requests day", retryAfterSeconds: "43200" }])
  })

  test("the app is served again once the window resets, and other apps were never refused", async () => {
    const h = harness({ perApp: { requests: { day: 1 } } })
    await requested(h.usage, "alpha", 1)
    expect(await start(h.caller, "alpha")).toHaveLength(1)
    expect(await start(h.caller, "beta")).toEqual([ev.text("hi"), ev.finish("stop")])
    h.clock.at = Date.parse(TOMORROW)
    expect(await start(h.caller, "alpha")).toEqual([ev.text("hi"), ev.finish("stop")])
  })

  test("a weekly ceiling counts from Monday: a Sunday still shares the week of the Monday before", async () => {
    const h = harness({ perApp: { requests: { week: 2 } } })
    h.clock.at = Date.parse("2026-10-05T09:00:00Z")
    await requested(h.usage, "alpha", 2)
    h.clock.at = T0
    expect(await start(h.caller, "alpha")).toEqual([refused("alpha", "requests week", 43_200)])
    h.clock.at = Date.parse(TOMORROW)
    expect(await start(h.caller, "alpha")).toEqual([ev.text("hi"), ev.finish("stop")])
  })

  test("a monthly token ceiling counts the month's answered calls and resets on the 1st", async () => {
    const h = harness({ perApp: { tokens: { month: 1_000 } } })
    h.clock.at = Date.parse("2026-10-30T10:00:00Z")
    h.usage.call({ app: "alpha", answered: true, usage: { inputTokens: 1_000, outputTokens: 0 } })
    await tick()
    h.clock.at = Date.parse("2026-10-31T23:00:00Z")
    expect(await start(h.caller, "alpha")).toEqual([refused("alpha", "tokens month", 3_600)])
    h.clock.at = Date.parse("2026-11-01T00:00:00Z")
    expect(await start(h.caller, "alpha")).toEqual([ev.text("hi"), ev.finish("stop")])
  })

  test("the cost ceiling reads the priced answers of the catalog, in USD", async () => {
    const h = harness({ perApp: { costUsd: { day: 1.5 }, tokens: { day: 10_000_000 } } })
    h.usage.call({ app: "alpha", ref: { providerID: "test", id: "priced" }, answered: true, usage: { inputTokens: 1_000_000, outputTokens: 0 } })
    await tick()
    await until(async () => ((await h.usage.query({ app: "alpha" })) as UsageReport).apps.alpha?.totals.costUsd === 2, 1_000, "the priced call")
    expect(await start(h.caller, "alpha")).toEqual([refused("alpha", "cost (USD) day", 43_200)])
  })

  test("every exceeded ceiling is named, and Retry-After waits for the latest reset", async () => {
    const h = harness({ perApp: { requests: { day: 1 }, tokens: { week: 1 } } })
    // Monday of the same week, then today: the tokens sit in the week, the request in the day.
    h.clock.at = Date.parse("2026-10-05T09:00:00Z")
    h.usage.call({ app: "alpha", answered: true, usage: { inputTokens: 5, outputTokens: 0 } })
    await tick()
    h.clock.at = T0
    await requested(h.usage, "alpha", 1)
    expect(await start(h.caller, "alpha")).toEqual([refused("alpha", "requests day, tokens week", 43_200)])
  })
})

describe("several windows on one metric: each is enforced, and the refusal names the one that tripped", () => {
  const budgets: Budgets = { perApp: { requests: { day: 2, month: 5 } } }

  test("the day ceiling trips first while the month has room", async () => {
    const h = harness(budgets)
    await requested(h.usage, "alpha", 2)
    expect(await start(h.caller, "alpha")).toEqual([refused("alpha", "requests day", 43_200)])
    expect(h.fake.calls.length).toBe(0)
  })

  test("the month ceiling trips first when earlier days used it up, and the refusal waits for the month to reset", async () => {
    const h = harness(budgets)
    h.clock.at = Date.parse("2026-10-03T10:00:00Z")
    await requested(h.usage, "alpha", 5)
    h.clock.at = T0
    // Nothing today, so the day ceiling is clear; the month is spent. Resets 2026-11-01T00:00Z: 20 days 12 hours after T0.
    expect(await start(h.caller, "alpha")).toEqual([refused("alpha", "requests month", 20 * 86_400 + 43_200)])
  })

  test("a call under both ceilings is served, and both are named when both are over", async () => {
    const h = harness(budgets)
    h.clock.at = Date.parse("2026-10-03T10:00:00Z")
    await requested(h.usage, "alpha", 3)
    h.clock.at = T0
    await requested(h.usage, "alpha", 1)
    expect(await start(h.caller, "alpha")).toEqual([ev.text("hi"), ev.finish("stop")])
    await requested(h.usage, "alpha", 1)
    // Today holds 2 (day ceiling 2) and the month 5 (month ceiling 5).
    expect(await start(h.caller, "alpha")).toEqual([refused("alpha", "requests day, requests month", 20 * 86_400 + 43_200)])
  })
})

describe("#60 the 80% warning: once per app, budget and window", () => {
  test("crossing 80% logs budget.warning, once in a window and again in the next one", async () => {
    const h = harness({ perApp: { requests: { day: 10 } } })
    await requested(h.usage, "alpha", 7)
    expect(await start(h.caller, "alpha")).toHaveLength(2)
    expect(logs.of("budget.warning")).toHaveLength(0)

    await requested(h.usage, "alpha", 1)
    expect(await start(h.caller, "alpha")).toHaveLength(2)
    expect(await start(h.caller, "alpha")).toHaveLength(2)
    expect(logs.of("budget.warning").map((line) => line.fields)).toEqual([{ app: "alpha", budget: "requests", window: "day", used: "8", limit: "10", resetsAt: TOMORROW }])

    h.clock.at = Date.parse(TOMORROW)
    await requested(h.usage, "alpha", 8)
    expect(await start(h.caller, "alpha")).toHaveLength(2)
    expect(logs.of("budget.warning")).toHaveLength(2)
  })
})

describe("#60 the budget check runs before the limits", () => {
  test("a refused call takes no concurrency slot and never reaches the model", async () => {
    const clock = { at: T0 }
    const usage = createUsageRecorder({ state: createUsageState(), storage: new FakeStorage(), loadCatalog: async () => CATALOG, retentionDays: 90, now: () => clock.at })
    await requested(usage, "alpha", 1)
    const fake = new FakeModelCaller([ev.finish()])
    const limitState = createLimitState()
    const caller = withBudgets(
      withLimits(fake, () => ({ maxConcurrent: 1 }), limitState),
      { perApp: { requests: { day: 1 } } },
      usage,
      createBudgetState(),
      { now: () => clock.at },
    )

    expect(await start(caller, "alpha")).toEqual([refused("alpha", "requests day", 43_200)])
    expect(limitState.queues.get("*")?.pending ?? 0).toBe(0)
    expect(fake.calls.length).toBe(0)
  })
})

describe("#60 records that cannot be read refuse the call", () => {
  test("a storage failure is 503 budget_unavailable, logged, and the model is not called", async () => {
    const storage = new FakeStorage()
    storage.get = async () => {
      throw new Error("database locked")
    }
    const h = harness({ perApp: { requests: { day: 1 } } }, { storage })
    expect(await start(h.caller, "alpha")).toEqual([
      { type: "error", error: { status: 503, kind: "server", code: "budget_unavailable", message: "Could not read the usage records for the budget check" } },
    ])
    expect(h.fake.calls.length).toBe(0)
    expect(logs.of("budget.check_failed").map((line) => line.fields)).toEqual([{ app: "alpha", error: "database locked" }])
  })
})

describe("#60 budget state: what the current window has used and when it resets", () => {
  test("each ceiling lists its limit, used count and reset instant, in metric then window order", async () => {
    const h = harness({ perApp: { requests: { day: 10, month: 100 }, tokens: { week: 5_000 } } })
    await requested(h.usage, "alpha", 3)
    const budget = budgetFor({ perApp: { requests: { day: 10, month: 100 }, tokens: { week: 5_000 } } }, "alpha")!
    expect(await budgetStatus(h.usage, budget, "alpha", T0)).toEqual([
      { metric: "requests", window: "day", limit: 10, used: 3, resetsAt: TOMORROW },
      { metric: "requests", window: "month", limit: 100, used: 3, resetsAt: "2026-11-01T00:00:00.000Z" },
      { metric: "tokens", window: "week", limit: 5_000, used: 0, resetsAt: TOMORROW },
    ])
  })
})

describe("#60 refusals reach metrics as reason budget", () => {
  test('plugboard_limited_total counts a budget refusal under reason="budget"', async () => {
    const metrics = createMetrics()
    metrics.limited("alpha", "budget")
    const text = await metrics.render({ generations: 0, pumpRunning: false, guards: 0, startedAt: T0 })
    expect(text).toContain('plugboard_limited_total{app="alpha",reason="budget"} 1')
  })
})
