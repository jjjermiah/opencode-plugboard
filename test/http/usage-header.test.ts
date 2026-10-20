/**
 * #52 `x-plugboard-usage` on every non-streaming model response, when usage recording is on: the
 * tokens and cost of the answered calls, summed over the choices of `n`. A stream has no such header.
 */
import { afterEach, describe, expect, test } from "bun:test"
import type { ModelRef, PlugEvent } from "../../src/contract.js"
import { withUsage } from "../../src/usage.js"
import type { UsageRecorder } from "../../src/usage.js"
import { ev } from "../support/fixtures.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

/** A recorder that prices every call at `costUsd` (undefined: unpriced). Only `call` and `price` are used by `withUsage`. */
const recorder = (costUsd: number | undefined): UsageRecorder =>
  ({
    call: () => {},
    price: async (_ref: ModelRef, _tokens: unknown) => costUsd,
  }) as unknown as UsageRecorder

const ANSWER: PlugEvent[] = [ev.text("Hi"), ev.finish("stop", { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40 })]

async function route(costUsd: number | undefined, script: PlugEvent[] = ANSWER, options: Record<string, unknown> = {}) {
  const caller = new FakeModelCaller(script)
  server = await startRoute({ caller: withUsage(caller, recorder(costUsd)), options: { aliases: { fast: "test/echo" }, ...options } })
  return caller
}

const chat = (body: Record<string, unknown> = {}): SendInit => ({ method: "POST", path: "/v1/chat/completions", body: { model: "fast", messages: [{ role: "user", content: "hi" }], ...body } })

describe("#52 x-plugboard-usage", () => {
  test("a JSON answer carries input, output, cache_read and the cost", async () => {
    await route(0.5)
    const reply = await server!.send(chat())
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-usage"]).toBe("input=100; output=20; cache_read=40; cache_write=0; cost_usd=0.500000")
  })

  test("an unpriced model reports the tokens and leaves the cost out", async () => {
    await route(undefined)
    expect((await server!.send(chat())).headers["x-plugboard-usage"]).toBe("input=100; output=20; cache_read=40; cache_write=0")
  })

  test("a streamed answer has no x-plugboard-usage: its headers are sent before the usage is known", async () => {
    await route(0.5)
    const reply = await server!.send(chat({ stream: true }))
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-usage"]).toBeUndefined()
  })

  test("n > 1 sums the choices into one header", async () => {
    await route(0.5, ANSWER, { maxChoices: 2 })
    const reply = await server!.send(chat({ n: 2 }))
    expect(reply.json().choices).toHaveLength(2)
    expect(reply.headers["x-plugboard-usage"]).toBe("input=200; output=40; cache_read=80; cache_write=0; cost_usd=1.000000")
  })

  test("no header when usage recording is off (the caller is not wrapped)", async () => {
    server = await startRoute({ caller: new FakeModelCaller(ANSWER), options: { aliases: { fast: "test/echo" } } })
    expect((await server!.send(chat())).headers["x-plugboard-usage"]).toBeUndefined()
  })

  test.each([
    ["Responses", { method: "POST", path: "/v1/responses", body: { model: "fast", input: "hi" } }],
    ["Messages", { method: "POST", path: "/v1/messages", body: { model: "fast", max_tokens: 10, messages: [{ role: "user", content: "hi" }] } }],
    ["Gemini", { method: "POST", path: "/v1beta/models/fast:generateContent", body: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } }],
    ["legacy completions", { method: "POST", path: "/v1/completions", body: { model: "fast", prompt: "hi" } }],
  ] as Array<[string, SendInit]>)("the %s JSON answer carries the header", async (_name, init) => {
    await route(0.5)
    expect((await server!.send(init)).headers["x-plugboard-usage"]).toBe("input=100; output=20; cache_read=40; cache_write=0; cost_usd=0.500000")
  })
})
