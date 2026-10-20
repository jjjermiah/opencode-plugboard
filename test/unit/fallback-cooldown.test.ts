/**
 * The circuit breaker inside a fallback chain (src/fallback.ts, src/breaker.ts): a target that failed N times in a row is
 * skipped for a cooldown, one probe is let through after it, and a chain whose targets all cool down still tries the first.
 * The model caller is a script per target and the clock is moved by the test, so nothing sleeps.
 */
import { describe, expect, test } from "bun:test"
import { createBreaker, type Breaker } from "../../src/breaker.js"
import { parseOptions } from "../../src/config.js"
import type { CallContext, ModelCaller, PlugEvent, PlugRequest, ServedModel } from "../../src/contract.js"
import { withFallbacks } from "../../src/fallback.js"
import { resolveModel } from "../../src/models.js"
import { collect, ev, model, plugRequest } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"

const logs = captureLogs()

const CATALOG = [model("a", "x"), model("b", "y", { variants: ["low"] }), model("c", "z")]
const COOLDOWN_MS = 1000
const raw = { models: ["a/*", "b/*", "c/*"], aliases: { chain: ["a/x", "b/y#low", "c/z"], one: ["a/x"], plain: "a/x" } }
const options = parseOptions({ ...raw, circuitBreaker: { failures: 3, cooldownMs: COOLDOWN_MS, failureWindowMs: 10_000 } })
const rateLimited = ev.error({ status: 429, kind: "rate_limit", code: "rate_limited" })
const answer = (): PlugEvent[] => [ev.text("hi"), ev.finish()]

/** What each target does when called: events to yield, or an Error to throw. A test changes it between requests. */
type Behaviour = Record<string, PlugEvent[] | Error>

function setup(behaviour: Behaviour, opts = options, shared?: Breaker) {
  let at = 1_000_000
  const breaker = shared ?? createBreaker(() => at)
  const calls: Array<{ target: string; fallbackNext: boolean | undefined }> = []
  const events: string[] = []
  const inner: ModelCaller = {
    stream(request: PlugRequest, context: CallContext) {
      const target = `${request.ref.providerID}/${request.ref.id}`
      calls.push({ target, fallbackNext: context.fallbackNext })
      return (async function* () {
        const script = behaviour[target]!
        if (script instanceof Error) throw script
        yield* script
      })()
    },
  }
  const caller = withFallbacks(inner, { options: opts, loadCatalog: async () => CATALOG, breaker, onCooldown: (event) => void events.push(event) })
  /** One request to `name`; resolves with what the call saw. */
  async function request(name = "chain", signal = new AbortController().signal) {
    const before = calls.length
    const served: ServedModel[] = []
    const out = await collect(caller.stream(plugRequest({ model: name, ref: resolveModel(opts, name, CATALOG) as never }), { app: "app1", signal, onServed: (s) => served.push(s) }))
    return { targets: calls.slice(before).map((call) => call.target), served, out }
  }
  return { request, calls, events, breaker, advance: (ms: number) => void (at += ms), behaviour }
}

/** a/x is down (429); b/y#low and c/z answer. Three requests open a/x. */
async function openFirst() {
  const run = setup({ "a/x": [rateLimited], "b/y": answer(), "c/z": answer() })
  for (let i = 0; i < 3; i++) await run.request()
  return run
}

