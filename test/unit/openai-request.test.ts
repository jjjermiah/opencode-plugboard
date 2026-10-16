import { describe, expect, test } from "bun:test"
import { isPlugError } from "../../src/contract.js"
import { parseChatRequest, type ParsedChat } from "../../src/openai/request.js"
import { testOptions } from "../support/fixtures.js"

const options = testOptions({ maxTools: 3 })

// #390 review: a client value with no usable toString is a 400, never a thrown TypeError (show, src/client-value.ts).
test("openai: a message role with a null toString is a 400, not a crash", () => {
  const result = parseChatRequest({ model: "test/echo", messages: [{ role: { toString: null }, content: "hi" }] }, options)
  expect(isPlugError(result)).toBe(true)
  expect(result).toMatchObject({ status: 400, message: expect.stringContaining('"object"') })
})
const user = (content: unknown = "hi") => ({ role: "user", content })
const body = (extra: Record<string, unknown> = {}) => ({ model: "test/echo", messages: [user()], ...extra })
const fn = (name: string, extra: Record<string, unknown> = {}) => ({ type: "function", function: { name, ...extra } })
const call = (id: string, name: string, args: unknown = "{}") => ({ id, type: "function", function: { name, arguments: args } })

function parse(raw: unknown): ParsedChat {
  const parsed = parseChatRequest(raw, options)
  if (isPlugError(parsed)) throw new Error(`unexpected rejection: ${parsed.message} (${parsed.param})`)
  return parsed
}

