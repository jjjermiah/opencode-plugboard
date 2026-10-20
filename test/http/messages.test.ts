/**
 * #4 `POST /v1/messages` over loopback HTTP: Anthropic's auth headers, error body and event
 * stream, on the same route, deadline and model caller as the OpenAI front-ends.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { CATALOG, ev, gate, model } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { parseSse, startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller, type Script } from "../support/model-caller.js"
import { FakeSessionPort } from "../support/session.js"
import { personaOf } from "../../src/models.js"
import type { PlugError } from "../../src/contract.js"

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
  test("GET is a 405, Anthropic-shaped; count_tokens answers { input_tokens } (#143)", async () => {
    await route([ev.finish()])
    const get = await server!.send({ path: "/v1/messages" })
    expect(get.status).toBe(405)
    expect(get.json()).toEqual(anthropicError("invalid_request_error"))
    const count = await server!.send({ ...messages(), path: "/v1/messages/count_tokens" })
    expect(count.status).toBe(200)
    expect(count.json()).toEqual({ input_tokens: expect.any(Number) })
  })

  test("#201 count_tokens includes the app's system policy, which every request sends", async () => {
    await route([ev.finish()])
    const plain = (await server!.send({ ...messages(), path: "/v1/messages/count_tokens" })).json().input_tokens
    await server!.close()
    await route([ev.finish()], { apps: { default: { system: "P".repeat(400), systemMode: "prepend" } } })
    const withPolicy = (await server!.send({ ...messages(), path: "/v1/messages/count_tokens" })).json().input_tokens
    expect(withPolicy - plain).toBe(80)
  })

  test("#275 a caller's cache_control breakpoint reaches the model call; the request is still answered", async () => {
    const caller = await route([ev.finish()])
    const reply = await server!.send(messages({ messages: [{ role: "user", content: [{ type: "text", text: "context", cache_control: { type: "ephemeral", ttl: "1h" } }] }] }))
    expect(reply.status).toBe(200)
    expect(caller.call.request.messages[0]!.content).toEqual([{ type: "text", text: "context", cache: true, cacheTtl: "1h" }])
  })

  test("#137 an unauthenticated GET is a 401, not a 405, so the path is not revealed", async () => {
    await route([ev.finish()], { keys: { app: "secret" } })
    const reply = await server!.send({ path: "/v1/messages" })
    expect(reply.status).toBe(401)
    expect(reply.json()).toEqual(anthropicError("authentication_error"))
  })

  test("#137 an authenticated GET is still a 405", async () => {
    await route([ev.finish()], { keys: { app: "secret" } })
    const reply = await server!.send({ path: "/v1/messages", headers: { "x-api-key": "secret" } })
    expect(reply.status).toBe(405)
    expect(reply.json()).toEqual(anthropicError("invalid_request_error"))
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

  test("#511 top_k reaches the model call and is not reported when the model takes it", async () => {
    const caller = new FakeModelCaller([ev.finish()])
    server = await startRoute({ caller, catalog: [...CATALOG, { providerID: "anthropic", id: "claude-sonnet-4-5", variants: [] }], options: { models: ["anthropic/*"] } })
    const reply = await server.send(messages({ model: "anthropic/claude-sonnet-4-5", top_k: 5 }))
    expect(reply.headers).not.toHaveProperty("x-plugboard-dropped-params")
    expect(caller.call.request.generation).toEqual({ maxTokens: 64, topK: 5 })
  })

  test("top_k is dropped and reported with the sampling drops when the model refuses it", async () => {
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
    expect(reply.json()).toMatchObject({
      type: "message",
      role: "assistant",
      model: "test/echo",
      content: [{ type: "text", text: "Hi" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 1 },
    })
  })

  test("a model error keeps its status in Anthropic's shape", async () => {
    await route([ev.error({ status: 429, kind: "rate_limit", message: "slow" })])
    const reply = await server!.send(messages())
    expect(reply.status).toBe(429)
    expect(reply.json()).toEqual({ type: "error", error: { type: "rate_limit_error", message: "slow" } })
  })

  test("#204 a provider overload is HTTP 529 with overloaded_error, the status Anthropic clients retry on", async () => {
    await route([ev.error({ status: 503, kind: "server", code: "provider_overloaded", message: "The model provider is overloaded; retry later" })])
    const reply = await server!.send(messages())
    expect(reply.status).toBe(529)
    expect(reply.json()).toEqual({ type: "error", error: { type: "overloaded_error", message: "The model provider is overloaded; retry later" } })
  })

  test("#202 disable_parallel_tool_use is passed to the caller and answered with x-plugboard-parallel-tools: limited", async () => {
    const caller = await route([ev.finish()])
    const tools = [{ name: "read", input_schema: { type: "object" } }]
    const reply = await server!.send(messages({ tools, tool_choice: { type: "auto", disable_parallel_tool_use: true } }))
    expect(reply.headers["x-plugboard-parallel-tools"]).toBe("limited")
    expect(caller.call.request.parallelToolCalls).toBe(false)
    expect((await server!.send(messages({ tools }))).headers).not.toHaveProperty("x-plugboard-parallel-tools")
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

describe("output_config.format (structured outputs)", () => {
  const SCHEMA = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false }
  const format = { format: { type: "json_schema", schema: SCHEMA } }
  const structured = (extra: Record<string, unknown> = {}) => messages({ output_config: format, ...extra })
  const WEATHER = { name: "get_weather", description: "Weather.", input_schema: { type: "object", properties: { city: { type: "string" } } } }

  test("a non-streamed answer is the JSON as a text block with end_turn, and the model call is the forced respond tool", async () => {
    const caller = await route([ev.call("c1", "respond", { answer: "42" }), ev.finish("tool-calls", { inputTokens: 5, outputTokens: 3 })])
    const reply = await server!.send(structured())
    expect(reply.status).toBe(200)
    expect(reply.json()).toMatchObject({ type: "message", content: [{ type: "text", text: '{"answer":"42"}' }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 3 } })
    expect(reply.headers).not.toHaveProperty("x-plugboard-structured-fallback")
    expect(caller.call.request.tools).toEqual([{ name: "respond", description: expect.any(String), parameters: SCHEMA }])
    expect(caller.call.request.toolChoice).toEqual({ type: "tool", name: "respond" })
    expect(caller.call.request.structuredTool).toBe("respond")
  })

  test("a streamed answer is one text_delta of the JSON, then end_turn, with no tool_use block", async () => {
    await route([ev.call("c1", "respond", { answer: "42" }), ev.finish("tool-calls")])
    const events = eventsOf(await (await server!.open(structured({ stream: true }))).ended)
    expect(events.map(({ event }) => event)).toEqual(["message_start", "content_block_start", "ping", "content_block_delta", "content_block_stop", "message_delta", "message_stop"])
    expect(events[1]!.data.content_block).toMatchObject({ type: "text" })
    expect(events[3]!.data.delta).toEqual({ type: "text_delta", text: '{"answer":"42"}' })
    expect(events[5]!.data.delta).toMatchObject({ stop_reason: "end_turn" })
  })

  test("a text answer that is the schema's JSON is taken, and a non-streamed reply says so in x-plugboard-structured-fallback", async () => {
    await route([ev.text('```json\n{"answer":"42"}\n```'), ev.finish("stop")])
    const reply = await server!.send(structured())
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-structured-fallback"]).toBe("text")
    expect(reply.json().content).toMatchObject([{ type: "text", text: '{"answer":"42"}' }])
  })

  test("no respond call and no matching text is a 502 structured_output_missing in Messages' error shape", async () => {
    await route([ev.text("I refuse"), ev.finish("stop")])
    const reply = await server!.send(structured())
    expect(reply.status).toBe(502)
    expect(reply.json()).toEqual({ type: "error", error: { type: "api_error", message: expect.stringContaining("did not return JSON matching the response schema") } })
  })

  test("a streamed turn with no answer is committed by its first event, so it ends as an error event with no content and no message_stop", async () => {
    await route([ev.text("I refuse"), ev.finish("stop")])
    const events = eventsOf(await (await server!.open(structured({ stream: true }))).ended)
    expect(events).toEqual([{ event: "error", data: { type: "error", error: { type: "api_error", message: expect.stringContaining("did not return JSON matching the response schema") } } }])
    expect(logs.of("request.failed")[0]!.fields).toMatchObject({ route: "POST /v1/messages", outcome: "error", error: "structured_output_missing" })
  })

  test("with caller tools offered, a caller tool call is a normal tool_use turn and the model may choose", async () => {
    const caller = await route([ev.call("c1", "get_weather", { city: "Oslo" }), ev.finish("tool-calls")])
    const reply = await server!.send(structured({ tools: [WEATHER] }))
    expect(reply.json()).toMatchObject({ content: [{ type: "tool_use", name: "get_weather", input: { city: "Oslo" } }], stop_reason: "tool_use" })
    expect(caller.call.request.tools.map((tool) => tool.name)).toEqual(["get_weather", "respond"])
    expect(caller.call.request.toolChoice).toBe("required")
  })

  test.each([
    ["a tool named respond", { tools: [{ name: "respond", input_schema: { type: "object" } }] }, /collides with output_config\.format/],
    ["a tool_choice that names a tool", { tools: [WEATHER], tool_choice: { type: "tool", name: "get_weather" } }, /cannot be combined with output_config\.format/],
    ["a format of another type", { output_config: { format: { type: "json_object" } } }, /output_config\.format\.type/],
  ])("%s is a 400 invalid_request_error and never reaches the model", async (_name, extra, message) => {
    const caller = await route([ev.finish()])
    const reply = await server!.send(structured(extra))
    expect(reply.status).toBe(400)
    expect(reply.json()).toEqual({ type: "error", error: { type: "invalid_request_error", message: expect.stringMatching(message) } })
    expect(caller.calls).toEqual([])
  })

  test("count_tokens counts the request the model gets: the same as the equivalent request that declares and names the respond tool", async () => {
    await route([ev.finish()])
    const count = async (init: SendInit) => (await server!.send({ ...init, path: "/v1/messages/count_tokens" })).json().input_tokens as number
    const plain = await count(messages())
    const withFormat = await count(structured())
    const respond = { name: "respond", description: "Give your final answer by calling this tool with JSON matching its schema.", input_schema: SCHEMA }
    expect(withFormat).toBeGreaterThan(plain)
    // The named choice is part of the request the model gets: its steering sentence is counted too.
    expect(withFormat).toBe(await count(messages({ tools: [respond], tool_choice: { type: "tool", name: "respond" } })))
  })
})

describe("#201 count_tokens counts the persona, skill and server tools the session sends", () => {
  /** Starts the route with a session port; the persona lookup reads the options the server parsed. */
  async function countServerWith(options: Record<string, unknown>, port: FakeSessionPort, ensureBackend?: () => Promise<PlugError | undefined>) {
    server = await startRoute({ caller: new FakeModelCaller([ev.finish()]), options, session: { port, persona: (model) => personaOf(server!.options, model), ensureBackend } })
  }
  const countOf = async (model: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => {
    const reply = await server!.send({ ...messages({ model, ...extra }, headers), path: "/v1/messages/count_tokens" })
    return { status: reply.status, body: reply.json() }
  }

  test("a skill alias counts the skill's content, which leads the system prompt", async () => {
    const port = new FakeSessionPort()
    port.skills.set("invoice-parser", "S".repeat(400))
    await countServerWith({ models: ["test/*"], aliases: { "invoice-parser": "skill:invoice-parser@test/echo" } }, port)
    // 21 request + 4 message + (400 skill characters + 2 for "hi") / 5, rounded up
    expect((await countOf("invoice-parser")).body).toEqual({ input_tokens: Math.ceil(21 + 4 + 402 / 5) })
    expect((await countOf("test/echo")).body).toEqual({ input_tokens: Math.ceil(21 + 4 + 2 / 5) })
  })

  test("an agent's prompt replaces the caller's system prompt in the count", async () => {
    const port = new FakeSessionPort()
    port.agents.set("review", { system: "A".repeat(400) })
    await countServerWith({ models: ["test/*"], agents: [{ name: "review", model: "test/echo" }] }, port)
    const system = "C".repeat(800)
    expect((await countOf("agent/review", { system })).body).toEqual({ input_tokens: Math.ceil(21 + 4 + 402 / 5) })
    expect((await countOf("test/echo", { system })).body).toEqual({ input_tokens: Math.ceil(21 + 4 + 802 / 5) })
  })

  test("a skill missing from the app directory is the 404 the request would get", async () => {
    await countServerWith({ models: ["test/*"], aliases: { "invoice-parser": "skill:invoice-parser@test/echo" } }, new FakeSessionPort())
    const reply = await countOf("invoice-parser")
    expect(reply.status).toBe(404)
    expect(reply.body).toMatchObject({ error: { message: "Skill invoice-parser is not available" } })
  })

  test("the app's server tools count with their schemas; tool_choice none leaves them out", async () => {
    const port = new FakeSessionPort()
    port.toolIDs.push("websearch")
    const input = { type: "object", properties: { q: { type: "string" } } }
    port.toolSchemas.set("websearch", { description: "D".repeat(200), input })
    await countServerWith({ keys: { app: "secret" }, apps: { app: { opencodeTools: ["websearch"] } } }, port)
    const headers = { "x-api-key": "secret" }
    // 21 request + 4 message + 534 tool preamble + 40 per tool + (2 for "hi" + name + description + JSON schema characters) / 5
    expect((await countOf("test/echo", {}, headers)).body).toEqual({ input_tokens: Math.ceil(21 + 4 + 534 + 40 + (2 + "websearch".length + 200 + JSON.stringify(input).length) / 5) })
    // tool_choice is kept only with a caller tool (src/anthropic/request.ts). `none` offers no caller tool and no server tool.
    const caller = { name: "lookup", description: "Looks up", input_schema: { type: "object" } }
    expect((await countOf("test/echo", { tools: [caller], tool_choice: { type: "none" } }, headers)).body).toEqual({ input_tokens: Math.ceil(21 + 4 + 2 / 5) })
  })

  test("a named tool choice counts only that caller tool, its steering sentence, and the server tools", async () => {
    const port = new FakeSessionPort()
    port.toolIDs.push("websearch")
    const input = { type: "object", properties: { q: { type: "string" } } }
    port.toolSchemas.set("websearch", { description: "D".repeat(200), input })
    await countServerWith({ keys: { app: "secret" }, apps: { app: { opencodeTools: ["websearch"] } } }, port)
    const lookup = { name: "lookup", description: "Looks up", input_schema: { type: "object" } }
    const fetch = { name: "fetch", description: "Fetches", input_schema: { type: "object" } }
    const steering = "You must respond by calling the `fetch` tool."
    const chars = 2 + steering.length + "fetch".length + "Fetches".length + JSON.stringify(fetch.input_schema).length + "websearch".length + 200 + JSON.stringify(input).length
    // Two tools (fetch and websearch): the preamble and 40 per tool, on top of the characters
    expect((await countOf("test/echo", { tools: [lookup, fetch], tool_choice: { type: "tool", name: "fetch" } }, { "x-api-key": "secret" })).body).toEqual({
      input_tokens: Math.ceil(21 + 4 + 534 + 2 * 40 + chars / 5),
    })
  })

  test("a server tool the location does not offer is the 400 the request would get", async () => {
    await countServerWith({ keys: { app: "secret" }, apps: { app: { opencodeTools: ["websearch"] } } }, new FakeSessionPort())
    const reply = await countOf("test/echo", {}, { "x-api-key": "secret" })
    expect(reply.status).toBe(400)
    expect(reply.body).toMatchObject({ error: { message: expect.stringContaining("websearch") } })
  })

  test("a backend that cannot run the session answers the count with the same refusal as the request", async () => {
    const refused: PlugError = { status: 503, kind: "server", code: "backend_unavailable", message: "Not ready" }
    await countServerWith({ models: ["test/*"], aliases: { "invoice-parser": "skill:invoice-parser@test/echo" } }, new FakeSessionPort(), async () => refused)
    expect((await countOf("invoice-parser")).status).toBe(503)
  })
})

