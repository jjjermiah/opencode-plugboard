import { describe, expect, test } from "bun:test"
import type { Limits } from "../../src/config.js"
import type { CallContext, ModelCaller, PlugEvent, PlugRequest } from "../../src/contract.js"
import { withFallbacks } from "../../src/fallback.js"
import { createLimitState, withLimits, type LimitState } from "../../src/limits.js"
import { collect, CATALOG, ev, gate, plugRequest, testOptions, tick, until } from "../support/fixtures.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { captureLogs } from "../support/logs.js"

const logs = captureLogs()

const concurrency429: PlugEvent = {
  type: "error",
  error: { status: 429, kind: "rate_limit", code: "too_many_requests", message: "Too many concurrent requests", retryAfterSeconds: 1 },
}
const rate429 = (retryAfterSeconds: number): PlugEvent => ({
  type: "error",
  error: { status: 429, kind: "rate_limit", code: "rate_limit_exceeded", message: "Too many requests per minute", retryAfterSeconds },
})

const signal = () => new AbortController().signal

/** One call from `app`, drained to its events. */
const start = (caller: ModelCaller, app: string, controller = new AbortController()): Promise<PlugEvent[]> =>
  collect(caller.stream(plugRequest(), { app, signal: controller.signal }))

/** A caller whose every call holds until `open` is opened (or the request aborts), then finishes. */
function holding() {
  const open = gate()
  const fake = new FakeModelCaller(() => [{ wait: open.promise }, ev.finish()])
  return { fake, open }
}

describe("#54 concurrency cap: the call over the cap is refused, the others run", () => {
  test("the N+1th concurrent call gets 429 at once and never reaches the model", async () => {
    const limitedBy: string[] = []
    const { fake, open } = holding()
    const state = createLimitState()
    const caller = withLimits(fake, () => ({ maxConcurrent: 2 }), state, { onLimited: (app, reason) => limitedBy.push(`${app}:${reason}`) })
    const first = start(caller, "alpha")
    const second = start(caller, "alpha")
    await until(() => fake.calls.length === 2, 1_000, "two calls in flight")

    expect(await start(caller, "alpha")).toEqual([concurrency429])
    expect(fake.calls.length).toBe(2)
    expect(limitedBy).toEqual(["alpha:concurrency"])
    expect(logs.of("request.limited").map((line) => line.fields)).toEqual([{ app: "alpha", reason: "concurrency", retryAfterSeconds: "1" }])

    open.open()
    expect(await first).toEqual([ev.finish()])
    expect(await second).toEqual([ev.finish()])
    expect(await start(caller, "alpha")).toEqual([ev.finish()])
  })

  test("the slot is taken before the model is called and a refused call holds none", async () => {
    const { fake, open } = holding()
    const state = createLimitState()
    const caller = withLimits(fake, () => ({ maxConcurrent: 1 }), state)
    const first = start(caller, "alpha")
    await until(() => fake.calls.length === 1, 1_000, "the first call in flight")
    expect(state.queues.get("*")?.pending).toBe(1)
    expect(await start(caller, "beta")).toEqual([{ ...concurrency429 }])
    expect(state.queues.get("*")?.pending).toBe(1)
    open.open()
    await first
    expect(state.queues.get("*")?.pending).toBe(0)
  })
})

describe("#54 a slot is freed however the call ends", () => {
  const cap = () => ({ maxConcurrent: 1 })

  test("when the stream completes", async () => {
    const caller = withLimits(new FakeModelCaller([ev.text("a"), ev.finish()]), cap, createLimitState())
    expect(await start(caller, "alpha")).toEqual([ev.text("a"), ev.finish()])
    expect(await start(caller, "alpha")).toEqual([ev.text("a"), ev.finish()])
  })

  test("when the inner stream throws", async () => {
    const fake = new FakeModelCaller((_request, call) => (call === 0 ? [{ throw: new Error("boom") }] : [ev.finish()]))
    const caller = withLimits(fake, cap, createLimitState())
    await expect(start(caller, "alpha")).rejects.toThrow("boom")
    expect(await start(caller, "alpha")).toEqual([ev.finish()])
  })

  test("when the consumer stops early", async () => {
    const fake = new FakeModelCaller([ev.text("a"), ev.text("b"), ev.finish()])
    const caller = withLimits(fake, cap, createLimitState())
    for await (const _ of caller.stream(plugRequest(), { app: "alpha", signal: signal() })) break
    expect(fake.calls[0]!.closed).toBe(true)
    await tick() // p-queue counts the slot free one microtask after the job resolves
    expect(await start(caller, "alpha")).toEqual([ev.text("a"), ev.text("b"), ev.finish()])
  })

  test("when the request aborts, even if the inner stream ignores the signal", async () => {
    const state = createLimitState()
    // An inner caller that never ends and never looks at the signal: only the abort can free the slot.
    const hung: ModelCaller = { stream: () => (async function* () { await new Promise(() => {}) })() }
    const controller = new AbortController()
    void start(withLimits(hung, cap, state), "alpha", controller)
    await tick()

    const ok = withLimits(new FakeModelCaller([ev.finish()]), cap, state)
    expect(await start(ok, "alpha")).toEqual([concurrency429])
    controller.abort()
    await tick()
    expect(await start(ok, "alpha")).toEqual([ev.finish()])
  })
})