describe("a target that keeps failing is skipped", () => {
  test("the first two failures still try it; the third opens its breaker, and the fourth request goes straight to the next target", async () => {
    const run = setup({ "a/x": [rateLimited], "b/y": answer(), "c/z": answer() })
    expect((await run.request()).targets).toEqual(["a/x", "b/y"])
    expect((await run.request()).targets).toEqual(["a/x", "b/y"])
    expect(logs.of("fallback.cooldown.open")).toEqual([])
    expect((await run.request()).targets).toEqual(["a/x", "b/y"])
    expect(logs.of("fallback.cooldown.open")).toHaveLength(1)
    const fourth = await run.request()
    expect(fourth.targets).toEqual(["b/y"])
    // The answering target's position: the skipped first target counts as a fallback in the header.
    expect(fourth.served).toEqual([{ model: "b/y#low", fallbacks: 1, chain: true }])
    expect(fourth.out.map((e) => e.type)).toEqual(["text-delta", "finish"])
  })

  test("the open and skip log lines name the target and when its cooldown ends", async () => {
    const run = await openFirst()
    await run.request()
    const open = logs.of("fallback.cooldown.open")
    expect(open).toHaveLength(1)
    expect(open[0]!.fields).toMatchObject({ app: "app1", target: "a/x", reopened: "false", cooldownMs: String(COOLDOWN_MS) })
    expect(open[0]!.fields.until).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(logs.of("fallback.cooldown.skip")).toHaveLength(1)
    expect(logs.of("fallback.cooldown.skip")[0]!.fields).toMatchObject({ app: "app1", target: "a/x", until: open[0]!.fields.until })
    expect(run.events).toEqual(["open", "skip"])
  })

  test("a skipped target is not a retry: no model.fallback line is written for it", async () => {
    const run = await openFirst()
    const before = logs.of("model.fallback").length
    await run.request()
    expect(logs.of("model.fallback")).toHaveLength(before)
  })

  test("the open target is skipped by every request, not only the one that opened it", async () => {
    const run = await openFirst()
    for (let i = 0; i < 4; i++) expect((await run.request()).targets).toEqual(["b/y"])
    expect(run.calls.filter((call) => call.target === "a/x")).toHaveLength(3)
  })

  test("a later target that is cooling down is skipped too: the chain goes to the one after it", async () => {
    const run = setup({ "a/x": [rateLimited], "b/y": [rateLimited], "c/z": answer() })
    for (let i = 0; i < 3; i++) await run.request()
    expect(run.breaker.cooling().map((target) => target.model)).toEqual(["a/x", "b/y#low"])
    const next = await run.request()
    expect(next.targets).toEqual(["c/z"])
    expect(next.served).toEqual([{ model: "c/z", fallbacks: 2, chain: true }])
  })

  test("the breaker is shared by the wrappers that share it: process-wide, not per wrapper", async () => {
    const first = await openFirst()
    const second = setup({ "a/x": [rateLimited], "b/y": answer(), "c/z": answer() }, options, first.breaker)
    expect((await second.request()).targets).toEqual(["b/y"])
  })

  test("without a shared breaker a wrapper keeps its own", async () => {
    const run = setup({ "a/x": [rateLimited], "b/y": answer(), "c/z": answer() })
    const other = setup({ "a/x": [rateLimited], "b/y": answer(), "c/z": answer() })
    for (let i = 0; i < 3; i++) await run.request()
    expect((await run.request()).targets).toEqual(["b/y"])
    expect((await other.request()).targets).toEqual(["a/x", "b/y"])
  })

  test("the default is 3 failures: no circuitBreaker option still opens a breaker", async () => {
    const run = setup({ "a/x": [rateLimited], "b/y": answer(), "c/z": answer() }, parseOptions(raw))
    for (let i = 0; i < 3; i++) await run.request()
    expect((await run.request()).targets).toEqual(["b/y"])
  })

  test("the threshold is the option's", async () => {
    const run = setup({ "a/x": [rateLimited], "b/y": answer(), "c/z": answer() }, parseOptions({ ...raw, circuitBreaker: { failures: 1 } }))
    expect((await run.request()).targets).toEqual(["a/x", "b/y"])
    expect((await run.request()).targets).toEqual(["b/y"])
  })

  test("circuitBreaker false never skips", async () => {
    const run = setup({ "a/x": [rateLimited], "b/y": answer(), "c/z": answer() }, parseOptions({ ...raw, circuitBreaker: false }))
    for (let i = 0; i < 6; i++) expect((await run.request()).targets).toEqual(["a/x", "b/y"])
    expect(run.breaker.cooling()).toEqual([])
    expect(logs.of("fallback.cooldown.open")).toEqual([])
  })
})

