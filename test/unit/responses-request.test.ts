import { describe, expect, test } from "bun:test"
import { isPlugError } from "../../src/contract.js"
import { parseResponsesRequest, type ParsedResponses } from "../../src/responses/request.js"
import { testOptions } from "../support/fixtures.js"

const options = testOptions({ maxTools: 2 })
const body = (extra: Record<string, unknown> = {}) => ({ model: "test/echo", input: "hi", ...extra })
const fn = (name: string, extra: Record<string, unknown> = {}) => ({ type: "function", name, ...extra })
const message = (role: string, content: unknown) => ({ type: "message", role, content })
const fnCall = (call_id: string, name: string, args: unknown = "{}") => ({ type: "function_call", call_id, name, arguments: args })
const fnOutput = (call_id: string, output: unknown) => ({ type: "function_call_output", call_id, output })

describe("a client value that cannot be turned into a string is a 400, not a crash (property test counterexample)", () => {
  test("an input item whose role is an object with a null toString is refused as a 400 (not a TypeError)", () => {
    const result = parseResponsesRequest(body({ input: [{ type: "message", role: { toString: null }, content: [] }] }), options)
    expect(isPlugError(result)).toBe(true)
    expect(result).toMatchObject({ status: 400 })
  })

  test("an unsupported input item type that is an object is named as an object", () => {
    const result = parseResponsesRequest(body({ input: [{ type: { toString: null } }] }), options)
    expect(result).toMatchObject({ status: 400, message: 'Unsupported input item type "object"' })
  })
})

describe("#421 tool_choice none without tools", () => {
  test("is kept as the neutral none, so the session offers no server tool", () => {
    expect(parse(body({ tool_choice: "none" })).request.toolChoice).toBe("none")
  })
})

describe("#202 parallel_tool_calls", () => {
  test("false asks for one tool call per answer; true and absent do not", () => {
    expect(parse(body({ parallel_tool_calls: false })).request.parallelToolCalls).toBe(false)
    expect(parse(body({ parallel_tool_calls: true })).request).not.toHaveProperty("parallelToolCalls")
    expect(parse(body()).request).not.toHaveProperty("parallelToolCalls")
  })
})

function parse(raw: unknown): ParsedResponses {
  const parsed = parseResponsesRequest(raw, options)
  if (isPlugError(parsed)) throw new Error(`unexpected rejection: ${parsed.message} (${parsed.param})`)
  return parsed
}

describe("parseResponsesRequest: stateless and hosted features are refused with unsupported_parameter", () => {
  const refusals: Array<[string, Record<string, unknown>, string]> = [
    ["conversation", { conversation: "conv_1" }, "conversation"],
    ["background mode", { background: true }, "background"],
    ["stored prompts", { prompt: { id: "p" } }, "prompt"],
    ["top_logprobs", { top_logprobs: 2 }, "top_logprobs"],
    ["truncation auto", { truncation: "auto" }, "truncation"],
    ["an unknown item type", { input: [{ type: "web_search_call" }] }, "input[0].type"],
    ["a tool type with no client-side shape (local_shell)", { tools: [{ type: "local_shell" }] }, "tools[0].type"],
    ["a tool_search tool", { tools: [{ type: "tool_search", execution: "client" }] }, "tools[0].type"],
    ["a tool of another type inside a namespace", { tools: [{ type: "namespace", name: "n", tools: [{ type: "web_search" }] }] }, "tools[0].tools[0].type"],
    ["an input_image by file_id", { input: [message("user", [{ type: "input_image", file_id: "f" }])] }, "input[0].content[0].image_url"],
    ["an input_file by file_id", { input: [message("user", [{ type: "input_file", file_id: "f" }])] }, "input[0].content[0].file_data"],
    ["an unsupported user part", { input: [message("user", [{ type: "input_audio" }])] }, "input[0].content[0].type"],
    ["an unsupported assistant part", { input: [message("assistant", [{ type: "image" }])] }, "input[0].content[0].type"],
    ["an unsupported tool_choice", { tool_choice: { type: "file_search" } }, "tool_choice"],
    ["json_schema with a named tool_choice", { tools: [fn("a")], tool_choice: { type: "function", name: "a" }, text: { format: { type: "json_schema", schema: {} } } }, "tool_choice"],
  ]
  test.each(refusals)("refuses %s", (_name, extra, param) => {
    expect(parseResponsesRequest(body(extra), options)).toMatchObject({ status: 400, kind: "invalid_request", code: "unsupported_parameter", param })
  })

  test("background false, top_logprobs 0 and truncation disabled are accepted", () => {
    expect(isPlugError(parseResponsesRequest(body({ background: false, top_logprobs: 0, truncation: "disabled" }), options))).toBe(false)
  })

  test("conversation is refused with a message that points at previous_response_id", () => {
    expect(parseResponsesRequest(body({ conversation: "conv_1" }), options)).toMatchObject({ message: expect.stringContaining("previous_response_id") })
  })
})

