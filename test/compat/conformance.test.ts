/**
 * #107 Cross-endpoint conformance: plugboard's responses and stream events, sent over loopback,
 * validated against the upstream response schemas vendored in test/fixtures/specs (OpenAI's
 * OpenAPI 3.1 document, Gemini's discovery document; see vendor.ts for the sources and dates).
 *
 * Every object a response carries must be in the schema (no unknown fields) and every required
 * field must be present. A known deviation is a `test.failing` that names it: the response is
 * then validated with that one field waived, so only the named gap is open. Anthropic's Messages
 * spec has no public source to vendor, so the Anthropic shapes are covered by the SDK types (#132).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js"
import { ev } from "../support/fixtures.js"
import { parseSse, startRoute, type RouteServer } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { STREAM_DELTAS, TEXT, USAGE, tag } from "./scenarios.js"

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

/** Compiled validators per spec. `waived` is the set of required fields a known gap leaves out. */
function compiler(waived: ReadonlySet<string>) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false })
  const validators = new Map<string, ValidateFunction>()
  for (const [name, vendored] of [
    ["openai", openai],
    ["gemini", gemini],
  ] as const) {
    const branched = new Set<string>()
    collectBranches(vendored.$defs, branched)
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

test("#107 the vendored specs record their source and retrieval date", () => {
  for (const vendored of [openai, gemini]) {
    expect(vendored.$source.startsWith("https://")).toBe(true)
    expect(vendored.$retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  }
})