describe("what counts as a failure", () => {
  test.each([
    ["a 429", [rateLimited]],
    ["a quota error", [ev.error({ status: 429, kind: "rate_limit", code: "quota_exceeded" })]],
    ["a provider failure (520)", [ev.error({ status: 502, kind: "server", code: "provider_unavailable" })]],
    ["a provider overload (529)", [ev.error({ status: 503, kind: "server", code: "provider_overloaded" })]],
    ["a provider timeout", [ev.error({ status: 504, kind: "timeout", code: "provider_timeout" })]],
    ["a provider sign-in failure", [ev.error({ status: 502, kind: "server", code: "provider_auth_failed" })]],
    ["a provider_retry", [ev.error({ status: 503, kind: "server", code: "provider_retry" })]],
  ])("%s opens the breaker after three", async (_name, script) => {
    const run = setup({ "a/x": script, "b/y": answer(), "c/z": answer() })
    for (let i = 0; i < 3; i++) await run.request()
    expect((await run.request()).targets).toEqual(["b/y"])
  })

  test("a missed first-event deadline counts, as a provider's silence", async () => {
    const timed = parseOptions({ ...raw, firstEventTimeoutMs: 40, circuitBreaker: { failures: 2, cooldownMs: COOLDOWN_MS } })
    const targets: string[] = []
    const inner: ModelCaller = {
      stream(request, context) {
        targets.push(`${request.ref.providerID}/${request.ref.id}`)
        return (async function* () {
          if (request.ref.id === "x") await new Promise<void>((resolve) => context.signal.addEventListener("abort", () => resolve(), { once: true }))
          else yield* answer()
        })()
      },
    }
    const caller = withFallbacks(inner, { options: timed, loadCatalog: async () => CATALOG, breaker: createBreaker() })
    const ask = () => collect(caller.stream(plugRequest({ model: "chain", ref: resolveModel(timed, "chain", CATALOG) as never }), { app: "app1", signal: new AbortController().signal }))
    await ask()
    await ask()
    expect(targets).toEqual(["a/x", "b/y", "a/x", "b/y"])
    expect(logs.of("fallback.cooldown.open")).toHaveLength(1)
    await ask()
    expect(targets.slice(4)).toEqual(["b/y"])
  })

  // These still move the chain on, but say nothing about the target: a backend that throws, a prompt that could not start, a failed
  // model run, an empty stream.
  test.each([
    ["a failed model run", [ev.error({ status: 502, kind: "server", code: "model_run_failed" })]],
    ["a prompt that could not start", [ev.error({ status: 502, kind: "server", code: "prompt_failed" })]],
    ["a backend failure", [ev.error({ status: 502, kind: "server", code: "backend_failed" })]],
    ["an empty stream", []],
    ["a thrown error", new Error("boom")],
  ])("%s falls back but never opens the breaker", async (_name, script) => {
    const run = setup({ "a/x": script, "b/y": answer(), "c/z": answer() })
    for (let i = 0; i < 6; i++) expect((await run.request()).targets).toEqual(["a/x", "b/y"])
    expect(run.breaker.cooling()).toEqual([])
    expect(run.events).toEqual([])
  })

  test("a synchronous throw of the model caller is a failure of the attempt: the next target answers, and a probe it held is given back", async () => {
    let at = 1_000_000
    const breaker = createBreaker(() => at)
    const config = { failures: 3, cooldownMs: COOLDOWN_MS, failureWindowMs: 10_000 }
    for (let i = 0; i < 3; i++) breaker.failure("a/x", config)
    at += COOLDOWN_MS
    let first = true
    const inner: ModelCaller = {
      stream(request) {
        if (request.ref.id === "x" && first) {
          first = false
          throw new Error("sync boom")
        }
        return (async function* () {
          yield* answer()
        })()
      },
    }
    const caller = withFallbacks(inner, { options, loadCatalog: async () => CATALOG, breaker })
    const out = await collect(caller.stream(plugRequest({ model: "chain", ref: resolveModel(options, "chain", CATALOG) as never }), { app: "app1", signal: new AbortController().signal }))
    expect(out.map((e) => e.type)).toEqual(["text-delta", "finish"])
    // The probe slot of a/x is free again: the next claim is a probe, not a skip.
    expect(breaker.claim("a/x", config).verdict).toBe("probe")
  })

  test("a failure after the first event is an answer: it does not count, and it is not retried", async () => {
    const run = setup({ "a/x": [ev.text("par"), ev.error({ code: "provider_unavailable" })], "b/y": answer(), "c/z": answer() })
    for (let i = 0; i < 5; i++) expect((await run.request()).targets).toEqual(["a/x"])
    expect(run.breaker.cooling()).toEqual([])
  })

  test("a client error is not a failure of the target", async () => {
    const run = setup({ "a/x": [ev.error({ status: 400, kind: "invalid_request", code: "context_length_exceeded" })], "b/y": answer(), "c/z": answer() })
    for (let i = 0; i < 5; i++) expect((await run.request()).targets).toEqual(["a/x"])
    expect(run.breaker.cooling()).toEqual([])
  })

  test("an answer in between resets the count", async () => {
    const run = setup({ "a/x": [rateLimited], "b/y": answer(), "c/z": answer() })
    await run.request()
    await run.request()
    run.behaviour["a/x"] = answer()
    expect((await run.request()).targets).toEqual(["a/x"])
    run.behaviour["a/x"] = [rateLimited]
    await run.request()
    await run.request()
    expect((await run.request()).targets).toEqual(["a/x", "b/y"])
    expect(run.breaker.cooling()).toHaveLength(1)
  })

  test("the last target's failures count too", async () => {
    const run = setup({ "a/x": [rateLimited], "b/y": [rateLimited], "c/z": [rateLimited] })
    for (let i = 0; i < 3; i++) await run.request()
    expect(run.breaker.cooling().map((target) => target.model)).toEqual(["a/x", "b/y#low", "c/z"])
  })

  test("a request the client abandoned counts for nothing", async () => {
    const run = setup({ "a/x": [rateLimited], "b/y": answer(), "c/z": answer() })
    const controller = new AbortController()
    controller.abort(new Error("gone"))
    for (let i = 0; i < 5; i++) await run.request("chain", controller.signal)
    expect(run.breaker.cooling()).toEqual([])
  })
})