describe("previous_response_id: the stored chain is the context ahead of the new input", () => {
  const earlierInput = { id: "msg_a", type: "message", role: "user", content: [{ type: "input_text", text: "first" }] }
  const earlierOutput = { id: "msg_b", type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: "one", annotations: [] }] }

  test("the history comes first, then the new input, and the echoed object names the previous id", () => {
    const parsed = parseResponsesRequest(body({ input: "second", previous_response_id: "resp_x" }), options, undefined, [earlierInput, earlierOutput])
    expect(isPlugError(parsed)).toBe(false)
    const { request, exchange, inputItems } = parsed as ParsedResponses
    expect(request.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"])
    expect(exchange.envelope.previous_response_id).toBe("resp_x")
    // Only the new input comes back as items: the route keeps the history it already holds.
    expect(inputItems).toEqual([{ type: "message", role: "user", content: [{ type: "input_text", text: "second" }] }])
  })

  test("instructions are the request's own: the history carries none", () => {
    const parsed = parse(body({ instructions: "now", previous_response_id: "resp_x" }))
    expect(parsed.request.system).toEqual(["now"])
    expect(parse(body()).request.system).toEqual([])
  })

  test("a function_call_output answers a call from the history", () => {
    const call = { id: "fc_1", type: "function_call", status: "completed", call_id: "call_1", name: "weather", arguments: "{}" }
    const parsed = parseResponsesRequest(body({ input: [fnOutput("call_1", "sunny")], previous_response_id: "resp_x" }), options, undefined, [earlierInput, call])
    expect((parsed as ParsedResponses).request.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"])
  })

  test("an error in the new input counts its index from the new input, not the history", () => {
    expect(parseResponsesRequest(body({ input: [{ type: "web_search_call" }] }), options, undefined, [earlierInput, earlierOutput])).toMatchObject({ param: "input[0].type" })
  })

  test("a previous_response_id that is not a string is a 400 on that field", () => {
    expect(parseResponsesRequest(body({ previous_response_id: 5 }), options)).toMatchObject({ status: 400, param: "previous_response_id" })
    expect(parseResponsesRequest(body({ previous_response_id: "" }), options)).toMatchObject({ status: 400, param: "previous_response_id" })
  })

  test("item_references in the new input come back resolved, so a stored response keeps the items", () => {
    const known = new Map([["msg_b", earlierOutput as Record<string, unknown>]])
    const parsed = parseResponsesRequest(body({ input: [{ type: "item_reference", id: "msg_b" }, message("user", "again")] }), options, (id) => known.get(id))
    expect((parsed as ParsedResponses).inputItems[0]).toEqual(earlierOutput)
  })
})

