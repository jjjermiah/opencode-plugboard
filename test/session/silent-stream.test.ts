/**
 * #515 A connected event stream that stops delivering events for a session. The collector settles the response on
 * `session.step.ended` and on the execution events (`session.execution.succeeded`, `.failed`, `.interrupted`); with both lost
 * the request used to wait for `requestTimeoutMs`. The session caller now watches for silence (`silenceMs`): when no event
 * came for that long it reads the session's stored last assistant message, and a finished one settles the request as the
 * events would have. An unfinished one means the model is still working, so the watch waits on.
 *
 * Driven on the fake host, at the caller and over loopback HTTP (Chat Completions, streamed and not). The collector's own
 * replay of a stored answer is covered at the end.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { CallContext, PlugEvent } from "../../src/contract.js"
import { createSessionCaller } from "../../src/session/caller.js"
import { RequestCollector } from "../../src/session/events.js"
import { createSessionPort, type HostContext, type StoredAnswer } from "../../src/session/host.js"
import { createSessionStore } from "../../src/session/state.js"
import { collect, plugRequest, until } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { sseData, startRoute, type RouteServer } from "../support/loopback.js"
import { isolateRuntime } from "../support/runtime.js"
import { bus, FakeSessionPort, type BusEnvelope } from "../support/session.js"

const logs = captureLogs()
isolateRuntime()

const SILENCE_MS = 30

/** What the host stored for a finished step. */
const stored = (over: Partial<StoredAnswer> = {}): StoredAnswer => ({ completed: true, finish: "stop", parts: [], ...over })
const text = (value: string) => ({ type: "text", text: value }) as const
const TOOLS = [{ name: "get_weather", description: "", parameters: { type: "object" } }]

function setup(silenceMs = SILENCE_MS) {
  const port = new FakeSessionPort()
  const sessions = createSessionStore()
  const settled: string[] = []
  const caller = createSessionCaller({
    port,
    sessions,
    maxTools: 2,
    silenceMs,
    metrics: () => ({
      settledFromTranscript: (app) => {
        settled.push(app)
      },
    }),
  })
  // The route's deadline (`requestTimeoutMs`) aborts this signal; a test that expects the old hang aborts it by hand.
  const deadline = new AbortController()
  const context: CallContext = { app: "app", signal: deadline.signal }
  const host = (events: (sessionID: string) => BusEnvelope[]) => {
    port.script.prompt = async (input) => {
      queueMicrotask(() => events(input.sessionID).forEach((event) => sessions.dispatch(event)))
    }
  }
  return { port, sessions, caller, deadline, context, settled, host }
}

/** What `stream` has yielded so far, and whether it has ended. */
function watch(stream: AsyncIterable<PlugEvent>) {
  const seen: PlugEvent[] = []
  const state = { ended: false }
  const done = (async () => {
    for await (const event of stream) seen.push(event)
    state.ended = true
  })()
  return { seen, state, done }
}

const textOf = (events: PlugEvent[]) => events.flatMap((event) => (event.type === "text-delta" ? [event.text] : [])).join("")

