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

function parse(raw: unknown): ParsedResponses {
  const parsed = parseResponsesRequest(raw, options)
  if (isPlugError(parsed)) throw new Error(`unexpected rejection: ${parsed.message} (${parsed.param})`)
  return parsed
}

describe("parseResponsesRequest: stateless and hosted features are refused with unsupported_parameter", () => {
  const refusals: Array<[string, Record<string, unknown>, string]> = [
    ["previous_response_id", { previous_response_id: "resp_1" }, "previous_response_id"],
    ["conversation", { conversation: "conv_1" }, "conversation"],
    ["background mode", { background: true }, "background"],
    ["stored prompts", { prompt: { id: "p" } }, "prompt"],
    ["top_logprobs", { top_logprobs: 2 }, "top_logprobs"],
    ["truncation auto", { truncation: "auto" }, "truncation"],
    ["an unknown item type", { input: [{ type: "web_search_call" }] }, "input[0].type"],
    ["a hosted tool", { tools: [{ type: "web_search" }] }, "tools[0].type"],
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
    expect(parseResponsesRequest(body({ input: [message("user", [{ type: "input_file", file_data: "AAAA" }])] }), options)).toMatchObject({ status: 400, code: "invalid_file", param: "input[0].content[0].file_data" })
    expect(parseResponsesRequest(body({ input: [message("user", [{ type: "input_file", file_data: "data:text/plain;base64,JVBERi0xLjQK" }])] }), options)).toMatchObject({ status: 400, code: "invalid_file" })
  })

  test("adjacent assistant text and function calls become one assistant message, followed by the results", () => {
    const { request } = parse(
      body({
        input: [
          message("user", "weather?"),
          message("assistant", [{ type: "output_text", text: "Checking" }, { type: "refusal", refusal: "x" }]),
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

  test("the envelope echoes the request and always says store false", () => {
    const tools = [fn("a")]
    expect(parse(body({ instructions: "i", max_output_tokens: 9, temperature: 0.5, top_p: 0.5, metadata: { k: "v" }, parallel_tool_calls: false, tools, tool_choice: "auto", user: "u", store: true })).exchange).toEqual({
      model: "test/echo",
      stream: false,
      envelope: {
        instructions: "i",
        max_output_tokens: 9,
        metadata: { k: "v" },
        parallel_tool_calls: false,
        previous_response_id: null,
        reasoning: { effort: null, summary: null },
        store: false,
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
