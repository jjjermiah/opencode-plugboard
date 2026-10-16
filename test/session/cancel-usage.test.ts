/**
 * A run cut short (the client left, or the request timed out) still spent the tokens the host reported before the cut. The
 * usage record counts them and the app's budget is charged, as it is for a finished answer (`withUsage`, src/usage.ts). The
 * fake host reports usage, then the client cancels: the fake host never sends a finish.
 */
import { describe, expect, test } from "bun:test"
import { createBudgetState, withBudgets } from "../../src/budgets.js"
import type { Budgets } from "../../src/config.js"
import type { CallContext, PlugEvent } from "../../src/contract.js"
import { createSessionCaller, type SessionCallerDeps } from "../../src/session/caller.js"
import { createSessionStore } from "../../src/session/state.js"
import { createUsageRecorder, createUsageState, withUsage, type UsageRecorder, type UsageReport } from "../../src/usage.js"
import { collect, model, plugRequest, until } from "../support/fixtures.js"
import { bus, FakeSessionPort, type BusEnvelope } from "../support/session.js"
import { FakeStorage } from "../support/usage.js"

/** Sunday 2026-10-11 12:00 UTC: every window started before it. */
const NOW = Date.parse("2026-10-11T12:00:00Z")
/** The model the request names (`test/echo`), priced at 2 USD per million input and output tokens. */
const PRICED = model("test", "echo", { cost: [{ input: 2, output: 2, cacheRead: 0, cacheWrite: 0 }] })

/**
 * The session caller under the usage recorder and the budget wrapper, in the order the server composes them. `settleMs` is
 * short by default: a disconnected run waits that long for its host step before it is interrupted.
 */
