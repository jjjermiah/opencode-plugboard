/**
 * #107 Cross-endpoint conformance: plugboard's responses and stream events, sent over loopback,
 * validated against the upstream response schemas vendored in test/fixtures/specs (OpenAI's
 * OpenAPI 3.1 document, Gemini's discovery document; see vendor.ts for the sources and dates).
 * Anthropic's Messages has no published spec, so its schema is derived from the pinned SDK's types
 * (vendor-anthropic.ts).
 *
 * Every object a response carries must be in the schema (no unknown fields) and every required
 * field must be present. A known deviation is a `test.failing` that names it: the response is
 * then validated with that one field waived, so only the named gap is open.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js"
import { ev } from "../support/fixtures.js"
import { parseSse, startRoute, type RouteServer } from "../support/loopback.js"
import { FakeModelCaller, type Script } from "../support/model-caller.js"
import type { PlugEvent } from "../../src/contract.js"
import { STREAM_DELTAS, TEXT, THINKING, USAGE, tag } from "./scenarios.js"

type Schema = Record<string, unknown>
interface Vendored {
  readonly $source: string
  readonly $retrieved: string
  readonly $defs: Record<string, Schema>
}

const load = (file: string): Vendored => JSON.parse(readFileSync(new URL(`../fixtures/specs/${file}`, import.meta.url), "utf8"))

/** Each `$ref` a composition (allOf, oneOf, anyOf) names directly: a branch, checked with its siblings. */
function collectBranches(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) return value.forEach((item) => collectBranches(item, out))
  if (value === null || typeof value !== "object") return
  const record = value as Schema
  for (const key of ["allOf", "oneOf", "anyOf"]) {
    const branches = record[key]
    if (!Array.isArray(branches)) continue
    for (const branch of branches) {
      const ref = (branch as Schema | null)?.$ref
      if (typeof ref === "string") out.add(ref.slice("#/$defs/".length))
    }
  }
  for (const child of Object.values(record)) collectBranches(child, out)
}

/**
 * A copy of a schema where every object with `properties` rejects fields it does not list
 * (`additionalProperties: false`), unless it is a composition or a branch of one: those are checked
 * together by the parent, so a strict check on each would reject fields a sibling declares.
 * `waived` required fields are dropped from `required` (a documented gap, see the file header).
 */
function strict(value: unknown, composed: boolean, waived: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => strict(item, composed, waived))
  if (value === null || typeof value !== "object") return value
  const record = value as Schema
  const out: Schema = {}
  const branches = ["allOf", "oneOf", "anyOf"]
  for (const [key, child] of Object.entries(record)) {
    if (key === "required" && Array.isArray(child)) out[key] = child.filter((name) => !waived.has(String(name)))
    else out[key] = strict(child, branches.includes(key), waived)
  }
  const composes = branches.some((key) => key in record)
  if (record.properties !== undefined && !composes && !composed && record.additionalProperties === undefined) out.additionalProperties = false
  return out
}

const openai = load("openai.json")
const gemini = load("gemini.json")
const anthropic = load("anthropic.json")

/** Compiled validators per spec. `waived` is the set of required fields a known gap leaves out. */
function compiler(waived: ReadonlySet<string>) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false })
  const validators = new Map<string, ValidateFunction>()
  for (const [name, vendored] of [
    ["openai", openai],
    ["gemini", gemini],
    ["anthropic", anthropic],
  ] as const) {
    // Anthropic's unions are discriminated by `type`, each variant a `$ref` checked on its own (vendor-anthropic.ts).
    const branched = new Set<string>()
    if (name !== "anthropic") collectBranches(vendored.$defs, branched)
    const defs = Object.fromEntries(Object.entries(vendored.$defs).map(([key, schema]) => [key, strict(schema, branched.has(key), waived)]))
    ajv.addSchema({ $id: name, $defs: defs }, name)
  }
  return (spec: string, root: string): ValidateFunction => {
    const key = `${spec}/${root}`
    let validate = validators.get(key)
    if (!validate) {
      validate = ajv.compile({ $ref: `${spec}#/$defs/${root}` })
      validators.set(key, validate)
    }
    return validate
  }
}

