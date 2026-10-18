/**
 * `RequestCollector` (src/session/events.ts): one request session's host bus events, routed by
 * the real session store, become `PlugEvent`s. Covers the event mapping, usage, finish reasons
 * (#36), the stop-turn rules keyed on the step and execution ends (#33), the queue bounds (#39) and
 * the caller-safe error classes (#88).
 */
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import type { PlugEvent } from "../../src/contract.js"
import { replayedReasoning } from "../../src/reasoning-replay.js"
import { RequestCollector } from "../../src/session/events.js"
import { createSessionStore, FAILURE_EVENT } from "../../src/session/state.js"
import { collect, plugRequest } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { bus, type BusEnvelope, type HostError } from "../support/session.js"

const logs = captureLogs()
const host = bus("ses_1")

/** The caller tools the tests below declare: every name a test's tool call uses, so a call to one of them is a valid call (#463). */
const CALLER_TOOLS = ["lookup", "f", "first", "second", "get_weather"]

/** A collector registered in a fresh store, so events go through `dispatch` exactly as the event pump sends them. */
function setup(toolNames: readonly string[] = CALLER_TOOLS) {
  let stops = 0
  const collector = new RequestCollector({ stopTurn: () => void stops++, requestID: "req_1", toolNames, callerTools: toolNames })
  const store = createSessionStore()
  store.register({ sessionID: "ses_1", app: "app", requestID: "req_1", request: plugRequest(), collector })
  return {
    collector,
    store,
    get stops() {
      return stops
    },
    send: (...events: BusEnvelope[]) => events.forEach((event) => store.dispatch(event)),
    /** Everything emitted, once the collector is terminal. */
    drain: () => collect(collector.events()),
  }
}

describe("#390 the window after a match (review #429): the answer is complete, so the run ends at once", () => {
  test("before any match, a non-aborted host failure is still an error", async () => {
    const run = setup()
    run.send(host.stepFailed({ type: "provider.rate-limit", message: "slow down" }))
    expect((await run.drain()).at(-1)).toMatchObject({ type: "error" })
  })

  test("after a match, a non-aborted host failure finishes as stop with the usage so far, and is logged", async () => {
    const run = setup()
    run.collector.markStopped()
    run.send(host.usage({ input: 10, output: 40 }), host.stepFailed({ type: "provider.rate-limit", message: "slow down" }))
    expect(await run.drain()).toEqual([{ type: "finish", reason: "stop", usage: { inputTokens: 10, outputTokens: 40 } }])
    expect(logs.of("request.stop_step_failed")).toHaveLength(1)
  })

  test("after a match, a client tool call ends the run at once: no tool-call event, the host is interrupted now", async () => {
    const run = setup()
    run.collector.markStopped()
    run.send(host.toolCalled("c1", "lookup", { q: 1 }))
    expect(run.stops).toBe(1)
    expect(await run.drain()).toEqual([{ type: "finish", reason: "stop", usage: undefined }])
  })

  test("after a match, a server tool call runs no tool and starts no next step", async () => {
    let stops = 0
    const collector = new RequestCollector({ stopTurn: () => void stops++, requestID: "req_1", serverTools: new Set(["web"]), maxServerToolSteps: 3, maxServerToolCalls: 3, callerTools: [] })
    const store = createSessionStore()
    store.register({ sessionID: "ses_1", app: "app", requestID: "req_1", request: plugRequest(), collector })
    collector.markStopped()
    store.dispatch(host.toolCalled("s1", "web", {}))
    store.dispatch(host.stepEnded("tool-calls"))
    const events = await collect(collector.events())
    expect(stops).toBe(1)
    expect(events).toEqual([{ type: "finish", reason: "stop", usage: undefined }])
  })

  test("after a match, a plain step end finishes as stop with the step's usage, and does not interrupt the host", async () => {
    const run = setup()
    run.collector.markStopped()
    run.send(host.textDelta("Hi"), host.stepEnded("stop", { input: 3, output: 4 }))
    expect(run.stops).toBe(0)
    expect((await run.drain()).at(-1)).toEqual({ type: "finish", reason: "stop", usage: { inputTokens: 3, outputTokens: 4 } })
  })
})

