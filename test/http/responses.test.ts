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
    const reply = await server!.send(responses({ conversation: "conv_1" }))
    expect(reply.status).toBe(400)
    expect(reply.json().error).toMatchObject({ code: "unsupported_parameter", param: "conversation", message: expect.stringContaining("previous_response_id") })
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
    expect(reply.json()).toMatchObject({
      object: "response",
      status: "completed",
      model: "test/echo",
      store: true,
      output: [{ type: "message", content: [{ type: "output_text", text: "Hello" }] }],
      usage: { total_tokens: 2 },
    })
    expect(logs.of("request")[0]!.fields).toMatchObject({ route: "POST /v1/responses", model: "test/echo", outcome: "ok" })
  })

  test("#442 the envelope echoes the caller's store: true by default, and the value sent otherwise", async () => {
    await route([ev.text("Hello"), ev.finish()])
    expect((await server!.send(responses())).json()).toMatchObject({ store: true })
    expect((await server!.send(responses({ store: true }))).json()).toMatchObject({ store: true })
    expect((await server!.send(responses({ store: false }))).json()).toMatchObject({ store: false })
  })

  test("#442 a streamed answer echoes the caller's store on its created and completed events", async () => {
    await route([ev.text("Hi"), ev.finish()])
    const frames = eventsOf((await server!.send(responses({ stream: true }))).text)
    expect(frames.find((frame) => frame.event === "response.created")!.data.response).toMatchObject({ store: true })
    expect(frames.find((frame) => frame.event === "response.completed")!.data.response).toMatchObject({ store: true })
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
    body: {
      model: "test/echo",
      input: [
        { type: "item_reference", id },
        { role: "user", content: "Again?" },
      ],
    },
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

  test("#426 an answer made with store: false keeps nothing: its items are a 400 item_not_found when referenced", async () => {
    await route([ev.text("Hello"), ev.finish()])
    const first = await server!.send(responses({ store: false }))
    expect(first.status).toBe(200)
    const reply = await server!.send(nextTurn(messageIdOf(first.json().output)))
    expect(reply.status).toBe(400)
    expect(reply.json()).toMatchObject({ error: { code: "item_not_found", param: "input[0].id" } })
  })

  test("#426 a streamed answer made with store: false is not kept either", async () => {
    await route([ev.text("Hello"), ev.finish()])
    const streamed = await server!.send(responses({ store: false, stream: true }))
    const completed = eventsOf(streamed.text).find((event) => event.event === "response.completed")!
    const id = messageIdOf((completed.data as { response: { output: Array<{ id: string; type: string }> } }).response.output)
    expect((await server!.send(nextTurn(id))).status).toBe(400)
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

describe("reasoningOutput (since 0.36.0) on Responses", () => {
  test("a returned rs_ item can be sent back as item_reference: accepted, and its reasoning is not replayed", async () => {
    const caller = await route([ev.reasoning("think"), ev.text("Hi"), ev.finish("stop")], { reasoningOutput: true })
    const first = await server!.send(responses())
    expect(first.status).toBe(200)
    const reasoning = first.json().output.find((item: any) => item.type === "reasoning")
    expect(reasoning.id).toMatch(/^rs_/)
    const second = await server!.send(
      responses({
        input: [
          { type: "item_reference", id: reasoning.id },
          { role: "user", content: "again" },
        ],
      }),
    )
    expect(second.status).toBe(200)
    expect(caller.calls).toHaveLength(2)
    expect(caller.calls[1]!.request.messages).toEqual([{ role: "user", content: [{ type: "text", text: "again" }] }])
  })

  test("apps.<name>.reasoningOutput false drops the reasoning item while the global switch is on", async () => {
    await route([ev.reasoning("think"), ev.text("Hi"), ev.finish("stop")], {
      reasoningOutput: true,
      keys: { quiet: "k-quiet" },
      apps: { quiet: { reasoningOutput: false } },
    })
    const reply = await server!.send({ ...responses(), headers: { authorization: "Bearer k-quiet" } })
    expect(reply.status).toBe(200)
    expect(reply.json().output.map((item: any) => item.type)).toEqual(["message"])
  })
})

describe("#498 Codex CLI: namespace, custom, additional_tools and hosted tools", () => {
  const weather = {
    type: "namespace",
    name: "mcp__weather",
    description: "Tools in the mcp__weather namespace.",
    tools: [{ type: "function", name: "get_weather", description: "Weather", strict: false, parameters: { type: "object", properties: { city: { type: "string" } } } }],
  }
  const exec = { type: "custom", name: "exec", description: "Run code", format: { type: "grammar", syntax: "lark", definition: "start: /.+/" } }
  const toolNames = (caller: FakeModelCaller) => caller.call.request.tools.map((tool) => tool.name)

  test("web_search is left out with x-plugboard-dropped-tools, and the MCP namespace is offered as one prefixed function", async () => {
    const caller = await route([ev.call("call_1", "mcp__weather__get_weather", { city: "Paris" }), ev.finish("tool-calls")])
    const reply = await server!.send(responses({ tools: [{ type: "web_search", external_web_access: false }, weather] }))
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-dropped-tools"]).toBe("web_search")
    expect(toolNames(caller)).toEqual(["mcp__weather__get_weather"])
    // The call comes back in the shape Codex parses: the bare name and the namespace.
    expect(reply.json().output).toEqual([
      { id: expect.stringMatching(/^fc_/), type: "function_call", status: "completed", call_id: "call_1", name: "get_weather", namespace: "mcp__weather", arguments: '{"city":"Paris"}' },
    ])
  })

  test("a stream carries the header and the namespace on the call item", async () => {
    await route([ev.call("call_1", "mcp__weather__get_weather", { city: "Paris" }), ev.finish("tool-calls")])
    const reply = await server!.send(responses({ stream: true, tools: [{ type: "web_search" }, weather] }))
    expect(reply.headers["x-plugboard-dropped-tools"]).toBe("web_search")
    const done = eventsOf(reply.text).find((frame) => frame.event === "response.output_item.done")!
    expect(done.data.item).toMatchObject({ type: "function_call", name: "get_weather", namespace: "mcp__weather" })
  })

  test("without a hosted tool there is no header", async () => {
    await route([ev.text("Hi"), ev.finish()])
    expect((await server!.send(responses({ tools: [weather] }))).headers).not.toHaveProperty("x-plugboard-dropped-tools")
  })

  test("the tool result Codex sends back, with the namespace on the call, reaches the model under the flattened name", async () => {
    const caller = await route([ev.text("It is sunny."), ev.finish()])
    const reply = await server!.send(
      responses({
        tools: [weather],
        input: [
          { type: "message", role: "user", content: [{ type: "input_text", text: "Weather in Paris?" }] },
          { type: "function_call", call_id: "call_1", name: "get_weather", namespace: "mcp__weather", arguments: '{"city":"Paris"}' },
          { type: "function_call_output", call_id: "call_1", output: "sunny" },
        ],
      }),
    )
    expect(reply.status).toBe(200)
    expect(caller.call.request.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"])
    expect(caller.call.request.messages[1]).toMatchObject({ content: [{ type: "tool-call", name: "mcp__weather__get_weather" }] })
  })

  test("a known model slug: the tools come in an additional_tools item, with no tools field, and a custom call round trips", async () => {
    const caller = await route([ev.call("call_1", "exec", { input: "text('hi')" }), ev.finish("tool-calls")])
    const reply = await server!.send(
      responses({
        input: [
          {
            type: "additional_tools",
            id: "at_1",
            role: "developer",
            tools: [{ type: "namespace", name: "functions", description: "", tools: [exec, { type: "function", name: "wait", parameters: { type: "object" } }] }],
          },
          { type: "message", role: "user", content: [{ type: "input_text", text: "run it" }] },
        ],
      }),
    )
    expect(reply.status).toBe(200)
    expect(toolNames(caller)).toEqual(["exec", "wait"])
    expect(reply.json().output).toEqual([{ id: expect.stringMatching(/^ctc_/), type: "custom_tool_call", status: "completed", call_id: "call_1", name: "exec", input: "text('hi')" }])

    const second = await server!.send(
      responses({
        input: [
          { type: "additional_tools", id: "at_1", role: "developer", tools: [{ type: "namespace", name: "functions", description: "", tools: [exec] }] },
          { type: "message", role: "user", content: [{ type: "input_text", text: "run it" }] },
          { type: "custom_tool_call", call_id: "call_1", name: "exec", input: "text('hi')" },
          { type: "custom_tool_call_output", call_id: "call_1", output: "hi" },
        ],
      }),
    )
    expect(second.status).toBe(200)
    expect(caller.calls[1]!.request.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"])
  })

  test("a tool type plugboard cannot take is still a 400 naming the field, and a request with too many flattened tools is too_many_tools", async () => {
    const caller = await route([ev.finish()], { maxTools: 2 })
    const refused = await server!.send(responses({ tools: [{ type: "local_shell" }] }))
    expect(refused.status).toBe(400)
    expect(refused.json().error).toMatchObject({ code: "unsupported_parameter", param: "tools[0].type" })
    const many = await server!.send(responses({ tools: [{ type: "namespace", name: "n", tools: ["a", "b", "c"].map((name) => ({ type: "function", name })) }] }))
    expect(many.json().error).toMatchObject({ code: "too_many_tools" })
    expect(caller.calls).toEqual([])
  })
})
