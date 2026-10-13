import { describe, expect, test } from "bun:test"
import { parseCompletionsRequest, type ParsedCompletions } from "../../src/completions/request.js"
import { completionsCodec, type CompletionsExchange } from "../../src/completions/response.js"
import { isPlugError, type PlugEvent } from "../../src/contract.js"
import { ev, events, testOptions } from "../support/fixtures.js"
import { sseData } from "../support/loopback.js"

const options = testOptions({ maxN: 4 })
const body = (extra: Record<string, unknown> = {}) => ({ model: "test/echo", prompt: "Once upon", ...extra })

function parse(raw: unknown): ParsedCompletions {
  const parsed = parseCompletionsRequest(raw, options)
  if (isPlugError(parsed)) throw new Error(`unexpected rejection: ${parsed.message}`)
  return parsed
}

describe("#75 parseCompletionsRequest", () => {
  const rejections: Array<[string, unknown, { param?: string; code?: string }]> = [
    ["a body that is not an object", "x", {}],
    ["a missing model", { prompt: "x" }, { param: "model" }],
    ["a missing prompt", { model: "m" }, { param: "prompt" }],
    ["an empty prompt array", body({ prompt: [] }), { param: "prompt" }],
    ["a token-array prompt", body({ prompt: [1, 2, 3] }), { param: "prompt", code: "unsupported_parameter" }],
    ["a list of token arrays", body({ prompt: [[1, 2]] }), { param: "prompt", code: "unsupported_parameter" }],
    ["a prompt list with a non-string", body({ prompt: ["a", null] }), { param: "prompt" }],
    ["logprobs", body({ logprobs: 2 }), { param: "logprobs", code: "unsupported_parameter" }],
    ["best_of 2", body({ best_of: 2 }), { param: "best_of", code: "unsupported_parameter" }],
    ["best_of 0", body({ best_of: 0 }), { param: "best_of" }],
    ["a non-boolean echo", body({ echo: "yes" }), { param: "echo" }],
    ["a non-string suffix", body({ suffix: 1 }), { param: "suffix" }],
    ["#58 n above maxN", body({ n: 5 }), { param: "n", code: "too_many_choices" }],
    ["#58 prompts times n above maxN", body({ prompt: ["a", "b", "c"], n: 2 }), { param: "prompt", code: "too_many_choices" }],
    ["temperature above 2", body({ temperature: 3 }), { param: "temperature" }],
  ]
  test.each(rejections)("rejects %s", (_name, raw, expected) => {
    expect(parseCompletionsRequest(raw, options)).toMatchObject({ status: 400, kind: "invalid_request", ...expected })
  })

  test("a string prompt is one user message, no system prompt, no tools", () => {
    expect(parse(body({ max_tokens: 5 }))).toMatchObject({
      n: 1,
      requests: [{ model: "test/echo", system: [], tools: [], generation: { maxTokens: 5 }, messages: [{ role: "user", content: [{ type: "text", text: "Once upon" }] }] }],
      exchange: { model: "test/echo", stream: false, includeUsage: false, perPrompt: 1 },
    })
  })

  test("a prompt list is one call per prompt; n multiplies them within maxN", () => {
    const parsed = parse(body({ prompt: ["a", "b"], n: 2, best_of: 1 }))
    expect(parsed.requests.map((request) => (request.messages[0]!.content[0] as { text: string }).text)).toEqual(["a", "b"])
    expect(parsed.n).toBe(2)
    expect(parsed.exchange.perPrompt).toBe(2)
  })

  test("suffix becomes the one system instruction", () => {
    const [request] = parse(body({ suffix: "The end." })).requests
    expect(request!.system).toHaveLength(1)
    expect(request!.system[0]).toEndWith("Suffix:\nThe end.")
  })

  test("echo keeps the prompts for the encoder; stream_options.include_usage is read", () => {
    expect(parse(body({ prompt: ["a", "b"], echo: true, stream: true, stream_options: { include_usage: true } })).exchange).toEqual({
      model: "test/echo",
      stream: true,
      includeUsage: true,
      perPrompt: 1,
      echo: ["a", "b"],
    })
  })
})