describe("#410 a thinking budget that maps to no variant of the model", () => {
  /** A thinking request for `budget` tokens on a model with `variants`; the caller sees the ref the request runs on. */
  async function thinking(variants: string[], budget: number) {
    const caller = new FakeModelCaller([ev.finish()])
    const catalog = [model("anthropic", "claude-haiku-4-5", { variants })]
    server = await startRoute({ caller, options: { models: ["anthropic/*"] }, catalog })
    const reply = await server!.send(messages({ model: "anthropic/claude-haiku-4-5", max_tokens: 20000, thinking: { type: "enabled", budget_tokens: budget } }))
    return { reply, ref: caller.call.request.ref }
  }

  test("a budget of 1500 on Haiku 4.5 (high and max only) runs on high, with no unavailable header", async () => {
    const { reply, ref } = await thinking(["high", "max"], 1500)
    expect(reply.status).toBe(200)
    expect(ref).toMatchObject({ providerID: "anthropic", id: "claude-haiku-4-5", variant: "high" })
    expect(reply.headers).not.toHaveProperty("x-plugboard-thinking")
  })

  test("a model with no thinking variant runs without thinking and says so in x-plugboard-thinking", async () => {
    const { reply, ref } = await thinking(["fast"], 1500)
    expect(reply.status).toBe(200)
    expect(ref.variant).toBeUndefined()
    expect(reply.headers["x-plugboard-thinking"]).toBe("unavailable")
  })

  test("a request without thinking never gets the header", async () => {
    const caller = new FakeModelCaller([ev.finish()])
    server = await startRoute({ caller, options: { models: ["anthropic/*"] }, catalog: [model("anthropic", "claude-haiku-4-5", { variants: ["fast"] })] })
    const reply = await server!.send(messages({ model: "anthropic/claude-haiku-4-5" }))
    expect(reply.headers).not.toHaveProperty("x-plugboard-thinking")
  })
})