describe("#463 a tool call must name a declared caller tool: any other name is dropped, and a run with nothing else fails", () => {
  const NO_ANSWER: PlugEvent = { type: "error", error: { status: 502, kind: "server", code: "model_run_failed", message: "The model returned neither text nor a call to a declared tool" } }
  const GARBLED = "Realtime-2.5-flash-2025-15‸none…I'm just a language model, so I can't actually play ping pong"

  test("no tools declared: a call to any name is dropped, and a step with nothing else fails the run (never tool-calls)", async () => {
    const run = setup([])
    run.send(host.toolCalled("c1", GARBLED, { q: 1 }), host.stepEnded("tool-calls"))
    expect(await run.drain()).toEqual([NO_ANSWER])
    expect(run.stops).toBe(1)
  })

  test("tools declared, but the call names another tool: dropped the same way", async () => {
    const run = setup(["get_weather"])
    run.send(host.toolCalled("c1", "lookup", {}), host.stepEnded("tool-calls"))
    expect(await run.drain()).toEqual([NO_ANSWER])
  })

  test("mixed: text and a garbled call finish as stop with the text, and no tool call is emitted", async () => {
    const run = setup([])
    run.send(host.textDelta("Let me check."), host.toolCalled("c1", GARBLED, {}), host.stepEnded("tool-calls"))
    expect(await run.drain()).toEqual([
      { type: "text-delta", text: "Let me check." },
      { type: "finish", reason: "stop", usage: undefined },
    ])
    expect(run.stops).toBe(1)
  })

  test("reasoning is not an answer: a garbled call after reasoning fails the run", async () => {
    const run = setup([])
    run.send(host.reasoningDelta("thinking"), host.toolCalled("c1", GARBLED, {}), host.stepEnded("tool-calls"))
    const events = await run.drain()
    expect(events.at(-1)).toEqual(NO_ANSWER)
    expect(events.some((event) => event.type === "tool-call")).toBe(false)
  })

  test("the run ends without a step end: a garbled call and no text fails at execution end", async () => {
    const run = setup([])
    run.send(host.toolCalled("c1", GARBLED, {}), host.executionSucceeded())
    expect(await run.drain()).toEqual([NO_ANSWER])
  })

  test("a step that ends tool-calls with no valid call and text is a stop, and the host is stopped before another step", async () => {
    const run = setup(["get_weather"])
    run.send(host.textDelta("ok"), host.stepEnded("tool-calls"))
    expect((await run.drain()).at(-1)).toEqual({ type: "finish", reason: "stop", usage: undefined })
    expect(run.stops).toBe(1)
  })

  test("a declared call is still returned as a tool call (unchanged)", async () => {
    const run = setup(["get_weather"])
    run.send(host.toolCalled("c1", "get_weather", { city: "Paris" }), host.stepEnded("tool-calls"))
    expect(await run.drain()).toEqual([
      { type: "tool-call", id: "c1", name: "get_weather", input: { city: "Paris" } },
      { type: "finish", reason: "tool-calls", usage: undefined },
    ])
  })

  test("the drop is logged at warn once per call, with the name cut to 64 characters and no call input", async () => {
    const run = setup([])
    run.send(host.toolCalled("c1", GARBLED, { secret: "SECRET-463" }), host.toolCalled("c1", GARBLED, { secret: "SECRET-463" }), host.stepEnded("tool-calls"))
    await run.drain()
    const lines = logs.of("tool_call.undeclared")
    expect(lines).toHaveLength(1)
    expect(lines[0]!.fields.tool).toBe(GARBLED.slice(0, 64))
    expect(lines[0]!.raw).not.toContain("SECRET-463")
  })
})

describe("#390 finishNow: a run a stop sequence interrupted ends with the usage counted so far", () => {
  test("no host end arrives: the collector finishes with the running usage, then ignores the late end", async () => {
    const run = setup()
    run.send(host.textDelta("Hello"), host.usage({ input: 10, output: 500 }))
    run.collector.finishNow()
    run.send(host.stepEnded("stop", { input: 10, output: 900 }))
    const events = await run.drain()
    expect(events.filter((event) => event.type === "finish")).toEqual([{ type: "finish", reason: "stop", usage: { inputTokens: 10, outputTokens: 500 } }])
  })

  test("after markStopped, the host's aborted step failure ends the run with stop and the usage counted so far", async () => {
    const run = setup()
    run.collector.markStopped()
    run.send(host.usage({ input: 10, output: 500 }), host.stepFailed({ type: "aborted", message: "Step interrupted" }), host.executionInterrupted())
    const events = await run.drain()
    expect(events).toEqual([{ type: "finish", reason: "stop", usage: { inputTokens: 10, outputTokens: 500 } }])
  })

  test("without markStopped, an aborted step failure is still an error", async () => {
    const run = setup()
    run.send(host.stepFailed({ type: "aborted", message: "Step interrupted" }))
    const events = await run.drain()
    expect(events.at(-1)).toMatchObject({ type: "error" })
  })

  test("after the run ended on its own, finishNow changes nothing", async () => {
    const run = setup()
    run.send(host.textDelta("Hi"), host.stepEnded("stop", { input: 3, output: 4 }))
    run.collector.finishNow()
    const events = await run.drain()
    expect(events.at(-1)).toEqual({ type: "finish", reason: "stop", usage: { inputTokens: 3, outputTokens: 4 } })
  })
})