describe("the half-open probe", () => {
  test("after the cooldown the next request tries the target again; an answer closes the breaker", async () => {
    const run = await openFirst()
    expect((await run.request()).targets).toEqual(["b/y"])
    run.advance(COOLDOWN_MS)
    run.behaviour["a/x"] = answer()
    const probe = await run.request()
    expect(probe.targets).toEqual(["a/x"])
    expect(probe.served).toEqual([{ model: "a/x", fallbacks: 0, chain: true }])
    expect(logs.of("fallback.cooldown.close")).toHaveLength(1)
    expect(logs.of("fallback.cooldown.close")[0]!.fields).toMatchObject({ app: "app1", target: "a/x" })
    expect(run.events).toEqual(["open", "skip", "close"])
    expect(run.breaker.cooling()).toEqual([])
    // Closed: the next request is an ordinary one.
    expect((await run.request()).targets).toEqual(["a/x"])
  })

  test("the open, skip and close sequence, in time order, with the cooldown ending exactly at its mark", async () => {
    const run = setup({ "a/x": [rateLimited], "b/y": answer(), "c/z": answer() })
    const seen: string[] = []
    const mark = (label: string) =>
      void seen.push(
        `${label}:${logs.lines
          .filter((line) => line.event.startsWith("fallback.cooldown."))
          .map((line) => line.event.slice(18))
          .join(",")}`,
      )
    for (let i = 0; i < 3; i++) await run.request()
    mark("opened")
    await run.request()
    run.advance(COOLDOWN_MS - 1)
    await run.request()
    mark("still-open")
    run.advance(1)
    run.behaviour["a/x"] = answer()
    await run.request()
    mark("closed")
    expect(seen).toEqual(["opened:open", "still-open:open,skip,skip", "closed:open,skip,skip,close"])
  })

  test("a probe that fails opens it again for a full cooldown, and the request falls to the next target", async () => {
    const run = await openFirst()
    run.advance(COOLDOWN_MS)
    const probe = await run.request()
    expect(probe.targets).toEqual(["a/x", "b/y"])
    expect(probe.served).toEqual([{ model: "b/y#low", fallbacks: 1, chain: true }])
    expect(logs.of("fallback.cooldown.open")).toHaveLength(2)
    expect(logs.of("fallback.cooldown.open")[1]!.fields).toMatchObject({ reopened: "true" })
    expect(logs.of("fallback.cooldown.close")).toEqual([])
    run.advance(COOLDOWN_MS - 1)
    expect((await run.request()).targets).toEqual(["b/y"])
    run.advance(1)
    expect((await run.request()).targets).toEqual(["a/x", "b/y"])
  })

  test("only one request probes at a time: one held open mid-probe, the next skips the target", async () => {
    const run = await openFirst()
    run.advance(COOLDOWN_MS)
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const inner: ModelCaller = {
      stream(request) {
        return (async function* () {
          if (request.ref.id === "x") await held
          yield* answer()
        })()
      },
    }
    const caller = withFallbacks(inner, { options, loadCatalog: async () => CATALOG, breaker: run.breaker })
    const start = (name: string) => collect(caller.stream(plugRequest({ model: name, ref: resolveModel(options, name, CATALOG) as never }), { app: "app1", signal: new AbortController().signal }))
    const probing = start("chain")
    await new Promise((resolve) => setImmediate(resolve))
    expect(run.breaker.peek("a/x", { failures: 3, cooldownMs: COOLDOWN_MS, failureWindowMs: 10_000 })).toBe(false)
    const other = await start("chain")
    expect(other.map((e) => e.type)).toEqual(["text-delta", "finish"])
    release()
    await probing
    expect(run.breaker.cooling()).toEqual([])
  })

  test("a probe that ends with a client error gives the slot back: the target is not closed, and the next request probes again", async () => {
    const run = await openFirst()
    run.advance(COOLDOWN_MS)
    run.behaviour["a/x"] = [ev.error({ status: 400, kind: "invalid_request", code: "content_filter" })]
    expect((await run.request()).targets).toEqual(["a/x"])
    expect(run.breaker.cooling()).toHaveLength(1)
    run.behaviour["a/x"] = answer()
    expect((await run.request()).targets).toEqual(["a/x"])
    expect(run.breaker.cooling()).toEqual([])
  })
})