describe("#147 item_reference resolves to the output item an earlier answer returned", () => {
  const answer = { id: "msg_1", type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: "Hello", annotations: [] }] }
  const call = { id: "fc_1", type: "function_call", status: "completed", call_id: "call_1", name: "weather", arguments: '{"city":"Oslo"}' }
  const known = new Map<string, Record<string, unknown>>([
    [answer.id, answer],
    [call.id, call],
  ])
  const resolve = (id: string) => known.get(id)

  test("a message reference is decoded as the assistant message it names, before the user's next turn", () => {
    const parsed = parseResponsesRequest(body({ input: [{ type: "item_reference", id: "msg_1" }, message("user", "Again?")] }), options, resolve)
    expect(isPlugError(parsed)).toBe(false)
    expect((parsed as ParsedResponses).request.messages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "Hello" }] },
      { role: "user", content: [{ type: "text", text: "Again?" }] },
    ])
  })

  test("a function_call reference pairs with the function_call_output that answers it", () => {
    const parsed = parseResponsesRequest(body({ input: [{ type: "item_reference", id: "fc_1" }, fnOutput("call_1", "sunny")] }), options, resolve)
    expect((parsed as ParsedResponses).request.messages).toEqual([
      { role: "assistant", content: [{ type: "tool-call", id: "call_1", name: "weather", input: { city: "Oslo" } }] },
      { role: "tool", content: [{ type: "tool-result", id: "call_1", name: "weather", result: "sunny" }] },
    ])
  })

  test("a reference the store does not hold is a 400 that suggests store: false", () => {
    expect(parseResponsesRequest(body({ input: [{ type: "item_reference", id: "msg_gone" }] }), options, resolve)).toMatchObject({
      status: 400,
      code: "item_not_found",
      param: "input[0].id",
      message: expect.stringContaining("store: false"),
    })
    expect(parseResponsesRequest(body({ input: [{ type: "item_reference", id: "msg_gone" }] }), options)).toMatchObject({ code: "item_not_found" })
  })

  test("a reference without an id is a 400 on that id", () => {
    expect(parseResponsesRequest(body({ input: [{ type: "item_reference" }] }), options, resolve)).toMatchObject({ status: 400, param: "input[0].id" })
  })
})

describe("parseResponsesRequest: validation answers 400 with its param", () => {
  const rejections: Array<[string, unknown, { param?: string; code?: string }]> = [
    ["a body that is not an object", "hi", {}],
    ["a missing model", { input: "hi" }, { param: "model" }],
    ["a missing input", { model: "m" }, { param: "input" }],
    ["an empty input array", body({ input: [] }), { param: "input" }],
    ["input with only system items", body({ input: [message("system", "s")] }), { param: "input" }],
    ["instructions that are not a string", body({ instructions: 1 }), { param: "instructions" }],
    ["reasoning that is not an object", body({ reasoning: "high" }), { param: "reasoning" }],
    ["an item that is not an object", body({ input: ["x"] }), { param: "input[0]" }],
    ["an unknown role", body({ input: [message("tool", "x")] }), { param: "input[0].role" }],
    ["system content that is not text", body({ input: [message("system", 1)] }), { param: "input[0].content" }],
    ["user content that is not a string or parts", body({ input: [message("user", 1)] }), { param: "input[0].content" }],
    ["assistant content that is not a string or parts", body({ input: [message("assistant", 1)] }), { param: "input[0].content" }],
    ["a function_call without call_id", body({ input: [{ type: "function_call", name: "f" }] }), { param: "input[0].call_id" }],
    ["a function_call without name", body({ input: [{ type: "function_call", call_id: "c" }] }), { param: "input[0].name" }],
    ["a function_call_output without call_id", body({ input: [{ type: "function_call_output", output: "x" }] }), { param: "input[0].call_id" }],
    ["a function_call_output with non-text output", body({ input: [fnCall("c", "f"), fnOutput("c", 5)] }), { param: "input[1].output" }],
    ["a function_call_output for an unknown call", body({ input: [fnOutput("c", "x")] }), { param: "input[0].call_id" }],
    ["tools that are not an array", body({ tools: {} }), { param: "tools" }],
    ["a tool that is not an object", body({ tools: ["f"] }), { param: "tools[0]" }],
    ["a function tool without name", body({ tools: [{ type: "function" }] }), { param: "tools[0].name" }],
    ["a duplicate tool", body({ tools: [fn("a"), fn("a")] }), { param: "tools[1].name" }],
    ["a tool description that is not a string", body({ tools: [fn("a", { description: 1 })] }), { param: "tools[0].description" }],
    ["tool parameters that are not an object", body({ tools: [fn("a", { parameters: "x" })] }), { param: "tools[0].parameters" }],
    ["more tools than maxTools", body({ tools: [fn("a"), fn("b"), fn("c")] }), { param: "tools", code: "too_many_tools" }],
    ["a tool_choice naming a missing tool", body({ tools: [fn("a")], tool_choice: { type: "function", name: "b" } }), { param: "tool_choice.name" }],
    ["text that is not an object", body({ text: "json" }), { param: "text" }],
    ["text.format that is not an object", body({ text: { format: "json" } }), { param: "text.format" }],
    ["an unknown text.format type", body({ text: { format: { type: "xml" } } }), { param: "text.format.type" }],
    ["json_schema with a non-string name", body({ text: { format: { type: "json_schema", name: 1, schema: {} } } }), { param: "text.format.name" }],
    ["json_schema with a non-string description", body({ text: { format: { type: "json_schema", description: 1, schema: {} } } }), { param: "text.format.description" }],
    ["json_schema without a schema", body({ text: { format: { type: "json_schema" } } }), { param: "text.format.schema" }],
    ["json_schema next to a tool named respond", body({ tools: [fn("respond")], text: { format: { type: "json_schema", schema: {} } } }), { param: "tools", code: "reserved_tool_name" }],
    ["temperature above 2", body({ temperature: 3 }), { param: "temperature" }],
    ["top_p below 0", body({ top_p: -0.1 }), { param: "top_p" }],
    ["a fractional max_output_tokens", body({ max_output_tokens: 2.5 }), { param: "max_output_tokens" }],
    ["max_output_tokens of 0", body({ max_output_tokens: 0 }), { param: "max_output_tokens" }],
  ]
  test.each(rejections)("rejects %s", (_name, raw, expected) => {
    expect(parseResponsesRequest(raw, options)).toMatchObject({ status: 400, kind: "invalid_request", ...expected })
  })
})