async function play(...events: BusEnvelope[]): Promise<PlugEvent[]> {
  const run = setup()
  run.send(...events)
  return run.drain()
}

/** `play` for a request with these tool names, which the reasoning ids are rewritten for (#411). */
async function playWith(toolNames: readonly string[], ...events: BusEnvelope[]): Promise<PlugEvent[]> {
  const run = setup(toolNames)
  run.send(...events)
  return run.drain()
}

describe("#202 a request that asked for one tool call keeps the first and drops the rest", () => {
  const twoCalls = async (singleToolCall: boolean) => {
    const collector = new RequestCollector({ stopTurn: () => {}, requestID: "req_1", singleToolCall, callerTools: ["first", "second"] })
    const store = createSessionStore()
    store.register({ sessionID: "ses_1", app: "app", requestID: "req_1", request: plugRequest(), collector })
    store.dispatch(host.toolCalled("c1", "first", { a: 1 }))
    store.dispatch(host.toolCalled("c2", "second", { b: 2 }))
    store.dispatch(host.stepEnded("stop"))
    return collect(collector.events())
  }

  test("with the flag the second call is not returned and the answer is still tool-calls", async () => {
    const events = await twoCalls(true)
    expect(events.filter((event) => event.type === "tool-call")).toEqual([{ type: "tool-call", id: "c1", name: "first", input: { a: 1 } }])
    expect(events.at(-1)).toMatchObject({ type: "finish", reason: "tool-calls" })
  })

  test("without the flag both calls are returned", async () => {
    expect((await twoCalls(false)).filter((event) => event.type === "tool-call")).toHaveLength(2)
  })
})

