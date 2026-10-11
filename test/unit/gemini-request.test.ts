import { describe, expect, test } from "bun:test"
import { isPlugError } from "../../src/contract.js"
import { convertSchema, parseGeminiRequest, type ParsedGemini } from "../../src/gemini/request.js"
import { matchGeminiRoute } from "../../src/gemini/route.js"
import { testOptions } from "../support/fixtures.js"

const options = testOptions({ maxTools: 3 })
const user = (...parts: unknown[]) => ({ role: "user", parts })
const modelTurn = (...parts: unknown[]) => ({ role: "model", parts })
const body = (extra: Record<string, unknown> = {}) => ({ contents: [user({ text: "hi" })], ...extra })
const fn = (name: string, extra: Record<string, unknown> = {}) => ({ name, ...extra })
const tools = (...declarations: unknown[]) => [{ functionDeclarations: declarations }]

function parse(raw: unknown, stream = false): ParsedGemini {
  const parsed = parseGeminiRequest("fast", stream, raw, options)
  if (isPlugError(parsed)) throw new Error(`unexpected rejection: ${parsed.message} (${parsed.param})`)
  return parsed
}

describe("matchGeminiRoute", () => {
  test.each([
    ["GET", "/v1beta/models", { op: "list", route: "GET /v1beta/models" }],
    ["GET", "/v1beta/models/test%2Fecho%23high", { op: "get", route: "GET /v1beta/models/{model}", model: "test/echo#high" }],
    ["POST", "/v1beta/models/fast:generateContent", { op: "generate", route: "POST /v1beta/models/{model}:generateContent", model: "fast", stream: false }],
    ["POST", "/v1beta/models/models/fast:streamGenerateContent", { op: "generate", route: "POST /v1beta/models/{model}:streamGenerateContent", model: "fast", stream: true }],
    ["POST", "/v1/models/test/echo:generateContent", { op: "generate", route: "POST /v1/models/{model}:generateContent", model: "test/echo", stream: false }],
    ["POST", "/v1beta/models/ollama/llama3:8b:generateContent", { op: "generate", route: "POST /v1beta/models/{model}:generateContent", model: "ollama/llama3:8b", stream: false }],
    ["POST", "/v1beta/models/fast:countTokens", { op: "unsupported", route: "POST /v1beta/models/{model}:countTokens", verb: "countTokens" }],
  ])("%s %s", (method, path, match) => {
    expect(matchGeminiRoute(method, path)).toEqual(match as never)
  })

  test.each([
    ["GET", "/v1/models/test/echo", "the OpenAI model route"],
    ["GET", "/v1/models", "the OpenAI model list"],
    ["POST", "/v1beta/models", "POST to the list"],
    ["POST", "/v1beta/models/fast", "a POST without a :method"],
    ["DELETE", "/v1beta/models/fast:generateContent", "another method"],
    ["GET", "/v1beta/models/%E0%A4%A", "a malformed percent escape"],
  ])("%s %s is not a Gemini route (%s)", (method, path) => {
    expect(matchGeminiRoute(method, path)).toBeUndefined()
  })
})