function harness(budgets?: Budgets, deps: Partial<SessionCallerDeps> = {}) {
  const port = new FakeSessionPort()
  const sessions = createSessionStore()
  const missing: string[] = []
  const session = createSessionCaller({ port, sessions, maxTools: 2, settleMs: 100, stopDrainMs: 50, onUsageMissing: (app) => void missing.push(app), ...deps })
  const usage: UsageRecorder = createUsageRecorder({
    state: createUsageState(),
    storage: new FakeStorage(),
    loadCatalog: async () => [PRICED],
    retentionDays: 90,
    now: () => NOW,
  })
  const caller = withUsage(withBudgets(session, budgets, usage, createBudgetState(), { now: () => NOW }), usage)
  return { port, sessions, caller, usage, missing }
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

describe("a disconnected run gets the settle window: the host step that ends within it is charged", () => {
  test("the host is not interrupted at once; its step end with usage inside the window is charged, and nothing is counted missing", async () => {
    const run = harness(undefined, { settleMs: 1000 })
    run.port.script.prompt = async (input) => {
      const id = String(input.sessionID)
      queueMicrotask(() => run.sessions.dispatch(bus(id).textDelta("hel")))
      setTimeout(() => {
        run.sessions.dispatch(bus(id).usage({ input: 800, output: 100 }))
        run.sessions.dispatch(bus(id).stepEnded("stop", { input: 800, output: 100 }))
      }, 50)
    }
    const controller = new AbortController()
    for await (const _event of run.caller.stream(plugRequest(), { app: "app", signal: controller.signal })) controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(run.port.interrupted).toEqual([])
    await until(async () => (await appTotals(run.usage)).tokens.input === 800, 1_000, "the step end usage")
    const totals = await appTotals(run.usage)
    expect(totals.tokens).toMatchObject({ input: 800, output: 100 })
    expect(run.port.interrupted).toEqual([])
    expect(run.missing).toEqual([])
  })

  test("a host that never ends its step is interrupted when the window runs out, and the miss is counted with no tokens", async () => {
    const run = harness(undefined, { settleMs: 100 })
    answer(run, (id) => [bus(id).textDelta("hel")])
    const controller = new AbortController()
    for await (const _event of run.caller.stream(plugRequest(), { app: "app", signal: controller.signal })) controller.abort()
    expect(run.port.interrupted).toEqual([])
    await until(() => run.port.interrupted.length === 1, 1_000, "the interrupt after the window")
    await until(() => run.missing.length === 1, 1_000, "the missing count")
    expect(run.missing).toEqual(["app"])
    expect((await appTotals(run.usage)).tokens.input).toBe(0)
  })

  test("a request timeout still interrupts at once, without the window, and the usage reported so far is charged", async () => {
    const run = harness(undefined, { settleMs: 10_000 })
    answer(run, (id) => [bus(id).textDelta("hel"), bus(id).usage({ input: 300, output: 30 })])
    const controller = new AbortController()
    for await (const _event of run.caller.stream(plugRequest(), { app: "app", signal: controller.signal })) controller.abort(Object.assign(new Error("timeout"), { kind: "timeout" }))
    await until(() => run.port.interrupted.length === 1, 1_000, "the interrupt")
    await until(async () => (await appTotals(run.usage)).tokens.input === 300, 1_000, "the usage reported before the timeout")
    expect(run.missing).toEqual([])
  })

  test("settleMs 0 interrupts a disconnected run at once", async () => {
    const run = harness(undefined, { settleMs: 0 })
    answer(run, (id) => [bus(id).textDelta("hel")])
    const controller = new AbortController()
    for await (const _event of run.caller.stream(plugRequest(), { app: "app", signal: controller.signal })) controller.abort()
    expect(run.port.interrupted).toEqual(["ses_1"])
  })
})

describe("a client that left: no tool runs and no step starts, and internal cancels stop at once", () => {
  /** A run the client leaves after its first text: the window is long, so only an interrupt before it can satisfy a test. */
  async function leftAfterFirstText(options: Partial<SessionCallerDeps> = {}) {
    const run = harness(undefined, { settleMs: 10_000, ...options })
    answer(run, (id) => [bus(id).textDelta("hel")])
    const controller = new AbortController()
    for await (const _event of run.caller.stream(plugRequest(), { app: "app", signal: controller.signal })) controller.abort()
    return run
  }

  test("a client tool call in the window interrupts the host at once", async () => {
    const run = await leftAfterFirstText()
    run.sessions.dispatch(bus("ses_1").toolCalled("c1", "lookup", { q: 1 }))
    await until(() => run.port.interrupted.length === 1, 300, "the interrupt at the tool call")
    expect(run.port.interrupted).toEqual(["ses_1"])
  })

  test("a server tool call in the window interrupts the host at once", async () => {
    const run = harness(undefined, { settleMs: 10_000, apps: { app: { serverTools: ["lookup"] } } as never })
    run.port.toolIDs.push("lookup")
    answer(run, (id) => [bus(id).textDelta("hel")])
    const controller = new AbortController()
    for await (const _event of run.caller.stream(plugRequest(), { app: "app", signal: controller.signal })) controller.abort()
    run.sessions.dispatch(bus("ses_1").toolCalled("s1", "lookup", {}))
    await until(() => run.port.interrupted.length === 1, 300, "the interrupt at the server tool call")
    expect(run.port.interrupted).toEqual(["ses_1"])
  })

  test("a step that ends with tool calls in the window interrupts the host at once, so no next step starts", async () => {
    const run = await leftAfterFirstText()
    run.sessions.dispatch(bus("ses_1").stepEnded("tool-calls"))
    await until(() => run.port.interrupted.length === 1, 300, "the interrupt at the step end")
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(run.port.interrupted).toEqual(["ses_1"])
  })

  test("a tool call and its step end are one interrupt, not two", async () => {
    const run = await leftAfterFirstText()
    run.sessions.dispatch(bus("ses_1").toolCalled("c1", "lookup", { q: 1 }))
    run.sessions.dispatch(bus("ses_1").stepEnded("tool-calls"))
    await until(() => run.port.interrupted.length === 1, 300, "the interrupt")
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(run.port.interrupted).toEqual(["ses_1"])
  })

  test("a finish that was already yielded when the client leaves is charged once, not again when the window closes", async () => {
    // `length` is not a settled stop, so without the guard the caller would wait for the window and charge the same usage again.
    const run = harness(undefined, { settleMs: 200, stopDrainMs: 50 })
    answer(run, (id) => [bus(id).textDelta("hel"), bus(id).usage({ input: 800, output: 100 }), bus(id).stepEnded("length", { input: 800, output: 100 })])
    const controller = new AbortController()
    for await (const event of run.caller.stream(plugRequest(), { app: "app", signal: controller.signal })) if (event.type === "finish") controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect((await appTotals(run.usage)).tokens).toMatchObject({ input: 800, output: 100 })
  })

  test("a cancel by plugboard itself (a sibling choice failed) interrupts at once, without the window", async () => {
    const run = harness(undefined, { settleMs: 10_000 })
    answer(run, (id) => [bus(id).textDelta("hel")])
    const controller = new AbortController()
    for await (const _event of run.caller.stream(plugRequest(), { app: "app", signal: controller.signal })) controller.abort(Object.assign(new Error("cancelled"), { kind: "cancelled" }))
    await until(() => run.port.interrupted.length === 1, 300, "the interrupt")
  })
})