describe("event mapping", () => {
  test("#146 the provider signature of a reasoning block is carried on an empty reasoning-delta at its end", async () => {
    // The host publishes the state unwrapped (`{ signature }`): that is what a live Anthropic run stores.
    expect(await play(host.reasoningDelta("think"), host.reasoningEnded({ signature: "sig_abc" }), host.stepEnded("stop"))).toEqual([
      { type: "reasoning-delta", text: "think" },
      { type: "reasoning-delta", text: "", signature: "sig_abc" },
      expect.objectContaining({ type: "finish", reason: "stop" }),
    ])
  })

  test("#146 a signature wrapped under a provider key is read too", async () => {
    expect(await play(host.reasoningDelta("think"), host.reasoningEnded({ anthropic: { signature: "sig_abc" } }), host.stepEnded("stop"))).toEqual([
      { type: "reasoning-delta", text: "think" },
      { type: "reasoning-delta", text: "", signature: "sig_abc" },
      expect.objectContaining({ type: "finish", reason: "stop" }),
    ])
  })

  test("#385 a redacted reasoning block's opaque payload is carried on an empty reasoning-delta at its end", async () => {
    // The host keeps the start state of a redacted block, which holds `redactedData` and no signature.
    expect(await play(host.reasoningEnded({ redactedData: "opaque_1" }), host.stepEnded("stop"))).toEqual([
      { type: "reasoning-delta", text: "", redactedData: "opaque_1" },
      expect.objectContaining({ type: "finish", reason: "stop" }),
    ])
  })

  test("#146 a reasoning block without a signature in its metadata emits nothing at its end", async () => {
    expect(await play(host.reasoningDelta("think"), host.reasoningEnded({}), host.stepEnded("stop"))).toEqual([{ type: "reasoning-delta", text: "think" }, expect.objectContaining({ type: "finish" })])
  })

  test("#411 a placeholder id in reasoning text is rewritten to the tool's name, even when split across deltas", async () => {
    expect(await playWith(["get_weather"], host.reasoningDelta("I can use mcp_TZ2V0"), host.reasoningDelta("X3dlYXRoZXI here"), host.reasoningEnded({}), host.stepEnded("stop"))).toEqual([
      { type: "reasoning-delta", text: "I can use " },
      { type: "reasoning-delta", text: "get_weather here" },
      expect.objectContaining({ type: "finish", reason: "stop" }),
    ])
  })

  test("#411 an id that ends a reasoning block is flushed at its end, before the signature", async () => {
    expect(await playWith(["get_weather"], host.reasoningDelta("call mcp_TZ2V0X3dlYXRoZXI"), host.reasoningEnded({ signature: "sig_abc" }), host.stepEnded("stop"))).toEqual([
      { type: "reasoning-delta", text: "call " },
      { type: "reasoning-delta", text: "get_weather" },
      { type: "reasoning-delta", text: "", signature: "sig_abc" },
      expect.objectContaining({ type: "finish", reason: "stop" }),
    ])
  })

  test("#411 held reasoning text is flushed when the step ends with no reasoning.ended (the last characters are not lost)", async () => {
    expect(await playWith(["get_weather"], host.reasoningDelta("call mcp_TZ2V0X3dlYXRoZXI"), host.stepEnded("stop"))).toEqual([
      { type: "reasoning-delta", text: "call " },
      { type: "reasoning-delta", text: "get_weather" },
      expect.objectContaining({ type: "finish", reason: "stop" }),
    ])
  })

  test("#411 held reasoning text is flushed before a failure's error", async () => {
    expect(await playWith(["get_weather"], host.reasoningDelta("call mcp_TZ2V0X3dlYXRoZXI"), host.stepFailed({ type: "provider.rate-limit", message: "slow down" }))).toEqual([
      { type: "reasoning-delta", text: "call " },
      { type: "reasoning-delta", text: "get_weather" },
      expect.objectContaining({ type: "error" }),
    ])
  })

  test("#411 held reasoning text is flushed before a text delta and before a tool call", async () => {
    expect(
      await playWith(
        ["get_weather"],
        host.reasoningDelta("call mcp_TZ2V0"),
        host.textDelta("Hi"),
        host.reasoningDelta("x mcp_TZ2V0X3dlYXRoZXI"),
        host.toolCalled("c1", "get_weather", {}),
        host.stepEnded("tool-calls"),
      ),
    ).toEqual([
      { type: "reasoning-delta", text: "call " },
      { type: "reasoning-delta", text: "mcp_TZ2V0" },
      { type: "text-delta", text: "Hi" },
      { type: "reasoning-delta", text: "x " },
      { type: "reasoning-delta", text: "get_weather" },
      expect.objectContaining({ type: "tool-call" }),
      expect.objectContaining({ type: "finish" }),
    ])
  })

  test("#411 held reasoning text is flushed by a server tool call, so the next delta does not join the id", async () => {
    const collector = new RequestCollector({
      stopTurn: () => {},
      requestID: "req_1",
      toolNames: ["get_weather"],
      callerTools: ["get_weather"],
      serverTools: new Set(["web"]),
      maxServerToolSteps: 3,
      maxServerToolCalls: 3,
    })
    const store = createSessionStore()
    store.register({ sessionID: "ses_1", app: "app", requestID: "req_1", request: plugRequest(), collector })
    store.dispatch(host.reasoningDelta("call mcp_TZ2V0X3dlYXRoZXI"))
    store.dispatch(host.toolCalled("s1", "web", {}))
    store.dispatch(host.stepEnded("tool-calls"))
    store.dispatch(host.reasoningDelta("more"))
    store.dispatch(host.reasoningEnded({}))
    store.dispatch(host.stepEnded("stop"))
    expect(await collect(collector.events())).toEqual([
      { type: "reasoning-delta", text: "call " },
      { type: "reasoning-delta", text: "get_weather" },
      { type: "reasoning-delta", text: "more" },
      expect.objectContaining({ type: "finish", reason: "stop" }),
    ])
  })

  test("#411 the H form of a long tool name is rewritten, even when its id is split across deltas", async () => {
    const long = "a_very_long_tool_name_that_goes_past_the_limit_".repeat(2)
    const id = `mcp_H${createHash("sha256").update(long).digest("base64url")}`
    const events = await playWith([long], host.reasoningDelta(`call ${id.slice(0, 30)}`), host.reasoningDelta(`${id.slice(30)} now`), host.reasoningEnded({}), host.stepEnded("stop"))
    expect(
      events
        .filter((event) => event.type === "reasoning-delta")
        .map((event) => (event as { text: string }).text)
        .join(""),
    ).toBe(`call ${long} now`)
  })

  test("#411 reasoning text that is not one of this request's ids is left as it is", async () => {
    expect(await playWith(["get_weather"], host.reasoningDelta("mcp_servers and mcp_Tbm90 stay"), host.reasoningEnded({}), host.stepEnded("stop"))).toEqual([
      { type: "reasoning-delta", text: "mcp_servers and mcp_Tbm90 stay" },
      expect.objectContaining({ type: "finish", reason: "stop" }),
    ])
  })

  test("#411 a rewritten block remembers the text it was signed for, so a replay can restore it", async () => {
    await playWith(["get_weather"], host.reasoningDelta("call mcp_TZ2V0X3dlYXRoZXI"), host.reasoningEnded({ signature: "sig_rt" }), host.stepEnded("stop"))
    expect(replayedReasoning("sig_rt", "call get_weather")).toBe("call mcp_TZ2V0X3dlYXRoZXI")
  })

  test("text and reasoning deltas, then a plain stop", async () => {
    expect(await play(host.reasoningDelta("think"), host.textDelta("Hel"), host.textDelta(""), host.textDelta("lo"), host.stepEnded("stop"))).toEqual([
      { type: "reasoning-delta", text: "think" },
      { type: "text-delta", text: "Hel" },
      { type: "text-delta", text: "lo" },
      { type: "finish", reason: "stop", usage: undefined },
    ])
  })

  test("text.ended fills in what the live deltas missed, per text ordinal", async () => {
    expect(await play(host.textDelta("Hel"), host.textEnded("Hello"), host.textEnded("Second", 1), host.stepEnded())).toEqual([
      { type: "text-delta", text: "Hel" },
      { type: "text-delta", text: "lo" },
      { type: "text-delta", text: "Second" },
      expect.objectContaining({ type: "finish" }),
    ])
  })

  test("a tool call is emitted once; its name falls back to the input.started event", async () => {
    expect(
      await play(
        host.toolInputStarted("c1", "lookup"),
        { type: "session.tool.called", data: { sessionID: "ses_1", id: "c1", input: { q: 1 } } },
        host.toolCalled("c1", "lookup", { q: 1 }),
        host.stepEnded("tool-calls"),
      ),
    ).toEqual([
      { type: "tool-call", id: "c1", name: "lookup", input: { q: 1 } },
      { type: "finish", reason: "tool-calls", usage: undefined },
    ])
  })

  test("usage: the host's non-overlapping breakdown becomes inclusive totals", async () => {
    const events = await play(host.usage({ input: 1 }), host.stepEnded("stop", { input: 10, output: 4, reasoning: 3, cache: { read: 5, write: 2 } }))
    expect(events.at(-1)).toEqual({ type: "finish", reason: "stop", usage: { inputTokens: 17, outputTokens: 7, reasoningTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 2 } })
  })

  test("events of other sessions never reach the collector", async () => {
    const run = setup()
    run.send(bus("ses_other").textDelta("not mine"), host.textDelta("mine"), host.stepEnded())
    expect((await run.drain()).filter((event) => event.type === "text-delta")).toEqual([{ type: "text-delta", text: "mine" }])
  })
})