const exact = compiler(new Set())

/** The first failing message list for `value` against `root`, or "" when it conforms. */
function violations(validate: ValidateFunction, value: unknown): string {
  if (validate(value)) return ""
  return (validate.errors ?? []).map((error: ErrorObject) => `${error.instancePath || "/"} ${error.message ?? ""}`).join("; ")
}

/** Expects `value` to conform to `root`, with the named required fields waived (a documented gap). */
const expectConforms = (spec: string, root: string, value: unknown, waived: readonly string[] = []) => {
  const validate = waived.length === 0 ? exact(spec, root) : compiler(new Set(waived))(spec, root)
  expect(violations(validate, value)).toBe("")
}

let server: RouteServer
const KEY = "conformance-key"
const auth = { authorization: `Bearer ${KEY}`, "content-type": "application/json" }
const json = (path: string, body: unknown) => ({ method: "POST", path, headers: auth, body: JSON.stringify(body) })

beforeAll(async () => {
  server = await startRoute({
    caller: new FakeModelCaller(() => [ev.text(TEXT), ev.finish("stop", USAGE)]),
    options: { keys: { conformance: KEY }, aliases: { fast: "test/echo" } },
  })
})
afterAll(async () => {
  await server.close()
})

/** Fields plugboard does not send yet (see test/types/generate.ts GAPS): the same gap the SDK types report. */
const RESPONSE_GAPS = ["access_programs", "cache_write_tokens"]

describe("#107 OpenAI responses conform to the vendored OpenAPI schemas", () => {
  test("#107 POST /v1/chat/completions (one answer) is a CreateChatCompletionResponse", async () => {
    const reply = await server.send(json("/v1/chat/completions", { model: "fast", messages: [{ role: "user", content: tag("text") }] }))
    expect(reply.status).toBe(200)
    expectConforms("openai", "CreateChatCompletionResponse", reply.json())
  })

  test("#107 every chat.completion.chunk of a stream is a CreateChatCompletionStreamResponse", async () => {
    const reply = await server.send(json("/v1/chat/completions", { model: "fast", stream: true, stream_options: { include_usage: true }, messages: [{ role: "user", content: tag("stream") }] }))
    const chunks = parseSse(reply.text).filter((frame) => frame.data !== undefined && frame.data !== "[DONE]")
    expect(chunks.length).toBeGreaterThan(STREAM_DELTAS.length)
    for (const frame of chunks) expectConforms("openai", "CreateChatCompletionStreamResponse", JSON.parse(frame.data!))
  })

  test("#107 POST /v1/completions is a CreateCompletionResponse", async () => {
    const reply = await server.send(json("/v1/completions", { model: "fast", prompt: tag("text") }))
    expectConforms("openai", "CreateCompletionResponse", reply.json())
  })

  test("#107 POST /v1/responses is a Response, with the fields plugboard does not send waived", async () => {
    const reply = await server.send(json("/v1/responses", { model: "fast", input: tag("text") }))
    expect(reply.status).toBe(200)
    expectConforms("openai", "Response", reply.json(), RESPONSE_GAPS)
  })

  test("#289 a function tool echoed on a Response carries strict: false when the caller omitted it", async () => {
    const reply = await server.send(json("/v1/responses", { model: "fast", input: tag("text"), tools: [{ type: "function", name: "weather", parameters: { type: "object", properties: {} } }] }))
    expect(reply.status).toBe(200)
    expect(reply.json().tools).toEqual([{ type: "function", name: "weather", parameters: { type: "object", properties: {} }, strict: false }])
    expectConforms("openai", "Response", reply.json(), RESPONSE_GAPS)
  })

  test("#289 a function tool with strict: true is echoed with strict: true", async () => {
    const reply = await server.send(json("/v1/responses", { model: "fast", input: tag("text"), tools: [{ type: "function", name: "weather", strict: true, parameters: { type: "object", properties: {} } }] }))
    expect(reply.json().tools).toEqual([expect.objectContaining({ name: "weather", strict: true })])
    expectConforms("openai", "Response", reply.json(), RESPONSE_GAPS)
  })

  test.failing("#107 gap: a Response carries access_programs and usage.input_tokens_details.cache_write_tokens, which plugboard omits", async () => {
    const reply = await server.send(json("/v1/responses", { model: "fast", input: tag("text") }))
    expectConforms("openai", "Response", reply.json())
  })

  test("#107 GET /v1/models is a ListModelsResponse, with the extension fields of each model set aside", async () => {
    const reply = await server.send({ method: "GET", path: "/v1/models", headers: auth })
    const listed = reply.json() as { data: Array<Record<string, unknown>> }
    // `plugboard` (the catalog's capabilities and limits) and the OpenRouter-style `context_length`, `max_output_tokens` and `pricing` are extensions; the OpenAI Model does not declare them.
    expectConforms("openai", "ListModelsResponse", {
      ...listed,
      data: listed.data.map(({ plugboard: _, context_length: _c, max_output_tokens: _m, pricing: _p, ...model }) => model),
    })
  })

  test.failing("#107 gap: each model in GET /v1/models carries a plugboard field the OpenAI Model does not declare", async () => {
    const reply = await server.send({ method: "GET", path: "/v1/models", headers: auth })
    expectConforms("openai", "ListModelsResponse", reply.json())
  })
})