describe("parseChatRequest: every validation rule answers 400 with its param", () => {
  const rejections: Array<[string, unknown, { param?: string; code?: string }]> = [
    ["a body that is not an object", [], {}],
    ["a missing model", { messages: [user()] }, { param: "model" }],
    ["an empty model", body({ model: "" }), { param: "model" }],
    ["missing messages", { model: "m" }, { param: "messages" }],
    ["empty messages", body({ messages: [] }), { param: "messages" }],
    ["n = 0", body({ n: 0 }), { param: "n" }],
    ["#58 n above maxN (default 1)", body({ n: 2 }), { param: "n", code: "too_many_choices" }],
    ["a fractional n", body({ n: 1.5 }), { param: "n" }],
    ["#287 a string stream", body({ stream: "yes" }), { param: "stream" }],
    ["#287 a numeric stream", body({ stream: 1 }), { param: "stream" }],
    ["logprobs", body({ logprobs: true }), { param: "logprobs", code: "unsupported_parameter" }],
    ["top_logprobs", body({ top_logprobs: 2 }), { param: "top_logprobs", code: "unsupported_parameter" }],
    ["a message that is not an object", body({ messages: ["hi"] }), { param: "messages[0]" }],
    ["an unknown role", body({ messages: [{ role: "function", content: "x" }] }), { param: "messages[0].role" }],
    ["system content that is not text", body({ messages: [{ role: "system", content: 5 }, user()] }), { param: "messages[0].content" }],
    ["user content that is not a string or parts", body({ messages: [user(5)] }), { param: "messages[0].content" }],
    ["a user part that is not an object", body({ messages: [user(["x"])] }), { param: "messages[0].content[0]" }],
    ["an unsupported user part type", body({ messages: [user([{ type: "input_audio" }])] }), { param: "messages[0].content[0].type", code: "unsupported_parameter" }],
    ["assistant content that is not text", body({ messages: [user(), { role: "assistant", content: 5 }] }), { param: "messages[1].content" }],
    ["tool_calls that are not an array", body({ messages: [user(), { role: "assistant", tool_calls: {} }] }), { param: "messages[1].tool_calls" }],
    ["a tool call without a function name", body({ messages: [user(), { role: "assistant", tool_calls: [{ id: "c1", function: {} }] }] }), { param: "messages[1].tool_calls[0]" }],
    ["a tool call with an empty id", body({ messages: [user(), { role: "assistant", tool_calls: [call("", "f")] }] }), { param: "messages[1].tool_calls[0].id" }],
    ["a tool message without tool_call_id", body({ messages: [user(), { role: "tool", content: "r" }] }), { param: "messages[1]" }],
    ["a tool message answering an unknown call", body({ messages: [user(), { role: "tool", tool_call_id: "nope", content: "r" }] }), { param: "messages[1].tool_call_id" }],
    ["tools that are not an array", body({ tools: {} }), { param: "tools" }],
    ["a tool that is not a function tool", body({ tools: [{ type: "code_interpreter" }] }), { param: "tools[0]" }],
    ["a duplicate tool name", body({ tools: [fn("a"), fn("a")] }), { param: "tools[1].function.name" }],
    ["a tool description that is not a string", body({ tools: [fn("a", { description: 1 })] }), { param: "tools[0].function.description" }],
    ["tool parameters that are not an object", body({ tools: [fn("a", { parameters: [] })] }), { param: "tools[0].function.parameters" }],
    ["more tools than maxTools", body({ tools: [fn("a"), fn("b"), fn("c"), fn("d")] }), { param: "tools", code: "too_many_tools" }],
    ["an unsupported tool_choice", body({ tool_choice: "any" }), { param: "tool_choice" }],
    ["a tool_choice naming a tool not in tools", body({ tools: [fn("a")], tool_choice: { type: "function", function: { name: "b" } } }), { param: "tool_choice.function.name" }],
    ["a response_format that is not an object", body({ response_format: "json" }), { param: "response_format" }],
    ["an unsupported response_format type", body({ response_format: { type: "yaml" } }), { param: "response_format.type" }],
    ["json_schema without json_schema", body({ response_format: { type: "json_schema" } }), { param: "response_format.json_schema" }],
    ["json_schema with a non-string name", body({ response_format: { type: "json_schema", json_schema: { name: 1, schema: {} } } }), { param: "response_format.json_schema.name" }],
    ["json_schema with a non-string description", body({ response_format: { type: "json_schema", json_schema: { description: 1, schema: {} } } }), { param: "response_format.json_schema.description" }],
    ["json_schema without a schema object", body({ response_format: { type: "json_schema", json_schema: { name: "x" } } }), { param: "response_format.json_schema.schema" }],
    ["json_schema next to a tool named respond", body({ tools: [fn("respond")], response_format: { type: "json_schema", json_schema: { schema: {} } } }), { param: "tools", code: "reserved_tool_name" }],
    ["json_schema with a tool_choice naming a tool", body({ tools: [fn("a")], tool_choice: { type: "function", function: { name: "a" } }, response_format: { type: "json_schema", json_schema: { schema: {} } } }), { param: "tool_choice", code: "unsupported_parameter" }],
    ["temperature above 2", body({ temperature: 2.1 }), { param: "temperature" }],
    ["a string temperature", body({ temperature: "1" }), { param: "temperature" }],
    ["top_p above 1", body({ top_p: 1.5 }), { param: "top_p" }],
    ["presence_penalty below -2", body({ presence_penalty: -3 }), { param: "presence_penalty" }],
    ["frequency_penalty above 2", body({ frequency_penalty: 3 }), { param: "frequency_penalty" }],
    ["max_tokens of 0", body({ max_tokens: 0 }), { param: "max_tokens" }],
    ["a fractional max_completion_tokens", body({ max_completion_tokens: 1.5 }), { param: "max_completion_tokens" }],
    ["a stop that is not strings", body({ stop: [1] }), { param: "stop" }],
    ["five stop sequences", body({ stop: ["a", "b", "c", "d", "e"] }), { param: "stop" }],
  ]
  test.each(rejections)("rejects %s", (_name, raw, expected) => {
    const parsed = parseChatRequest(raw, options)
    expect(parsed).toMatchObject({ status: 400, kind: "invalid_request", ...expected })
    if (expected.param === undefined) expect(parsed).not.toHaveProperty("param")
    if (expected.code === undefined) expect(parsed).not.toHaveProperty("code")
  })
})

