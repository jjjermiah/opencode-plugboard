/**
 * #4 `POST /v1/messages` over loopback HTTP: Anthropic's auth headers, error body and event
 * stream, on the same route, deadline and model caller as the OpenAI front-ends.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { CATALOG, ev, gate } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { parseSse, startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller, type Script } from "../support/model-caller.js"

const logs = captureLogs()
let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

async function route(script: Script, options: Record<string, unknown> = {}) {
  const caller = new FakeModelCaller(script)
  server = await startRoute({ caller, options })
  return caller
}

const messages = (extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): SendInit => ({
  method: "POST",
  path: "/v1/messages",
  headers,
  body: { model: "test/echo", max_tokens: 64, messages: [{ role: "user", content: "hi" }], ...extra },
})
const eventsOf = (text: string) => parseSse(text).map((frame) => ({ event: frame.event!, data: JSON.parse(frame.data!) }))
const anthropicError = (type: string) => ({ type: "error", error: { type, message: expect.any(String) } })

describe("#4 authentication", () => {
  test.each([
    ["x-api-key (the Anthropic SDKs)", { "x-api-key": "secret" }],
    ["Authorization: Bearer (Claude Code)", { authorization: "Bearer secret" }],
    ["a wrong Bearer next to a right x-api-key", { authorization: "Bearer nope", "x-api-key": "secret" }],
  ])("%s authenticates", async (_name, headers) => {
    const caller = await route([ev.finish()], { keys: { app: "secret" } })
    expect((await server!.send(messages({}, headers))).status).toBe(200)
    expect(caller.call.context.app).toBe("app")
  })

  test("a missing or wrong key is a 401 in Anthropic's error shape", async () => {
    const caller = await route([ev.finish()], { keys: { app: "secret" } })
    for (const headers of [{}, { "x-api-key": "nope" }] as Array<Record<string, string>>) {
      const reply = await server!.send(messages({}, headers))
      expect(reply.status).toBe(401)
      expect(reply.json()).toEqual(anthropicError("authentication_error"))
    }
    expect(caller.calls).toEqual([])
  })

  test("the keyless Origin rule applies, in Anthropic's shape", async () => {
    await route([ev.finish()])
    const reply = await server!.send(messages({}, { origin: "https://example.com" }))
    expect(reply.status).toBe(403)
    expect(reply.json()).toEqual(anthropicError("permission_error"))
  })
})

describe("#4 the route", () => {
  test("GET is a 405; count_tokens is a 404, both Anthropic-shaped", async () => {
    await route([ev.finish()])
    const get = await server!.send({ path: "/v1/messages" })
    expect(get.status).toBe(405)
    expect(get.json()).toEqual(anthropicError("invalid_request_error"))
    const count = await server!.send({ ...messages(), path: "/v1/messages/count_tokens" })
    expect(count.status).toBe(404)
    expect(count.json()).toEqual(anthropicError("not_found_error"))
  })

  test("every response carries Anthropic's request-id and plugboard's request id", async () => {
    await route([ev.finish()])
    const reply = await server!.send(messages())
    expect(reply.headers["request-id"]).toMatch(/^req_[0-9a-f]{32}$/)
    expect(reply.headers["x-plugboard-request-id"]).toMatch(/^[0-9a-f]{12}$/)
  })

  test("an invalid body is a 400 invalid_request_error naming the field", async () => {
    const caller = await route([ev.finish()])
    const reply = await server!.send(messages({ max_tokens: undefined }))
    expect(reply.status).toBe(400)
    expect(reply.json()).toEqual({ type: "error", error: { type: "invalid_request_error", message: "max_tokens: Field required" } })
    expect(caller.calls).toEqual([])
  })

  test("invalid JSON and an unknown model use the same error shape", async () => {
    await route([ev.finish()])
    const bad = await server!.send({ ...messages(), body: "{" })
    expect(bad.status).toBe(400)
    expect(bad.json().type).toBe("error")
    const unknown = await server!.send(messages({ model: "test/ghost" }))
    expect(unknown.status).toBe(404)
    expect(unknown.json()).toEqual(anthropicError("not_found_error"))
  })

  test("top_k is dropped and reported with the sampling drops", async () => {
    const caller = new FakeModelCaller([ev.finish()])
    server = await startRoute({ caller, catalog: [...CATALOG, { providerID: "anthropic", id: "claude-opus-5", variants: [] }], options: { models: ["anthropic/*"] } })
    const reply = await server.send(messages({ model: "anthropic/claude-opus-5", temperature: 0.5, top_k: 5 }))
    expect(reply.headers["x-plugboard-dropped-params"]).toBe("temperature,top_k")
    expect(caller.call.request.generation).toEqual({ maxTokens: 64 })
    expect(logs.of("request")[0]!.fields).toMatchObject({ route: "POST /v1/messages", dropped: "temperature,top_k" })
  })
})

describe("#4 answers", () => {
  test("a JSON answer is an Anthropic message with x-plugboard-session", async () => {
    await route([{ record: "ses_9" }, ev.text("Hi"), ev.finish("stop", { inputTokens: 5, outputTokens: 1 })])
    const reply = await server!.send(messages())
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-session"]).toBe("ses_9")
    expect(reply.json()).toMatchObject({ type: "message", role: "assistant", model: "test/echo", content: [{ type: "text", text: "Hi" }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 1 } })
  })

  test("a model error keeps its status in Anthropic's shape", async () => {
    await route([ev.error({ status: 429, kind: "rate_limit", message: "slow" })])
    const reply = await server!.send(messages())
    expect(reply.status).toBe(429)
    expect(reply.json()).toEqual({ type: "error", error: { type: "rate_limit_error", message: "slow" } })
  })

  test("a stream is Anthropic's named event sequence, with no [DONE]", async () => {
    await route([ev.text("Hi"), ev.call("t1", "read", { p: 1 }), ev.finish()])
    const stream = await server!.open(messages({ stream: true }))
    const text = await stream.ended
    const events = eventsOf(text)
    expect(events.map(({ event }) => event)).toEqual([
      "message_start",
      "content_block_start",
      "ping",
      "content_block_delta",
      "content_block_stop",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ])
    expect(events.every(({ event, data }) => event === data.type)).toBe(true)
    expect(text).not.toContain("[DONE]")
  })

  test("#38 a stream failing before output keeps its HTTP status", async () => {
    await route([ev.error({ status: 503, message: "down" })])
    expect((await server!.send(messages({ stream: true }))).status).toBe(503)
  })

  test("#38 a stream failing after output ends with an error event, logged as an error", async () => {
    await route([ev.text("part"), ev.error({ status: 502, message: "died", code: "upstream" })])
    const stream = await server!.open(messages({ stream: true }))
    const events = eventsOf(await stream.ended)
    expect(events.at(-1)).toEqual({ event: "error", data: { type: "error", error: { type: "api_error", message: "died" } } })
    expect(logs.of("request.failed")[0]!.fields).toMatchObject({ route: "POST /v1/messages", outcome: "error", error: "upstream" })
  })

  test("#49 reasoning commits the stream (even without thinking), so a later failure is still an error event", async () => {
    const release = gate()
    await route([ev.reasoning("x"), { wait: release.promise }, ev.error({ message: "died" })])
    const stream = await server!.open(messages({ stream: true }))
    expect(stream.status).toBe(200)
    release.open()
    expect(eventsOf(await stream.ended)).toEqual([{ event: "error", data: { type: "error", error: { type: "api_error", message: "died" } } }])
  })

  test("#32 the deadline is a 504 timeout_error in Anthropic's shape", async () => {
    await route(["hang"], { requestTimeoutMs: 20 })
    const reply = await server!.send(messages())
    expect(reply.status).toBe(504)
    expect(reply.json()).toEqual(anthropicError("timeout_error"))
    expect(logs.of("request.failed")[0]!.fields).toMatchObject({ status: "504", outcome: "timeout" })
  })

  test("a caller that throws is a generic 500 api_error", async () => {
    await route([{ throw: new Error("internal detail") }])
    const reply = await server!.send(messages())
    expect(reply.status).toBe(500)
    expect(reply.json()).toEqual({ type: "error", error: { type: "api_error", message: "Internal server error" } })
  })
})
