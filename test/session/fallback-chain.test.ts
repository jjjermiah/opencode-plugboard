/**
 * Fault injection through a fallback chain: the real route, `withFallbacks` and session caller over a fake host. Each target
 * of the chain misbehaves in one of the ways a provider does (hangs, 429, 529 overloaded, upstream 520, a host retry, an error after the first
 * event), and the tests assert the order the targets are called in, how long the answer took, the `x-plugboard-model` and
 * `x-plugboard-fallbacks` headers, and, over several requests, the circuit breaker's open, skip and close sequence.
 *
 * Timings are real but generous: a failure that is answered at once must come back well inside the first-event deadline,
 * and a hung target must cost that deadline, and not much more.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createBreaker } from "../../src/breaker.js"
import { parseOptions } from "../../src/config.js"
import { withFallbacks } from "../../src/fallback.js"
import { createSessionCaller } from "../../src/session/caller.js"
import { createSessionStore } from "../../src/session/state.js"
import { model } from "../support/fixtures.js"
import { sseData, startRoute, TEST_STATUS, type RouteServer } from "../support/loopback.js"
import { captureLogs } from "../support/logs.js"
import { bus, FakeSessionPort, type BusEnvelope } from "../support/session.js"

const logs = captureLogs()

/** What a target does when the host runs it. */
type Fault = "ok" | "hang" | "429" | "520" | "529" | "retry" | "midstream"

const DEADLINE = 250
/** An attempt that fails at once must be over well before the first-event deadline. */
const FAST = DEADLINE * 0.8
const COOLDOWN_MS = 60_000
const CATALOG = [model("a", "x"), model("b", "y", { variants: ["low"] }), model("c", "z")]
const RAW = {
  models: ["a/*", "b/*", "c/*"],
  aliases: { chain: ["a/x", "b/y#low", "c/z"] },
  fallbackAfterMs: DEADLINE,
  fallbackCooldown: { failureThreshold: 3, cooldownMs: COOLDOWN_MS, windowMs: 600_000 },
}
const upstream520 = { type: "provider.internal", status: 520, message: "upstream 520" }
/** Anthropic's overloaded_error: the provider's own 529 (#503). */
const upstream529 = { type: "provider.other", status: 529, message: "Overloaded" }

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

/** A route over the real session caller, whose host answers each session as `faults[its model]` says. */
async function start(faults: Record<string, Fault>) {
  let at = 1_000_000
  const breaker = createBreaker(() => at)
  const port = new FakeSessionPort()
  const sessions = createSessionStore()
  const targets: string[] = []
  const send = (events: BusEnvelope[]) => queueMicrotask(() => events.forEach((event) => sessions.dispatch(event)))
  port.script.prompt = async (input) => {
    const created = port.created.find((session) => session.id === input.sessionID)!
    const target = `${created.model.providerID}/${created.model.id}`
    targets.push(target)
    const host = bus(input.sessionID)
    switch (faults[target]) {
      case "ok":
        return send([host.textDelta("hi"), host.stepEnded("stop"), host.executionSucceeded()])
      case "429":
        return send([host.stepFailed({ type: "provider.rate-limit", status: 429 }), host.executionFailed({ type: "provider.rate-limit", status: 429 })])
      case "520":
        return send([host.stepFailed(upstream520), host.executionFailed(upstream520)])
      case "529":
        return send([host.stepFailed(upstream529), host.executionFailed(upstream529)])
      case "retry":
        return send([host.retryScheduled(upstream520)])
      case "midstream":
        return send([host.textDelta("par"), host.stepFailed({ type: "provider.internal", status: 503, message: "x" }), host.executionFailed({ type: "provider.internal", status: 503 })])
      case "hang":
        return
    }
  }
  // The host ends an interrupted run.
  port.script.interrupt = async (sessionID) => void send([bus(sessionID).executionInterrupted()])
  const options = parseOptions(RAW)
  const caller = withFallbacks(createSessionCaller({ port, sessions, maxTools: 2 }), { options, loadCatalog: async () => CATALOG, breaker })
  server = await startRoute({ caller, options: RAW, catalog: CATALOG, status: () => ({ ...TEST_STATUS, cooldowns: breaker.cooling() }) })
  const srv = server
  return {
    port,
    targets,
    faults,
    breaker,
    advance: (ms: number) => void (at += ms),
    /** One chat request to `chain`: what came back, which targets the host ran for it, and how long it took. */
    async ask(stream = false) {
      const before = targets.length
      const started = performance.now()
      const reply = await srv.send({ method: "POST", path: "/v1/chat/completions", body: { model: "chain", stream, messages: [{ role: "user", content: "hi" }] } })
      return { reply, ran: targets.slice(before), ms: performance.now() - started }
    },
    status: async () =>
      (await srv.send({ method: "GET", path: "/plugboard/status" })).json().fallbackCooldown as { enabled: boolean; cooling: Array<{ model: string; state: string; failures: number; until: string }> },
  }
}

