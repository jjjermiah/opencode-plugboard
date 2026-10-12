import { describe, expect, test } from "bun:test"
import type { PlugErrorKind, PlugEvent } from "../../src/contract.js"
import { encodeGeminiError, encodeGeminiModel, encodeGeminiModelList, runGenerate, sseChunk, type GeminiExchange } from "../../src/gemini/response.js"
import { listAvailableModels } from "../../src/models.js"
import { CATALOG, ev, events, testOptions } from "../support/fixtures.js"

// Non-streamed: the tests below read the aggregated body, which a stream does not build (#153).
const plain: GeminiExchange = { model: "fast", stream: false }
const structured: GeminiExchange = { ...plain, structuredTool: "respond" }

async function run(exchange: GeminiExchange, ...list: PlugEvent[]) {
  const chunks: any[] = []
  // Serialized at emit time, as the route's `sseChunk` does: the encoder reuses part objects for the aggregate.
  const result = await runGenerate(events(...list), exchange, (chunk) => void chunks.push(JSON.parse(JSON.stringify(chunk))))
  return { ...result, response: result.response as any, chunks, parts: chunks.map((chunk) => chunk.candidates[0].content.parts[0]) }
}

describe("runGenerate: GenerateContentResponse chunks and the aggregated body", () => {
  test("one chunk per piece of output, then a final chunk with finishReason, usage and an empty text part", async () => {
    const { chunks, parts, response } = await run(plain, ev.reasoning("x"), ev.text("Hel"), ev.text("lo"), ev.finish("stop", { inputTokens: 10, outputTokens: 7, reasoningTokens: 3, cacheReadTokens: 2 }))
    expect(parts).toEqual([{ text: "Hel" }, { text: "lo" }, { text: "" }])
    expect(chunks.at(-1)).toMatchObject({ candidates: [{ finishReason: "STOP", index: 0 }], modelVersion: "fast", usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 17, cachedContentTokenCount: 2, thoughtsTokenCount: 3 } })
    expect(new Set(chunks.map((chunk) => chunk.responseId)).size).toBe(1)
    expect(response).toMatchObject({ candidates: [{ content: { role: "model", parts: [{ text: "Hello" }] }, finishReason: "STOP" }], modelVersion: "fast" })
  })

  test("a tool call is a functionCall part with object args; Gemini reports STOP after one", async () => {
    const { response } = await run(plain, ev.call("c1", "weather", { city: "Oslo" }), ev.call("c2", "raw", "not an object"), ev.finish("tool-calls"))
    expect(response.candidates[0]).toMatchObject({ finishReason: "STOP", content: { parts: [{ functionCall: { name: "weather", args: { city: "Oslo" } } }, { functionCall: { name: "raw", args: { value: "not an object" } } }] } })
  })

  test.each([
    ["length", "MAX_TOKENS"],
    ["content-filter", "SAFETY"],
  ] as const)("finish %s -> %s", async (reason, wire) => {
    expect((await run(plain, ev.text("x"), ev.finish(reason))).response.candidates[0].finishReason).toBe(wire)
  })

  test("an empty answer has one empty text part, and no usage when none was reported", async () => {
    const { response } = await run(plain, ev.finish())
    expect(response.candidates[0].content.parts).toEqual([{ text: "" }])
    expect(response).not.toHaveProperty("usageMetadata")
  })

  test("a failure before output emits nothing; after output the chunks stay and the run reports the failure", async () => {
    expect(await run(plain, ev.error({ status: 429, kind: "rate_limit", message: "slow" }))).toMatchObject({ chunks: [], started: false, failure: { status: 429 } })
    const after = await run(plain, ev.text("part"), ev.error({ message: "died" }))
    expect(after).toMatchObject({ started: true, failure: { message: "died" } })
    expect(after.response).toBeUndefined()
  })

  test("structured output: the respond call's input is the text; a wrapped schema is unwrapped", async () => {
    expect((await run(structured, ev.text("prose"), ev.call("c1", "respond", { a: 1 }), ev.finish("tool-calls"))).response.candidates[0].content.parts).toEqual([{ text: '{"a":1}' }])
    expect((await run({ ...structured, wrapped: true }, ev.call("c1", "respond", { value: ["x", "y"] }), ev.finish())).response.candidates[0].content.parts).toEqual([{ text: '["x","y"]' }])
    expect((await run(structured, ev.finish())).failure).toMatchObject({ status: 502, code: "structured_output_missing" })
  })

  test("structured with caller tools: a caller call replaces the held answer", async () => {
    const { response } = await run({ ...structured, callerTools: true }, ev.call("c1", "respond", { a: 1 }), ev.call("c2", "search"), ev.finish("tool-calls"))
    expect(response.candidates[0].content.parts).toEqual([{ functionCall: { name: "search", args: {} } }])
  })

  test("json mode: one code fence around JSON is stripped", async () => {
    expect((await run({ ...plain, jsonObject: true }, ev.text("```json\n"), ev.text('{"a":1}\n```'), ev.finish())).response.candidates[0].content.parts).toEqual([{ text: '{"a":1}' }])
  })

  test("sseChunk is a bare data line, no event name and no [DONE]", () => {
    expect(sseChunk({ a: 1 })).toBe('data: {"a":1}\n\n')
  })
})