describe("parseChatRequest: messages", () => {
  test("system and developer messages become the system list; empty ones are dropped", () => {
    const { request } = parse(body({ messages: [{ role: "system", content: "be brief" }, { role: "developer", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }, { role: "system", content: "" }, user()] }))
    expect(request.system).toEqual(["be brief", "a\nb"])
  })

  test("user parts: text and image_url (data URL media type kept)", () => {
    const { request } = parse(
      body({
        messages: [
          user([
            { type: "text", text: "look" },
            { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" } },
            { type: "image_url", image_url: { url: "https://example.com/a.jpg" } },
          ]),
        ],
      }),
    )
    expect(request.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "media", url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", mediaType: "image/png" },
          { type: "media", url: "https://example.com/a.jpg" },
        ],
      },
    ])
  })

  test("#288 a file part keeps a PDF data URL and refuses bare base64 or another type as invalid_file", () => {
    const pdf = "data:application/pdf;base64,JVBERi0xLjQK"
    expect(parse(body({ messages: [user([{ type: "file", file: { file_data: pdf } }])] })).request.messages[0]!.content).toEqual([{ type: "media", url: pdf, mediaType: "application/pdf" }])
    expect(parseChatRequest(body({ messages: [user([{ type: "file", file: { file_data: "JVBERi0xLjQK" } }])] }), options)).toMatchObject({ status: 400, code: "invalid_file", param: "messages[0].content[0].file.file_data" })
    expect(parseChatRequest(body({ messages: [user([{ type: "file", file: { file_data: "data:text/plain;base64,JVBERi0xLjQK" } }])] }), options)).toMatchObject({ status: 400, code: "invalid_file" })
  })

  test("an assistant tool turn and its result: arguments parsed, result named after the call", () => {
    const { request } = parse(
      body({
        messages: [
          user(),
          { role: "assistant", content: [{ type: "text", text: "let me check" }, { type: "refusal", refusal: "no" }], tool_calls: [call("c1", "lookup", '{"q":1}'), call("c2", "lookup", "not json")] },
          { role: "tool", tool_call_id: "c1", content: "one" },
          { role: "tool", tool_call_id: "c2", content: [{ type: "text", text: "two" }] },
        ],
      }),
    )
    expect(request.messages.slice(1)).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "let me check" },
          { type: "tool-call", id: "c1", name: "lookup", input: { q: 1 } },
          { type: "tool-call", id: "c2", name: "lookup", input: "not json" },
        ],
      },
      { role: "tool", content: [{ type: "tool-result", id: "c1", name: "lookup", result: "one" }] },
      { role: "tool", content: [{ type: "tool-result", id: "c2", name: "lookup", result: "two" }] },
    ])
  })

  test("an assistant message with null content and no calls is dropped", () => {
    expect(parse(body({ messages: [user(), { role: "assistant", content: null }, user("again")] })).request.messages).toHaveLength(2)
  })
})

describe("#202 parallel_tool_calls", () => {
  test("false asks for one tool call per answer; true and absent do not", () => {
    expect(parse(body({ parallel_tool_calls: false })).request.parallelToolCalls).toBe(false)
    expect(parse(body({ parallel_tool_calls: true })).request).not.toHaveProperty("parallelToolCalls")
    expect(parse(body()).request).not.toHaveProperty("parallelToolCalls")
  })

  test("a non-boolean is a 400 naming the field", () => {
    expect(parseChatRequest(body({ parallel_tool_calls: "no" }), options)).toMatchObject({ status: 400, param: "parallel_tool_calls" })
  })
})

describe("parseChatRequest: tools and tool_choice", () => {
  test("a tool without parameters gets an empty object schema and description", () => {
    expect(parse(body({ tools: [fn("ping")] })).request.tools).toEqual([{ name: "ping", description: "", parameters: { type: "object", properties: {} } }])
  })

  test.each([
    ["auto", "auto"],
    ["none", "none"],
    ["required", "required"],
  ])("tool_choice %p passes through with tools", (choice, expected) => {
    expect(parse(body({ tools: [fn("a")], tool_choice: choice })).request.toolChoice).toBe(expected as never)
  })

  test("a named tool_choice becomes { type: tool, name }", () => {
    expect(parse(body({ tools: [fn("a")], tool_choice: { type: "function", function: { name: "a" } } })).request.toolChoice).toEqual({ type: "tool", name: "a" })
  })

  test("#421 tool_choice none without tools is kept, so the session offers no server tool", () => {
    expect(parse(body({ tool_choice: "none" })).request.toolChoice).toBe("none")
  })

  test("tool_choice without tools is left out", () => {
    expect(parse(body({ tool_choice: "required" })).request).not.toHaveProperty("toolChoice")
  })
})