const cooldownEvents = () => logs.lines.filter((line) => line.event.startsWith("fallback.cooldown.")).map((line) => line.event.slice("fallback.cooldown.".length))

describe("a first target that fails before any output: the next target answers", () => {
  test.each([
    ["hangs past fallbackAfterMs", "hang"],
    ["answers 429", "429"],
    ["fails upstream with 520", "520"],
    ["is overloaded (529, provider_overloaded)", "529"],
    ["makes the host schedule a retry of a 520 (provider_retry)", "retry"],
  ] as const)("the first target %s", async (_name, fault) => {
    const run = await start({ "a/x": fault, "b/y": "ok", "c/z": "ok" })
    const { reply, ran, ms } = await run.ask()
    expect(reply.status).toBe(200)
    expect(ran).toEqual(["a/x", "b/y"])
    expect(reply.headers["x-plugboard-model"]).toBe("b/y#low")
    expect(reply.headers["x-plugboard-fallbacks"]).toBe("1")
    expect(reply.json()).toMatchObject({ model: "b/y#low", choices: [{ message: { content: "hi" } }] })
    if (fault === "hang") {
      // The hung target is abandoned at the deadline: not before it (it may still have answered), and not much after.
      expect(ms).toBeGreaterThanOrEqual(DEADLINE - 20)
      expect(ms).toBeLessThan(DEADLINE + 1500)
      expect(run.port.interrupted).toContain("ses_1")
    } else {
      expect(ms).toBeLessThan(FAST)
    }
    if (fault === "retry") expect(run.port.interrupted).toContain("ses_1")
  })

  test("a hung target and a 429 in a row: the third target answers, after one deadline", async () => {
    const run = await start({ "a/x": "hang", "b/y": "429", "c/z": "ok" })
    const { reply, ran, ms } = await run.ask()
    expect(ran).toEqual(["a/x", "b/y", "c/z"])
    expect(reply.headers["x-plugboard-model"]).toBe("c/z")
    expect(reply.headers["x-plugboard-fallbacks"]).toBe("2")
    expect(ms).toBeGreaterThanOrEqual(DEADLINE - 20)
    expect(ms).toBeLessThan(DEADLINE + 1500)
  })

  test("a target that answers in time is the answer: no fallback header", async () => {
    const run = await start({ "a/x": "ok", "b/y": "429", "c/z": "429" })
    const { reply, ran } = await run.ask()
    expect(ran).toEqual(["a/x"])
    expect(reply.headers["x-plugboard-model"]).toBe("a/x")
    expect(reply.headers).not.toHaveProperty("x-plugboard-fallbacks")
  })
})

describe("an error after the first event is never retried", () => {
  test("the answer that began is the response: the first target stays the served model and no other target runs", async () => {
    const run = await start({ "a/x": "midstream", "b/y": "ok", "c/z": "ok" })
    const { reply, ran, ms } = await run.ask(true)
    expect(ran).toEqual(["a/x"])
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-model"]).toBe("a/x")
    expect(reply.headers).not.toHaveProperty("x-plugboard-fallbacks")
    const frames = sseData(reply.text)
    expect(frames.some((frame) => frame.choices?.[0]?.delta?.content === "par")).toBe(true)
    expect(frames.some((frame) => frame.error !== undefined)).toBe(true)
    expect(frames.some((frame) => frame.choices?.[0]?.delta?.content === "hi")).toBe(false)
    expect(ms).toBeLessThan(FAST)
  })

  test("and it does not count against the target: repeated, the breaker never opens", async () => {
    const run = await start({ "a/x": "midstream", "b/y": "ok", "c/z": "ok" })
    for (let i = 0; i < 4; i++) expect((await run.ask(true)).ran).toEqual(["a/x"])
    expect(run.breaker.cooling()).toEqual([])
    expect(cooldownEvents()).toEqual([])
  })
})

