/**
 * #130 Property tests with fast-check: every request decoder takes any JSON a client can send and
 * returns either a 400 `PlugError` or a well-formed request, never a throw. Random JSON mostly
 * fails at the first check, so each decoder also gets request-shaped arbitraries whose leaves are
 * random, which reach the deeper branches. On a failure fast-check shrinks to the smallest input.
 */
import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { parseMessagesRequest } from "../../src/anthropic/request.js"
import { parseCompletionsRequest } from "../../src/completions/request.js"
import { isPlugError } from "../../src/contract.js"
import { convertSchema, parseGeminiRequest } from "../../src/gemini/request.js"
import { parseChatRequest } from "../../src/openai/request.js"
import { parseResponsesRequest } from "../../src/responses/request.js"
import { testOptions } from "../support/fixtures.js"

const options = testOptions({ maxTools: 8, maxN: 4 })
const RUNS = { numRuns: 200 }
/** Decoders are cheap: more runs reach rarer branches (a null inside a content array, an empty name). */
const DECODER_RUNS = { numRuns: 1000 }

/** What every decoder result must be: a 400 invalid_request, or a request the rest of plugboard can use. */
function wellFormed(result: unknown): boolean {
  if (isPlugError(result)) {
    expect(result).toMatchObject({ status: 400, kind: "invalid_request", message: expect.any(String) })
    return false
  }
  const requests = (result as { request?: unknown; requests?: unknown[] }).requests ?? [(result as { request: unknown }).request]
  for (const request of requests as Array<Record<string, unknown>>) {
    expect(typeof request.model).toBe("string")
    expect(Array.isArray(request.system) && request.system.every((line) => typeof line === "string")).toBe(true)
    // Chat Completions accepts a system-only conversation (OpenAI does), so messages may be empty there.
    expect(Array.isArray(request.messages)).toBe(true)
    expect(Array.isArray(request.tools)).toBe(true)
    expect(typeof request.generation).toBe("object")
    // Serializable: no cycles, no BigInt, nothing a session transcript cannot hold.
    expect(() => JSON.stringify(request)).not.toThrow()
  }
  return true
}

/** Any JSON value, or a value JSON cannot hold (undefined, NaN, -0, sparse arrays, null-prototype objects). */
const anyValue = fc.oneof(fc.jsonValue(), fc.anything({ withNullPrototype: true, withSparseArray: true }))
/** A value of any JSON type: what a field holds when the client got it wrong. */
const wrong = fc.oneof(fc.string(), fc.integer(), fc.double(), fc.boolean(), fc.constant(null), fc.jsonValue({ maxDepth: 2 }))
/** Usually `valid`, sometimes a wrong value, so both sides of every check are reached. */
const often = <T>(valid: fc.Arbitrary<T>) => fc.oneof({ arbitrary: valid, weight: 12 }, { arbitrary: wrong, weight: 1 })
const maybe = <T>(arbitrary: fc.Arbitrary<T>) => fc.option(arbitrary, { nil: undefined, freq: 2 })
const list = <T>(arbitrary: fc.Arbitrary<T>, maxLength = 3) => fc.array(arbitrary, { maxLength })
const text = fc.oneof(fc.string(), fc.constantFrom("hi", "", "respond", "__proto__"))
const name = fc.constantFrom("f", "g", "respond", "")
const number = (min: number, max: number) => fc.oneof(fc.double({ min, max, noNaN: true }), fc.integer({ min: min - 1, max: max + 1 }))
const schema = fc.oneof(fc.constant({ type: "object", properties: { a: { type: "string" } } }), fc.jsonValue({ maxDepth: 3 }))

/**
 * Run `decode` on `arbitrary` and require a well-formed result. A request-shaped arbitrary must also
 * decode successfully some of the time, or it is not reaching the branches it was written for.
 */
function property(arbitrary: fc.Arbitrary<unknown>, decode: (body: unknown) => unknown, shaped = false) {
  let decoded = 0
  fc.assert(
    fc.property(arbitrary, (body) => {
      if (wellFormed(decode(body))) decoded++
    }),
    DECODER_RUNS,
  )
  if (shaped) expect(decoded).toBeGreaterThan(DECODER_RUNS.numRuns / 100)
}