describe("#36 finish reasons", () => {
  test.each([
    ["stop", false, "stop"],
    ["length", false, "length"],
    ["content-filter", false, "content-filter"],
    ["error", false, "error"],
    ["unknown-value", false, "stop"],
    ["stop", true, "tool-calls"],
    ["tool-calls", true, "tool-calls"],
    ["length", true, "length"],
  ] as const)("a step that ended with %s (tool calls: %p) finishes as %s", async (finish, withCall, reason) => {
    const events = await play(...(withCall ? [host.toolCalled("c1", "f")] : []), host.stepEnded(finish))
    expect(events.at(-1)).toMatchObject({ type: "finish", reason })
  })

  test("an execution that succeeds without a step end finishes as stop; with calls as tool-calls", async () => {
    expect((await play(host.textDelta("x"), host.executionSucceeded())).at(-1)).toMatchObject({ type: "finish", reason: "stop" })
    expect((await play(host.toolCalled("c1", "f"), host.executionInterrupted())).at(-1)).toMatchObject({ type: "finish", reason: "tool-calls" })
  })

  test("an execution interrupted before any answer is an error", async () => {
    expect((await play(host.executionInterrupted())).at(-1)).toEqual({ type: "error", error: { status: 500, kind: "server", message: "Request was interrupted before the model finished" } })
  })
})

