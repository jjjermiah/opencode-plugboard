import { describe, expect, test } from "bun:test"
import type { PlugErrorKind, PlugEvent } from "../../src/contract.js"
import { listAvailableModels } from "../../src/models.js"
import { collectCompletion, encodeError, encodeModelList, matchesSchema, streamCompletion, textFallback, unfence, type OpenAiExchange } from "../../src/openai/response.js"
import { CATALOG, ev, events, testOptions } from "../support/fixtures.js"
import { sseData } from "../support/loopback.js"

const plain: OpenAiExchange = { model: "fast", stream: false, includeUsage: false }
const structured: OpenAiExchange = { ...plain, structuredTool: "respond" }
const structuredWithTools: OpenAiExchange = { ...structured, callerTools: true }
const jsonObject: OpenAiExchange = { ...plain, jsonObject: true }

const collect = async (exchange: OpenAiExchange, ...list: PlugEvent[]) => (await collectCompletion(events(...list), exchange)) as { status: number; body: any; structuredFallback?: boolean }

/** Runs the stream encoder and returns its frames as raw text plus the result. */
async function stream(exchange: OpenAiExchange, ...list: PlugEvent[]) {
  let text = ""
  const result = await streamCompletion(events(...list), { ...exchange, stream: true }, (chunk) => (text += chunk))
  const frames = sseData(text)
  return { text, result, frames, deltas: frames.flatMap((frame) => frame.choices?.map((choice: any) => choice.delta) ?? []) }
}

describe("encodeError: kind maps to the OpenAI error type", () => {
  const kinds: Array<[PlugErrorKind, string]> = [
    ["invalid_request", "invalid_request_error"],
    ["authentication", "authentication_error"],
    ["permission", "permission_error"],
    ["not_found", "not_found_error"],
    ["rate_limit", "rate_limit_error"],
    ["server", "server_error"],
    ["timeout", "timeout_error"],
  ]
  test.each(kinds)("%s -> %s", (kind, type) => {
    expect(encodeError({ status: 400, kind, message: "m" })).toEqual({ error: { message: "m", type, param: null, code: null } })
  })

  test("param and code are carried when present", () => {
    expect(encodeError({ status: 400, kind: "invalid_request", message: "m", param: "tools", code: "too_many_tools" })).toEqual({
      error: { message: "m", type: "invalid_request_error", param: "tools", code: "too_many_tools" },
    })
  })
})

describe("encodeModelList", () => {
  test("lists models in the OpenAI shape with plugboard capabilities", () => {
    const listed = listAvailableModels(testOptions({ models: ["test/echo#high", "test/vision"] }), CATALOG)
    expect(encodeModelList(listed)).toEqual({
      object: "list",
      data: [
        { id: "test/echo#high", object: "model", created: 0, owned_by: "test", context_length: 8192, plugboard: { capabilities: { tools: true }, contextLimit: 8192 } },
        { id: "test/vision", object: "model", created: 0, owned_by: "test", plugboard: { capabilities: { tools: true, image: true }, contextLimit: undefined } },
      ],
    })
  })
})

describe("unfence (#50 json_object fences)", () => {
  test.each([
    ["a json fence", '```json\n{"a":1}\n```', '{"a":1}'],
    ["a bare fence", '```\n{"a":1}\n```', '{"a":1}'],
    ["a fence with surrounding whitespace", '  ```JSON\r\n[1,2]\r\n```  ', "[1,2]"],
    ["unfenced JSON", '{"a":1}', '{"a":1}'],
    ["a fence around non-JSON", "```\nhello\n```", "```\nhello\n```"],
    ["prose around a fence", 'Here:\n```json\n{"a":1}\n```', 'Here:\n```json\n{"a":1}\n```'],
    ["two fences", '```json\n{"a":1}\n```\n```json\n{"b":2}\n```', '```json\n{"a":1}\n```\n```json\n{"b":2}\n```'],
  ])("%s", (_name, input, expected) => {
    expect(unfence(input)).toBe(expected)
  })
})