describe("parseResponsesRequest: input items", () => {
  test("a string input is one user message", () => {
    expect(parse(body()).request.messages).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }])
  })

  test("items without a type but with a role are messages", () => {
    expect(parse(body({ input: [{ role: "user", content: "hey" }] })).request.messages).toEqual([{ role: "user", content: [{ type: "text", text: "hey" }] }])
  })

  test("instructions come first in the system list, then system and developer items", () => {
    const { request } = parse(body({ instructions: "be brief", input: [message("system", [{ type: "input_text", text: "s" }]), message("developer", "d"), message("user", "u")] }))
    expect(request.system).toEqual(["be brief", "s", "d"])
  })

  test("user parts: input_text, input_image (and Chat-style image_url), input_file by data and URL", () => {
    const { request } = parse(
      body({
        input: [
          message("user", [
            { type: "input_text", text: "look" },
            { type: "input_image", image_url: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==" },
            { type: "image_url", image_url: { url: "https://example.com/x.png" } },
            { type: "input_file", file_data: "JVBERi0xLjQK", filename: "Doc.PDF" },
            { type: "input_file", file_url: "https://example.com/f" },
          ]),
        ],
      }),
    )
    expect(request.messages[0]!.content).toEqual([
      { type: "text", text: "look" },
      { type: "media", url: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==", mediaType: "image/jpeg" },
      { type: "media", url: "https://example.com/x.png" },
      { type: "media", url: "data:application/pdf;base64,JVBERi0xLjQK", mediaType: "application/pdf" },
      { type: "media", url: "https://example.com/f" },
    ])
  })

  test("#288 input_file data that is not a PDF is a 400 invalid_file, not sent to backend preparation", () => {
    expect(parseResponsesRequest(body({ input: [message("user", [{ type: "input_file", file_data: "AAAA" }])] }), options)).toMatchObject({
      status: 400,
      code: "invalid_file",
      param: "input[0].content[0].file_data",
    })
    expect(parseResponsesRequest(body({ input: [message("user", [{ type: "input_file", file_data: "data:text/plain;base64,JVBERi0xLjQK" }])] }), options)).toMatchObject({
      status: 400,
      code: "invalid_file",
    })
  })

  test("adjacent assistant text and function calls become one assistant message, followed by the results", () => {
    const { request } = parse(
      body({
        input: [
          message("user", "weather?"),
          message("assistant", [
            { type: "output_text", text: "Checking" },
            { type: "refusal", refusal: "x" },
          ]),
          fnCall("c1", "weather", '{"city":"Oslo"}'),
          fnCall("c2", "weather", { city: "Rome" }),
          { type: "reasoning", summary: [] },
          fnOutput("c1", "rain"),
          fnOutput("c2", [{ type: "output_text", text: "sun" }]),
        ],
      }),
    )
    expect(request.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "weather?" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Checking" },
          { type: "tool-call", id: "c1", name: "weather", input: { city: "Oslo" } },
          { type: "tool-call", id: "c2", name: "weather", input: { city: "Rome" } },
        ],
      },
      { role: "tool", content: [{ type: "tool-result", id: "c1", name: "weather", result: "rain" }] },
      { role: "tool", content: [{ type: "tool-result", id: "c2", name: "weather", result: "sun" }] },
    ])
  })
})