describe("#33 stopping the turn", () => {
  test("a step that ended with tool calls asks the owner to stop the turn", () => {
    const run = setup()
    run.send(host.toolCalled("c1", "f"), host.stepEnded("tool-calls"))
    expect(run.stops).toBe(1)
    expect(run.collector.turnSettled).toBe(false)
  })

  test("a later step that also ended with calls (the interrupt lost the race) asks again", () => {
    const run = setup()
    run.send(host.toolCalled("c1", "f"), host.stepEnded("tool-calls"), host.toolCalled("c2", "f"), host.stepEnded("tool-calls"))
    expect(run.stops).toBe(2)
  })

  test("a plain stop settles the turn and asks for nothing", () => {
    const run = setup()
    run.send(host.textDelta("x"), host.stepEnded("stop"))
    expect(run.stops).toBe(0)
    expect(run.collector.turnSettled).toBe(true)
  })

  test("a failed step stops the turn, unless it failed because it was aborted", () => {
    const failed = setup()
    failed.send(host.stepFailed({ type: "provider.unknown", status: 500 }))
    expect(failed.stops).toBe(1)
    const aborted = setup()
    aborted.collector.cancel()
    aborted.send(host.stepFailed({ type: "aborted" }))
    expect(aborted.stops).toBe(0)
  })

  test("nothing is stopped once the execution has ended", () => {
    const run = setup()
    run.send(host.toolCalled("c1", "f"), host.executionSucceeded(), host.stepEnded("tool-calls"))
    expect(run.stops).toBe(0)
    expect(run.collector.executionEnded).toBe(true)
  })

  test("an aborted step after tool calls finishes as tool-calls (our own interrupt)", async () => {
    expect((await play(host.toolCalled("c1", "f"), host.stepFailed({ type: "aborted" }))).at(-1)).toMatchObject({ type: "finish", reason: "tool-calls" })
  })

  test("a cancelled request ends without a terminal event", async () => {
    const run = setup()
    run.collector.cancel()
    expect(run.collector.cancelled).toBe(true)
    expect(await run.drain()).toEqual([])
  })

  test("the execution end releases the request guard from the store", () => {
    const run = setup()
    run.send(host.executionSucceeded())
    expect(run.store.lookup("ses_1")).toBeUndefined()
  })
})