describe("parseGeminiRequest: rejections answer 400 with their param", () => {
  const rejections: Array<[string, unknown, { param?: string; code?: string }]> = [
    ["a body that is not an object", [], {}],
    ["generationConfig that is not an object", body({ generationConfig: 1 }), { param: "generationConfig" }],
    ["cachedContent (server state)", body({ cachedContent: "cachedContents/1" }), { param: "cachedContent", code: "unsupported_parameter" }],
    ["candidateCount 2", body({ generationConfig: { candidateCount: 2 } }), { param: "generationConfig.candidateCount", code: "unsupported_parameter" }],
    ["candidateCount 0", body({ generationConfig: { candidateCount: 0 } }), { param: "generationConfig.candidateCount" }],
    ["responseLogprobs", body({ generationConfig: { responseLogprobs: true } }), { param: "generationConfig.responseLogprobs", code: "unsupported_parameter" }],
    ["an IMAGE response modality", body({ generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }), { param: "generationConfig.responseModalities", code: "unsupported_parameter" }],
    ["missing contents", {}, { param: "contents" }],
    ["empty contents", body({ contents: [] }), { param: "contents" }],
    ["a content that is not an object", body({ contents: ["hi"] }), { param: "contents[0]" }],
    ["an unknown role", body({ contents: [{ role: "system", parts: [{ text: "x" }] }] }), { param: "contents[0].role" }],
    ["a content without parts", body({ contents: [{ role: "user" }] }), { param: "contents[0].parts" }],
    ["a part that is not an object", body({ contents: [user("x")] }), { param: "contents[0].parts[0]" }],
    ["a functionCall in a user turn", body({ contents: [user({ functionCall: { name: "f" } })] }), { param: "contents[0].parts[0].functionCall" }],
    ["a functionCall without a name", body({ contents: [user({ text: "x" }), modelTurn({ functionCall: {} })] }), { param: "contents[1].parts[0].functionCall.name" }],
    ["functionCall args that are not an object", body({ contents: [user({ text: "x" }), modelTurn({ functionCall: { name: "f", args: [1] } })] }), { param: "contents[1].parts[0].functionCall.args" }],
    ["a functionResponse in a model turn", body({ contents: [modelTurn({ functionResponse: { name: "f" } })] }), { param: "contents[0].parts[0].functionResponse" }],
    ["a functionResponse answering nothing", body({ contents: [user({ functionResponse: { name: "f", response: {} } })] }), { param: "contents[0].parts[0].functionResponse" }],
    ["a functionCall left unanswered", body({ contents: [user({ text: "x" }), modelTurn({ functionCall: { name: "f" } }), user({ text: "y" })] }), { param: "contents" }],
    ["inlineData without mimeType", body({ contents: [user({ inlineData: { data: "AA" } })] }), { param: "contents[0].parts[0].inlineData" }],
    ["inlineData in a model turn", body({ contents: [user({ text: "x" }), modelTurn({ inlineData: { mimeType: "image/png", data: "AA" } })] }), { param: "contents[1].parts[0].inlineData", code: "unsupported_parameter" }],
    ["fileData by gs:// URI", body({ contents: [user({ fileData: { fileUri: "gs://bucket/a.png" } })] }), { param: "contents[0].parts[0].fileData.fileUri", code: "unsupported_parameter" }],
    ["an unknown part kind", body({ contents: [user({ executableCode: { code: "x" } })] }), { param: "contents[0].parts[0]", code: "unsupported_parameter" }],
    ["contents with only thoughts", body({ contents: [user({ text: "x", thought: true })] }), { param: "contents" }],
    ["a systemInstruction with a non-text part", body({ systemInstruction: { parts: [{ inlineData: {} }] } }), { param: "systemInstruction.parts[0]", code: "unsupported_parameter" }],
    ["tools that are not an array", body({ tools: {} }), { param: "tools" }],
    ["a hosted tool", body({ tools: [{ googleSearch: {} }] }), { param: "tools[0].googleSearch", code: "unsupported_parameter" }],
    ["a hosted tool in snake_case", body({ tools: [{ code_execution: {} }] }), { param: "tools[0].codeExecution", code: "unsupported_parameter" }],
    ["an unknown tool kind", body({ tools: [{ somethingElse: {} }] }), { param: "tools[0].somethingElse", code: "unsupported_parameter" }],
    ["functionDeclarations that are not an array", body({ tools: [{ functionDeclarations: {} }] }), { param: "tools[0].functionDeclarations" }],
    ["a declaration without a name", body({ tools: tools({}) }), { param: "tools[0].functionDeclarations[0].name" }],
    ["a duplicate declaration", body({ tools: tools(fn("a"), fn("a")) }), { param: "tools[0].functionDeclarations[1].name" }],
    ["a non-string description", body({ tools: tools(fn("a", { description: 1 })) }), { param: "tools[0].functionDeclarations[0].description" }],
    ["more tools than maxTools", body({ tools: tools(fn("a"), fn("b"), fn("c"), fn("d")) }), { param: "tools", code: "too_many_tools" }],
    ["a toolConfig that is not an object", body({ toolConfig: 1 }), { param: "toolConfig" }],
    ["an unknown calling mode", body({ tools: tools(fn("a")), toolConfig: { functionCallingConfig: { mode: "SOMETIMES" } } }), { param: "toolConfig.functionCallingConfig.mode" }],
    ["allowedFunctionNames naming a missing tool", body({ tools: tools(fn("a")), toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["b"] } } }), { param: "toolConfig.functionCallingConfig.allowedFunctionNames" }],
    ["an unsupported responseMimeType", body({ generationConfig: { responseMimeType: "text/x.enum" } }), { param: "generationConfig.responseMimeType", code: "unsupported_parameter" }],
    ["a responseSchema that is not an object", body({ generationConfig: { responseSchema: "x" } }), { param: "generationConfig.responseSchema" }],
    ["responseSchema next to a tool named respond", body({ tools: tools(fn("respond")), generationConfig: { responseSchema: { type: "OBJECT" } } }), { param: "tools", code: "reserved_tool_name" }],
    ["responseSchema with ANY on one function", body({ tools: tools(fn("a"), fn("b")), toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["a"] } }, generationConfig: { responseSchema: { type: "OBJECT" } } }), { param: "toolConfig.functionCallingConfig", code: "unsupported_parameter" }],
    ["temperature above 2", body({ generationConfig: { temperature: 2.5 } }), { param: "generationConfig.temperature" }],
    ["a fractional maxOutputTokens", body({ generationConfig: { maxOutputTokens: 1.5 } }), { param: "generationConfig.maxOutputTokens" }],
    ["six stop sequences", body({ generationConfig: { stopSequences: ["a", "b", "c", "d", "e", "f"] } }), { param: "generationConfig.stopSequences" }],
  ]
  test.each(rejections)("rejects %s", (_name, raw, expected) => {
    expect(parseGeminiRequest("fast", false, raw, options)).toMatchObject({ status: 400, kind: "invalid_request", ...expected })
  })
})

