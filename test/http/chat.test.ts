/**
 * `POST /v1/chat/completions` end to end over loopback HTTP with a scripted model: what the model
 * caller receives, the JSON and SSE answers, the status rules for failures (#38, #49), the
 * deadline and disconnects (#32), and the plugboard response headers.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { RequestAborted } from "../../src/http.js"
import { CATALOG, ev, gate, until } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { sseData, startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
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

const chat = (body: Record<string, unknown> = {}): SendInit => ({
  method: "POST",
  path: "/v1/chat/completions",
  body: { model: "test/echo", messages: [{ role: "user", content: "hi" }], ...body },
})
const streamed = (body: Record<string, unknown> = {}) => chat({ stream: true, ...body })
const requestLine = () => {
  const lines = [...logs.of("request"), ...logs.of("request.failed")]
  expect(lines).toHaveLength(1)
  return lines[0]!.fields
}

describe("what the model caller receives", () => {
  test("the decoded request with the resolved model ref, the app and the request signal", async () => {
    const caller = await route([ev.finish()])
    await server!.send(chat({ messages: [{ role: "system", content: "s" }, { role: "user", content: "hi" }], temperature: 0.3 }))
    const { request, context } = caller.call
    expect(request).toEqual({
      model: "test/echo",
      ref: { providerID: "test", id: "echo" },
      system: ["s"],
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      tools: [],
      generation: { temperature: 0.3 },
    })
    expect(context.app).toBe("default")
    expect(context.signal.aborted).toBe(false)
  })

  test("an alias resolves to its target; the client's string stays the request model", async () => {
    const caller = await route([ev.finish()], { aliases: { fast: "test/echo#low" } })
    const reply = await server!.send(chat({ model: "fast" }))
    expect(caller.call.request).toMatchObject({ model: "fast", ref: { providerID: "test", id: "echo", variant: "low" } })
    expect(reply.json().model).toBe("fast")
    expect(requestLine().model).toBe("test/echo#low")
  })

  test("reasoning_effort picks the variant of that name", async () => {
    const caller = await route([ev.finish()])
    await server!.send(chat({ reasoning_effort: "high" }))
    expect(caller.call.request.ref).toEqual({ providerID: "test", id: "echo", variant: "high" })
  })

  test.each([
    ["an invalid body", { messages: [] }, 400, "invalid_request_error"],
    ["a model that is not allowed", { model: "other/model" }, 404, "not_found_error"],
    ["a model that does not exist", { model: "test/ghost" }, 404, "not_found_error"],
  ])("%s is answered before any model call", async (_name, body, status, type) => {
    const caller = await route([ev.finish()])
    const reply = await server!.send(chat(body))
    expect(reply.status).toBe(status)
    expect(reply.json().error.type).toBe(type)
    expect(caller.calls).toEqual([])
  })

  test("an empty allowlist is a 403 no_models_configured", async () => {
    await route([ev.finish()], { models: [] })
    const reply = await server!.send(chat())
    expect(reply.status).toBe(403)
    expect(reply.json().error.code).toBe("no_models_configured")
  })
})

describe("#202 parallel_tool_calls on Chat Completions", () => {
  test("false reaches the caller and is answered with x-plugboard-parallel-tools: limited; absent carries no header", async () => {
    const caller = await route([ev.finish()])
    const reply = await server!.send(chat({ parallel_tool_calls: false }))
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-parallel-tools"]).toBe("limited")
    expect(caller.call.request.parallelToolCalls).toBe(false)
    expect((await server!.send(chat())).headers).not.toHaveProperty("x-plugboard-parallel-tools")
  })
})

describe("#30 dropped sampling parameters", () => {
  const catalog = [...CATALOG, { providerID: "openai", id: "gpt-5.5", variants: [] }]
  const gpt = (body: Record<string, unknown>) => chat({ model: "openai/gpt-5.5", ...body })

  test("parameters the model rejects are dropped, named in x-plugboard-dropped-params and logged", async () => {
    const caller = new FakeModelCaller([ev.finish()])
    server = await startRoute({ caller, catalog, options: { models: ["openai/*"] } })
    const reply = await server.send(gpt({ temperature: 0.2, top_p: 0.5, max_tokens: 9 }))
    expect(reply.headers["x-plugboard-dropped-params"]).toBe("temperature,top_p")
    expect(caller.call.request.generation).toEqual({ maxTokens: 9 })
    expect(requestLine().dropped).toBe("temperature,top_p")
  })

  test("the header is also set on a stream", async () => {
    server = await startRoute({ caller: new FakeModelCaller([ev.text("x"), ev.finish()]), catalog, options: { models: ["openai/*"] } })
    const stream = await server.open(gpt({ stream: true, temperature: 1 }))
    expect(stream.headers["x-plugboard-dropped-params"]).toBe("temperature")
    await stream.ended
  })

  test("nothing dropped, no header", async () => {
    await route([ev.finish()])
    expect((await server!.send(chat({ temperature: 0.2 }))).headers).not.toHaveProperty("x-plugboard-dropped-params")
  })

  test("dropUnsupportedParams false forwards them as sent", async () => {
    const caller = new FakeModelCaller([ev.finish()])
    server = await startRoute({ caller, catalog, options: { models: ["openai/*"], dropUnsupportedParams: false } })
    const reply = await server.send(gpt({ temperature: 0.2 }))
    expect(reply.headers).not.toHaveProperty("x-plugboard-dropped-params")
    expect(caller.call.request.generation).toEqual({ temperature: 0.2 })
  })
})

describe("x-plugboard-session", () => {
  test("the record id reported before the first event is the header of a JSON answer", async () => {
    await route([{ record: "ses_abc123" }, ev.text("x"), ev.finish()])
    expect((await server!.send(chat())).headers["x-plugboard-session"]).toBe("ses_abc123")
  })

  test("and of a stream", async () => {
    await route([{ record: "ses_abc123" }, ev.text("x"), ev.finish()])
    const stream = await server!.open(streamed())
    expect(stream.headers["x-plugboard-session"]).toBe("ses_abc123")
    await stream.ended
  })

  test("an id with spaces or control characters is not put in a header", async () => {
    await route([{ record: "bad id\r\nx-injected: 1" }, ev.finish()])
    const reply = await server!.send(chat())
    expect(reply.status).toBe(200)
    expect(reply.headers).not.toHaveProperty("x-plugboard-session")
    expect(reply.headers).not.toHaveProperty("x-injected")
  })

  test("an id reported after the headers went out is ignored", async () => {
    await route([ev.text("x"), { record: "ses_late" }, ev.finish()])
    const stream = await server!.open(streamed())
    await stream.ended
    expect(stream.headers).not.toHaveProperty("x-plugboard-session")
  })
})

describe("non-streaming answers", () => {
  test("a text answer is a chat.completion", async () => {
    await route([ev.text("Hello"), ev.finish("stop", { inputTokens: 3, outputTokens: 1 })])
    const reply = await server!.send(chat())
    expect(reply.status).toBe(200)
    expect(reply.json()).toMatchObject({ object: "chat.completion", choices: [{ message: { content: "Hello" }, finish_reason: "stop" }], usage: { total_tokens: 4 } })
    expect(requestLine()).toMatchObject({ status: "200", outcome: "ok" })
  })

  test("a model error keeps its status and wire error", async () => {
    await route([ev.error({ status: 429, kind: "rate_limit", message: "slow down", code: "rate_limited" })])
    const reply = await server!.send(chat())
    expect(reply.status).toBe(429)
    expect(reply.json()).toEqual({ error: { message: "slow down", type: "rate_limit_error", param: null, code: "rate_limited" } })
  })

  test("a caller that throws is a generic 500; the message goes to the log only", async () => {
    await route([{ throw: new Error("secret internals") }])
    const reply = await server!.send(chat())
    expect(reply.status).toBe(500)
    expect(reply.text).not.toContain("secret internals")
    expect(requestLine()).toMatchObject({ outcome: "error", error: "secret internals" })
  })
})

describe("streaming answers", () => {
  test("a text answer streams chunks and ends with [DONE]", async () => {
    await route([ev.text("Hel"), ev.text("lo"), ev.finish()])
    const stream = await server!.open(streamed())
    const text = await stream.ended
    expect(stream.status).toBe(200)
    expect(stream.headers["content-type"]).toBe("text/event-stream; charset=utf-8")
    expect(sseData(text).map((chunk) => chunk.choices[0].delta)).toEqual([{ role: "assistant", content: "" }, { content: "Hel" }, { content: "lo" }, {}])
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true)
    expect(requestLine()).toMatchObject({ status: "200", outcome: "ok" })
  })

  test("#38 a failure before the first output keeps its HTTP status", async () => {
    await route([ev.error({ status: 503, message: "backend down", code: "backend_unavailable" })])
    const reply = await server!.send(streamed())
    expect(reply.status).toBe(503)
    expect(reply.headers["content-type"]).toBe("application/json")
    expect(reply.json().error).toMatchObject({ code: "backend_unavailable", type: "server_error" })
  })

  test("#38 a failure after output is an SSE error frame and [DONE], logged as an error", async () => {
    await route([ev.text("partial"), ev.error({ status: 502, message: "upstream died", code: "upstream" })])
    const stream = await server!.open(streamed())
    const text = await stream.ended
    expect(stream.status).toBe(200)
    expect(sseData(text).at(-1)).toEqual({ error: { message: "upstream died", type: "server_error", param: null, code: "upstream" } })
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true)
    expect(requestLine()).toMatchObject({ status: "200", outcome: "error", error: "upstream" })
  })

  test("#49 reasoning commits the stream before any text, so a later failure is still an error frame", async () => {
    const release = gate()
    await route([ev.reasoning("thinking"), { wait: release.promise }, ev.error({ status: 429, kind: "rate_limit", message: "slow", code: "rate_limited" })])
    const stream = await server!.open(streamed())
    expect(stream.status).toBe(200)
    expect(stream.received).toBe("")
    release.open()
    const text = await stream.ended
    expect(sseData(text)).toEqual([{ error: { message: "slow", type: "rate_limit_error", param: null, code: "rate_limited" } }])
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true)
  })

  test("a stream that ends with nothing is a 500 before any output", async () => {
    await route([])
    const reply = await server!.send(streamed())
    expect(reply.status).toBe(500)
    expect(reply.json().error.message).toBe("Model stream ended without a finish event")
  })

  test("a caller that throws after output ends the stream", async () => {
    await route([ev.text("partial"), { throw: new Error("boom") }])
    const stream = await server!.open(streamed())
    await stream.ended
    expect(stream.status).toBe(200)
    expect(requestLine()).toMatchObject({ outcome: "error", error: "boom" })
  })
})

describe("#32 the request deadline (option requestTimeoutMs)", () => {
  test("a model that never answers is a 504 timeout that closes the connection, and the caller is aborted", async () => {
    const caller = await route(["hang"], { requestTimeoutMs: 20 })
    const reply = await server!.send(chat())
    expect(reply.status).toBe(504)
    expect(reply.headers.connection).toBe("close")
    expect(reply.json().error).toMatchObject({ type: "timeout_error", code: "timeout", message: "Request timed out after 20 ms (option requestTimeoutMs)" })
    expect(((await caller.call.aborted) as RequestAborted).kind).toBe("timeout")
    expect(requestLine()).toMatchObject({ status: "504", outcome: "timeout" })
  })

  test("a stream that times out before output is a 504 too", async () => {
    await route(["hang"], { requestTimeoutMs: 20 })
    expect((await server!.send(streamed())).status).toBe(504)
  })

  test("a stream that times out after output ends with a timeout error frame", async () => {
    const caller = await route([ev.text("partial"), "hang"], { requestTimeoutMs: 20 })
    const stream = await server!.open(streamed())
    const text = await stream.ended
    expect(stream.status).toBe(200)
    expect(sseData(text).at(-1)).toMatchObject({ error: { type: "timeout_error", code: "timeout" } })
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true)
    await until(() => caller.call.closed, 1_000, "the model stream to be closed")
  })
})

describe("client disconnects", () => {
  test("hanging up mid-stream aborts the model call and closes its stream", async () => {
    const caller = await route([ev.text("first"), "hang"])
    const stream = await server!.open(streamed())
    await stream.waitFor((text) => text.includes("first"))
    stream.destroy()
    expect(((await caller.call.aborted) as RequestAborted).kind).toBe("disconnected")
    await until(() => caller.call.closed, 1_000, "the model stream to be closed")
    await until(() => logs.of("request").length === 1, 1_000, "the request log line")
    expect(logs.of("request")[0]!.fields.outcome).toBe("disconnected")
  })

  test("a client that leaves while the catalog loads never reaches the model", async () => {
    const loading = gate<typeof CATALOG>()
    const asked = gate()
    const caller = new FakeModelCaller([ev.finish()])
    server = await startRoute({ caller, catalog: () => (asked.open(), loading.promise) })
    const client = server.raw(chat())
    await asked.promise
    client.destroy()
    await until(() => logs.of("request").length === 1, 1_000, "the request log line")
    loading.open(CATALOG)
    expect(caller.calls).toEqual([])
    expect(logs.of("request")[0]!.fields.outcome).toBe("disconnected")
  })
})

describe("reasoningOutput (since 0.34.0): reasoning on the wire", () => {
  test("JSON: the message carries reasoning_content and reasoning when the option is on", async () => {
    await route([ev.reasoning("hm"), ev.text("Hi"), ev.finish("stop")], { reasoningOutput: true })
    const reply = await server!.send(chat())
    expect(reply.json().choices[0].message).toMatchObject({ content: "Hi", reasoning_content: "hm", reasoning: "hm" })
  })

  test("JSON: the default drops reasoning, the message has no reasoning field", async () => {
    await route([ev.reasoning("hm"), ev.text("Hi"), ev.finish("stop")])
    const reply = await server!.send(chat())
    expect(reply.json().choices[0].message).not.toHaveProperty("reasoning_content")
    expect(reply.json().choices[0].message).not.toHaveProperty("reasoning")
  })

  test("SSE: reasoning comes as deltas under both names before the content", async () => {
    await route([ev.reasoning("hm"), ev.text("Hi"), ev.finish("stop")], { reasoningOutput: true })
    const stream = await server!.open(streamed())
    const text = await stream.ended
    expect(sseData(text).flatMap((frame) => frame.choices?.map((choice: any) => choice.delta) ?? [])).toEqual([
      { role: "assistant", content: "" },
      { reasoning_content: "hm", reasoning: "hm" },
      { content: "Hi" },
      {},
    ])
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true)
  })
})