describe("parseChatRequest: structured output", () => {
  const schema = { type: "object", properties: { answer: { type: "string" } } }
  const jsonSchema = { type: "json_schema", json_schema: { name: "out", description: "The answer.", schema } }

  test("json_schema alone forces the respond tool", () => {
    const parsed = parse(body({ response_format: jsonSchema }))
    expect(parsed.request.tools).toEqual([{ name: "respond", description: "Give your final answer by calling this tool with JSON matching its schema. The answer.", parameters: schema }])
    expect(parsed.request.toolChoice).toEqual({ type: "tool", name: "respond" })
    // The request carries the structured tool's name, so `tools: false` keeps respond (#252).
    expect(parsed.request.structuredTool).toBe("respond")
    expect(parsed.exchange).toMatchObject({ structuredTool: "respond" })
    expect(parsed.exchange).not.toHaveProperty("callerTools")
  })

  test("json_schema with caller tools offers both and requires a call", () => {
    const parsed = parse(body({ tools: [fn("search")], response_format: jsonSchema }))
    expect(parsed.request.tools.map((tool) => tool.name)).toEqual(["search", "respond"])
    expect(parsed.request.toolChoice).toBe("required")
    expect(parsed.exchange).toMatchObject({ structuredTool: "respond", callerTools: true })
  })

  test("json_schema with tool_choice none leaves only respond", () => {
    const parsed = parse(body({ tools: [fn("search")], tool_choice: "none", response_format: jsonSchema }))
    expect(parsed.request.tools.map((tool) => tool.name)).toEqual(["respond"])
    expect(parsed.request.toolChoice).toEqual({ type: "tool", name: "respond" })
  })

  test("the respond tool counts against maxTools", () => {
    expect(parseChatRequest(body({ tools: [fn("a"), fn("b"), fn("c")], response_format: jsonSchema }), options)).toMatchObject({ code: "too_many_tools", message: expect.stringContaining("4 tools") })
  })

  test("json_object adds a system instruction and marks the exchange for unfencing", () => {
    const parsed = parse(body({ messages: [{ role: "system", content: "s" }, user()], response_format: { type: "json_object" } }))
    expect(parsed.request.system).toEqual(["s", "Respond with a single valid JSON object only."])
    expect(parsed.request.tools).toEqual([])
    expect(parsed.exchange.jsonObject).toBe(true)
  })

  test("response_format text changes nothing", () => {
    expect(parse(body({ response_format: { type: "text" } }))).toEqual(parse(body()))
  })
})

describe("parseChatRequest: generation and exchange", () => {
  test("sampling parameters map to the neutral names", () => {
    expect(parse(body({ temperature: 0, top_p: 1, presence_penalty: -2, frequency_penalty: 2, max_tokens: 5, stop: "END" })).request.generation).toEqual({
      temperature: 0,
      topP: 1,
      presencePenalty: -2,
      frequencyPenalty: 2,
      maxTokens: 5,
      stop: ["END"],
    })
  })

  test("max_completion_tokens wins over the deprecated max_tokens", () => {
    expect(parse(body({ max_tokens: 5, max_completion_tokens: 9 })).request.generation.maxTokens).toBe(9)
  })

  test("null parameters are treated as absent", () => {
    expect(parse(body({ temperature: null, stop: null, n: null, tools: null })).request.generation).toEqual({})
  })

  test("the exchange carries the client's model string, stream and include_usage", () => {
    expect(parse(body({ stream: true, stream_options: { include_usage: true } })).exchange).toEqual({ model: "test/echo", stream: true, includeUsage: true })
    expect(parse(body({ stream: null })).exchange).toEqual({ model: "test/echo", stream: false, includeUsage: false })
    expect(parse(body({ stream: false })).exchange).toEqual({ model: "test/echo", stream: false, includeUsage: false })
  })

  test("reasoning_effort is passed on for variant selection", () => {
    expect(parse(body({ reasoning_effort: "high" })).reasoningEffort).toBe("high")
    expect(parse(body())).not.toHaveProperty("reasoningEffort")
  })
})

describe("reasoningOutput (since 0.36.0): reasoning in a replayed history", () => {
  test("an assistant message's reasoning_content and reasoning (a client replaying a reply) are ignored, not rejected", () => {
    const parsed = parse(body({ messages: [user(), { role: "assistant", content: "A", reasoning_content: "r", reasoning: "r" }, user("again")] }))
    expect(JSON.stringify(parsed.request.messages)).not.toContain('"r"')
    expect(JSON.stringify(parsed.request.messages)).toContain('"A"')
  })
})