describe("parseGeminiRequest: contents", () => {
  test("the model and stream flag come from the URL; role defaults to user; systemInstruction is the system prompt", () => {
    const parsed = parse({ contents: [{ parts: [{ text: "hi" }] }], systemInstruction: { parts: [{ text: "be" }, { text: "brief" }] } }, true)
    expect(parsed.request).toMatchObject({ model: "fast", system: ["be\nbrief"], messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], tools: [], generation: {} })
    expect(parsed.exchange).toEqual({ model: "fast", stream: true })
  })

  test("snake_case fields are read too", () => {
    const parsed = parse({ contents: [user({ inline_data: { mimeType: "image/png", data: "AA" } })], system_instruction: "s", generation_config: { max_output_tokens: 5 } })
    expect(parsed.request.system).toEqual(["s"])
    expect(parsed.request.generation).toEqual({ maxTokens: 5 })
    expect(parsed.request.messages[0]!.content).toEqual([{ type: "media", url: "data:image/png;base64,AA", mediaType: "image/png" }])
  })

  test("inlineData becomes a data URL; fileData with an http(s) URI passes through", () => {
    expect(parse(body({ contents: [user({ text: "see" }, { inlineData: { mimeType: "image/jpeg", data: "BB" } }, { fileData: { fileUri: "https://x.test/a.png", mimeType: "image/png" } })] })).request.messages[0]!.content).toEqual([
      { type: "text", text: "see" },
      { type: "media", url: "data:image/jpeg;base64,BB", mediaType: "image/jpeg" },
      { type: "media", url: "https://x.test/a.png", mediaType: "image/png" },
    ])
  })

  test("thought parts and signature-only parts are dropped", () => {
    expect(parse(body({ contents: [user({ text: "hi" }), modelTurn({ text: "pondering", thought: true }, { thoughtSignature: "sig" }, { text: "answer" }), user({ text: "ok" })] })).request.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "answer" }] },
      { role: "user", content: [{ type: "text", text: "ok" }] },
    ])
  })

  test("calls get generated ids; responses pair with the earliest unanswered call of that name, results first", () => {
    const parsed = parse(
      body({
        contents: [
          user({ text: "weather in two cities" }),
          modelTurn({ functionCall: { name: "weather", args: { city: "Oslo" } } }, { functionCall: { name: "weather", args: { city: "Rome" } } }),
          user({ functionResponse: { name: "weather", response: { output: "rain" } } }, { functionResponse: { name: "weather", response: { error: "down" } } }, { text: "and?" }),
        ],
      }),
    )
    expect(parsed.request.messages.slice(1)).toEqual([
      { role: "assistant", content: [{ type: "tool-call", id: "call_0", name: "weather", input: { city: "Oslo" } }, { type: "tool-call", id: "call_1", name: "weather", input: { city: "Rome" } }] },
      { role: "tool", content: [{ type: "tool-result", id: "call_0", name: "weather", result: '{"output":"rain"}' }] },
      { role: "tool", content: [{ type: "tool-result", id: "call_1", name: "weather", result: '{"error":"down"}', isError: true }] },
      { role: "user", content: [{ type: "text", text: "and?" }] },
    ])
  })

  test("a client-sent call id is kept and matched", () => {
    const parsed = parse(body({ contents: [user({ text: "x" }), modelTurn({ functionCall: { id: "a1", name: "f" } }, { functionCall: { id: "b2", name: "f" } }), user({ functionResponse: { id: "b2", name: "f", response: {} } }, { functionResponse: { id: "a1", name: "f", response: {} } })] }))
    expect(parsed.request.messages.slice(2).map((message) => (message.content[0] as { id: string }).id)).toEqual(["b2", "a1"])
  })

  test("a streamed model turn replayed as several contents is one assistant message, text merged at the seam", () => {
    expect(parse(body({ contents: [user({ text: "x" }), modelTurn({ text: "Hel" }), modelTurn({ text: "lo" }, { functionCall: { name: "f" } }), user({ functionResponse: { name: "f", response: {} } })] })).request.messages[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "Hello" }, { type: "tool-call", id: "call_0", name: "f", input: {} }],
    })
  })
})

