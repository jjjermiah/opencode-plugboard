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

describe("#147 item_reference resolves to an output item of a recent answer", () => {
  /** The next turn: the earlier answer by reference (store: true, the AI SDK default), then the user's message. */
  const nextTurn = (id: string, headers: Record<string, string> = {}): SendInit => ({
    method: "POST",
    path: "/v1/responses",
    headers,
    body: { model: "test/echo", input: [{ type: "item_reference", id }, { role: "user", content: "Again?" }] },
  })
  const messageIdOf = (output: Array<{ id: string; type: string }>) => output.find((item) => item.type === "message")!.id

  test("a referenced message of a JSON answer is replayed as the assistant turn it was", async () => {
    const caller = await route([ev.text("Hello"), ev.finish()])
    const first = await server!.send(responses())
    const id = messageIdOf(first.json().output)
    const second = await server!.send(nextTurn(id))
    expect(second.status).toBe(200)
    expect(caller.calls[1]!.request.messages[0]).toEqual({ role: "assistant", content: [{ type: "text", text: "Hello" }] })
  })

  test("a referenced message of a streamed answer is kept too", async () => {
    await route([ev.text("Hello"), ev.finish()])
    const streamed = await server!.send(responses({ stream: true }))
    const completed = eventsOf(streamed.text).find((event) => event.event === "response.completed")!
    const id = messageIdOf((completed.data as { response: { output: Array<{ id: string; type: string }> } }).response.output)
    expect((await server!.send(nextTurn(id))).status).toBe(200)
  })

  test("an id the store does not hold is a 400 that suggests store: false", async () => {
    await route([ev.text("Hello"), ev.finish()])
    const reply = await server!.send(nextTurn("msg_never_returned"))
    expect(reply.status).toBe(400)
    expect(reply.json()).toMatchObject({ error: { code: "item_not_found", param: "input[0].id", message: expect.stringContaining("store: false") } })
  })

  test("an app reads only the items its own answers returned: another app's id is a 400", async () => {
    await route([ev.text("Hello"), ev.finish()], { keys: { alpha: "key-alpha", beta: "key-beta" } })
    const id = messageIdOf((await server!.send({ ...responses(), headers: { authorization: "Bearer key-alpha" } })).json().output)
    expect((await server!.send(nextTurn(id, { authorization: "Bearer key-alpha" }))).status).toBe(200)
    expect((await server!.send(nextTurn(id, { authorization: "Bearer key-beta" }))).status).toBe(400)
  })
})

describe("#173 POST /v1/responses structured output", () => {
  const schema = { type: "object", required: ["a"], properties: { a: { type: "number" } } }
  const format = { text: { format: { type: "json_schema", name: "a", schema } } }

  test("a text answer that matches the schema is the message text, with x-plugboard-structured-fallback: text", async () => {
    await route([ev.text('{"a":3}'), ev.finish("stop")])
    const reply = await server!.send(responses(format))
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-structured-fallback"]).toBe("text")
    expect(reply.json()).toMatchObject({ status: "completed", output: [{ content: [{ text: '{"a":3}' }] }] })
  })

  test("a respond call is answered without the header", async () => {
    await route([ev.call("c1", "respond", { a: 3 }), ev.finish("tool-calls")])
    const reply = await server!.send(responses(format))
    expect(reply.headers["x-plugboard-structured-fallback"]).toBeUndefined()
    expect(reply.json().output[0].content[0].text).toBe('{"a":3}')
  })

  test("a length finish with no answer is a 502 structured_output_missing, not an incomplete response", async () => {
    await route([ev.finish("length")])
    const reply = await server!.send(responses(format))
    expect(reply.status).toBe(502)
    expect(reply.json().error.code).toBe("structured_output_missing")
  })

  test("a streamed text answer that matches the schema completes with the text and no error", async () => {
    await route([ev.text('{"a":3}'), ev.finish("stop")])
    const stream = await server!.open(responses({ ...format, stream: true }))
    const types = eventsOf(await stream.ended).map((event) => event.event)
    expect(types.at(-1)).toBe("response.completed")
    expect(types).not.toContain("response.failed")
  })

  test("a streamed prose answer that is not the schema ends as response.failed, after the commit", async () => {
    await route([ev.text("prose"), ev.finish("stop")])
    const stream = await server!.open(responses({ ...format, stream: true }))
    const frames = eventsOf(await stream.ended)
    expect(frames.at(-1)).toMatchObject({ event: "response.failed", data: { response: { error: { code: "structured_output_missing" } } } })
  })
})