describe("#75 the text_completion codec", () => {
  const exchange: CompletionsExchange = { model: "fast", stream: false, includeUsage: false, perPrompt: 2, echo: ["P0 ", "P1 "] }
  const codec = completionsCodec(exchange)

  test("collect: one choice as a text_completion body; echo prefixes the choice's own prompt", async () => {
    const result = (await codec.collect(events(ev.reasoning("x"), ev.text("lived"), ev.call("c", "f"), ev.finish("stop", { inputTokens: 3, outputTokens: 1 })), 2)) as { status: number; body: any }
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ object: "text_completion", model: "fast", choices: [{ text: "P1 lived", index: 0, logprobs: null, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } })
    expect(result.body.id).toMatch(/^cmpl-/)
  })

  test.each([
    ["length", "length"],
    ["content-filter", "content_filter"],
    ["tool-calls", "stop"],
  ] as const)("finish %s -> finish_reason %s", async (reason, wire) => {
    const result = (await codec.collect(events(ev.text("x"), ev.finish(reason)), 0)) as { body: any }
    expect(result.body.choices[0].finish_reason).toBe(wire)
  })

  test("collect: a failure is its own status and an OpenAI error body", async () => {
    expect(await codec.collect(events(ev.error({ status: 429, kind: "rate_limit", message: "slow" })), 0)).toEqual({
      status: 429,
      body: { error: { message: "slow", type: "rate_limit_error", param: null, code: null } },
    })
  })

  async function stream(list: PlugEvent[], index = 0) {
    let text = ""
    const result = await codec.streamChoice(events(...list), (chunk) => void (text += chunk), { id: "cmpl-shared", created: 7, index })
    return { text, result, chunks: sseData(text) }
  }

  test("streamChoice: the echo prefix, text chunks and a finish chunk with this choice's index; no [DONE] (the fan-out owns it)", async () => {
    const { chunks, text, result } = await stream([ev.text("a"), ev.text("b"), ev.finish("stop", { inputTokens: 1 })], 1)
    expect(chunks.map((chunk) => [chunk.choices[0].text, chunk.choices[0].index, chunk.choices[0].finish_reason])).toEqual([
      ["P0 ", 1, null],
      ["a", 1, null],
      ["b", 1, null],
      ["", 1, "stop"],
    ])
    expect(chunks.every((chunk) => chunk.id === "cmpl-shared" && chunk.created === 7)).toBe(true)
    expect(text).not.toContain("[DONE]")
    expect(result).toEqual({ started: true, usage: { inputTokens: 1 } })
  })

  test("streamChoice: a failure before text writes nothing", async () => {
    const { text, result } = await stream([ev.error({ message: "x" })])
    expect(text).toBe("")
    expect(result).toEqual({ started: false, failure: { status: 502, kind: "server", message: "x" } })
  })

  test("usageChunk: no choices, the summed totals", () => {
    expect(codec.usageChunk({ id: "cmpl-shared", created: 7 }, { inputTokens: 2, outputTokens: 3 })).toEqual({
      id: "cmpl-shared",
      object: "text_completion",
      created: 7,
      model: "fast",
      choices: [],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    })
  })
})

describe("#169 response_format on legacy completions, as on Chat Completions", () => {
  const jsonSchema = { type: "json_schema", json_schema: { name: "answer", schema: { type: "object", properties: { a: { type: "number" } }, required: ["a"] } } }

  test("json_schema is the forced respond tool, and the answer is its arguments", () => {
    const parsed = parse(body({ response_format: jsonSchema }))
    expect(parsed.requests[0]).toMatchObject({
      tools: [{ name: "respond", parameters: { type: "object", required: ["a"] } }],
      toolChoice: { type: "tool", name: "respond" },
      structuredTool: "respond", // #252: tools: false keeps respond
    })
    expect(parsed.exchange).toMatchObject({ structuredTool: "respond" })
    expect(parsed.exchange.jsonObject).toBeUndefined()
  })

  test("json_object is a system instruction and the answer loses one code fence", () => {
    const parsed = parse(body({ suffix: "!", response_format: { type: "json_object" } }))
    expect(parsed.requests[0]!.system).toHaveLength(2)
    expect(parsed.requests[0]!.tools).toEqual([])
    expect(parsed.requests[0]!.toolChoice).toBeUndefined()
    expect(parsed.exchange).toMatchObject({ jsonObject: true })
    expect(parsed.exchange.structuredTool).toBeUndefined()
  })

  test("response_format text changes nothing", () => {
    expect(parse(body({ response_format: { type: "text" } }))).toEqual(parse(body()))
  })

  test("an invalid response_format is a 400 naming the field", () => {
    expect(parseCompletionsRequest(body({ response_format: { type: "yaml" } }), options)).toMatchObject({ status: 400, param: "response_format.type" })
    expect(parseCompletionsRequest(body({ response_format: { type: "json_schema", json_schema: { name: "x" } } }), options)).toMatchObject({
      status: 400,
      param: "response_format.json_schema.schema",
    })
  })
})