describe("parseGeminiRequest: tools, tool config and structured output", () => {
  test("Gemini Schema parameters become JSON Schema; parametersJsonSchema passes through", () => {
    const parsed = parse(body({ tools: tools(fn("a", { description: "A", parameters: { type: "OBJECT", properties: { n: { type: "INTEGER", format: "int32" } } } }), fn("b", { parametersJsonSchema: { type: "object", additionalProperties: false } }), fn("c")) }))
    expect(parsed.request.tools).toEqual([
      { name: "a", description: "A", parameters: { type: "object", properties: { n: { type: "integer" } } } },
      { name: "b", description: "", parameters: { type: "object", additionalProperties: false } },
      { name: "c", description: "", parameters: { type: "object", properties: {} } },
    ])
  })

  test.each([
    ["AUTO is auto", "AUTO", undefined, "auto", ["a", "b"]],
    ["NONE is none", "NONE", undefined, "none", ["a", "b"]],
    ["ANY is required", "ANY", undefined, "required", ["a", "b"]],
    ["ANY with one allowed name forces that tool", "ANY", ["b"], { type: "tool", name: "b" }, ["b"]],
    ["modes are case-insensitive; several allowed names stay required", "any", ["a", "b"], "required", ["a", "b"]],
  ])("functionCallingConfig: %s", (_name, mode, allowed, choice, offered) => {
    const parsed = parse(body({ tools: tools(fn("a"), fn("b")), toolConfig: { functionCallingConfig: { mode, ...(allowed ? { allowedFunctionNames: allowed } : {}) } } }))
    expect(parsed.request.toolChoice).toEqual(choice as never)
    expect(parsed.request.tools.map((tool) => tool.name)).toEqual(offered)
  })

  test("an object responseSchema forces the respond tool with the converted schema", () => {
    const parsed = parse(body({ generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { a: { type: "STRING", nullable: true } }, propertyOrdering: ["a"] } } }))
    expect(parsed.request.tools).toEqual([{ name: "respond", description: expect.any(String), parameters: { type: "object", properties: { a: { type: ["string", "null"] } } } }])
    expect(parsed.request.toolChoice).toEqual({ type: "tool", name: "respond" })
    expect(parsed.exchange).toMatchObject({ structuredTool: "respond" })
    expect(parsed.exchange).not.toHaveProperty("wrapped")
  })

  test("an array schema is wrapped under value and marked for unwrapping", () => {
    const parsed = parse(body({ generationConfig: { responseJsonSchema: { type: "array", items: { type: "string" } } } }))
    expect(parsed.request.tools[0]!.parameters).toEqual({ type: "object", properties: { value: { type: "array", items: { type: "string" } } }, required: ["value"] })
    expect(parsed.exchange.wrapped).toBe(true)
  })

  test("a schema with caller tools offers both and requires a call", () => {
    const parsed = parse(body({ tools: tools(fn("a")), generationConfig: { responseSchema: { type: "OBJECT" } } }))
    expect(parsed.request.tools.map((tool) => tool.name)).toEqual(["a", "respond"])
    expect(parsed.request.toolChoice).toBe("required")
    expect(parsed.exchange.callerTools).toBe(true)
  })

  test("application/json without a schema is the JSON instruction", () => {
    const parsed = parse(body({ generationConfig: { responseMimeType: "application/json" } }))
    expect(parsed.request.system).toEqual(["Respond with a single valid JSON object only."])
    expect(parsed.exchange.jsonObject).toBe(true)
  })

  test("generation config maps; thinkingLevel or a bucketed thinkingBudget picks the variant", () => {
    expect(parse(body({ generationConfig: { temperature: 0.4, topP: 0.9, presencePenalty: 1, frequencyPenalty: -1, maxOutputTokens: 10, stopSequences: ["END"] } })).request.generation).toEqual({
      temperature: 0.4,
      topP: 0.9,
      presencePenalty: 1,
      frequencyPenalty: -1,
      maxTokens: 10,
      stop: ["END"],
    })
    const effort = (thinkingConfig: unknown) => parse(body({ generationConfig: { thinkingConfig } })).reasoningEffort
    expect([effort({ thinkingLevel: "HIGH" }), effort({ thinkingBudget: 0 }), effort({ thinkingBudget: 1024 }), effort({ thinkingBudget: 8192 }), effort({ thinkingBudget: 8193 }), effort({ thinkingBudget: -1 })]).toEqual([
      "high",
      "none",
      "low",
      "medium",
      "high",
      undefined,
    ])
  })
})