describe("a look-ahead that took no probe slot", () => {
  /** b is half open with its probe free when R2 starts, so R2's attempt on a is told b follows (and is bounded by the deadline); R1 then takes b's probe. */
  test("another request takes the probe of the target an attempt was told follows: the attempt's failure still goes there, and is not left with an empty stream", async () => {
    const timed = parseOptions({ ...raw, firstEventTimeoutMs: 40, circuitBreaker: { failures: 3, cooldownMs: COOLDOWN_MS, failureWindowMs: 10_000 } })
    const config = { failures: 3, cooldownMs: COOLDOWN_MS, failureWindowMs: 10_000 }
    let at = 1_000_000
    const breaker = createBreaker(() => at)
    for (let i = 0; i < 3; i++) breaker.failure("b/y#low", config)
    at += COOLDOWN_MS
    for (let i = 0; i < 3; i++) breaker.failure("c/z", config)
    expect(breaker.peek("b/y#low", config)).toBe(true)
    expect(breaker.peek("c/z", config)).toBe(false)

    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const seen: Array<{ target: string; fallbackNext: boolean | undefined }> = []
    let calls = 0
    const inner: ModelCaller = {
      stream(request, context) {
        const target = `${request.ref.providerID}/${request.ref.id}`
        seen.push({ target, fallbackNext: context.fallbackNext })
        const call = target === "a/x" ? calls++ : -1
        return (async function* () {
          if (target === "a/x") {
            // R2's call hangs until the deadline aborts it; R1's call fails at once.
            if (call === 0) await new Promise<void>((resolve) => context.signal.addEventListener("abort", () => resolve(), { once: true }))
            else yield rateLimited
            return
          }
          await held
          yield* answer()
        })()
      },
    }
    const caller = withFallbacks(inner, { options: timed, loadCatalog: async () => CATALOG, breaker })
    const ask = () => collect(caller.stream(plugRequest({ model: "chain", ref: resolveModel(timed, "chain", CATALOG) as never }), { app: "app1", signal: new AbortController().signal }))
    const settle = () => new Promise((resolve) => setImmediate(resolve))

    const r2 = ask()
    await settle()
    await settle()
    // R2 is on a/x, bounded by the deadline because b looked free.
    expect(seen).toEqual([{ target: "a/x", fallbackNext: true }])
    const r1 = ask()
    await settle()
    await settle()
    // R1 failed on a/x at once and took b's probe.
    expect(seen.map((call) => call.target)).toEqual(["a/x", "a/x", "b/y"])
    expect(breaker.peek("b/y#low", config)).toBe(false)
    // The deadline passes: R2 has no slot to claim on b, but it was told b follows, so b is tried anyway.
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(seen.map((call) => call.target)).toEqual(["a/x", "a/x", "b/y", "b/y"])
    release()
    const [out2, out1] = await Promise.all([r2, r1])
    expect(out2.map((e) => e.type)).toEqual(["text-delta", "finish"])
    expect(out1.map((e) => e.type)).toEqual(["text-delta", "finish"])
    expect(logs.of("model.fallback_exhausted")).toEqual([])
    // c/z is open: the forced attempt on b is the last that would run, so it has no deadline.
    expect(seen.at(-1)).toEqual({ target: "b/y", fallbackNext: false })
  })
})

