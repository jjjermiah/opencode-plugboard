/**
 * #287 a non-boolean `stream` is a 400 `invalid_request` naming `stream`, on every route that reads it, and
 * the model is never called. Absent and null are not stream requests and keep working.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { ev } from "../support/fixtures.js"
import { startRoute, type RouteServer } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const message = [{ role: "user", content: "reply with exactly: pong" }]
const routes = [
  { name: "chat", path: "/v1/chat/completions", body: (stream: unknown) => ({ model: "test/echo", stream, messages: message }) },
  { name: "responses", path: "/v1/responses", body: (stream: unknown) => ({ model: "test/echo", stream, input: "pong" }) },
  { name: "completions", path: "/v1/completions", body: (stream: unknown) => ({ model: "test/echo", stream, prompt: "pong" }) },
  { name: "messages", path: "/v1/messages", body: (stream: unknown) => ({ model: "test/echo", stream, max_tokens: 8, messages: message }) },
]
const values = ["yes", "true", 1, 0, {}, []]

describe("#287 a non-boolean stream is refused, on every route", () => {
  test.each(routes.flatMap((route) => values.map((value) => [route.name, route, value] as const)))("#287 %s with stream %j is a 400", async (_name, route, value) => {
    const caller = new FakeModelCaller(() => [ev.text("pong"), ev.finish()])
    server = await startRoute({ caller })
    const reply = await server.send({ method: "POST", path: route.path, body: route.body(value) })
    expect(reply.status).toBe(400)
    const error = reply.json().error ?? reply.json()
    expect(error.type).toBe("invalid_request_error")
    expect(error.message).toMatch(/stream:? must be a boolean/)
    // Anthropic's error body has no `param`; the message names the field there.
    if (route.name !== "messages") expect(error.param).toBe("stream")
    expect(caller.calls).toHaveLength(0)
  })

  test.each(routes.flatMap((route) => [null, undefined, false, true].map((value) => [route.name, route, value] as const)))("#287 %s with stream %j is accepted", async (_name, route, value) => {
    const caller = new FakeModelCaller(() => [ev.text("pong"), ev.finish()])
    server = await startRoute({ caller })
    const reply = await server.send({ method: "POST", path: route.path, body: route.body(value) })
    expect(reply.status).toBe(200)
    expect(caller.calls).toHaveLength(1)
  })
})