describe("#515 the host finished the message but step.ended and the execution event were lost", () => {
  test("the stored message settles the request: the rest of the text, then a finish with the stored usage and no repeat", async () => {
    const run = setup()
    run.host((id) => [bus(id).textDelta("Hel")])
    const call = watch(run.caller.stream(plugRequest(), run.context))
    run.port.script.lastAnswer = async () => stored({ parts: [text("Hello there")], tokens: { input: 4, output: 3, cache: { read: 2 } } })
    await call.done
    expect(call.seen.map((event) => event.type)).toEqual(["text-delta", "text-delta", "finish"])
    expect(textOf(call.seen)).toBe("Hello there")
    expect(call.seen.at(-1)).toEqual({ type: "finish", reason: "stop", usage: { inputTokens: 6, outputTokens: 3, reasoningTokens: undefined, cacheReadTokens: 2, cacheWriteTokens: undefined } })
    expect(run.settled).toEqual(["app"])
    expect(run.port.interrupted).toEqual([])
  })

  test("it is logged as session.settled_from_transcript with the request, app, session and how long it was quiet", async () => {
    const run = setup()
    run.host((id) => [bus(id).textDelta("Hi")])
    run.port.script.lastAnswer = async () => stored({ parts: [text("Hi")] })
    await watch(run.caller.stream(plugRequest(), run.context)).done
    const [line] = logs.of("session.settled_from_transcript")
    expect(logs.of("session.settled_from_transcript")).toHaveLength(1)
    expect(line!.fields).toMatchObject({ app: "app", sessionID: "ses_1", finish: "stop" })
    expect(line!.fields.requestID).toBeTruthy()
    expect(Number(line!.fields.silentMs)).toBeGreaterThanOrEqual(SILENCE_MS - 5)
  })

  test("a stream that delivered nothing at all settles with the whole text", async () => {
    const run = setup()
    run.host(() => [])
    run.port.script.lastAnswer = async () => stored({ parts: [text("All of it")] })
    const call = watch(run.caller.stream(plugRequest(), run.context))
    await call.done
    expect(call.seen.map((event) => event.type)).toEqual(["text-delta", "finish"])
    expect(textOf(call.seen)).toBe("All of it")
  })

  test("a stored tool call is returned as a tool call, the finish is tool-calls and the host turn is stopped", async () => {
    const run = setup()
    run.host((id) => [bus(id).textDelta("Checking.")])
    run.port.script.lastAnswer = async () =>
      stored({ finish: "tool-calls", parts: [text("Checking."), { type: "tool", id: "c1", name: "get_weather", input: { city: "Paris" } }], tokens: { input: 5, output: 2 } })
    const call = watch(run.caller.stream(plugRequest({ tools: TOOLS }), run.context))
    await call.done
    expect(call.seen.map((event) => event.type)).toEqual(["text-delta", "tool-call", "finish"])
    expect(call.seen[1]).toMatchObject({ type: "tool-call", id: "c1", name: "get_weather", input: { city: "Paris" } })
    expect(call.seen.at(-1)).toMatchObject({ type: "finish", reason: "tool-calls" })
    expect(run.port.interrupted).toEqual(["ses_1"])
  })

  test("a call the stream already delivered is not returned twice", async () => {
    const run = setup()
    run.host((id) => [bus(id).toolCalled("c1", "get_weather", { city: "Paris" })])
    run.port.script.lastAnswer = async () => stored({ finish: "tool-calls", parts: [{ type: "tool", id: "c1", name: "get_weather", input: { city: "Paris" } }] })
    const call = watch(run.caller.stream(plugRequest({ tools: TOOLS }), run.context))
    await call.done
    expect(call.seen.map((event) => event.type)).toEqual(["tool-call", "finish"])
  })

  test("a step the host stored as failed ends the request with the error the event path gives", async () => {
    const run = setup()
    run.host(() => [])
    run.port.script.lastAnswer = async () => ({ completed: true, parts: [], error: { type: "provider.rate-limit", message: "slow down" } })
    const call = watch(run.caller.stream(plugRequest(), run.context))
    await call.done
    expect(call.seen.at(-1)).toMatchObject({ type: "error" })
  })
})