describe("the circuit breaker over several requests", () => {
  test("429: open after three, skipped while it cools down, closed by the probe that answers", async () => {
    const run = await start({ "a/x": "429", "b/y": "ok", "c/z": "ok" })
    for (let i = 0; i < 3; i++) {
      const { reply, ran } = await run.ask()
      expect(ran).toEqual(["a/x", "b/y"])
      expect(reply.headers["x-plugboard-fallbacks"]).toBe("1")
    }
    expect(cooldownEvents()).toEqual(["open"])
    const status = await run.status()
    expect(status.enabled).toBe(true)
    expect(status.cooling).toEqual([{ model: "a/x", state: "open", failures: 3, until: "1970-01-01T00:17:40.000Z" }])

    // Skipped: the host never runs a/x, and the answer still names its position in the chain.
    const skipped = await run.ask()
    expect(skipped.ran).toEqual(["b/y"])
    expect(skipped.reply.headers["x-plugboard-model"]).toBe("b/y#low")
    expect(skipped.reply.headers["x-plugboard-fallbacks"]).toBe("1")
    expect(cooldownEvents()).toEqual(["open", "skip"])

    // Cooldown over, the target recovered: the next request is the probe, answers, and closes the breaker.
    run.advance(COOLDOWN_MS)
    run.faults["a/x"] = "ok"
    const probe = await run.ask()
    expect(probe.ran).toEqual(["a/x"])
    expect(probe.reply.headers["x-plugboard-model"]).toBe("a/x")
    expect(probe.reply.headers).not.toHaveProperty("x-plugboard-fallbacks")
    expect(cooldownEvents()).toEqual(["open", "skip", "close"])
    expect((await run.status()).cooling).toEqual([])
  })

  test("529 overloaded: open after three, then skipped", async () => {
    const run = await start({ "a/x": "529", "b/y": "ok", "c/z": "ok" })
    for (let i = 0; i < 3; i++) expect((await run.ask()).ran).toEqual(["a/x", "b/y"])
    expect(cooldownEvents()).toEqual(["open"])
    expect((await run.status()).cooling).toMatchObject([{ model: "a/x", state: "open", failures: 3 }])
    expect((await run.ask()).ran).toEqual(["b/y"])
  })

  test("a hung target: three deadlines are paid, then the target is skipped and the answer is immediate", async () => {
    const run = await start({ "a/x": "hang", "b/y": "ok", "c/z": "ok" })
    for (let i = 0; i < 3; i++) expect((await run.ask()).ms).toBeGreaterThanOrEqual(DEADLINE - 20)
    expect(cooldownEvents()).toEqual(["open"])
    const skipped = await run.ask()
    expect(skipped.ran).toEqual(["b/y"])
    expect(skipped.ms).toBeLessThan(FAST)
    expect(skipped.reply.headers["x-plugboard-model"]).toBe("b/y#low")
  })

  test("a probe that fails opens the target again; the request is answered by the next target", async () => {
    const run = await start({ "a/x": "520", "b/y": "ok", "c/z": "ok" })
    for (let i = 0; i < 3; i++) await run.ask()
    run.advance(COOLDOWN_MS)
    const probe = await run.ask()
    expect(probe.ran).toEqual(["a/x", "b/y"])
    expect(probe.reply.headers["x-plugboard-model"]).toBe("b/y#low")
    expect(cooldownEvents()).toEqual(["open", "open"])
    expect(logs.of("fallback.cooldown.open")[1]!.fields.reopened).toBe("true")
    expect((await run.ask()).ran).toEqual(["b/y"])
  })

  test("every target cooling down: the first is still tried, and an answer from it closes its breaker", async () => {
    const run = await start({ "a/x": "429", "b/y": "429", "c/z": "429" })
    for (let i = 0; i < 3; i++) expect((await run.ask()).reply.status).toBe(429)
    expect((await run.status()).cooling.map((target) => target.model)).toEqual(["a/x", "b/y#low", "c/z"])

    // Nothing is skipped without an attempt: a/x runs, fails, and its error is the response; the cooling targets after it are not tried.
    const failed = await run.ask()
    expect(failed.ran).toEqual(["a/x"])
    expect(failed.reply.status).toBe(429)
    expect(logs.of("fallback.cooldown.all_open")).toHaveLength(1)

    run.faults["a/x"] = "ok"
    const recovered = await run.ask()
    expect(recovered.ran).toEqual(["a/x"])
    expect(recovered.reply.status).toBe(200)
    expect(recovered.reply.headers["x-plugboard-model"]).toBe("a/x")
    expect((await run.status()).cooling.map((target) => target.model)).toEqual(["b/y#low", "c/z"])
  })
})