describe("collectCompletion: the JSON body", () => {
  test("text deltas join into one assistant message with finish_reason stop", async () => {
    const { status, body } = await collect(plain, ev.reasoning("hmm"), ev.text("Hel"), ev.text("lo"), ev.finish("stop"))
    expect(status).toBe(200)
    expect(body).toMatchObject({
      object: "chat.completion",
      model: "fast",
      choices: [{ index: 0, message: { role: "assistant", content: "Hello", refusal: null }, logprobs: null, finish_reason: "stop" }],
    })
    expect(body.id).toMatch(/^chatcmpl-[0-9a-f]{29}$/)
    expect(body).not.toHaveProperty("usage")
  })

  test("reasoning is dropped: Chat Completions has no field for it", async () => {
    const { body } = await collect(plain, ev.reasoning("secret"), ev.finish())
    expect(JSON.stringify(body)).not.toContain("secret")
    expect(body.choices[0].message.content).toBeNull()
  })

  test("usage totals are inclusive and carry cache and reasoning details", async () => {
    const { body } = await collect(plain, ev.text("x"), ev.finish("stop", { inputTokens: 10, outputTokens: 7, reasoningTokens: 3, cacheReadTokens: 4 }))
    expect(body.usage).toEqual({ prompt_tokens: 10, completion_tokens: 7, total_tokens: 17, prompt_tokens_details: { cached_tokens: 4 }, completion_tokens_details: { reasoning_tokens: 3 } })
  })

  test("tool calls become tool_calls with string arguments and force finish_reason tool_calls", async () => {
    const { body } = await collect(plain, ev.call("c1", "lookup", { q: 1 }), ev.call("c2", "raw", '{"already":"string"}'), ev.finish("stop"))
    expect(body.choices[0]).toMatchObject({
      finish_reason: "tool_calls",
      message: {
        content: null,
        tool_calls: [
          { id: "c1", type: "function", function: { name: "lookup", arguments: '{"q":1}' } },
          { id: "c2", type: "function", function: { name: "raw", arguments: '{"already":"string"}' } },
        ],
      },
    })
  })

  test.each([
    ["length", "length"],
    ["content-filter", "content_filter"],
  ] as const)("a %s finish keeps its reason even with tool calls", async (reason, wire) => {
    const { body } = await collect(plain, ev.call("c1", "f"), ev.finish(reason))
    expect(body.choices[0].finish_reason).toBe(wire)
  })

  test("an error event answers with its own status and wire error", async () => {
    expect(await collect(plain, ev.text("partial"), ev.error({ status: 429, kind: "rate_limit", message: "slow down", code: "rate_limited" }))).toEqual({
      status: 429,
      body: { error: { message: "slow down", type: "rate_limit_error", param: null, code: "rate_limited" } },
    })
  })

  test("a finish with reason error is a 500 Model run failed", async () => {
    expect(await collect(plain, ev.finish("error"))).toMatchObject({ status: 500, body: { error: { message: "Model run failed" } } })
  })

  test("a stream that ends without a finish is a 500", async () => {
    expect(await collect(plain, ev.text("x"))).toMatchObject({ status: 500, body: { error: { message: "Model stream ended without a finish event", type: "server_error" } } })
  })

  test("#50 json_object: one fence around JSON is stripped", async () => {
    const { body } = await collect(jsonObject, ev.text("```json\n"), ev.text('{"ok":true}\n```'), ev.finish())
    expect(body.choices[0].message.content).toBe('{"ok":true}')
  })
})