describe("#515 an answer that is not finished is never settled", () => {
  test("an incomplete stored message re-arms the timer: it is read again, and the request settles on the read that finds it finished", async () => {
    const run = setup()
    run.host((id) => [bus(id).textDelta("Hel")])
    let reads = 0
    run.port.script.lastAnswer = async () => (++reads < 3 ? stored({ completed: false, finish: undefined, parts: [text("Hel")] }) : stored({ parts: [text("Hello")] }))
    const call = watch(run.caller.stream(plugRequest(), run.context))
    await call.done
    expect(run.port.answerReads).toEqual(["ses_1", "ses_1", "ses_1"])
    expect(textOf(call.seen)).toBe("Hello")
    expect(call.seen.at(-1)).toMatchObject({ type: "finish", reason: "stop" })
  })

  test("no stored message yet (the model has not started) keeps the request waiting, and the deadline still ends it", async () => {
    const run = setup()
    run.host(() => [])
    const call = watch(run.caller.stream(plugRequest(), run.context))
    await until(() => run.port.answerReads.length >= 2, 1_000, "two reads")
    expect(call.state.ended).toBe(false)
    expect(run.settled).toEqual([])
    run.deadline.abort(new Error("requestTimeoutMs"))
    await call.done
    expect(call.seen).toEqual([])
  })

  test("a read that fails is logged and the watch goes on", async () => {
    const run = setup()
    run.host((id) => [bus(id).textDelta("Hi")])
    let reads = 0
    run.port.script.lastAnswer = async () => {
      if (++reads === 1) throw new Error("host unavailable")
      return stored({ parts: [text("Hi")] })
    }
    const call = watch(run.caller.stream(plugRequest(), run.context))
    await call.done
    expect(reads).toBe(2)
    expect(logs.of("session.transcript_read_failed")).toHaveLength(1)
    expect(call.seen.at(-1)).toMatchObject({ type: "finish", reason: "stop" })
  })

  test("a slow stream is never settled: events that keep coming keep the timer off, even with a finished message stored", async () => {
    // The events outlast the silence (6 x 30 ms against 100 ms), and none is more than 30 ms after the one before.
    const run = setup(100)
    run.port.script.lastAnswer = async () => stored({ parts: [text("early")] })
    run.host((id) => [bus(id).textDelta("a")])
    const call = watch(run.caller.stream(plugRequest(), run.context))
    await until(() => call.seen.length === 1, 1_000, "the first delta")
    for (const piece of ["b", "c", "d", "e", "f"]) {
      await new Promise((resolve) => setTimeout(resolve, 30))
      run.sessions.dispatch(bus("ses_1").reasoningDelta(piece))
    }
    expect(run.port.answerReads).toEqual([])
    run.sessions.dispatch(bus("ses_1").textDelta("b"))
    run.sessions.dispatch(bus("ses_1").stepEnded("stop"))
    await call.done
    expect(textOf(call.seen)).toBe("ab")
    expect(run.port.answerReads).toEqual([])
    expect(run.settled).toEqual([])
  })

  test("a read that overlapped an event is dropped: the older snapshot never overtakes the live path", async () => {
    const run = setup()
    run.host((id) => [bus(id).textDelta("Hel")])
    let release: (answer: StoredAnswer) => void = () => {}
    const reads: string[] = []
    run.port.script.lastAnswer = (id) => {
      reads.push(id)
      return reads.length === 1 ? new Promise<StoredAnswer>((resolve) => (release = resolve)) : Promise.resolve(stored({ completed: false, finish: undefined, parts: [] }))
    }
    const call = watch(run.caller.stream(plugRequest(), run.context))
    await until(() => reads.length === 1, 1_000, "the first read")
    // The host speaks while the read is out, then the read returns a finished (older) message.
    run.sessions.dispatch(bus("ses_1").textDelta("lo"))
    release(stored({ parts: [text("Hel")] }))
    await until(() => reads.length === 2, 1_000, "the second read")
    expect(call.state.ended).toBe(false)
    expect(run.settled).toEqual([])
    run.sessions.dispatch(bus("ses_1").stepEnded("stop"))
    await call.done
    expect(textOf(call.seen)).toBe("Hello")
  })

  test("events that arrive are not touched: a normal answer is relayed as before and the stored messages are never read", async () => {
    const run = setup()
    run.host((id) => [bus(id).textDelta("Hi"), bus(id).stepEnded("stop"), bus(id).executionSucceeded()])
    const call = watch(run.caller.stream(plugRequest(), run.context))
    await call.done
    expect(call.seen.map((event) => event.type)).toEqual(["text-delta", "finish"])
    expect(run.port.answerReads).toEqual([])
  })
})

