/**
 * Security review round 3 (since 0.37.0), the session layer: the silent-stream transcript settle and the fallback breaker.
 *
 * Guarantees: a request settled from the host's stored messages reads only its own session, so the text it returns is never
 * another request's; and the breaker's state, which every app shares, is moved only by what the provider did, never by what a
 * caller made slow or wrong.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { ServerResponse } from "node:http"
import { createBreaker } from "../../src/breaker.js"
import type { CallContext } from "../../src/contract.js"
import { parseOptions } from "../../src/config.js"
import type { PlugEvent } from "../../src/contract.js"
import { withFallbacks } from "../../src/fallback.js"
import { createLimitState, withLimits } from "../../src/limits.js"
import { resolveModel } from "../../src/models.js"
import { createSessionCaller } from "../../src/session/caller.js"
import type { StoredAnswer } from "../../src/session/host.js"
import { createSessionStore } from "../../src/session/state.js"
import { collect, ev, model, plugRequest } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { listen, type Loopback } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { isolateRuntime } from "../support/runtime.js"
import { bus, FakeSessionPort, type HostError } from "../support/session.js"

captureLogs()
isolateRuntime()

const textOf = (events: PlugEvent[]) => events.flatMap((event) => (event.type === "text-delta" ? [event.text] : [])).join("")
const stored = (text: string): StoredAnswer => ({ completed: true, finish: "stop", parts: [{ type: "text", text }] })

// ---------------------------------------------------------------- the silent-stream settle

describe("security regression test: a request settled from the transcript reads only its own session", () => {
  test("two apps' requests with a silent host each get the text of their own session, and each read names that request's session", async () => {
    const port = new FakeSessionPort()
    const sessions = createSessionStore()
    const caller = createSessionCaller({ port, sessions, maxTools: 2, silenceMs: 20 })
    const appOf = (sessionID: string) => (port.created.find((session) => session.id === sessionID)!.metadata as { plugboard: { app: string } }).plugboard.app
    // The host never sends an event; what it stored for a session is the answer for the app that session belongs to.
    port.script.lastAnswer = async (sessionID) => stored(`answer for ${appOf(sessionID)} (${sessionID})`)
    const run = (app: string) =>
      collect(caller.stream(plugRequest({ messages: [{ role: "user", content: [{ type: "text", text: `question of ${app}` }] }] }), { app, signal: new AbortController().signal }))
    const [a, b, c] = await Promise.all([run("app-a"), run("app-b"), run("app-a")])
    for (const [events, app] of [
      [a, "app-a"],
      [b, "app-b"],
      [c, "app-a"],
    ] as const) {
      expect(textOf(events)).toMatch(new RegExp(`^answer for ${app} \\(ses_\\d+\\)$`))
      expect(events.at(-1)).toMatchObject({ type: "finish", reason: "stop" })
    }
    // Every request read its own session, and no session was read for another request.
    expect(new Set(port.answerReads).size).toBe(3)
    expect([...port.answerReads].sort()).toEqual(port.created.map((session) => session.id).sort())
    // The three texts name three different sessions.
    expect(new Set([a, b, c].map(textOf)).size).toBe(3)
  })

  test("a session that has stored nothing, or only an unfinished step, settles nothing: no text from anywhere else", async () => {
    const port = new FakeSessionPort()
    const sessions = createSessionStore()
    const caller = createSessionCaller({ port, sessions, maxTools: 2, silenceMs: 15 })
    // A neighbour's finished answer exists in the host, and is what a careless lookup would find.
    port.script.lastAnswer = async (sessionID) => (sessionID === "ses_1" ? undefined : stored("a neighbour's finished answer"))
    const deadline = new AbortController()
    const seen: PlugEvent[] = []
    const done = (async () => {
      for await (const event of caller.stream(plugRequest(), { app: "app-a", signal: deadline.signal })) seen.push(event)
    })()
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(port.answerReads.length).toBeGreaterThan(1)
    expect(new Set(port.answerReads)).toEqual(new Set(["ses_1"]))
    expect(seen).toEqual([])
    deadline.abort()
    await done
  })

  test("a stored answer settles one request once: a second read of the same session adds no text", async () => {
    const port = new FakeSessionPort()
    const sessions = createSessionStore()
    const caller = createSessionCaller({ port, sessions, maxTools: 2, silenceMs: 10 })
    let reads = 0
    port.script.lastAnswer = async () => {
      reads++
      return stored("once")
    }
    port.script.prompt = async (input) => {
      queueMicrotask(() => sessions.dispatch(bus(input.sessionID).textDelta("on")))
    }
    const events = await collect(caller.stream(plugRequest(), { app: "app-a", signal: new AbortController().signal }))
    expect(textOf(events)).toBe("once")
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(reads).toBe(1)
  })
})

// ---------------------------------------------------------------- the fallback breaker

describe("security regression test: what moves the breaker every app shares", () => {
  const CATALOG = [model("a", "x"), model("b", "y", { variants: ["low"] }), model("c", "z")]
  const DEADLINE = 150
  const RAW = {
    models: ["a/*", "b/*", "c/*"],
    aliases: { chain: ["a/x", "b/y#low", "c/z"] },
    firstEventTimeoutMs: DEADLINE,
    circuitBreaker: { failures: 2, cooldownMs: 60_000, failureWindowMs: 600_000 },
  }
  const options = parseOptions(RAW)
  const ask = (caller: ReturnType<typeof withFallbacks>, app: string, extra: Parameters<typeof plugRequest>[0] = {}) =>
    collect(caller.stream(plugRequest({ model: "chain", ref: resolveModel(options, "chain", CATALOG) as never, ...extra }), { app, signal: new AbortController().signal }))

  /** A host that answers `a/x` as `fault` says, and every other target with a plain answer. */
  function host(fault: HostError | "ok" | "hang", remoteImages?: Parameters<typeof createSessionCaller>[0]["remoteImages"]) {
    const breaker = createBreaker()
    const port = new FakeSessionPort()
    const sessions = createSessionStore()
    port.script.prompt = async (input) => {
      const created = port.created.find((session) => session.id === input.sessionID)!
      const first = created.model.providerID === "a"
      const events = bus(input.sessionID)
      if (first && fault === "hang") return
      queueMicrotask(() => {
        const out =
          first && fault !== "ok" && fault !== "hang" ? [events.stepFailed(fault), events.executionFailed(fault)] : [events.textDelta("hi"), events.stepEnded("stop"), events.executionSucceeded()]
        for (const event of out) sessions.dispatch(event)
      })
    }
    port.script.interrupt = async (sessionID) => void queueMicrotask(() => sessions.dispatch(bus(sessionID).executionInterrupted()))
    const caller = withFallbacks(createSessionCaller({ port, sessions, maxTools: 2, ...(remoteImages === undefined ? {} : { remoteImages }) }), { options, loadCatalog: async () => CATALOG, breaker })
    return { breaker, port, caller }
  }

  test("the app's own limits are refused outside the breaker: an app past its rate never counts against a model", async () => {
    const breaker = createBreaker()
    const inner = new FakeModelCaller([ev.error({ status: 502, kind: "server", code: "provider_unavailable" })])
    const limited = withLimits(withFallbacks(inner, { options, loadCatalog: async () => CATALOG, breaker }), () => ({ perApp: { requestsPerMinute: 1 } }), createLimitState())
    const request = plugRequest({ model: "chain", ref: resolveModel(options, "chain", CATALOG) as never })
    const run = () => collect(limited.stream(request, { app: "greedy", signal: new AbortController().signal }))
    await run()
    const calls = inner.calls.length
    const refused = (await Promise.all(Array.from({ length: 8 }, run))).map((events) => events[0])
    expect(refused.every((event) => event?.type === "error" && event.error.status === 429)).toBe(true)
    expect(inner.calls).toHaveLength(calls)
    expect(breaker.cooling()).toEqual([])
  })

  test("a provider's client errors are nobody's failure: a rejected request, a context overflow and a content filter never open it", async () => {
    for (const error of [
      { type: "provider.invalid-request", status: 400, message: "messages: text content blocks must be non-empty" },
      { type: "provider.invalid-request", status: 400, message: "prompt is too long: 250000 tokens > 200000 maximum" },
      { type: "provider.content-filter", status: 400, message: "blocked" },
      { type: "provider.invalid-request", status: 422, message: "bad parameter" },
    ] satisfies HostError[]) {
      const run = host(error)
      for (let i = 0; i < 5; i++) await ask(run.caller, "noisy")
      expect(run.breaker.cooling(), JSON.stringify(error)).toEqual([])
    }
  })

  test("a 400 rejection whose text mentions a rate limit, a quota, an overload or a sign-in is still the caller's error, not the model's", async () => {
    for (const word of ["rate limit", "usage limit", "quota", "overloaded", "unauthorized"]) {
      const run = host({ type: "provider.invalid-request", status: 400, message: `invalid tool_use_id: ${word}`, response: { body: `{"error":"${word}"}` } })
      for (let i = 0; i < 4; i++) await ask(run.caller, "noisy")
      expect(run.breaker.cooling(), word).toEqual([])
    }
  })

  test("the deadline waits for the caller's prompt: a caller that reports its preparation is timed from `onPrompted`, one that reports nothing from the start", async () => {
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const targets: string[] = []
    const inner = {
      stream(request: Parameters<typeof plugRequest>[0] & { ref: { providerID: string } }, context: CallContext): AsyncIterable<PlugEvent> {
        const target = request.ref.providerID
        targets.push(target)
        return (async function* () {
          if (target === "a") {
            // Prepares for twice the deadline, then prompts and answers at once.
            context.onPreparing?.()
            await pause(DEADLINE * 2)
            context.onPrompted?.()
          } else if (target === "b") await pause(DEADLINE * 3) // Reports nothing, so it is timed from the start: it is cut off.
          yield ev.text(`from ${target}`)
          yield ev.finish()
        })()
      },
    }
    const breaker = createBreaker()
    const caller = withFallbacks(inner as never, { options, loadCatalog: async () => CATALOG, breaker })
    const prepared = await ask(caller, "alpha")
    expect(textOf(prepared)).toBe("from a")
    expect(targets).toEqual(["a"])
    // The same chain with the first target skipped: `b` reports nothing and is cut off at the deadline, as before.
    targets.length = 0
    const slowAll = withFallbacks(
      {
        stream: (request: never, context: CallContext) => (context.signal ? inner.stream({ ...(request as object), ref: { providerID: "b" } } as never, context) : inner.stream(request, context)),
      } as never,
      { options, loadCatalog: async () => CATALOG, breaker: createBreaker() },
    )
    expect(textOf(await ask(slowAll, "alpha"))).toBe("from b")
    expect(targets.length).toBeGreaterThan(1)
    expect(breaker.cooling()).toEqual([])
  })

  test("a provider's own rate limit does open it, for every app: the documented behaviour", async () => {
    const run = host({ type: "provider.rate-limit", status: 429 })
    for (let i = 0; i < 2; i++) await ask(run.caller, "alpha")
    expect(run.breaker.cooling().map((entry) => entry.model)).toEqual(["a/x"])
    const before = run.port.prompted.length
    await ask(run.caller, "beta")
    // Beta's request went straight to the next target, so it never prompted a/x.
    expect(run.port.prompted.length - before).toBe(1)
  })

  describe("a caller who makes the first event late", () => {
    let slow: Loopback
    const PNG = Buffer.from("89504e470d0a1a0a", "hex")
    beforeAll(async () => {
      slow = await listen((_request, response: ServerResponse) => {
        const timer = setTimeout(() => {
          response.writeHead(200, { "content-type": "image/png" })
          response.end(PNG)
        }, 600)
        response.on("close", () => clearTimeout(timer))
      })
    })
    afterAll(() => slow.close())

    const withImage = (url: string) => ({
      messages: [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: "look" },
            { type: "media" as const, url },
          ],
        },
      ],
    })
    const providers = (run: ReturnType<typeof host>) => run.port.prompted.map((prompt) => run.port.created.find((session) => session.id === prompt.sessionID)!.model.providerID)

    test("a slow remote image is not the model's silence: the deadline runs from the prompt, and a target that was never prompted is not counted against", async () => {
      const run = host("ok", { allow: ["127.0.0.1"], timeoutMs: 5_000 })
      for (let i = 0; i < 2; i++) expect(textOf(await ask(run.caller, "slowpoke", withImage(`http://127.0.0.1:${slow.port}/slow.png`)))).toBe("hi")
      // The image took four times the deadline, and the first target still answered: it was prompted once per request, never skipped.
      expect(providers(run)).toEqual(["a", "a"])
      expect(run.breaker.cooling()).toEqual([])
    })

    test("the deadline still runs from the prompt: a target that is prompted and stays silent falls back, however long the image took", async () => {
      const run = host("hang", { allow: ["127.0.0.1"], timeoutMs: 5_000 })
      const started = performance.now()
      expect(textOf(await ask(run.caller, "slowpoke", withImage(`http://127.0.0.1:${slow.port}/slow.png`)))).toBe("hi")
      expect(providers(run)).toEqual(["a", "b"])
      expect(performance.now() - started).toBeGreaterThanOrEqual(600 + DEADLINE - 20)
      // A silence after the prompt is the target's, and counts.
      expect(run.breaker.cooling()).toEqual([])
      await ask(run.caller, "other")
      expect(run.breaker.cooling().map((entry) => entry.model)).toEqual(["a/x"])
    })
  })
})