describe("collectCompletion: structured output (json_schema)", () => {
  test("the content is exactly the first respond call's arguments; prose and other calls are dropped", async () => {
    const { body } = await collect(structured, ev.text("thinking aloud"), ev.call("c0", "other"), ev.call("c1", "respond", { a: 1 }), ev.call("c2", "respond", { a: 2 }), ev.finish("tool-calls"))
    expect(body.choices[0]).toMatchObject({ finish_reason: "stop", message: { content: '{"a":1}' } })
    expect(body.choices[0].message).not.toHaveProperty("tool_calls")
  })

  test("no respond call is a 502 structured_output_missing", async () => {
    expect(await collect(structured, ev.text("I refuse"), ev.finish("stop"))).toMatchObject({ status: 502, body: { error: { code: "structured_output_missing" } } })
  })

  test("#282 the 502 says the JSON did not match the schema and names no internal tool", async () => {
    const { body } = await collect(structured, ev.text("part 7Q-12"), ev.finish("stop"))
    expect(body.error.message).toBe("The model did not return JSON matching the response schema. Say the expected JSON, with its keys and types, in the prompt.")
    expect(body.error.message).not.toContain("respond")
    expect(body.error.code).toBe("structured_output_missing")
  })

  test.each(["length", "content-filter"] as const)("#172 no respond call after a %s finish is a 502, never a 200 with null content", async (reason) => {
    const { status, body } = await collect(structured, ev.finish(reason))
    expect(status).toBe(502)
    expect(body.error.code).toBe("structured_output_missing")
  })

  test("#172 an empty structured turn (stop, no text, no tool call) is a 502, not a 200", async () => {
    expect(await collect(structured, ev.finish("stop"))).toMatchObject({ status: 502, body: { error: { code: "structured_output_missing" } } })
    expect(await collect(structured, ev.reasoning("hm"), ev.finish("stop"))).toMatchObject({ status: 502, body: { error: { code: "structured_output_missing" } } })
  })

  test("with caller tools, a caller tool call wins over the structured answer", async () => {
    const { body } = await collect(structuredWithTools, ev.call("c1", "respond", { a: 1 }), ev.call("c2", "search", { q: "x" }), ev.finish("tool-calls"))
    expect(body.choices[0]).toMatchObject({ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "c2", function: { name: "search" } }] } })
  })

  test("with caller tools and only a respond call, the answer is the content", async () => {
    const { body } = await collect(structuredWithTools, ev.call("c1", "respond", { a: 1 }), ev.finish("tool-calls"))
    expect(body.choices[0]).toMatchObject({ finish_reason: "stop", message: { content: '{"a":1}' } })
  })
})