describe("convertSchema: Gemini Schema to JSON Schema", () => {
  test.each([
    ["types lowercased, TYPE_UNSPECIFIED dropped", { type: "STRING" }, { type: "string" }],
    ["unspecified type", { type: "TYPE_UNSPECIFIED", description: "d" }, { description: "d" }],
    ["nullable becomes a null type", { type: "INTEGER", nullable: true }, { type: ["integer", "null"] }],
    ["int64 limits as strings become numbers", { type: "ARRAY", minItems: "1", maxItems: "x" }, { type: "array", minItems: 1 }],
    ["JSON Schema formats kept, Gemini-only ones dropped", { type: "STRING", format: "date-time" }, { type: "string", format: "date-time" }],
    ["Gemini-only format", { type: "NUMBER", format: "float" }, { type: "number" }],
    ["unknown keys dropped", { type: "OBJECT", example: {}, propertyOrdering: ["a"] }, { type: "object" }],
    ["nested properties, items, anyOf and additionalProperties", { type: "OBJECT", properties: { a: { type: "ARRAY", items: { type: "BOOLEAN" } }, b: { anyOf: [{ type: "STRING" }, { type: "NULL" }] } }, additionalProperties: { type: "STRING" } }, { type: "object", properties: { a: { type: "array", items: { type: "boolean" } }, b: { anyOf: [{ type: "string" }, { type: "null" }] } }, additionalProperties: { type: "string" } }],
    ["copied keys", { enum: ["a"], required: ["x"], pattern: "^a", default: "a", minimum: 1, maximum: 2, title: "T" }, { enum: ["a"], required: ["x"], pattern: "^a", default: "a", minimum: 1, maximum: 2, title: "T" }],
  ])("%s", (_name, input, output) => {
    expect(convertSchema(input)).toEqual(output)
  })

  test("non-objects come back unchanged", () => {
    expect([convertSchema(1), convertSchema(null), convertSchema([1])]).toEqual([1, null, [1]])
  })
})
