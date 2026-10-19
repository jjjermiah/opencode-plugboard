/**
 * #515 A connected event stream that stops delivering events for a session. The collector settles the response on
 * `session.step.ended` and on the execution events (`session.execution.succeeded`, `.failed`, `.interrupted`). These tests
 * pin what the session caller does when those events never arrive while the host has finished the assistant message
 * (a stored transcript the caller never reads: `SessionPort` has no read of messages). They document today's behaviour;
 * they are not a fix.
 */
import { describe, expect, test } from "bun:test"
import type { CallContext, PlugEvent } from "../../src/contract.js"
import { createSessionCaller } from "../../src/session/caller.js"
import { createSessionStore } from "../../src/session/state.js"
import { plugRequest, until } from "../support/fixtures.js"
import { bus, FakeSessionPort, type BusEnvelope } from "../support/session.js"

const SILENCE_MS = 40

function setup() {
  const port = new FakeSessionPort()
  const sessions = createSessionStore()
  const caller = createSessionCaller({ port, sessions, maxTools: 2 })
  // The route's deadline (`requestTimeoutMs`) aborts this signal; the test aborts it by hand.
  const deadline = new AbortController()
  const context: CallContext = { app: "app", signal: deadline.signal }
  const host = (events: (sessionID: string) => BusEnvelope[]) => {
    port.script.prompt = async (input) => {
      queueMicrotask(() => events(input.sessionID).forEach((event) => sessions.dispatch(event)))
    }
  }
  return { port, caller, deadline, context, host }
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

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("#515 the response ends only on a step end or an execution event", () => {
  test("the host finished the message but step.ended and the execution event were lost: nothing settles the request until the deadline aborts it", async () => {
    const run = setup()
    run.host((id) => [bus(id).textDelta("Hi"), bus(id).usage({ input: 4, output: 1 })])
    const call = watch(run.caller.stream(plugRequest(), run.context))
    await until(() => call.seen.length === 1, 1_000, "the text delta")
    await pause(SILENCE_MS)
    // Still waiting: no finish, no error, no read of the stored messages, no interrupt.
    expect(call.state.ended).toBe(false)
    expect(call.seen.map((event) => event.type)).toEqual(["text-delta"])
    expect(run.port.interrupted).toEqual([])
    // The route's deadline is the only thing that ends it, and then without a terminal event.
    run.deadline.abort(new Error("requestTimeoutMs"))
    await call.done
    expect(call.seen.map((event) => event.type)).toEqual(["text-delta"])
  })

  test("a stream that stays connected and delivers nothing at all waits the same way", async () => {
    const run = setup()
    run.host(() => [])
    const call = watch(run.caller.stream(plugRequest(), run.context))
    await until(() => run.port.prompted.length === 1, 1_000, "the prompt")
    await pause(SILENCE_MS)
    expect(call.state.ended).toBe(false)
    expect(call.seen).toEqual([])
    run.deadline.abort(new Error("requestTimeoutMs"))
    await call.done
  })

  test("losing only step.ended is survived: the execution event settles the request", async () => {
    const run = setup()
    run.host((id) => [bus(id).textDelta("Hi"), bus(id).executionSucceeded()])
    const call = watch(run.caller.stream(plugRequest(), run.context))
    await call.done
    expect(call.seen.map((event) => event.type)).toEqual(["text-delta", "finish"])
  })

  test("losing only the execution event is survived: step.ended settles the request", async () => {
    const run = setup()
    run.host((id) => [bus(id).textDelta("Hi"), bus(id).stepEnded("stop")])
    const call = watch(run.caller.stream(plugRequest(), run.context))
    await call.done
    expect(call.seen.map((event) => event.type)).toEqual(["text-delta", "finish"])
  })
})