describe("streamCompletion: SSE frames", () => {
  test("role chunk, content chunks, finish chunk, [DONE]", async () => {
    const { text, result, frames, deltas } = await stream(plain, ev.text("Hel"), ev.text(""), ev.text("lo"), ev.finish("stop"))
    expect(result).toEqual({ started: true })
    expect(deltas).toEqual([{ role: "assistant", content: "" }, { content: "Hel" }, { content: "lo" }, {}])
    expect(frames.at(-1).choices[0].finish_reason).toBe("stop")
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true)
    // One id and created for every chunk.
    expect(new Set(frames.map((frame) => frame.id)).size).toBe(1)
    expect(frames.every((frame) => frame.object === "chat.completion.chunk" && frame.model === "fast")).toBe(true)
  })

  test("tool calls stream as whole chunks with increasing index", async () => {
    const { deltas, frames } = await stream(plain, ev.call("c1", "a", { x: 1 }), ev.call("c2", "b"), ev.finish("stop"))
    expect(deltas.slice(1, 3)).toEqual([
      { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "a", arguments: '{"x":1}' } }] },
      { tool_calls: [{ index: 1, id: "c2", type: "function", function: { name: "b", arguments: "{}" } }] },
    ])
    expect(frames.at(-1).choices[0].finish_reason).toBe("tool_calls")
  })

  test("include_usage: every chunk has usage null, then a final usage chunk with no choices", async () => {
    const { frames } = await stream({ ...plain, includeUsage: true }, ev.text("x"), ev.finish("stop", { inputTokens: 2, outputTokens: 3 }))
    expect(frames.slice(0, -1).every((frame) => frame.usage === null)).toBe(true)
    expect(frames.at(-1)).toMatchObject({ choices: [], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })
  })

  test("without include_usage no usage field appears", async () => {
    const { text } = await stream(plain, ev.text("x"), ev.finish("stop", { inputTokens: 2 }))
    expect(text).not.toContain("usage")
  })

  test("#38 a failure before the first output writes nothing, so the route can answer with its status", async () => {
    const { text, result } = await stream(plain, ev.reasoning("hmm"), ev.error({ status: 429, kind: "rate_limit", message: "slow" }))
    expect(text).toBe("")
    expect(result).toEqual({ started: false, failure: { status: 429, kind: "rate_limit", message: "slow" } })
  })

  test("#38 a failure after output is an error frame and [DONE]", async () => {
    const { text, result } = await stream(plain, ev.text("partial"), ev.error({ message: "boom" }))
    expect(result.started).toBe(true)
    expect(result.failure).toMatchObject({ message: "boom" })
    expect(sseData(text).at(-1)).toEqual({ error: { message: "boom", type: "server_error", param: null, code: null } })
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true)
  })

  test("a stream without a finish fails like the JSON path", async () => {
    expect((await stream(plain, ev.text("x"))).result.failure).toMatchObject({ status: 500, message: "Model stream ended without a finish event" })
  })

  test("structured: the answer is one content chunk; prose is suppressed; finish is stop", async () => {
    const { deltas } = await stream(structured, ev.text("prose"), ev.call("c1", "respond", { a: 1 }), ev.finish("tool-calls"))
    expect(deltas).toEqual([{ role: "assistant", content: "" }, { content: '{"a":1}' }, {}])
  })

  test("structured with caller tools: the answer waits for the finish and loses to a caller tool call", async () => {
    const answered = await stream(structuredWithTools, ev.call("c1", "respond", { a: 1 }), ev.finish("tool-calls"))
    expect(answered.deltas).toEqual([{ role: "assistant", content: "" }, { content: '{"a":1}' }, {}])
    const replaced = await stream(structuredWithTools, ev.call("c1", "respond", { a: 1 }), ev.call("c2", "search"), ev.finish("tool-calls"))
    expect(replaced.deltas.map((delta) => Object.keys(delta))).toEqual([["role", "content"], ["tool_calls"], []])
    expect(replaced.frames.at(-1).choices[0].finish_reason).toBe("tool_calls")
  })

  test("structured without an answer fails before any output", async () => {
    expect((await stream(structured, ev.text("prose"), ev.finish("stop"))).result).toMatchObject({ started: false, failure: { code: "structured_output_missing" } })
  })

  test.each(["length", "content-filter"] as const)("#172 streamed: no respond call after a %s finish fails before any output", async (reason) => {
    const { text, result } = await stream(structured, ev.finish(reason))
    expect(text).toBe("")
    expect(result).toMatchObject({ started: false, failure: { status: 502, code: "structured_output_missing" } })
  })

  test("#50 json_object: a fenced answer is held and arrives unfenced as one chunk", async () => {
    const { deltas } = await stream(jsonObject, ev.text("```json\n{"), ev.text('"a":1}\n```'), ev.finish())
    expect(deltas).toEqual([{ role: "assistant", content: "" }, { content: '{"a":1}' }, {}])
  })

  test("#50 json_object: text that does not open with a backtick streams as it comes", async () => {
    const { deltas } = await stream(jsonObject, ev.text("  "), ev.text('{"a"'), ev.text(":1}"), ev.finish())
    expect(deltas).toEqual([{ role: "assistant", content: "" }, { content: '  {"a"' }, { content: ":1}" }, {}])
  })
})