describe("every target cooling down: the first is tried anyway", () => {
  async function allOpen() {
    const run = setup({ "a/x": [rateLimited], "b/y": [rateLimited], "c/z": [rateLimited] })
    for (let i = 0; i < 3; i++) await run.request()
    expect(run.breaker.cooling()).toHaveLength(3)
    return run
  }

  test("the request is attempted, never failed fast: the first target runs, and its answer is the response", async () => {
    const run = await allOpen()
    run.behaviour["a/x"] = answer()
    const r = await run.request()
    expect(r.targets).toEqual(["a/x"])
    expect(r.served).toEqual([{ model: "a/x", fallbacks: 0, chain: true }])
    expect(logs.of("fallback.cooldown.all_open")).toHaveLength(1)
    // It answered, so its breaker closes even though the cooldown had not ended.
    expect(logs.of("fallback.cooldown.close")).toHaveLength(1)
  })

  test("when that attempt fails too, its error is the response and the other cooling targets are not tried", async () => {
    const run = await allOpen()
    const before = run.calls.length
    const r = await run.request()
    expect(run.calls.slice(before).map((call) => call.target)).toEqual(["a/x"])
    expect(r.out).toEqual([rateLimited])
    expect(r.served).toEqual([])
  })

  test("a chain whose catalog leaves one target never skips it", async () => {
    const breaker = createBreaker()
    let calls = 0
    const inner: ModelCaller = {
      stream: () =>
        (async function* () {
          calls++
          yield rateLimited
        })(),
    }
    const only = withFallbacks(inner, { options, loadCatalog: async () => [CATALOG[0]!], breaker })
    for (let i = 0; i < 5; i++)
      expect(await collect(only.stream(plugRequest({ model: "chain", ref: resolveModel(options, "chain", CATALOG) as never }), { app: "app1", signal: new AbortController().signal }))).toEqual([
        rateLimited,
      ])
    expect(calls).toBe(5)
    expect(breaker.cooling().map((target) => target.model)).toEqual(["a/x"])
  })
})

describe("aliases that are not lists never skip", () => {
  test.each(["one", "plain", "a/x"])("%s is attempted every time, however often it failed", async (name) => {
    const run = setup({ "a/x": [rateLimited], "b/y": answer(), "c/z": answer() })
    for (let i = 0; i < 8; i++) expect((await run.request(name)).targets).toEqual(["a/x"])
    expect(run.breaker.cooling()).toEqual([])
    expect(run.events).toEqual([])
  })

  test("a list alias's failures do not leak into a plain call of the same model: it is attempted whatever the breaker says", async () => {
    const run = await openFirst()
    expect(run.breaker.cooling().map((target) => target.model)).toEqual(["a/x"])
    expect((await run.request("plain")).targets).toEqual(["a/x"])
  })
})

describe("the attempt is told whether a target follows", () => {
  test("when every later target is cooling down, the first attempt is the last that would run: nothing follows it", async () => {
    const run = setup({ "a/x": answer(), "b/y": answer(), "c/z": answer() })
    for (const target of ["b/y#low", "c/z"]) for (let i = 0; i < 3; i++) run.breaker.failure(target, { failures: 3, cooldownMs: COOLDOWN_MS, failureWindowMs: 10_000 })
    expect((await run.request()).targets).toEqual(["a/x"])
    expect(run.calls.at(-1)).toEqual({ target: "a/x", fallbackNext: false })
  })

  test("a later target that is cooling down does not follow: the attempt before it is the last that would run", async () => {
    const run = setup({ "a/x": [rateLimited], "b/y": [rateLimited], "c/z": answer() })
    for (let i = 0; i < 3; i++) await run.request()
    // a/x and b/y are open: c/z is the only target left, and nothing follows it.
    await run.request()
    expect(run.calls.at(-1)).toEqual({ target: "c/z", fallbackNext: false })
    run.advance(COOLDOWN_MS)
    // Both are half open now, so a/x is a probe and b/y follows it.
    run.behaviour["a/x"] = answer()
    await run.request()
    expect(run.calls.at(-1)).toEqual({ target: "a/x", fallbackNext: true })
  })
})