describe("parseResponsesRequest: tools, text.format and the echoed envelope", () => {
  const schema = { type: "object", properties: { a: { type: "number" } } }

  test("a function tool with null parameters is a tool without arguments", () => {
    expect(parse(body({ tools: [fn("ping", { parameters: null })] })).request.tools).toEqual([{ name: "ping", description: "", parameters: { type: "object", properties: {} } }])
  })

  test("json_schema alone forces respond; with tools it requires a call", () => {
    const alone = parse(body({ text: { format: { type: "json_schema", name: "out", schema } } }))
    expect(alone.request.toolChoice).toEqual({ type: "tool", name: "respond" })
    expect(alone.exchange.structuredTool).toBe("respond")
    // The request carries the structured tool's name, so `tools: false` keeps respond (#252).
    expect(alone.request.structuredTool).toBe("respond")
    const withTools = parse(body({ tools: [fn("a")], text: { format: { type: "json_schema", schema } } }))
    expect(withTools.request.tools.map((tool) => tool.name)).toEqual(["a", "respond"])
    expect(withTools.request.toolChoice).toBe("required")
    expect(withTools.exchange.callerTools).toBe(true)
  })

  test("json_object adds the instruction after the system items", () => {
    expect(parse(body({ instructions: "i", text: { format: { type: "json_object" } } })).request.system).toEqual(["i", "Respond with a single valid JSON object only."])
  })

  test("reasoning.effort is the variant hint and is echoed", () => {
    const parsed = parse(body({ reasoning: { effort: "high" } }))
    expect(parsed.reasoningEffort).toBe("high")
    expect(parsed.exchange.envelope.reasoning).toEqual({ effort: "high", summary: null })
  })

  test("the envelope echoes the request, its store included (#442): true when the request leaves it out", () => {
    expect(parse(body({})).exchange.envelope.store).toBe(true)
    expect(parse(body({ store: false })).exchange.envelope.store).toBe(false)
    const tools = [fn("a")]
    expect(
      parse(body({ instructions: "i", max_output_tokens: 9, temperature: 0.5, top_p: 0.5, metadata: { k: "v" }, parallel_tool_calls: false, tools, tool_choice: "auto", user: "u", store: true }))
        .exchange,
    ).toEqual({
      model: "test/echo",
      stream: false,
      envelope: {
        instructions: "i",
        max_output_tokens: 9,
        metadata: { k: "v" },
        parallel_tool_calls: false,
        previous_response_id: null,
        reasoning: { effort: null, summary: null },
        store: true,
        temperature: 0.5,
        text: { format: { type: "text" } },
        tool_choice: "auto",
        tools: [{ ...tools[0], strict: false }],
        top_p: 0.5,
        truncation: "disabled",
        user: "u",
      },
    })
  })

  test("sampling maps to the neutral names (no penalties in Responses)", () => {
    expect(parse(body({ temperature: 1, top_p: 0.2, max_output_tokens: 7 })).request.generation).toEqual({ temperature: 1, topP: 0.2, maxTokens: 7 })
  })
})

