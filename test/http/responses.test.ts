/**
 * `POST /v1/responses` over loopback HTTP: it shares origin, auth, body and deadline handling
 * with Chat Completions (src/openai/route.ts) and has its own decode, encode and status rules.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { ev, gate } from "../support/fixtures.js"
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

const responses = (body: Record<string, unknown> = {}): SendInit => ({ method: "POST", path: "/v1/responses", body: { model: "test/echo", input: "hi", ...body } })
const eventsOf = (text: string) => parseSse(text).map((frame) => ({ event: frame.event, data: JSON.parse(frame.data!) }))

describe("POST /v1/responses", () => {
  test("shares the route's auth: a missing key is a 401", async () => {
    const caller = await route([ev.finish()], { keys: { app: "k" } })
    expect((await server!.send(responses())).status).toBe(401)
    expect(caller.calls).toEqual([])
  })

  test("instructions, input and reasoning effort reach the model caller", async () => {
    const caller = await route([ev.finish()])
    await server!.send(responses({ instructions: "be brief", reasoning: { effort: "low" } }))
    expect(caller.call.request).toMatchObject({ system: ["be brief"], ref: { providerID: "test", id: "echo", variant: "low" }, messages: [{ role: "user" }] })
  })

  test("a refused stateful field is a 400 before any model call", async () => {
    const caller = await route([ev.finish()])
    const reply = await server!.send(responses({ previous_response_id: "resp_1" }))
    expect(reply.status).toBe(400)
    expect(reply.json().error).toMatchObject({ code: "unsupported_parameter", param: "previous_response_id" })
    expect(caller.calls).toEqual([])
  })

  test("an unknown model is a 404", async () => {
    await route([ev.finish()])
    expect((await server!.send(responses({ model: "test/ghost" }))).status).toBe(404)
  })

  test("a JSON answer is the response object, with x-plugboard-session", async () => {
    await route([{ record: "ses_1" }, ev.text("Hello"), ev.finish("stop", { inputTokens: 1, outputTokens: 1 })])
    const reply = await server!.send(responses())
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-session"]).toBe("ses_1")
    expect(reply.json()).toMatchObject({ object: "response", status: "completed", model: "test/echo", store: false, output: [{ type: "message", content: [{ type: "output_text", text: "Hello" }] }], usage: { total_tokens: 2 } })
    expect(logs.of("request")[0]!.fields).toMatchObject({ route: "POST /v1/responses", model: "test/echo", outcome: "ok" })
  })

  test("a failure keeps its HTTP status in a JSON answer", async () => {
    await route([ev.text("partial"), ev.error({ status: 429, kind: "rate_limit", message: "slow" })])
    const reply = await server!.send(responses())
    expect(reply.status).toBe(429)
    expect(reply.json().error).toMatchObject({ type: "rate_limit_error", message: "slow" })
  })

  test("a stream sends named events whose name matches the data type", async () => {
    await route([ev.text("Hi"), ev.finish()])
    const stream = await server!.open(responses({ stream: true }))
    const events = eventsOf(await stream.ended)
    expect(stream.status).toBe(200)
    expect(events.every(({ event, data }) => event === data.type)).toBe(true)
    expect(events[0]!.event).toBe("response.created")
    expect(events.at(-1)!.event).toBe("response.completed")
  })

  test("#38 a stream failing before any output keeps its HTTP status", async () => {
    await route([ev.error({ status: 503, message: "down", code: "backend_unavailable" })])
    const reply = await server!.send(responses({ stream: true }))
    expect(reply.status).toBe(503)
    expect(reply.json().error.code).toBe("backend_unavailable")
  })

  test("#38 a stream failing after output ends with response.failed, logged as an error", async () => {
    await route([ev.text("partial"), ev.error({ message: "died", code: "upstream" })])
    const stream = await server!.open(responses({ stream: true }))
    const events = eventsOf(await stream.ended)
    expect(stream.status).toBe(200)
    expect(events.at(-1)).toMatchObject({ event: "response.failed", data: { response: { status: "failed", error: { code: "upstream", message: "died" } } } })
    expect(logs.of("request.failed")[0]!.fields).toMatchObject({ status: "200", outcome: "error", error: "upstream" })
  })

  // Found by this suite: the stream used to end with no event at all, so a client could not tell a failure from an empty answer.
  test("#49 reasoning commits the stream, so a later failure still opens the response and ends with response.failed", async () => {
    const release = gate()
    await route([ev.reasoning("thinking"), { wait: release.promise }, ev.error({ message: "died", code: "upstream" })])
    const stream = await server!.open(responses({ stream: true }))
    expect(stream.status).toBe(200)
    release.open()
    const events = eventsOf(await stream.ended)
    expect(events.map(({ event }) => event)).toEqual(["response.created", "response.in_progress", "response.failed"])
    expect(events.at(-1)!.data.response).toMatchObject({ status: "failed", error: { code: "upstream", message: "died" }, output: [] })
    expect(logs.of("request.failed")[0]!.fields).toMatchObject({ status: "200", outcome: "error", error: "upstream" })
  })

  test("#32 the deadline applies: a model that never answers is a 504", async () => {
    await route(["hang"], { requestTimeoutMs: 20 })
    const reply = await server!.send(responses())
    expect(reply.status).toBe(504)
    expect(reply.json().error.type).toBe("timeout_error")
  })

  test("sampling parameters are forwarded as sent (Responses has no drop table; docs/responses.md)", async () => {
    const caller = await route([ev.finish()])
    const reply = await server!.send(responses({ temperature: 0.5 }))
    expect(reply.headers).not.toHaveProperty("x-plugboard-dropped-params")
    expect(caller.call.request.generation).toEqual({ temperature: 0.5 })
  })
})