describe("#170 a structured turn that answered in text", () => {
  const schema = { type: "object", required: ["city", "population"], properties: { city: { type: "string" }, population: { type: "integer" } } }
  const withSchema: OpenAiExchange = { ...structured, structuredSchema: schema }

  test("the final text is the answer when it is the JSON the schema asks for, flagged as a fallback", async () => {
    const result = await collect(withSchema, ev.text('{"city":"Oslo","population":700000}'), ev.finish("stop"))
    expect(result).toMatchObject({ status: 200, structuredFallback: true, body: { choices: [{ message: { content: '{"city":"Oslo","population":700000}' }, finish_reason: "stop" }] } })
  })

  test("one code fence around the JSON is stripped first", async () => {
    const result = await collect(withSchema, ev.text('```json\n{"city":"Oslo","population":1}\n```'), ev.finish("stop"))
    expect(result).toMatchObject({ status: 200, structuredFallback: true, body: { choices: [{ message: { content: '{"city":"Oslo","population":1}' } }] } })
  })

  test("text that does not match the schema stays a 502 structured_output_missing", async () => {
    expect(await collect(withSchema, ev.text('{"city":"Oslo"}'), ev.finish("stop"))).toMatchObject({ status: 502, body: { error: { code: "structured_output_missing" } } })
    expect(await collect(withSchema, ev.text('{"city":"Oslo","population":"many"}'), ev.finish("stop"))).toMatchObject({ status: 502 })
    expect(await collect(withSchema, ev.text("Oslo has 700000 people"), ev.finish("stop"))).toMatchObject({ status: 502 })
  })

  test("a respond call wins over the text, and is not flagged", async () => {
    const result = await collect(withSchema, ev.text('{"city":"Bergen","population":2}'), ev.call("c1", "respond", { city: "Oslo", population: 1 }), ev.finish("tool-calls"))
    expect(result).toMatchObject({ status: 200, body: { choices: [{ message: { content: '{"city":"Oslo","population":1}' } }] } })
    expect(result.structuredFallback).toBeUndefined()
  })

  test("with caller tools, a caller tool call still wins and no fallback is taken", async () => {
    const result = await collect({ ...withSchema, callerTools: true }, ev.text('{"city":"Oslo","population":1}'), ev.call("c2", "search", {}), ev.finish("tool-calls"))
    expect(result).toMatchObject({ status: 200, body: { choices: [{ finish_reason: "tool_calls" }] } })
    expect(result.structuredFallback).toBeUndefined()
  })

  test("streamed: the JSON text is one content chunk with no error (a stream has no fallback header)", async () => {
    const { deltas, result } = await stream(withSchema, ev.text('{"city":"Oslo",'), ev.text('"population":1}'), ev.finish("stop"))
    expect(deltas).toEqual([{ role: "assistant", content: "" }, { content: '{"city":"Oslo","population":1}' }, {}])
    expect(result.failure).toBeUndefined()
  })

  test("streamed: text that does not match is still the structured_output_missing error", async () => {
    const { result } = await stream(withSchema, ev.text("prose"), ev.finish("stop"))
    expect(result.failure).toMatchObject({ code: "structured_output_missing" })
  })
})

describe("#170 matchesSchema and textFallback: the schema subset", () => {
  test.each([
    ["an object with its required keys and typed properties", { type: "object", required: ["a"], properties: { a: { type: "string" } } }, { a: "x" }, true],
    ["a missing required key", { type: "object", required: ["a"] }, {}, false],
    ["a property of the wrong type", { type: "object", properties: { a: { type: "number" } } }, { a: "1" }, false],
    ["an absent optional property is not checked", { type: "object", properties: { a: { type: "number" } } }, {}, true],
    ["an integer is not a fraction", { type: "integer" }, 1.5, false],
    ["a list of types", { type: ["string", "null"] }, null, true],
    ["a top-level array", { type: "array" }, [1], true],
    ["an array where an object is wanted", { type: "object" }, [1], false],
    ["no type constrains nothing", {}, "anything", true],
  ])("%s", (_name, schema, value, expected) => {
    expect(matchesSchema(value, schema)).toBe(expected)
  })

  test("textFallback: the trimmed, unfenced JSON, or undefined", () => {
    const schema = { type: "object", required: ["a"] }
    expect(textFallback('  {"a":1}\n', schema)).toBe('{"a":1}')
    expect(textFallback('```json\n{"a":1}\n```', schema)).toBe('{"a":1}')
    expect(textFallback("not json", schema)).toBeUndefined()
    expect(textFallback("", schema)).toBeUndefined()
    expect(textFallback('{"b":1}', schema)).toBeUndefined()
  })

  test("textFallback: one fenced block inside prose is the answer; two blocks or a non-matching one are not", () => {
    const schema = { type: "object", required: ["city"] }
    const prose = 'I cannot call any tool. However, here is the JSON:\n\n```json\n{\n  "city": "Oslo"\n}\n```\n\nHope that helps.'
    expect(textFallback(prose, schema)).toBe('{\n  "city": "Oslo"\n}')
    expect(textFallback('A:\n```json\n{"city":"Oslo"}\n```\nB:\n```json\n{"city":"Bergen"}\n```', schema)).toBeUndefined()
    expect(textFallback('Here:\n```json\n{"town":"Oslo"}\n```', schema)).toBeUndefined()
  })
})