describe("#498 Codex tool shapes: namespace, custom, additional_tools and hosted tools", () => {
  const wide = testOptions({ maxTools: 4 })
  const parseWide = (raw: unknown): ParsedResponses => {
    const parsed = parseResponsesRequest(raw, wide)
    if (isPlugError(parsed)) throw new Error(`unexpected rejection: ${parsed.message} (${parsed.param})`)
    return parsed
  }
  const weather = {
    type: "namespace",
    name: "mcp__weather",
    description: "Tools in the mcp__weather namespace.",
    tools: [fn("get_weather", { description: "Weather", parameters: { type: "object", properties: { city: { type: "string" } } } })],
  }
  const exec = { type: "custom", name: "exec", description: "Run code", format: { type: "grammar", syntax: "lark", definition: "start: /.+/" } }

  test("a namespace tool becomes one function per tool, named namespace__name, and its call goes back as the bare name in the namespace", () => {
    const parsed = parseWide(body({ tools: [fn("a"), weather] }))
    expect(parsed.request.tools.map((tool) => tool.name)).toEqual(["a", "mcp__weather__get_weather"])
    expect(parsed.request.tools[1]).toMatchObject({ description: "Weather", parameters: { properties: { city: { type: "string" } } } })
    expect([...parsed.exchange.toolRoutes!]).toEqual([["mcp__weather__get_weather", { name: "get_weather", namespace: "mcp__weather" }]])
  })

  test("a namespace that ends in __ is not given a second separator", () => {
    const parsed = parseWide(body({ tools: [{ type: "namespace", name: "mcp__Some_Server__", tools: [fn("t")] }] }))
    expect(parsed.request.tools.map((tool) => tool.name)).toEqual(["mcp__Some_Server__t"])
  })

  test("the functions namespace, Codex's own default, keeps the bare name and needs no route", () => {
    const parsed = parseWide(body({ tools: [{ type: "namespace", name: "functions", tools: [fn("wait")] }] }))
    expect(parsed.request.tools.map((tool) => tool.name)).toEqual(["wait"])
    expect(parsed.exchange.toolRoutes).toBeUndefined()
  })

  test("a function_call in a namespace in the history is the flattened tool, and its output pairs with it", () => {
    const call = { type: "function_call", call_id: "c1", name: "get_weather", namespace: "mcp__weather", arguments: '{"city":"Paris"}' }
    const parsed = parseWide(body({ input: [message("user", "hi"), call, fnOutput("c1", "sunny")], tools: [weather] }))
    expect(parsed.request.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "tool-call", id: "c1", name: "mcp__weather__get_weather", input: { city: "Paris" } }] },
      { role: "tool", content: [{ type: "tool-result", id: "c1", name: "mcp__weather__get_weather", result: "sunny" }] },
    ])
  })

  test("the maxTools count is of the flattened functions, not of the namespace entries", () => {
    const many = { type: "namespace", name: "n", tools: [fn("a"), fn("b"), fn("c")] }
    expect(parseResponsesRequest(body({ tools: [many, fn("d"), fn("e")] }), wide)).toMatchObject({ code: "too_many_tools", param: "tools" })
    expect(parseWide(body({ tools: [many, fn("d")] })).request.tools).toHaveLength(4)
  })

  test("a flattened name that collides with another tool is a duplicate, and respond stays reserved", () => {
    expect(parseResponsesRequest(body({ tools: [fn("n__a"), { type: "namespace", name: "n", tools: [fn("a")] }] }), wide)).toMatchObject({
      param: "tools[1].tools[0].name",
      message: 'Duplicate tool name "n__a"',
    })
    const reserved = { type: "namespace", name: "functions", tools: [fn("respond")] }
    expect(parseResponsesRequest(body({ tools: [reserved], text: { format: { type: "json_schema", schema: {} } } }), wide)).toMatchObject({ code: "reserved_tool_name" })
  })

  test("a malformed namespace tool is a 400 on the field", () => {
    expect(parseResponsesRequest(body({ tools: [{ type: "namespace", tools: [] }] }), wide)).toMatchObject({ param: "tools[0].name" })
    expect(parseResponsesRequest(body({ tools: [{ type: "namespace", name: "n" }] }), wide)).toMatchObject({ param: "tools[0].tools" })
    expect(parseResponsesRequest(body({ tools: [{ type: "namespace", name: "n", tools: ["x"] }] }), wide)).toMatchObject({ param: "tools[0].tools[0]" })
    expect(parseResponsesRequest(body({ tools: [{ type: "namespace", name: "n", tools: [{ type: "function" }] }] }), wide)).toMatchObject({ param: "tools[0].tools[0].name" })
  })

  test("a custom tool is a function taking one string, with its grammar in the description; its call goes back as a custom call", () => {
    const parsed = parseWide(body({ tools: [exec] }))
    expect(parsed.request.tools).toEqual([
      {
        name: "exec",
        description: 'Run code\n\nThis is a freeform tool: pass its whole input as the "input" string.\n\nThe input must match this lark grammar:\nstart: /.+/',
        parameters: { type: "object", properties: { input: { type: "string", description: "The raw input of the tool." } }, required: ["input"], additionalProperties: false },
      },
    ])
    expect([...parsed.exchange.toolRoutes!]).toEqual([["exec", { name: "exec", custom: true }]])
  })

  test("a custom tool in a namespace has both the namespace and the custom flag; a tool without a grammar has none in its description", () => {
    const parsed = parseWide(
      body({
        tools: [
          { type: "namespace", name: "functions", tools: [{ type: "custom", name: "patch", format: { type: "text" } }] },
          { type: "namespace", name: "n", tools: [{ type: "custom", name: "p" }] },
        ],
      }),
    )
    expect(parsed.request.tools.map((tool) => tool.name)).toEqual(["patch", "n__p"])
    expect(parsed.request.tools[0]!.description).not.toContain("grammar")
    expect([...parsed.exchange.toolRoutes!].map(([name, route]) => [name, route])).toEqual([
      ["patch", { name: "patch", custom: true }],
      ["n__p", { name: "p", namespace: "n", custom: true }],
    ])
  })

  test("custom_tool_call and its output in the history are the function call and result of the flattened tool", () => {
    const call = { type: "custom_tool_call", call_id: "c1", name: "exec", input: "text('hi')" }
    const output = { type: "custom_tool_call_output", call_id: "c1", output: "done" }
    const parsed = parseWide(body({ input: [message("user", "hi"), call, output], tools: [exec] }))
    expect(parsed.request.messages.slice(1)).toEqual([
      { role: "assistant", content: [{ type: "tool-call", id: "c1", name: "exec", input: { input: "text('hi')" } }] },
      { role: "tool", content: [{ type: "tool-result", id: "c1", name: "exec", result: "done" }] },
    ])
    expect(parseResponsesRequest(body({ input: [output] }), wide)).toMatchObject({ param: "input[0].call_id", message: expect.stringContaining("custom_tool_call") })
  })

  test("tool_choice names a tool by its namespace and name, or a custom tool", () => {
    expect(parseWide(body({ tools: [weather], tool_choice: { type: "function", namespace: "mcp__weather", name: "get_weather" } })).request.toolChoice).toEqual({
      type: "tool",
      name: "mcp__weather__get_weather",
    })
    expect(parseWide(body({ tools: [exec], tool_choice: { type: "custom", name: "exec" } })).request.toolChoice).toEqual({ type: "tool", name: "exec" })
  })

  test("an additional_tools input item is a tool list, with no tools field and no message of its own", () => {
    const parsed = parseWide(
      body({ input: [{ type: "additional_tools", role: "developer", tools: [{ type: "namespace", name: "functions", tools: [exec, fn("wait")] }, weather] }, message("user", "hi")] }),
    )
    expect(parsed.request.tools.map((tool) => tool.name)).toEqual(["exec", "wait", "mcp__weather__get_weather"])
    expect(parsed.request.messages).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }])
    expect(parsed.inputItems[0]).toMatchObject({ type: "additional_tools" })
  })

  test("additional_tools next to tools is one list; the same declaration sent again is not a duplicate, a different one is", () => {
    const item = { type: "additional_tools", role: "developer", tools: [fn("a")] }
    expect(parseWide(body({ input: [item, message("user", "x"), item], tools: [fn("b")] })).request.tools.map((tool) => tool.name)).toEqual(["b", "a"])
    expect(parseResponsesRequest(body({ input: [item, message("user", "x"), { ...item, tools: [fn("a", { description: "other" })] }] }), wide)).toMatchObject({ param: "input[2].tools[0].name" })
    expect(parseResponsesRequest(body({ input: [item, message("user", "x")], tools: [fn("a", { description: "other" })] }), wide)).toMatchObject({ message: 'Duplicate tool name "a"' })
    expect(parseResponsesRequest(body({ input: [{ type: "additional_tools", tools: "x" }, message("user", "x")] }), wide)).toMatchObject({ param: "input[0].tools" })
  })

  test("hosted tools are left out and named, never counted; the rest of the request is unchanged", () => {
    const parsed = parseWide(
      body({
        tools: [{ type: "web_search", external_web_access: false }, fn("a"), { type: "file_search" }, { type: "web_search" }],
        input: [{ type: "additional_tools", tools: [{ type: "image_generation" }] }, message("user", "hi")],
      }),
    )
    expect(parsed.request.tools.map((tool) => tool.name)).toEqual(["a"])
    expect(parsed.droppedTools).toEqual(["web_search", "file_search", "image_generation"])
    expect(parseWide(body({ tools: [fn("a")] })).droppedTools).toEqual([])
    // The echoed object shows the tools as the caller sent them.
    expect((parsed.exchange.envelope.tools as unknown[]).length).toBe(4)
    expect(parseWide(body({ tools: [{ type: "web_search" }, fn("a"), fn("b"), fn("c"), fn("d")] })).request.tools).toHaveLength(4)
  })
})