describe("#515 over HTTP: Chat Completions with the terminal events lost", () => {
  let server: RouteServer | undefined
  afterEach(async () => {
    await server?.close()
    server = undefined
  })

  async function serve(sent: (id: string) => BusEnvelope[], answer: StoredAnswer) {
    const run = setup()
    run.host(sent)
    run.port.script.lastAnswer = async () => answer
    server = await startRoute({ caller: run.caller })
    return {
      port: run.port,
      request: (stream: boolean) =>
        ({ method: "POST", path: "/v1/chat/completions", body: { model: "test/echo", messages: [{ role: "user", content: "hi" }], ...(stream ? { stream: true } : {}) } }) as const,
    }
  }

  test("not streamed: 200 with the stored text, finish stop and the stored usage, long before the deadline", async () => {
    const run = await serve((id) => [bus(id).textDelta("Hel")], stored({ parts: [text("Hello there")], tokens: { input: 4, output: 3 } }))
    const reply = await server!.send(run.request(false))
    expect(reply.status).toBe(200)
    const body = reply.json()
    expect(body.choices[0].message.content).toBe("Hello there")
    expect(body.choices[0].finish_reason).toBe("stop")
    expect(body.usage).toMatchObject({ prompt_tokens: 4, completion_tokens: 3 })
  })

  test("not streamed, nothing delivered at all: 200 with the stored text (it was a 504 at requestTimeoutMs)", async () => {
    const run = await serve(() => [], stored({ parts: [text("Hello there")] }))
    const reply = await server!.send(run.request(false))
    expect(reply.status).toBe(200)
    expect(reply.json().choices[0].message.content).toBe("Hello there")
  })

  test("streamed, after parts were sent: the rest of the text arrives once, then a finish chunk and [DONE]", async () => {
    const run = await serve((id) => [bus(id).textDelta("Hel")], stored({ parts: [text("Hello there")] }))
    const stream = await server!.open(run.request(true))
    const received = await stream.ended
    const frames = sseData(received)
    const choices = frames.flatMap((frame) => frame.choices ?? [])
    expect(choices.map((choice: any) => choice.delta?.content ?? "").join("")).toBe("Hello there")
    expect(choices.at(-1).finish_reason).toBe("stop")
    expect(received.trimEnd().endsWith("data: [DONE]")).toBe(true)
    expect(received.match(/Hel/g)).toHaveLength(1)
  })

  test("streamed, nothing sent before: the whole stored text is the stream", async () => {
    const run = await serve(() => [], stored({ parts: [text("Hello there")] }))
    const stream = await server!.open(run.request(true))
    const frames = sseData(await stream.ended)
    const choices = frames.flatMap((frame) => frame.choices ?? [])
    expect(choices.map((choice: any) => choice.delta?.content ?? "").join("")).toBe("Hello there")
    expect(choices.at(-1).finish_reason).toBe("stop")
  })
})

describe("#515 SessionPort.lastAnswer reads the host's stored messages", () => {
  const portOver = (messages: ReadonlyArray<unknown>) => {
    const asked: unknown[] = []
    const ctx = {
      session: {
        context: (input: unknown) => {
          asked.push(input)
          return Effect.succeed(messages)
        },
      },
    } as unknown as HostContext
    return { port: createSessionPort(ctx), asked }
  }
  const finished = { type: "assistant", time: { created: 1, completed: 3 }, finish: "tool-calls", tokens: { input: 5, output: 2 } }

  test("the last assistant message is returned in order, with its finish, tokens, and only the tool calls whose input is complete", async () => {
    const { port, asked } = portOver([
      { type: "user", text: "hi" },
      { type: "assistant", time: { created: 1, completed: 2 }, finish: "stop", content: [{ type: "text", text: "an earlier step" }] },
      {
        ...finished,
        content: [
          { type: "reasoning", text: "thinking" },
          { type: "text", text: "Checking." },
          { type: "tool", id: "c1", name: "get_weather", state: { status: "completed", input: { city: "Paris" }, content: [] } },
          { type: "tool", id: "c2", name: "get_weather", state: { status: "streaming", input: '{"ci' } },
        ],
      },
      { type: "user", text: "later" },
    ])
    await expect(port.lastAnswer("ses_1")).resolves.toEqual({
      completed: true,
      finish: "tool-calls",
      tokens: { input: 5, output: 2 },
      parts: [text("Checking."), { type: "tool", id: "c1", name: "get_weather", input: { city: "Paris" } }],
    })
    expect(asked).toEqual([{ sessionID: "ses_1" }])
  })

  test("a message the host has not completed is reported so, with no finish", async () => {
    const { port } = portOver([{ type: "assistant", time: { created: 1 }, content: [{ type: "text", text: "par" }] }])
    await expect(port.lastAnswer("ses_1")).resolves.toEqual({ completed: false, parts: [text("par")] })
  })

  test("a failed step carries its error", async () => {
    const { port } = portOver([{ type: "assistant", time: { created: 1, completed: 2 }, error: { type: "provider.rate-limit" }, content: [] }])
    await expect(port.lastAnswer("ses_1")).resolves.toEqual({ completed: true, error: { type: "provider.rate-limit" }, parts: [] })
  })

  test("no assistant message yet is no answer", async () => {
    await expect(portOver([{ type: "user", text: "hi" }]).port.lastAnswer("ses_1")).resolves.toBeUndefined()
    await expect(portOver([]).port.lastAnswer("ses_1")).resolves.toBeUndefined()
  })
})