describe("#54 caps per app: independent across apps, overridden per app", () => {
  test("the global cap counts every app together", async () => {
    const { fake, open } = holding()
    const caller = withLimits(fake, () => ({ maxConcurrent: 2 }), createLimitState())
    const busy = [start(caller, "alpha"), start(caller, "beta")]
    await until(() => fake.calls.length === 2, 1_000, "two apps in flight")
    expect(await start(caller, "gamma")).toEqual([concurrency429])
    open.open()
    await Promise.all(busy)
  })

  test("a per-app cap refuses only its own app", async () => {
    const { fake, open } = holding()
    const caller = withLimits(fake, () => ({ perApp: { maxConcurrent: 1 } }), createLimitState())
    const alpha = start(caller, "alpha")
    await until(() => fake.calls.length === 1, 1_000, "alpha in flight")
    expect(await start(caller, "alpha")).toEqual([concurrency429])
    const beta = start(caller, "beta")
    await until(() => fake.calls.length === 2, 1_000, "beta in flight")
    open.open()
    await Promise.all([alpha, beta])
  })

  test("an apps entry overrides perApp field by field", async () => {
    const { fake, open } = holding()
    const limits: Limits = { perApp: { maxConcurrent: 1 }, apps: { alpha: { maxConcurrent: 2 } } }
    const caller = withLimits(fake, () => limits, createLimitState())
    const alpha = [start(caller, "alpha"), start(caller, "alpha")]
    await until(() => fake.calls.length === 2, 1_000, "alpha at its own cap of 2")
    expect(await start(caller, "alpha")).toEqual([concurrency429])
    const beta = start(caller, "beta")
    await until(() => fake.calls.length === 3, 1_000, "beta at perApp 1")
    expect(await start(caller, "beta")).toEqual([concurrency429])
    open.open()
    await Promise.all([...alpha, beta])
  })
})

describe("#54 requests per minute: a fixed window per app, checked against an injected clock", () => {
  test("the call over the limit is refused with its retry time, and the window resets after a minute", async () => {
    let at = 0
    const fake = new FakeModelCaller([ev.finish()])
    const caller = withLimits(fake, () => ({ perApp: { requestsPerMinute: 2 } }), createLimitState(), { now: () => at })
    expect(await start(caller, "alpha")).toEqual([ev.finish()])
    at = 1_000
    expect(await start(caller, "alpha")).toEqual([ev.finish()])
    at = 30_000
    expect(await start(caller, "alpha")).toEqual([rate429(30)])
    expect(await start(caller, "beta")).toEqual([ev.finish()])
    expect(fake.calls.length).toBe(3)
    at = 59_999
    expect(await start(caller, "alpha")).toEqual([rate429(1)])
    at = 60_000
    expect(await start(caller, "alpha")).toEqual([ev.finish()])
    expect(logs.of("request.limited").at(-1)?.fields).toEqual({ app: "alpha", reason: "rate", retryAfterSeconds: "1" })
  })

  test("a call refused for concurrency spends no requests-per-minute count", async () => {
    const { fake, open } = holding()
    const caller = withLimits(fake, () => ({ maxConcurrent: 1, perApp: { requestsPerMinute: 2 } }), createLimitState(), { now: () => 0 })
    const first = start(caller, "alpha")
    await until(() => fake.calls.length === 1, 1_000, "first call in flight")
    expect(await start(caller, "alpha")).toEqual([concurrency429])
    open.open()
    await first
    expect(await start(caller, "alpha")).toEqual([ev.finish()])
    expect(await start(caller, "alpha")).toEqual([rate429(60)])
  })

  test("a request that falls back to a second target holds one slot and one count", async () => {
    const options = testOptions({ aliases: { chain: ["test/echo", "test/vision"] } })
    const open = gate()
    const fake = new FakeModelCaller((_request, call) =>
      call === 0 ? [ev.error({ status: 429, kind: "rate_limit", code: "rate_limited" })] : [{ wait: open.promise }, ev.finish()],
    )
    const state: LimitState = createLimitState()
    const caller = withLimits(withFallbacks(fake, { options, loadCatalog: async () => CATALOG }), () => ({ maxConcurrent: 1 }), state)
    const chain: PlugRequest = plugRequest({ model: "chain", ref: { providerID: "test", id: "echo" } })
    const answering = collect(caller.stream(chain, { app: "alpha", signal: signal() } satisfies CallContext))
    await until(() => fake.calls.length === 2, 1_000, "second target in flight")
    expect(await start(caller, "alpha")).toEqual([concurrency429])
    open.open()
    expect(await answering).toEqual([ev.finish()])
  })
})

describe("#54 no caps that apply: the caller is called as it is", () => {
  test.each([
    ["no limits", undefined],
    ["an empty limits", {}],
    ["an apps entry for another app", { apps: { beta: { maxConcurrent: 1 } } }],
  ])("%s admits every call", async (_name, limits) => {
    const fake = new FakeModelCaller([ev.finish()])
    const caller = withLimits(fake, () => limits as Limits | undefined, createLimitState())
    const all = await Promise.all([start(caller, "alpha"), start(caller, "alpha"), start(caller, "alpha")])
    expect(all).toEqual([[ev.finish()], [ev.finish()], [ev.finish()]])
  })
})