describe("#107 Gemini responses conform to the vendored discovery schemas", () => {
  test("#107 generateContent is a GenerateContentResponse", async () => {
    const reply = await server.send(json("/v1beta/models/fast:generateContent", { contents: [{ role: "user", parts: [{ text: tag("text") }] }] }))
    expect(reply.status).toBe(200)
    expectConforms("gemini", "GenerateContentResponse", reply.json())
  })

  test("#107 countTokens is a CountTokensResponse", async () => {
    const reply = await server.send(json("/v1beta/models/fast:countTokens", { contents: [{ role: "user", parts: [{ text: tag("text") }] }] }))
    expect(reply.status).toBe(200)
    expectConforms("gemini", "CountTokensResponse", reply.json())
  })
})

/**
 * Anthropic fields the SDK's types require that plugboard does not send yet: the Message's nullable
 * fields, a text block's `citations`, a tool_use block's `caller` (test/types/generate.ts GAPS, and
 * the `caller` gap found by this test).
 */
const MESSAGE_GAPS = ["container", "diagnostics", "stop_details", "cache_creation", "inference_geo", "output_tokens_details", "server_tool_use", "service_tier", "citations", "caller"]
/** The SDK's error body carries request_id; plugboard sends it as the request-id header instead. */
const ERROR_GAPS = ["request_id"]
/** The stream event each SSE frame name maps to: the frame's name is its `type` (checked below). */
const EVENT_ROOTS: Record<string, string> = {
  message_start: "RawMessageStartEvent",
  content_block_start: "RawContentBlockStartEvent",
  content_block_delta: "RawContentBlockDeltaEvent",
  content_block_stop: "RawContentBlockStopEvent",
  message_delta: "RawMessageDeltaEvent",
  message_stop: "RawMessageStopEvent",
}
const anthropicAuth = { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }
const messagesPost = (body: unknown) => ({ method: "POST", path: "/v1/messages", headers: anthropicAuth, body: JSON.stringify(body) })