describe("Google error bodies and model entries", () => {
  const kinds: Array<[PlugErrorKind, number, string]> = [
    ["invalid_request", 400, "INVALID_ARGUMENT"],
    ["authentication", 401, "UNAUTHENTICATED"],
    ["permission", 403, "PERMISSION_DENIED"],
    ["not_found", 404, "NOT_FOUND"],
    ["rate_limit", 429, "RESOURCE_EXHAUSTED"],
    ["server", 500, "INTERNAL"],
    ["server", 503, "UNAVAILABLE"],
    ["timeout", 504, "DEADLINE_EXCEEDED"],
  ]
  test.each(kinds)("%s with status %d -> %s", (kind, status, google) => {
    expect(encodeGeminiError({ status, kind, message: "m" })).toEqual({ error: { code: status, message: "m", status: google } })
  })

  test("an error with a param carries a BadRequest field violation", () => {
    expect(encodeGeminiError({ status: 400, kind: "invalid_request", message: "bad", param: "contents" })).toEqual({
      error: { code: 400, message: "bad", status: "INVALID_ARGUMENT", details: [{ "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [{ field: "contents", description: "bad" }] }] },
    })
  })

  test("models are listed as models/<id> with the generation methods", () => {
    const listed = listAvailableModels(testOptions({ models: ["test/echo"] }), CATALOG)
    expect(encodeGeminiModelList(listed)).toEqual({
      models: [
        { name: "models/test/echo", version: "plugboard", displayName: "Echo", description: "test model served by opencode-plugboard", inputTokenLimit: 8192, supportedGenerationMethods: ["generateContent", "streamGenerateContent"] },
        expect.objectContaining({ name: "models/test/echo#low" }),
        expect.objectContaining({ name: "models/test/echo#high" }),
      ],
    })
    expect(encodeGeminiModel(listAvailableModels(testOptions({ models: ["test/vision"] }), CATALOG)[0]!)).toMatchObject({ name: "models/test/vision", displayName: "test/vision" })
  })
})

describe("#153 a stream keeps no aggregate", () => {
  test("a long streamed answer leaves the aggregated body empty, while every chunk still goes out", async () => {
    const list = Array.from({ length: 2_000 }, (_, index) => ev.text(`chunk ${index} `))
    const { response, chunks } = await run({ ...plain, stream: true }, ...list, ev.finish("stop"))
    expect(response.candidates[0].content.parts).toEqual([{ text: "" }])
    expect(chunks.length).toBeGreaterThan(2_000)
  })

  test("a non-streamed answer keeps its parts for the JSON body", async () => {
    const { response } = await run({ ...plain, stream: false }, ev.text("Hi"), ev.finish("stop"))
    expect(response.candidates[0].content.parts).toEqual([{ text: "Hi" }])
  })
})

describe("#173 runGenerate: a text answer and the 502 for every finish", () => {
  const schema = { type: "object", required: ["a"], properties: { a: { type: "number" } } }
  const withSchema: GeminiExchange = { ...structured, structuredSchema: schema }

  test("the final text is the answer when it is the schema's JSON, flagged as a fallback", async () => {
    const { response, failure, structuredFallback } = await run(withSchema, ev.text('{"a":3}'), ev.finish("stop"))
    expect(failure).toBeUndefined()
    expect(response.candidates[0].content.parts).toEqual([{ text: '{"a":3}' }])
    expect(structuredFallback).toBe(true)
  })

  test("a respond call wins over the text and is not flagged", async () => {
    const { response, structuredFallback } = await run(withSchema, ev.text('{"a":9}'), ev.call("c1", "respond", { a: 1 }), ev.finish("tool-calls"))
    expect(response.candidates[0].content.parts).toEqual([{ text: '{"a":1}' }])
    expect(structuredFallback).toBeUndefined()
  })

  test("a wrapped (array) schema takes its text as the answer when the text is that JSON", async () => {
    const wrapped: GeminiExchange = { ...structured, wrapped: true, structuredSchema: { type: "array" } }
    expect((await run(wrapped, ev.text('["x"]'), ev.finish("stop"))).response.candidates[0].content.parts).toEqual([{ text: '["x"]' }])
  })

  test("text that does not match the schema is a 502 before any output", async () => {
    const { failure, started, chunks } = await run(withSchema, ev.text("prose"), ev.finish("stop"))
    expect(failure).toMatchObject({ status: 502, code: "structured_output_missing" })
    expect(started).toBe(false)
    expect(chunks).toEqual([])
  })

  test.each(["length", "content-filter"] as const)("#173 a %s finish with no answer is a 502, not a candidate with no content", async (reason) => {
    expect((await run(withSchema, ev.finish(reason))).failure).toMatchObject({ status: 502, code: "structured_output_missing" })
  })
})