describe("#130 Chat Completions decoder", () => {
  const decode = (body: unknown) => parseChatRequest(body, options)
  const part = fc.record({ type: fc.constantFrom("text", "image_url", "file", "input_audio"), text: often(text), image_url: often(fc.record({ url: often(fc.constantFrom("data:image/png;base64,AA", "https://x.test/a.png")) })), file: fc.record({ file_data: often(fc.string()) }) }, { requiredKeys: ["type"] })
  const call = fc.record({ id: often(fc.constantFrom("c1", "c2", "")), type: fc.constant("function"), function: fc.record({ name: often(name), arguments: often(fc.constantFrom("{}", '{"a":1}', "not json")) }) })
  const message = fc.oneof(
    { arbitrary: fc.record({ role: fc.constantFrom("system", "developer", "user"), content: often(fc.oneof(text, list(often(part)))) }), weight: 4 },
    { arbitrary: fc.record({ role: fc.constant("assistant"), content: maybe(often(text)), tool_calls: maybe(often(list(often(call), 2))) }), weight: 2 },
    fc.record({ role: fc.constantFrom("tool", "function"), tool_call_id: often(fc.constantFrom("c1", "c2")), content: often(text) }),
  )
  const body = fc.record(
    {
      model: often(text),
      messages: often(fc.array(message, { minLength: 1, maxLength: 4 })),
      tools: maybe(often(list(fc.record({ type: fc.constant("function"), function: fc.record({ name: often(name), description: maybe(often(fc.string())), parameters: maybe(schema) }) })))),
      tool_choice: maybe(often(fc.oneof(fc.constantFrom("auto", "none", "required"), fc.record({ type: fc.constant("function"), function: fc.record({ name: name }) })))),
      response_format: maybe(often(fc.oneof(fc.record({ type: fc.constantFrom("text", "json_object") }), fc.record({ type: fc.constant("json_schema"), json_schema: fc.record({ name: maybe(fc.string()), schema }) })))),
      temperature: maybe(often(number(0, 2))),
      top_p: maybe(often(number(0, 1))),
      max_tokens: maybe(often(fc.integer({ min: 0, max: 1000 }))),
      stop: maybe(often(fc.oneof(fc.string(), list(fc.string(), 5)))),
      n: maybe(often(fc.integer({ min: 0, max: 6 }))),
      stream: maybe(often(fc.boolean())),
      reasoning_effort: maybe(often(fc.constantFrom("low", "high"))),
    },
    { requiredKeys: ["model", "messages"] },
  )
  test("any value is a 400 or a request", () => property(anyValue, decode))
  test("any request-shaped body is a 400 or a request", () => property(body, decode, true))
})

describe("#130 Responses decoder", () => {
  const decode = (body: unknown) => parseResponsesRequest(body, options)
  const content = fc.record({ type: fc.constantFrom("input_text", "output_text", "input_image", "input_file", "refusal"), text: often(text), image_url: maybe(often(fc.string())), file_data: maybe(often(fc.string())) }, { requiredKeys: ["type"] })
  const item = fc.oneof(
    fc.record({ type: maybe(fc.constant("message")), role: often(fc.constantFrom("system", "developer", "user", "assistant")), content: often(fc.oneof(text, list(often(content)))) }),
    fc.record({ type: fc.constant("function_call"), call_id: often(fc.constantFrom("c1", "c2")), name: often(name), arguments: often(fc.constantFrom("{}", "x")) }),
    fc.record({ type: fc.constant("function_call_output"), call_id: often(fc.constantFrom("c1", "c2")), output: often(text) }),
    fc.record({ type: fc.constantFrom("reasoning", "item_reference", "web_search_call") }),
  )
  const body = fc.record(
    {
      model: often(text),
      input: often(fc.oneof(text, fc.array(often(item), { minLength: 1, maxLength: 5 }))),
      instructions: maybe(often(fc.string())),
      tools: maybe(often(list(fc.record({ type: often(fc.constantFrom("function", "web_search")), name: often(name), parameters: maybe(schema) })))),
      tool_choice: maybe(often(fc.oneof(fc.constantFrom("auto", "none", "required"), fc.record({ type: fc.constant("function"), name })))),
      text: maybe(often(fc.record({ format: often(fc.record({ type: fc.constantFrom("text", "json_object", "json_schema"), schema: maybe(schema) })) }))),
      reasoning: maybe(often(fc.record({ effort: often(fc.constantFrom("low", "high")) }))),
      temperature: maybe(often(number(0, 2))),
      max_output_tokens: maybe(often(fc.integer({ min: 0, max: 100 }))),
      previous_response_id: maybe(fc.string()),
    },
    { requiredKeys: ["model", "input"] },
  )
  test("any value is a 400 or a request", () => property(anyValue, decode))
  test("any request-shaped body is a 400 or a request", () => property(body, decode, true))
})

