/**
 * #586 The pieces of the exchange record that need no server (`src/record.ts`, `src/record-store.ts`): exact bytes, safe JSON, a
 * trace that does nothing outside a recorded request, and the store's keys.
 */
import { describe, expect, test } from "bun:test"
import { currentRecorder, exactBytes, ExchangeRecorder, jsonSafe, trace, withRecorder } from "../../src/record.js"
import { createRecordStore } from "../../src/record-store.js"
import { FakeStorage } from "../support/usage.js"

describe("#586 exactBytes", () => {
  test("UTF-8 is kept as text and anything else as base64, each exact", () => {
    const text = Buffer.from("héllo 🌍")
    expect(exactBytes(text)).toEqual({ text: "héllo 🌍" })
    const binary = Buffer.from([0x68, 0xff, 0xfe, 0x69])
    expect(exactBytes(binary)).toEqual({ base64: binary.toString("base64") })
    expect(exactBytes(Buffer.alloc(0))).toEqual({ text: "" })
  })
})

describe("#586 jsonSafe", () => {
  test("circular references, bigints, functions and errors become plain JSON", () => {
    const loop: Record<string, unknown> = { id: 1n, fn: function named() {}, err: new Error("boom") }
    loop.self = loop
    expect(jsonSafe(loop)).toEqual({ id: "1", fn: "[function named]", err: { name: "Error", message: "boom" }, self: "[circular]" })
  })

  test("a value that cannot be serialized is its string", () => {
    const hostile = {
      toJSON: () => {
        throw new Error("no")
      },
    }
    expect(jsonSafe(hostile)).toBe("[object Object]")
  })
})

describe("#586 trace", () => {
  test("outside a recorded request it does nothing; inside, it lands in the record", () => {
    expect(currentRecorder()).toBeUndefined()
    trace("breaker", { decision: "skip" })
    const recorder = new ExchangeRecorder({ id: "r1", app: "a", method: "POST", url: new URL("http://x/v1/chat/completions"), headers: {} })
    withRecorder(recorder, () => {
      expect(currentRecorder()).toBe(recorder)
      trace("breaker", { decision: "skip", target: "t" })
      trace("error", { source: "upstream", raw: { a: 1 } })
    })
    const response = { statusCode: 200, getHeaders: () => ({}) } as never
    const record = recorder.finish(response, undefined, "ok")
    expect(record.routing.breaker).toEqual([expect.objectContaining({ decision: "skip", target: "t" })])
    expect(record.errors).toEqual([expect.objectContaining({ source: "upstream", raw: { a: 1 } })])
    expect(record.request.body).toBeNull()
  })
})

describe("#586 the record store", () => {
  test("a record is under its app, a session pointer finds it, and another app finds nothing", async () => {
    const storage = new FakeStorage()
    const store = createRecordStore({ storage })
    await store.save("a", "req1", ["ses_1"], '{"id":"req1"}')
    expect([...storage.values.keys()].sort()).toEqual(["record-session/a/ses_1", "record/a/req1"])
    expect(await store.load("a", "req1")).toBe('{"id":"req1"}')
    expect(await store.load("a", "ses_1")).toBe('{"id":"req1"}')
    expect(await store.load("b", "req1")).toBeUndefined()
    expect(await store.load("b", "ses_1")).toBeUndefined()
    expect(await store.load("a", "../a/req1")).toBeUndefined()
    expect(await store.load("a", "")).toBeUndefined()
  })
})