describe("#88 host errors reach the caller only as a stable code and a fixed message", () => {
  const SECRET = "org-12345 at https://internal.example/v1 key sk-live-abc"
  const cases: Array<[string, HostError, { status: number; kind: string; code: string }]> = [
    ["a provider rate limit", { type: "provider.rate-limit", message: SECRET }, { status: 429, kind: "rate_limit", code: "rate_limited" }],
    ["any 429", { type: "unknown", status: 429, message: SECRET }, { status: 429, kind: "rate_limit", code: "rate_limited" }],
    ["an exhausted quota", { type: "provider.quota", message: SECRET }, { status: 429, kind: "rate_limit", code: "quota_exceeded" }],
    [
      "a context overflow in the message",
      { type: "provider.invalid-request", status: 400, message: "This model's maximum context length is 8192 tokens" },
      { status: 400, kind: "invalid_request", code: "context_length_exceeded" },
    ],
    [
      "a context overflow in the response body",
      { type: "provider.invalid-request", status: 413, message: "bad", response: { body: '{"error":"prompt is too long"}' } },
      { status: 400, kind: "invalid_request", code: "context_length_exceeded" },
    ],
    ["a provider 401", { type: "provider.auth", status: 401, message: SECRET }, { status: 401, kind: "authentication", code: "provider_auth_failed" }],
    ["a provider 403", { type: "unknown", status: 403, message: SECRET }, { status: 403, kind: "permission", code: "provider_auth_failed" }],
    ["provider credentials without a status", { type: "provider.auth", message: SECRET }, { status: 502, kind: "server", code: "provider_auth_failed" }],
    ["a content filter", { type: "provider.content-filter", message: SECRET }, { status: 400, kind: "invalid_request", code: "content_filter" }],
    ["a provider timeout", { type: "provider.timeout", message: SECRET }, { status: 504, kind: "timeout", code: "provider_timeout" }],
    ["a 408", { type: "unknown", status: 408 }, { status: 504, kind: "timeout", code: "provider_timeout" }],
    ["a provider 404", { type: "provider.other", status: 404, message: SECRET }, { status: 404, kind: "not_found", code: "provider_rejected_request" }],
    ["another provider 4xx", { type: "provider.invalid-request", status: 422, message: SECRET }, { status: 422, kind: "invalid_request", code: "provider_rejected_request" }],
    ["a provider 5xx", { type: "provider.other", status: 503, message: SECRET }, { status: 503, kind: "server", code: "provider_unavailable" }],
    ["#204 a provider 529", { type: "provider.other", status: 529, message: SECRET }, { status: 503, kind: "server", code: "provider_overloaded" }],
    [
      "#204 an overloaded_error in the provider body",
      { type: "provider.internal", message: "bad", response: { body: '{"type":"error","error":{"type":"overloaded_error"}}' } },
      { status: 503, kind: "server", code: "provider_overloaded" },
    ],
    ["#204 an overloaded message without a status", { type: "provider.internal", message: `Overloaded ${SECRET}` }, { status: 503, kind: "server", code: "provider_overloaded" }],
    ["a provider error without a status", { type: "provider.other", message: SECRET }, { status: 502, kind: "server", code: "provider_unavailable" }],
    ["anything else", { type: "unknown", message: SECRET }, { status: 502, kind: "server", code: "model_run_failed" }],
    [
      "#171 a ChatGPT subscription at its usage limit",
      { type: "provider.invalid-request", message: `subscription_sharing_usage_limit_exceeded: ChatGPT usage limit reached ${SECRET}` },
      { status: 429, kind: "rate_limit", code: "quota_exceeded" },
    ],
    [
      "#171 a usage limit in the raw body",
      { type: "provider.other", message: "bad", response: { body: `{"error":"usage_limit_reached","org":"${SECRET}"}` } },
      { status: 429, kind: "rate_limit", code: "quota_exceeded" },
    ],
    [
      "#171 provider rate-limit wording without a 429",
      { type: "provider.invalid-request", message: `Rate limit reached for requests ${SECRET}` },
      { status: 429, kind: "rate_limit", code: "rate_limited" },
    ],
    ["#171 a rejected API key in the message", { type: "provider.invalid-request", message: `Incorrect API key provided: ${SECRET}` }, { status: 502, kind: "server", code: "provider_auth_failed" }],
    [
      "#171 a model the provider does not know",
      { type: "provider.invalid-request", status: 404, message: `The model gpt-x does not exist ${SECRET}` },
      { status: 404, kind: "not_found", code: "model_not_found" },
    ],
    ["#171 an unknown model without a status", { type: "provider.other", message: "Unknown model: gpt-x" }, { status: 404, kind: "not_found", code: "model_not_found" }],
  ]
  test.each(cases)("%s", async (_name, error, expected) => {
    const [event] = await play(host.stepFailed(error))
    expect(event).toMatchObject({ type: "error", error: expected })
    expect(JSON.stringify(event)).not.toMatch(/org-12345|internal\.example|sk-live/)
  })

  test("#424 a provider rejection of a replayed thinking signature says the signature was rejected, not what the provider said", async () => {
    const [event] = await play(host.stepFailed({ type: "provider.invalid-request", status: 400, message: `messages.1.content.0: Invalid \`signature\` in \`thinking\` block ${SECRET}` }))
    expect(event).toMatchObject({
      type: "error",
      error: { status: 400, kind: "invalid_request", code: "provider_rejected_request", message: "The model provider rejected the signature of a replayed thinking block" },
    })
    expect(JSON.stringify(event)).not.toMatch(/org-12345|internal\.example|sk-live|Invalid/)
  })

  test("#424 another provider signature error keeps the generic provider message", async () => {
    const [event] = await play(host.stepFailed({ type: "provider.invalid-request", status: 400, message: `Invalid request signature ${SECRET}` }))
    expect(event).toMatchObject({ type: "error", error: { code: "provider_rejected_request", message: "The model provider rejected the request" } })
  })

  test("the raw text goes to the log as model.failed, with the request id", async () => {
    await play(host.stepFailed({ type: "provider.other", status: 503, message: SECRET }))
    expect(logs.of("model.failed")[0]!.fields).toMatchObject({ requestID: "req_1", type: "provider.other", status: "503", message: SECRET })
  })

  test("a failed execution with no step event uses the same mapping", async () => {
    expect(await play(host.executionFailed({ type: "provider.quota" }))).toEqual([expect.objectContaining({ type: "error", error: expect.objectContaining({ code: "quota_exceeded" }) })])
  })

  test("a step stopped by the content filter finishes as content-filter, not an error", async () => {
    expect((await play(host.textDelta("x"), host.stepFailed({ type: "provider.other" }, "content-filter"))).at(-1)).toMatchObject({ type: "finish", reason: "content-filter" })
  })

  test("our own prompt failure keeps its message", async () => {
    const run = setup()
    run.collector.push({ type: "session.execution.failed", error: { type: "prompt_failed", message: "Could not start the model session" } })
    expect(await run.drain()).toEqual([{ type: "error", error: { status: 502, kind: "server", code: "prompt_failed", message: "Could not start the model session" } }])
  })
})