describe("#515 RequestCollector.settleFromAnswer", () => {
  function collector(options: { opencodeTools?: string[]; maxToolSteps?: number } = {}) {
    let stops = 0
    const run = new RequestCollector({
      stopTurn: () => void stops++,
      requestID: "req_1",
      callerTools: ["get_weather"],
      toolNames: ["get_weather", ...(options.opencodeTools ?? [])],
      ...(options.opencodeTools ? { opencodeTools: new Set(options.opencodeTools), maxToolSteps: options.maxToolSteps ?? 3, maxToolCalls: 10 } : {}),
    })
    const store = createSessionStore()
    store.register({ sessionID: "ses_1", app: "app", requestID: "req_1", request: plugRequest(), collector: run })
    return { run, store, stops: () => stops }
  }

  test("an unfinished message settles nothing", () => {
    const { run } = collector()
    expect(run.settleFromAnswer(stored({ completed: false, finish: undefined, parts: [text("par")] }))).toBe(false)
    expect(run.terminal).toBe(false)
  })

  test("a completed message with neither a finish nor an error is not final", () => {
    const { run } = collector()
    expect(run.settleFromAnswer(stored({ finish: undefined, parts: [text("x")] }))).toBe(false)
  })

  test("a repeated settle after the request ended changes nothing", async () => {
    const { run } = collector()
    expect(run.settleFromAnswer(stored({ parts: [text("once")] }))).toBe(true)
    expect(run.settleFromAnswer(stored({ parts: [text("once more")] }))).toBe(true)
    expect(await collect(run.events())).toEqual([
      { type: "text-delta", text: "once" },
      { type: "finish", reason: "stop", usage: undefined },
    ])
  })

  test("the text a second step wrote is not cut by the first step's length: ordinals start again in each assistant message", async () => {
    // The first step wrote a long text and ran a server tool. The second step's text arrives only as `text.ended` (its deltas were lost).
    const { run, store } = collector({ opencodeTools: ["lookup"] })
    store.dispatch(bus("ses_1").textDelta("A long first step of text."))
    store.dispatch(bus("ses_1").toolCalled("s1", "lookup", {}))
    store.dispatch(bus("ses_1").stepEnded("tool-calls"))
    store.dispatch(bus("ses_1").textEnded("Done."))
    store.dispatch(bus("ses_1").stepEnded("stop"))
    const events = await collect(run.events())
    expect(events.map((event) => (event.type === "text-delta" ? event.text : event.type))).toEqual(["A long first step of text.", "Done.", "finish"])
  })

  test("a step that ran only server tools is not final, however often it is asked: the host starts the next step and nothing is counted twice", () => {
    const { run } = collector({ opencodeTools: ["lookup"], maxToolSteps: 1 })
    const answer = stored({ finish: "tool-calls", parts: [{ type: "tool", id: "s1", name: "lookup", input: {} }] })
    expect(run.settleFromAnswer(answer)).toBe(false)
    expect(run.settleFromAnswer(answer)).toBe(false)
    expect(run.settleFromAnswer(answer)).toBe(false)
    expect(run.terminal).toBe(false)
  })
})