/** Every frame of an Anthropic stream: a named SDK event (its frame name is its type), or an `error` event as an ErrorResponse. */
function expectAnthropicStream(text: string, waived: readonly string[]): string[] {
  const frames = parseSse(text)
  expect(frames.length).toBeGreaterThan(0)
  for (const frame of frames) {
    const data = JSON.parse(frame.data!)
    expect(frame.event).toBe(data.type)
    // A keep-alive is `{type: "ping"}` alone: the SDK's stream union leaves it out, so it is checked exactly.
    if (data.type === "ping") expect(data).toEqual({ type: "ping" })
    else if (frame.event === "error") expectConforms("anthropic", "ErrorResponse", data, ERROR_GAPS)
    else {
      expect(EVENT_ROOTS[data.type], `event type ${data.type}`).toBeDefined()
      expectConforms("anthropic", EVENT_ROOTS[data.type]!, data, waived)
    }
  }
  return frames.map((frame) => frame.event!)
}

/** A route with its own scripted model, for the scenarios that need a different answer (signatures, tools, errors). */
async function withRoute<T>(script: Script, run: (route: RouteServer) => Promise<T>): Promise<T> {
  const route = await startRoute({ caller: new FakeModelCaller(script), options: { keys: { conformance: KEY }, aliases: { fast: "test/echo" } } })
  try {
    return await run(route)
  } finally {
    await route.close()
  }
}

