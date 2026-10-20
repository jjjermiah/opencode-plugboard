/**
 * A refused call (a rate limit, `PlugError.retryAfterSeconds`) answers `Retry-After` on every route
 * that turns the error into an HTTP status before streaming starts. The limiter's own refusals are
 * the source in production; here the fake caller yields the same error.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { ev } from "../support/fixtures.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const messages = [{ role: "user", content: "hi" }]
const contents = [{ role: "user", parts: [{ text: "hi" }] }]
const refused = () => ev.error({ status: 429, kind: "rate_limit", code: "too_many_requests", message: "Too many concurrent requests", retryAfterSeconds: 1 })

const CASES: ReadonlyArray<readonly [string, SendInit]> = [
  ["chat completions", { method: "POST", path: "/v1/chat/completions", body: { model: "test/echo", messages } }],
  ["chat completions, streamed", { method: "POST", path: "/v1/chat/completions", body: { model: "test/echo", messages, stream: true } }],
  ["chat completions, n=2", { method: "POST", path: "/v1/chat/completions", body: { model: "test/echo", messages, n: 2 } }],
  ["legacy completions", { method: "POST", path: "/v1/completions", body: { model: "test/echo", prompt: "hi" } }],
  ["responses", { method: "POST", path: "/v1/responses", body: { model: "test/echo", input: "hi" } }],
  ["messages", { method: "POST", path: "/v1/messages", body: { model: "test/echo", max_tokens: 64, messages } }],
  ["gemini", { method: "POST", path: "/v1beta/models/test%2Fecho:generateContent", body: { contents } }],
  ["gemini, streamed", { method: "POST", path: "/v1beta/models/test%2Fecho:streamGenerateContent?alt=sse", body: { contents } }],
]

describe("a refused call answers Retry-After before any output", () => {
  test.each(CASES)("%s sends Retry-After: 1 with its 429", async (_name, init) => {
    // `maxChoices` lets the n=2 case through; the other cases send one call either way.
    server = await startRoute({ caller: new FakeModelCaller([refused()]), options: { maxChoices: 2 } })
    const reply = await server.send(init)
    expect(reply.status).toBe(429)
    expect(reply.headers["retry-after"]).toBe("1")
  })

  test("an error without retryAfterSeconds sends no Retry-After", async () => {
    server = await startRoute({ caller: new FakeModelCaller([ev.error({ status: 503, message: "down" })]) })
    const reply = await server.send(CASES[0]![1])
    expect(reply.status).toBe(503)
    expect(reply.headers["retry-after"]).toBeUndefined()
  })
})