describe("#130 Anthropic Messages decoder", () => {
  const decode = (body: unknown) => parseMessagesRequest(body, options)
  const block = fc.oneof(
    { arbitrary: fc.record({ type: fc.constant("text"), text: often(text) }), weight: 4 },
    fc.record({ type: fc.constantFrom("image", "document"), source: often(fc.record({ type: fc.constantFrom("base64", "url", "text", "file"), media_type: often(fc.constantFrom("image/png", "png")), data: often(fc.string()), url: often(fc.string()) })) }),
    fc.record({ type: fc.constant("tool_use"), id: often(fc.constantFrom("t1", "t2")), name: often(name), input: maybe(often(fc.dictionary(fc.string(), fc.jsonValue({ maxDepth: 1 }), { maxKeys: 2 }))) }),
    fc.record({ type: fc.constant("tool_result"), tool_use_id: often(fc.constantFrom("t1", "t2")), content: maybe(often(fc.oneof(text, list(fc.record({ type: fc.constantFrom("text", "image", "audio"), text: often(text) }), 2)))), is_error: maybe(fc.boolean()) }),
    fc.record({ type: fc.constantFrom("thinking", "redacted_thinking", "server_tool_use") }),
  )
  const body = fc.record(
    {
      model: often(text),
      max_tokens: often(fc.integer({ min: 0, max: 100_000 })),
      messages: often(fc.array(fc.record({ role: often(fc.constantFrom("user", "assistant", "system")), content: often(fc.oneof(text, list(often(block), 4))) }), { minLength: 1, maxLength: 4 })),
      system: maybe(often(fc.oneof(text, list(fc.record({ type: fc.constant("text"), text: often(text) }), 2)))),
      tools: maybe(often(list(fc.record({ name: often(name), input_schema: often(schema), type: maybe(fc.constantFrom("custom", "web_search_20250305")) })))),
      tool_choice: maybe(often(fc.record({ type: fc.constantFrom("auto", "any", "tool", "none"), name: maybe(name) }))),
      thinking: maybe(often(fc.record({ type: fc.constantFrom("enabled", "adaptive", "disabled"), budget_tokens: maybe(fc.integer({ min: 0, max: 200_000 })) }))),
      temperature: maybe(often(number(0, 1))),
      top_k: maybe(often(fc.integer({ min: -1, max: 100 }))),
      stop_sequences: maybe(often(list(fc.string()))),
    },
    { requiredKeys: ["model", "max_tokens", "messages"] },
  )
  test("any value is a 400 or a request", () => property(anyValue, decode))
  test("any request-shaped body is a 400 or a request", () => property(body, decode, true))
})

describe("#130 legacy completions decoder", () => {
  const decode = (body: unknown) => parseCompletionsRequest(body, options)
  const body = fc.record(
    {
      model: often(text),
      prompt: often(fc.oneof(text, fc.array(fc.oneof({ arbitrary: fc.string(), weight: 5 }, { arbitrary: fc.integer(), weight: 1 }), { minLength: 1, maxLength: 4 }))),
      n: maybe(often(fc.integer({ min: 0, max: 5 }))),
      best_of: maybe(often(fc.integer({ min: 0, max: 2 }))),
      echo: maybe(often(fc.boolean())),
      suffix: maybe(often(fc.string())),
      logprobs: maybe(fc.integer()),
      temperature: maybe(often(number(0, 2))),
    },
    { requiredKeys: ["model", "prompt"] },
  )
  test("any value is a 400 or a request", () => property(anyValue, decode))
  test("any request-shaped body is a 400 or a request", () => property(body, decode, true))
})

