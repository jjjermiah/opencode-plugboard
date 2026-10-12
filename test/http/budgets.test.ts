/**
 * Per-app budgets over loopback HTTP: a chat call over its ceiling gets 429 `budget_exceeded` with
 * Retry-After, and `GET /plugboard/usage` carries each app's budget state. The caller is wrapped as the
 * server wraps it (`withBudgets` inside `withUsage`), so the numbers come from the same path.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createBudgetState, withBudgets } from "../../src/budgets.js"
import { createUsageRecorder, createUsageState, withUsage, type UsageRecorder } from "../../src/usage.js"
import { CATALOG, ev, testOptions, until } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { FakeStorage } from "../support/usage.js"

captureLogs()

const KEYS = { alpha: "key-alpha-secret", beta: "key-beta-secret" }
const bearer = (key: string) => ({ authorization: `Bearer ${key}` })
const chat = (key: string): SendInit => ({
  method: "POST",
  path: "/v1/chat/completions",
  headers: bearer(key),
  body: { model: "test/echo", messages: [{ role: "user", content: "hi" }] },
})

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

/** A route whose chat calls answer with 10 input and 5 output tokens, under `budgets` (raw option). */
async function start(budgets?: Record<string, unknown>): Promise<{ srv: RouteServer; recorder: UsageRecorder }> {
  const recorder = createUsageRecorder({ state: createUsageState(), storage: new FakeStorage(), loadCatalog: async () => CATALOG, retentionDays: 90 })
  const parsed = testOptions({ keys: KEYS, ...(budgets ? { budgets } : {}) }).budgets
  const model = new FakeModelCaller(() => [ev.text("hi"), ev.finish("stop", { inputTokens: 10, outputTokens: 5 })])
  // Wired as index.ts wires it: a refusal is counted as limited.
  const caller = withUsage(withBudgets(model, parsed, recorder, createBudgetState(), { onRefused: (app) => recorder.limited(app) }), recorder)
  server = await startRoute({ caller, options: { keys: KEYS, ...(budgets ? { budgets } : {}) }, usage: recorder })
  return { srv: server, recorder }
}

/** Waits until the recorder has counted `count` requests of `app` (the route counts each one after its response ends). */
async function counted(recorder: UsageRecorder, app: string, count: number): Promise<void> {
  await until(async () => ((await recorder.query({ app })) as { apps: Record<string, { totals: { requests: number } }> }).apps[app]?.totals.requests === count, 1_000, `${count} request(s) of ${app}`)
}

describe("#60 a chat call over its ceiling is 429 budget_exceeded with Retry-After", () => {
  test("the first call is served; the next is refused with the seconds left in the UTC day", async () => {
    const { srv, recorder } = await start({ perApp: { requests: { day: 1 } } })
    expect((await srv.send(chat(KEYS.alpha))).status).toBe(200)
    await counted(recorder, "alpha", 1)

    const reply = await srv.send(chat(KEYS.alpha))
    expect(reply.status).toBe(429)
    const retryAfter = Number(reply.headers["retry-after"])
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(86_400)
    expect(reply.json().error).toEqual({
      message: "Budget for alpha exceeded: requests day",
      type: "rate_limit_error",
      param: null,
      code: "budget_exceeded",
    })
  })

  test("a budget is per app: the other app is served while alpha is refused", async () => {
    const { srv, recorder } = await start({ apps: { alpha: { requests: { day: 1 } } } })
    expect((await srv.send(chat(KEYS.alpha))).status).toBe(200)
    await counted(recorder, "alpha", 1)
    expect((await srv.send(chat(KEYS.alpha))).status).toBe(429)
    expect((await srv.send(chat(KEYS.beta))).status).toBe(200)
  })
})

describe("#60 GET /plugboard/usage shows each app's budget state", () => {
  test("alpha's ceiling is used by its served call only: the refusal is counted as limited, not as used", async () => {
    const { srv, recorder } = await start({ perApp: { requests: { day: 1 } } })
    await srv.send(chat(KEYS.alpha))
    await counted(recorder, "alpha", 1)
    await srv.send(chat(KEYS.alpha))
    await counted(recorder, "alpha", 2)

    const report = (await srv.send({ path: "/plugboard/usage", headers: bearer(KEYS.alpha) })).json()
    expect(report.apps.alpha.totals.limited).toBe(1)
    const tomorrow = new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString()
    expect(report.apps.alpha.budgets).toEqual([{ metric: "requests", window: "day", limit: 1, used: 1, resetsAt: tomorrow }])
  })

  test("without budgets the report has no budgets field", async () => {
    const { srv, recorder } = await start()
    await srv.send(chat(KEYS.alpha))
    await counted(recorder, "alpha", 1)
    const report = (await srv.send({ path: "/plugboard/usage", headers: bearer(KEYS.alpha) })).json()
    expect(report.apps.alpha).not.toHaveProperty("budgets")
  })
})
