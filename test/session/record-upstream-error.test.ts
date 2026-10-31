/**
 * #586 The host's own error reaches the exchange record whole, before the session caller maps it to a caller-safe one: the collector hands it
 * to the hook the caller binds to the request's recorder (events arrive from the event pump, outside the request's async context).
 */
import { describe, expect, test } from "bun:test"
import type { CallContext, PlugEvent } from "../../src/contract.js"
import { ExchangeRecorder, withRecorder } from "../../src/record.js"
import { createSessionCaller } from "../../src/session/caller.js"
import { RequestCollector } from "../../src/session/events.js"
import { createSessionStore } from "../../src/session/state.js"
import { collect, plugRequest } from "../support/fixtures.js"
import { bus, FakeSessionPort } from "../support/session.js"

const RAW = { type: "provider.unavailable", status: 503, message: "upstream says: model overloaded, try again", url: "https://api.example.test/v1/chat" }

describe("#586 the collector's upstream error hook", () => {
  test("a failed step hands over the raw host error, and a scheduled retry its raw error and attempt", async () => {
    const seen: Array<[string, unknown]> = []
    const collector = new RequestCollector({ stopTurn: () => {}, requestID: "r", callerTools: [], onUpstreamError: (kind, raw) => void seen.push([kind, raw]) })
    const store = createSessionStore()
    store.register({ sessionID: "ses_1", app: "app", requestID: "r", request: plugRequest(), collector })
    const host = bus("ses_1")
    store.dispatch(host.stepFailed(RAW))
    expect(seen).toEqual([["failed", RAW]])
    const events = await collect(collector.events())
    // The caller gets the safe mapping, not the host's text.
    expect(JSON.stringify(events)).not.toContain("model overloaded")
  })
})

describe("#586 the session caller binds the recorder of its request", () => {
  test("a host failure lands in the record as the host sent it, and the caller still gets the safe error", async () => {
    const port = new FakeSessionPort()
    const sessions = createSessionStore()
    const caller = createSessionCaller({ port, sessions, maxTools: 2 })
    port.script.prompt = async (input) => {
      queueMicrotask(() => sessions.dispatch(bus(input.sessionID).stepFailed(RAW)))
    }
    const recorder = new ExchangeRecorder({ id: "req1", app: "app", method: "POST", url: new URL("http://x/v1/chat/completions"), headers: {} })
    const context: CallContext = { app: "app", signal: new AbortController().signal }
    const events: PlugEvent[] = []
    await withRecorder(recorder, async () => {
      for await (const event of caller.stream(plugRequest(), context)) events.push(event)
    })
    const record = recorder.finish({ statusCode: 502, getHeaders: () => ({}) } as never, undefined, "status_502")
    expect(record.errors).toContainEqual(expect.objectContaining({ source: "upstream", kind: "failed", session: "ses_1", raw: RAW }))
    expect(events.at(-1)).toMatchObject({ type: "error" })
    expect(JSON.stringify(events)).not.toContain("model overloaded")
  })
})