describe("#130 Gemini decoder", () => {
  const decode = (body: unknown) => parseGeminiRequest("fast", false, body, options)
  const part = fc.oneof(
    { arbitrary: fc.record({ text: often(text), thought: maybe(fc.boolean()) }), weight: 4 },
    fc.record({ functionCall: often(fc.record({ name: often(name), args: maybe(often(fc.dictionary(fc.string(), fc.jsonValue({ maxDepth: 1 }), { maxKeys: 2 }))), id: maybe(fc.string()) })) }),
    fc.record({ functionResponse: often(fc.record({ name: often(name), response: maybe(fc.jsonValue({ maxDepth: 2 })), id: maybe(fc.string()) })) }),
    fc.record({ inlineData: often(fc.record({ mimeType: often(fc.constant("image/png")), data: often(fc.string()) })) }),
    fc.record({ fileData: often(fc.record({ fileUri: often(fc.constantFrom("https://x.test/a.png", "gs://b/a")), mimeType: maybe(fc.string()) })) }),
    fc.record({ thoughtSignature: fc.string() }),
    fc.dictionary(fc.string(), wrong, { maxKeys: 2 }),
  )
  const body = fc.record(
    {
      contents: often(fc.array(fc.record({ role: maybe(often(fc.constantFrom("user", "model", "function"))), parts: often(fc.array(often(part), { minLength: 1, maxLength: 3 })) }), { minLength: 1, maxLength: 4 })),
      systemInstruction: maybe(often(fc.oneof(text, fc.record({ parts: list(fc.record({ text: often(text) }), 2) })))),
      tools: maybe(often(list(fc.oneof({ arbitrary: fc.record({ functionDeclarations: often(list(fc.record({ name: often(name), parameters: maybe(schema), parametersJsonSchema: maybe(schema) }))) }), weight: 4 }, fc.record({ googleSearch: fc.constant({}) })), 2))),
      toolConfig: maybe(often(fc.record({ functionCallingConfig: often(fc.record({ mode: maybe(often(fc.constantFrom("AUTO", "ANY", "NONE", "VALIDATED"))), allowedFunctionNames: maybe(often(list(name, 2))) })) }))),
      generationConfig: maybe(
        often(
          fc.record(
            {
              temperature: often(number(0, 2)),
              maxOutputTokens: often(fc.integer({ min: 0, max: 100 })),
              stopSequences: often(list(fc.string(), 6)),
              responseMimeType: often(fc.constantFrom("application/json", "text/plain", "text/x.enum")),
              responseSchema: schema,
              thinkingConfig: often(fc.record({ thinkingBudget: maybe(fc.integer({ min: -2, max: 20_000 })), thinkingLevel: maybe(fc.constantFrom("LOW", "HIGH")) })),
              candidateCount: often(fc.integer({ min: 0, max: 2 })),
            },
            { requiredKeys: [] },
          ),
        ),
      ),
    },
    { requiredKeys: ["contents"] },
  )
  test("any value is a 400 or a request", () => property(anyValue, decode))
  test("any request-shaped body is a 400 or a request", () => property(body, decode, true))
})

describe("#130 Gemini schema converter", () => {
  /** A Gemini `Schema`-shaped arbitrary, recursive. */
  /** Recursive branches stay shallow: deep trees add time, not coverage. */
  const nested = <T>(arbitrary: fc.Arbitrary<T>) => fc.option(arbitrary, { nil: undefined, depthSize: "small", depthIdentifier: "schema" })
  const { geminiSchema } = fc.letrec((tie) => ({
    geminiSchema: fc.record(
      {
        type: often(fc.constantFrom("STRING", "NUMBER", "INTEGER", "BOOLEAN", "ARRAY", "OBJECT", "NULL", "TYPE_UNSPECIFIED")),
        format: maybe(fc.constantFrom("int32", "float", "date-time", "enum")),
        nullable: maybe(fc.boolean()),
        description: maybe(wrong),
        enum: maybe(wrong),
        properties: nested(fc.dictionary(fc.string(), tie("geminiSchema"), { maxKeys: 3 })),
        items: nested(tie("geminiSchema")),
        anyOf: nested(fc.array(tie("geminiSchema"), { maxLength: 2 })),
        minItems: maybe(fc.oneof(fc.string(), fc.integer())),
        propertyOrdering: maybe(fc.array(fc.string())),
      },
      { requiredKeys: [] },
    ),
  }))

  test("never throws and returns a JSON-serializable value for any input", () => {
    fc.assert(
      fc.property(fc.oneof(anyValue, geminiSchema), (input) => {
        expect(() => JSON.stringify(convertSchema(input))).not.toThrow()
      }),
      RUNS,
    )
  })

  test("types come out lowercase JSON Schema types, nullable as a [type, null] pair", () => {
    fc.assert(
      fc.property(geminiSchema, (input) => {
        const visit = (schema: unknown): void => {
          if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return
          const out = schema as Record<string, unknown>
          if (out.type !== undefined) {
            const types = Array.isArray(out.type) ? out.type : [out.type]
            for (const type of types) expect(typeof type === "string" && type === type.toLowerCase() && type !== "type_unspecified").toBe(true)
          }
          for (const key of ["example", "propertyOrdering", "nullable"]) expect(out).not.toHaveProperty(key)
          Object.values((out.properties as Record<string, unknown>) ?? {}).forEach(visit)
          visit(out.items)
          ;((out.anyOf as unknown[]) ?? []).forEach(visit)
        }
        visit(convertSchema(input))
      }),
      RUNS,
    )
  })

  test("every property of an OBJECT schema survives conversion", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), geminiSchema, { maxKeys: 4 }), (properties) => {
        const out = convertSchema({ type: "OBJECT", properties }) as { properties: Record<string, unknown> }
        expect(Object.keys(out.properties).sort()).toEqual(Object.keys(properties).sort())
      }),
      RUNS,
    )
  })
})