describe("#169 the text_completion codec with structured output", () => {
  const structured: CompletionsExchange = { model: "fast", stream: false, includeUsage: false, perPrompt: 1, structuredTool: "respond" }
  const fenced: CompletionsExchange = { model: "fast", stream: false, includeUsage: false, perPrompt: 1, jsonObject: true }

  test("collect: the text is the respond call's arguments; prose and other calls are dropped", async () => {
    const result = (await completionsCodec(structured).collect(events(ev.text("thinking"), ev.call("c0", "other"), ev.call("c1", "respond", { a: 42 }), ev.finish("tool-calls")), 0)) as { status: number; body: any }
    expect(result.status).toBe(200)
    expect(result.body.choices[0]).toMatchObject({ text: '{"a":42}', finish_reason: "stop" })
  })

  test("collect: no respond call is a 502 structured_output_missing", async () => {
    expect(await completionsCodec(structured).collect(events(ev.text("6 × 7 = 42"), ev.finish("stop")), 0)).toEqual({
      status: 502,
      body: { error: { message: "The model did not return JSON matching the response schema. Say the expected JSON, with its keys and types, in the prompt.", type: "server_error", param: null, code: "structured_output_missing" } },
    })
  })

  test("collect: json_object strips one fence", async () => {
    const result = (await completionsCodec(fenced).collect(events(ev.text('```json\n{"ok":true}\n```'), ev.finish("stop")), 0)) as { body: any }
    expect(result.body.choices[0].text).toBe('{"ok":true}')
  })

  test("streamChoice: a structured answer is one text chunk, then the finish chunk", async () => {
    let text = ""
    const result = await completionsCodec(structured).streamChoice(events(ev.text("prose"), ev.call("c1", "respond", { a: 1 }), ev.finish("tool-calls")), (chunk) => void (text += chunk), { id: "cmpl-s", created: 1, index: 0 })
    expect(sseData(text).map((chunk) => [chunk.choices[0].text, chunk.choices[0].finish_reason])).toEqual([
      ['{"a":1}', null],
      ["", "stop"],
    ])
    expect(result).toEqual({ started: true })
  })

  test("streamChoice: a structured turn with no answer fails before any output", async () => {
    let text = ""
    const result = await completionsCodec(structured).streamChoice(events(ev.text("prose"), ev.finish("stop")), (chunk) => void (text += chunk), { id: "cmpl-s", created: 1, index: 0 })
    expect(text).toBe("")
    expect(result).toMatchObject({ started: false, failure: { status: 502, code: "structured_output_missing" } })
  })
})

describe("#170 the text_completion codec takes a text answer that matches the schema", () => {
  const schema = { type: "object", required: ["a"] }
  const exchange: CompletionsExchange = { model: "fast", stream: false, includeUsage: false, perPrompt: 1, structuredTool: "respond", structuredSchema: schema }

  test("collect: the JSON text is the answer, flagged as a fallback", async () => {
    const result = (await completionsCodec(exchange).collect(events(ev.text('{"a":7}'), ev.finish("stop")), 0)) as { status: number; body: any; structuredFallback?: boolean }
    expect(result).toMatchObject({ status: 200, structuredFallback: true, body: { choices: [{ text: '{"a":7}', finish_reason: "stop" }] } })
  })

  test("collect: a respond call is not flagged", async () => {
    const result = (await completionsCodec(exchange).collect(events(ev.call("c1", "respond", { a: 7 }), ev.finish("tool-calls")), 0)) as { structuredFallback?: boolean }
    expect(result.structuredFallback).toBeUndefined()
  })

  test("collect: text that does not match is still a 502", async () => {
    expect(await completionsCodec(exchange).collect(events(ev.text('{"b":7}'), ev.finish("stop")), 0)).toMatchObject({ status: 502 })
  })
})

describe("legacy completions top-level checks: exact PlugError, first failure wins", () => {
  const fail = (raw: unknown) => parseCompletionsRequest(raw, options)

  test("each check's message, param and code are unchanged", () => {
    expect(fail(body({ model: "" }))).toEqual({ status: 400, kind: "invalid_request", message: "model is required", param: "model" })
    expect(fail({ model: "test/echo" })).toEqual({ status: 400, kind: "invalid_request", message: "prompt is required", param: "prompt" })
    expect(fail(body({ prompt: null }))).toEqual({ status: 400, kind: "invalid_request", message: "prompt is required", param: "prompt" })
    expect(fail(body({ stream: "y" }))).toEqual({ status: 400, kind: "invalid_request", message: "stream must be a boolean", param: "stream" })
    expect(fail(body({ logprobs: 1 }))).toEqual({
      status: 400,
      kind: "invalid_request",
      message: "logprobs is not supported",
      code: "unsupported_parameter",
      param: "logprobs",
    })
    expect(fail(body({ best_of: 1.5 }))).toEqual({ status: 400, kind: "invalid_request", message: "best_of must be a positive integer", param: "best_of" })
    expect(fail(body({ best_of: 2 }))).toEqual({
      status: 400,
      kind: "invalid_request",
      message: "best_of is not supported",
      code: "unsupported_parameter",
      param: "best_of",
    })
    expect(fail(body({ echo: "x" }))).toEqual({ status: 400, kind: "invalid_request", message: "echo must be a boolean", param: "echo" })
    expect(fail(body({ suffix: 1 }))).toEqual({ status: 400, kind: "invalid_request", message: "suffix must be a string", param: "suffix" })
  })

  test("the first failing check in the old order wins", () => {
    expect(fail(body({ model: "", echo: "x" }))).toMatchObject({ param: "model" })
    expect(fail(body({ logprobs: 1, best_of: 2 }))).toMatchObject({ param: "logprobs" })
    expect(fail(body({ best_of: 2, echo: "x" }))).toMatchObject({ param: "best_of", message: "best_of is not supported" })
    expect(fail(body({ stream: "y", suffix: 1 }))).toMatchObject({ param: "stream" })
  })
})