describe("reasoningOutput (since 0.36.0): reasoning on Chat Completions", () => {
  const on: OpenAiExchange = { ...plain, reasoningOutput: true }

  test("the JSON message carries the reasoning under both names, beside the content", async () => {
    const { body } = await collect(on, ev.reasoning("hm"), ev.reasoning("mm"), ev.text("Hel"), ev.text("lo"), ev.finish("stop"))
    expect(body.choices[0].message).toEqual({ role: "assistant", content: "Hello", refusal: null, reasoning_content: "hmmm", reasoning: "hmmm" })
  })

  test("off (the default): the message has no reasoning fields", async () => {
    const { body } = await collect(plain, ev.reasoning("hm"), ev.text("Hel"), ev.finish("stop"))
    expect(body.choices[0].message).not.toHaveProperty("reasoning_content")
    expect(body.choices[0].message).not.toHaveProperty("reasoning")
  })

  test("a turn with a tool call keeps the reasoning next to tool_calls", async () => {
    const { body } = await collect(on, ev.reasoning("need the file"), ev.call("c1", "read", { path: "a" }), ev.finish("tool-calls"))
    expect(body.choices[0].message).toMatchObject({ content: null, reasoning_content: "need the file", reasoning: "need the file", tool_calls: [{ id: "c1" }] })
    expect(body.choices[0].finish_reason).toBe("tool_calls")
  })

  test("structured output never carries reasoning: its content is the answer's arguments", async () => {
    const { body } = await collect({ ...structured, reasoningOutput: true }, ev.reasoning("secret"), ev.call("c1", "respond", { a: 1 }), ev.finish())
    expect(JSON.stringify(body)).not.toContain("secret")
    expect(body.choices[0].message.content).toBe('{"a":1}')
  })

  test("the stream sends reasoning as deltas under both names, after the role and before the content", async () => {
    const { deltas } = await stream(on, ev.reasoning("hm"), ev.reasoning("mm"), ev.text("Hel"), ev.finish("stop"))
    expect(deltas).toEqual([
      { role: "assistant", content: "" },
      { reasoning_content: "hm", reasoning: "hm" },
      { reasoning_content: "mm", reasoning: "mm" },
      { content: "Hel" },
      {},
    ])
  })

  test("a signature-only reasoning event (empty text) sends nothing", async () => {
    const signed: PlugEvent = { type: "reasoning-delta", text: "", signature: "sig" }
    const { deltas } = await stream(on, signed, ev.text("A"), ev.finish("stop"))
    expect(deltas).toEqual([{ role: "assistant", content: "" }, { content: "A" }, {}])
  })

  test("off: the stream sends no reasoning delta", async () => {
    const { text } = await stream(plain, ev.reasoning("secret"), ev.text("A"), ev.finish("stop"))
    expect(text).not.toContain("secret")
  })

  test("structured streaming never sends reasoning", async () => {
    const { text } = await stream({ ...structured, reasoningOutput: true }, ev.reasoning("secret"), ev.call("c1", "respond", { a: 1 }), ev.finish())
    expect(text).not.toContain("secret")
    expect(text).toContain('{\\"a\\":1}')
  })
})
