/**
 * A run cut short (the client left, or the request timed out) still spent the tokens the host reported before the cut. The
 * usage record counts them and the app's budget is charged, as it is for a finished answer (`withUsage`, src/usage.ts). The
 * fake host reports usage, then the client cancels: the fake host never sends a finish.
 */
import { describe, expect, test } from "bun:test"
import { createBudgetState, withBudgets } from "../../src/budgets.js"
import type { Budgets } from "../../src/config.js"
import type { CallContext, PlugEvent } from "../../src/contract.js"
import { createSessionCaller } from "../../src/session/caller.js"
import { createSessionStore } from "../../src/session/state.js"
import { createUsageRecorder, createUsageState, withUsage, type UsageRecorder, type UsageReport } from "../../src/usage.js"
import { collect, model, plugRequest, until } from "../support/fixtures.js"
import { bus, FakeSessionPort, type BusEnvelope } from "../support/session.js"
import { FakeStorage } from "../support/usage.js"

/** Sunday 2026-10-11 12:00 UTC: every window started before it. */
const NOW = Date.parse("2026-10-11T12:00:00Z")
/** The model the request names (`test/echo`), priced at 2 USD per million input and output tokens. */
const PRICED = model("test", "echo", { cost: [{ input: 2, output: 2, cacheRead: 0, cacheWrite: 0 }] })

/** The session caller under the usage recorder and the budget wrapper, in the order the server composes them. */
function harness(budgets?: Budgets) {
  const port = new FakeSessionPort()
  const sessions = createSessionStore()
  const session = createSessionCaller({ port, sessions, maxTools: 2 })
  const usage: UsageRecorder = createUsageRecorder({
    state: createUsageState(),
    storage: new FakeStorage(),
    loadCatalog: async () => [PRICED],
    retentionDays: 90,
    now: () => NOW,
  })
  const caller = withUsage(withBudgets(session, budgets, usage, createBudgetState(), { now: () => NOW }), usage)
  return { port, sessions, caller, usage }
}

/** The host's answer: each list of bus events is dispatched in order, as one step of the run. */
function answer(run: ReturnType<typeof harness>, events: (sessionID: string) => BusEnvelope[]) {
  run.port.script.prompt = async (input) => {
    const sessionID = String(input.sessionID)
    queueMicrotask(() => events(sessionID).forEach((event) => run.sessions.dispatch(event)))
  }
}

const appTotals = async (usage: UsageRecorder) => ((await usage.query({ app: "app" })) as UsageReport).apps.app!.totals

describe("a cancelled run is recorded and charged for the usage the host reported", () => {
  test("the client cancels after usage events: the tokens and cost are recorded, and the next call is refused by the token budget", async () => {
    const run = harness({ perApp: { tokens: { day: 500 } } })
    answer(run, (id) => [bus(id).textDelta("hel"), bus(id).usage({ input: 800, output: 100 })])
    const controller = new AbortController()
    const context: CallContext = { app: "app", signal: controller.signal }
    const seen: PlugEvent[] = []
    for await (const event of run.caller.stream(plugRequest(), context)) {
      seen.push(event)
      controller.abort()
    }
    expect(seen).toEqual([{ type: "text-delta", text: "hel" }])

    await until(async () => (await appTotals(run.usage)).tokens.input === 800, 1_000, "the cancelled run's usage")
    const totals = await appTotals(run.usage)
    expect(totals.tokens).toMatchObject({ input: 800, output: 100 })
    expect(totals.costUsd).toBeCloseTo(0.0018, 10)

    // 900 tokens are spent against a 500 token day: the next call of the app is refused before it reaches the host.
    const refused = await collect(run.caller.stream(plugRequest(), { app: "app", signal: new AbortController().signal }))
    expect(refused).toEqual([{ type: "error", error: expect.objectContaining({ status: 429, code: "budget_exceeded" }) }])
    expect(run.port.prompted).toHaveLength(1)
  })

  test("a run cut short before the host reported any usage records nothing and charges nothing", async () => {
    const run = harness({ perApp: { tokens: { day: 500 } } })
    answer(run, (id) => [bus(id).textDelta("hel")])
    const controller = new AbortController()
    for await (const _event of run.caller.stream(plugRequest(), { app: "app", signal: controller.signal })) controller.abort()
    await until(() => run.port.interrupted.length === 1, 1_000, "the interrupt")
    const totals = await appTotals(run.usage)
    expect(totals.tokens).toMatchObject({ input: 0, output: 0 })
    expect(totals.costUsd).toBe(0)
  })
})