describe("#107 Anthropic responses conform to the schemas derived from the SDK types", () => {
  test("#107 POST /v1/messages (one answer) is a Message, with the SDK fields plugboard does not send waived", async () => {
    const reply = await server.send(messagesPost({ model: "fast", max_tokens: 64, messages: [{ role: "user", content: tag("text") }] }))
    expect(reply.status).toBe(200)
    expectConforms("anthropic", "Message", reply.json(), MESSAGE_GAPS)
  })

  test("#107 every event of a text stream is its SDK stream event, in Anthropic's order", async () => {
    const reply = await server.send(messagesPost({ model: "fast", max_tokens: 64, stream: true, messages: [{ role: "user", content: tag("stream") }] }))
    const names = expectAnthropicStream(reply.text, MESSAGE_GAPS)
    expect(names[0]).toBe("message_start")
    expect(names.at(-1)).toBe("message_stop")
    expect(names).toContain("content_block_delta")
  })

  test("#107 a thinking stream carries thinking_delta and signature_delta events, all SDK events", async () => {
    const signed: PlugEvent = { type: "reasoning-delta", text: THINKING, signature: "sig_conformance" }
    await withRoute([signed, ev.text(TEXT), ev.finish("stop", USAGE)], async (route) => {
      const reply = await route.send(messagesPost({ model: "fast", max_tokens: 2048, thinking: { type: "enabled", budget_tokens: 1024 }, stream: true, messages: [{ role: "user", content: tag("thinking") }] }))
      expectAnthropicStream(reply.text, MESSAGE_GAPS)
      const deltas = parseSse(reply.text).map((frame) => JSON.parse(frame.data!)).filter((data) => data.type === "content_block_delta").map((data) => data.delta.type)
      expect(deltas).toEqual(expect.arrayContaining(["thinking_delta", "signature_delta"]))
    })
  })

  test("#107 a tool_use answer is a Message, and its stream is SDK events with input_json_delta", async () => {
    const tools = [{ name: "weather", input_schema: { type: "object", properties: { city: { type: "string" } } } }]
    await withRoute([ev.call("call_1", "weather", { city: "Oslo" }), ev.finish("tool-calls", USAGE)], async (route) => {
      const one = await route.send(messagesPost({ model: "fast", max_tokens: 64, tools, messages: [{ role: "user", content: tag("tools") }] }))
      expect(one.status).toBe(200)
      expectConforms("anthropic", "Message", one.json(), MESSAGE_GAPS)
      const streamed = await route.send(messagesPost({ model: "fast", max_tokens: 64, tools, stream: true, messages: [{ role: "user", content: tag("tools") }] }))
      expectAnthropicStream(streamed.text, MESSAGE_GAPS)
      expect(streamed.text).toContain("input_json_delta")
    })
  })

  test("#107 an error body (401, 400, a provider 429) is an ErrorResponse", async () => {
    const unauthorized = await server.send({ ...messagesPost({ model: "fast", max_tokens: 8, messages: [] }), headers: { ...anthropicAuth, "x-api-key": "nope" } })
    expect(unauthorized.status).toBe(401)
    expectConforms("anthropic", "ErrorResponse", unauthorized.json(), ERROR_GAPS)
    const invalid = await server.send(messagesPost({}))
    expect(invalid.status).toBe(400)
    expectConforms("anthropic", "ErrorResponse", invalid.json(), ERROR_GAPS)
    await withRoute([ev.error({ status: 429, kind: "rate_limit", code: "rate_limited", message: "The model provider is rate limiting requests; retry later" })], async (route) => {
      const limited = await route.send(messagesPost({ model: "fast", max_tokens: 8, messages: [{ role: "user", content: tag("error") }] }))
      expect(limited.status).toBe(429)
      expectConforms("anthropic", "ErrorResponse", limited.json(), ERROR_GAPS)
    })
  })

  test("#107 an error mid-stream ends the stream with an error event that is an ErrorResponse", async () => {
    await withRoute([ev.text("Hel"), ev.error({ status: 500, kind: "server", message: "upstream failed" })], async (route) => {
      const reply = await route.send(messagesPost({ model: "fast", max_tokens: 8, stream: true, messages: [{ role: "user", content: tag("stream") }] }))
      const names = expectAnthropicStream(reply.text, MESSAGE_GAPS)
      expect(names.at(-1)).toBe("error")
      expect(names).not.toContain("message_stop")
    })
  })

  test("#107 POST /v1/messages/count_tokens is a MessageTokensCount", async () => {
    const reply = await server.send({ ...messagesPost({ model: "fast", messages: [{ role: "user", content: tag("count-tokens") }] }), path: "/v1/messages/count_tokens" })
    expect(reply.status).toBe(200)
    expectConforms("anthropic", "MessageTokensCount", reply.json())
  })

  test("#107 the Anthropic check is strict: a stray field, on the Message or inside a content block, is a violation", async () => {
    const reply = await server.send(messagesPost({ model: "fast", max_tokens: 64, messages: [{ role: "user", content: tag("text") }] }))
    const message = reply.json() as { content: Array<Record<string, unknown>> }
    expect(violations(exact("anthropic", "Message"), { ...message, invented: true })).toContain("additional")
    expect(violations(exact("anthropic", "Message"), { ...message, content: [{ ...message.content[0], invented: true }] })).toContain("additional")
  })

  test.failing("#107 gap (#406): a Message omits the SDK's nullable fields (container, diagnostics, stop_details, usage details), which plugboard does not send", async () => {
    const reply = await server.send(messagesPost({ model: "fast", max_tokens: 64, messages: [{ role: "user", content: tag("text") }] }))
    expectConforms("anthropic", "Message", reply.json())
  })

  test.failing("#107 gap (#405): a text block omits citations, which the SDK requires (null when there are none) and plugboard does not send", async () => {
    const reply = await server.send(messagesPost({ model: "fast", max_tokens: 64, messages: [{ role: "user", content: tag("text") }] }))
    expectConforms("anthropic", "Message", reply.json(), MESSAGE_GAPS.filter((field) => field !== "citations"))
  })

  test.failing("#107 gap (#404): a tool_use block omits caller, which the SDK requires and plugboard does not send", async () => {
    await withRoute([ev.call("call_1", "weather", { city: "Oslo" }), ev.finish("tool-calls", USAGE)], async (route) => {
      const reply = await route.send(messagesPost({ model: "fast", max_tokens: 64, tools: [{ name: "weather", input_schema: { type: "object", properties: { city: { type: "string" } } } }], messages: [{ role: "user", content: tag("tools") }] }))
      expectConforms("anthropic", "Message", reply.json(), MESSAGE_GAPS.filter((field) => field !== "caller"))
    })
  })
})

test("#107 the vendored specs record their source and retrieval date", () => {
  for (const vendored of [openai, gemini, anthropic]) {
    expect(vendored.$source.startsWith("https://")).toBe(true)
    expect(vendored.$retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  }
})