describe("in-process failures and bounds", () => {
  test("a synthetic failure event (lost event stream) fails the request and stops the turn", async () => {
    const run = setup()
    run.store.failAll({ status: 502, kind: "server", code: "event_stream_lost", message: "lost" })
    expect(run.stops).toBe(1)
    expect(await run.drain()).toEqual([{ type: "error", error: { status: 502, kind: "server", code: "event_stream_lost", message: "lost" } }])
  })

  test("a malformed synthetic failure is ignored", () => {
    const run = setup()
    run.collector.push({ type: FAILURE_EVENT, error: "nope" })
    expect(run.collector.terminal).toBe(false)
  })

  test("events after the terminal one are ignored", async () => {
    expect(await play(host.stepEnded("stop"), host.textDelta("late"), host.toolCalled("c9", "f"))).toEqual([{ type: "finish", reason: "stop", usage: undefined }])
  })

  test("#39 a consumer that falls 10,000 events behind fails with response_overflow and stops the turn", async () => {
    const run = setup()
    for (let i = 0; i <= 10_000; i++) run.send(host.textDelta("x"))
    expect(run.collector.terminal).toBe(true)
    expect(run.stops).toBe(1)
    expect(await run.drain()).toEqual([
      { type: "error", error: { status: 502, kind: "server", code: "response_overflow", message: "The response was not read fast enough; too much output was waiting" } },
    ])
  })

  test("#39 so does one that falls 8 MB behind", async () => {
    const run = setup()
    const chunk = "x".repeat(1024 * 1024)
    for (let i = 0; i < 9; i++) run.send(host.textDelta(chunk))
    expect((await run.drain()).map((event) => event.type)).toEqual(["error"])
  })
})

/** #391: a host retry before any output fails the call at once when a fallback target follows; the last target keeps the host's retries. */
describe("#391 a host retry before any output moves a fallback chain on", () => {
  const upstream520 = { type: "provider.internal", status: 520, message: "upstream 520" }
  function failFast(failFastRetry: boolean) {
    let stops = 0
    const collector = new RequestCollector({ stopTurn: () => void stops++, requestID: "req_1", failFastRetry, callerTools: [] })
    const store = createSessionStore()
    store.register({ sessionID: "ses_1", app: "app", requestID: "req_1", request: plugRequest(), collector })
    return {
      collector,
      store,
      get stops() {
        return stops
      },
    }
  }

  test("with a target after it, the retry is a provider_retry error at once and the turn is stopped", async () => {
    const run = failFast(true)
    run.store.dispatch(host.retryScheduled(upstream520))
    const events = await collect(run.collector.events())
    expect(events).toEqual([{ type: "error", error: { status: 503, kind: "server", code: "provider_retry", message: "The model provider failed; the next target is tried" } }])
    expect(run.stops).toBe(1)
  })

  test("without a target after it, the retry is left to the host: nothing is emitted and the turn goes on", async () => {
    const run = failFast(false)
    run.store.dispatch(host.retryScheduled(upstream520))
    run.store.dispatch(host.textDelta("hi"))
    run.store.dispatch(host.stepEnded("stop"))
    expect((await collect(run.collector.events())).map((event) => event.type)).toEqual(["text-delta", "finish"])
    expect(run.stops).toBe(0)
  })

  test.each([
    ["text", () => host.textDelta("partial")],
    ["reasoning", () => host.reasoningDelta("thinking")],
  ])("after %s output a retry is not a failure: the answer is committed", async (_name, first) => {
    const run = failFast(true)
    run.store.dispatch(first())
    run.store.dispatch(host.retryScheduled(upstream520))
    run.store.dispatch(host.stepEnded("stop"))
    const types = (await collect(run.collector.events())).map((event) => event.type)
    expect(types).not.toContain("error")
    expect(types.at(-1)).toBe("finish")
  })
})

/** #391: a status past 511 is not an HTTP status a client can read (Cloudflare's 520 to 527): it is answered as 502. */
describe("#391 an upstream 520 is answered as a 502", () => {
  test("a 520 that reaches the caller is answered as 502 provider_unavailable, not 520", async () => {
    const events = await play(host.stepFailed({ type: "provider.internal", status: 520, message: "upstream 520" }))
    expect(events).toEqual([{ type: "error", error: { status: 502, kind: "server", code: "provider_unavailable", message: "The model provider is unavailable or returned an error" } }])
  })

  test("other upstream 5xx statuses in the standard range keep their status", async () => {
    const events = await play(host.stepFailed({ type: "provider.internal", status: 503, message: "x" }))
    expect(events).toMatchObject([{ type: "error", error: { status: 503, code: "provider_unavailable" } }])
  })
})
