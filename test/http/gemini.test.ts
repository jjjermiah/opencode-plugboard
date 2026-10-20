/**
 * The Gemini front-end over loopback HTTP: `generateContent`, `streamGenerateContent?alt=sse`,
 * the model routes, the three key sources and Google's error body.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { CATALOG, ev, gate } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { parseSse, sseData, startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller, type Script } from "../support/model-caller.js"
import { FakeSessionPort } from "../support/session.js"
import { RequestAborted } from "../../src/http.js"
import { personaOf } from "../../src/models.js"

const logs = captureLogs()
let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

async function route(script: Script, options: Record<string, unknown> = {}) {
  const caller = new FakeModelCaller(script)
  server = await startRoute({ caller, options: { aliases: { fast: "test/echo" }, ...options } })
  return caller
}

const generate = (path = "/v1beta/models/fast:generateContent", extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): SendInit => ({
  method: "POST",
  path,
  headers,
  body: { contents: [{ role: "user", parts: [{ text: "hi" }] }], ...extra },
})
const stream = (query = "?alt=sse", headers: Record<string, string> = {}) => generate(`/v1beta/models/fast:streamGenerateContent${query}`, {}, headers)
const googleError = (code: number, status: string) => ({ error: expect.objectContaining({ code, status, message: expect.any(String) }) })

describe("key sources", () => {
  test.each([
    ["x-goog-api-key (the SDKs)", "/v1beta/models/fast:generateContent", { "x-goog-api-key": "secret" }],
    ["the key query parameter", "/v1beta/models/fast:generateContent?key=secret", {}],
    ["Authorization: Bearer", "/v1beta/models/fast:generateContent", { authorization: "Bearer secret" }],
  ])("%s authenticates", async (_name, path, headers) => {
    const caller = await route([ev.finish()], { keys: { app: "secret" } })
    expect((await server!.send(generate(path, {}, headers))).status).toBe(200)
    expect(caller.call.context.app).toBe("app")
  })

  test("Authorization wins over x-goog-api-key, so a wrong Bearer is a 401 even with a right key", async () => {
    await route([ev.finish()], { keys: { app: "secret" } })
    expect((await server!.send(generate(undefined, {}, { authorization: "Bearer nope", "x-goog-api-key": "secret" }))).status).toBe(401)
  })

  test("a missing key is a 401 in Google's error shape, and the key in a URL never reaches the log", async () => {
    const caller = await route([ev.finish()], { keys: { app: "secret" } })
    const reply = await server!.send(generate("/v1beta/models/fast:generateContent?key=wrong-key-value"))
    expect(reply.status).toBe(401)
    expect(reply.json()).toEqual(googleError(401, "UNAUTHENTICATED"))
    expect(caller.calls).toEqual([])
    expect(logs.lines.map((line) => line.raw).join("\n")).not.toContain("wrong-key-value")
  })

  test("the keyless Origin rule answers in Google's shape too", async () => {
    await route([ev.finish()])
    const reply = await server!.send(generate(undefined, {}, { origin: "https://example.com" }))
    expect(reply.status).toBe(403)
    expect(reply.json()).toEqual(googleError(403, "PERMISSION_DENIED"))
  })
})

describe("routes", () => {
  test("GET /v1beta/models lists models/<id> entries; GET one by id; an unknown one is a Google 404", async () => {
    await route([ev.finish()], { models: ["test/echo"] })
    expect((await server!.send({ path: "/v1beta/models" })).json().models.map((model: { name: string }) => model.name)).toEqual([
      "models/test/echo",
      "models/test/echo#low",
      "models/test/echo#high",
      "models/fast",
    ])
    expect((await server!.send({ path: "/v1beta/models/test%2Fecho" })).json()).toMatchObject({ name: "models/test/echo" })
    const missing = await server!.send({ path: "/v1beta/models/ghost" })
    expect(missing.status).toBe(404)
    expect(missing.json()).toEqual(googleError(404, "NOT_FOUND"))
  })

  test("GET /v1/models stays the OpenAI list", async () => {
    await route([ev.finish()])
    expect((await server!.send({ path: "/v1/models" })).json().object).toBe("list")
  })

  test("countTokens answers { totalTokens } (#144); an unsupported method is a Google 404 method_not_supported", async () => {
    await route([ev.finish()])
    const count = await server!.send(generate("/v1beta/models/fast:countTokens"))
    expect(count.status).toBe(200)
    expect(count.json()).toEqual({ totalTokens: expect.any(Number) })
    const reply = await server!.send(generate("/v1beta/models/fast:embedContent"))
    expect(reply.status).toBe(404)
    expect(reply.json().error.message).toContain("embedContent is not supported")
  })

  test("#201 countTokens includes the app's system policy", async () => {
    await route([ev.finish()])
    const plain = (await server!.send(generate("/v1beta/models/fast:countTokens"))).json().totalTokens
    await server!.close()
    await route([ev.finish()], { apps: { default: { system: "P".repeat(400), systemMode: "prepend" } } })
    const withPolicy = (await server!.send(generate("/v1beta/models/fast:countTokens"))).json().totalTokens
    expect(withPolicy - plain).toBe(80)
  })

  test("the /v1/models/{model}:generateContent spelling works too, and is logged by route label", async () => {
    await route([ev.text("hi"), ev.finish()])
    expect((await server!.send(generate("/v1/models/fast:generateContent"))).status).toBe(200)
    expect(logs.of("request")[0]!.fields).toMatchObject({ route: "POST /v1/models/{model}:generateContent", model: "test/echo" })
  })

  test("#135 made-up methods share one bounded route label, unknown", async () => {
    await route([ev.finish()], { metrics: true })
    for (const verb of ["aaa", "bbb", "ccc"]) await server!.send(generate(`/v1beta/models/fast:${verb}`))
    const routes = new Set(logs.of("request").map((line) => line.fields.route))
    expect([...routes]).toEqual(["unknown"])
  })

  test("#135 different model names share one route label, the fixed template", async () => {
    await route([ev.finish()], { metrics: true })
    for (const model of ["fast", "ghost", "other-model"]) await server!.send(generate(`/v1beta/models/${model}:generateContent`))
    const routes = new Set(logs.of("request").map((line) => line.fields.route))
    expect([...routes]).toEqual(["POST /v1beta/models/{model}:generateContent"])
  })

  test("#135 paths outside the Gemini routes are labelled unknown, not by their path", async () => {
    await route([ev.finish()], { metrics: true })
    await server!.send({ path: "/v1beta/nothing-here" })
    await server!.send({ method: "DELETE", path: "/v1beta/models/fast" })
    const routes = logs.of("request").map((line) => line.fields.route)
    expect(routes).toEqual(["unknown", "unknown"])
  })

  test("streamGenerateContent with an alt other than sse or json is a 400 on param alt", async () => {
    const caller = await route([ev.finish()])
    const reply = await server!.send(stream("?alt=proto"))
    expect(reply.status).toBe(400)
    expect(reply.json().error.details[0].fieldViolations[0].field).toBe("alt")
    expect(caller.calls).toEqual([])
  })

  test("an invalid body is a 400 INVALID_ARGUMENT with a field violation", async () => {
    await route([ev.finish()])
    const reply = await server!.send(generate(undefined, { contents: [] }))
    expect(reply.status).toBe(400)
    expect(reply.json().error).toMatchObject({ status: "INVALID_ARGUMENT", details: [{ fieldViolations: [{ field: "contents" }] }] })
  })

  test("#511 #512 topK and seed reach the model call; a model whose protocol sends neither drops and reports them", async () => {
    const caller = new FakeModelCaller([ev.finish()])
    server = await startRoute({ caller, catalog: [...CATALOG, { providerID: "openai", id: "gpt-5.5", variants: [] }], options: { models: ["openai/*", "test/*"] } })
    const kept = await server.send(generate("/v1beta/models/test%2Fecho:generateContent", { generationConfig: { topK: 40, seed: 7 } }))
    expect(kept.headers).not.toHaveProperty("x-plugboard-dropped-params")
    expect(caller.calls[0]!.request.generation).toEqual({ topK: 40, seed: 7 })
    const dropped = await server.send(generate("/v1beta/models/openai%2Fgpt-5.5:generateContent", { generationConfig: { topK: 40, seed: 7 } }))
    expect(dropped.headers["x-plugboard-dropped-params"]).toBe("top_k,seed")
    expect(caller.calls[1]!.request.generation).toEqual({})
  })

  test("sampling a model rejects is dropped and reported", async () => {
    const caller = new FakeModelCaller([ev.finish()])
    server = await startRoute({ caller, catalog: [...CATALOG, { providerID: "openai", id: "gpt-5.5", variants: [] }], options: { models: ["openai/*"] } })
    const reply = await server.send(generate("/v1beta/models/openai%2Fgpt-5.5:generateContent", { generationConfig: { temperature: 0.2 } }))
    expect(reply.headers["x-plugboard-dropped-params"]).toBe("temperature")
    expect(caller.call.request.generation).toEqual({})
  })
})

describe("answers", () => {
  test("a JSON answer is a GenerateContentResponse with x-plugboard-session", async () => {
    await route([{ record: "ses_1" }, ev.text("Hi"), ev.finish("stop", { inputTokens: 2, outputTokens: 1 })])
    const reply = await server!.send(generate())
    expect(reply.headers["x-plugboard-session"]).toBe("ses_1")
    expect(reply.json()).toMatchObject({ candidates: [{ content: { role: "model", parts: [{ text: "Hi" }] }, finishReason: "STOP" }], usageMetadata: { totalTokenCount: 3 }, modelVersion: "fast" })
  })

  test("a model error keeps its status in Google's shape", async () => {
    await route([ev.error({ status: 429, kind: "rate_limit", message: "slow" })])
    const reply = await server!.send(generate())
    expect(reply.status).toBe(429)
    expect(reply.json()).toEqual({ error: { code: 429, message: "slow", status: "RESOURCE_EXHAUSTED" } })
  })

  test("a stream is bare data chunks, no event names and no [DONE]", async () => {
    await route([ev.text("Hel"), ev.text("lo"), ev.finish()])
    const open = await server!.open(stream())
    const text = await open.ended
    expect(open.headers["content-type"]).toBe("text/event-stream; charset=utf-8")
    expect(parseSse(text).every((frame) => frame.event === undefined)).toBe(true)
    expect(sseData(text).map((chunk) => chunk.candidates[0].content.parts[0].text)).toEqual(["Hel", "lo", ""])
    expect(text).not.toContain("[DONE]")
  })

  test("#408 each text delta is its own chunk and reaches the client before the next delta; the last chunk carries only the finish reason and usage", async () => {
    const release = gate()
    await route([ev.text("1\n2"), ev.text("\n3\n4"), { wait: release.promise }, ev.text("\n5"), ev.finish("stop", { inputTokens: 7, outputTokens: 3 })])
    const open = await server!.open(stream())
    // Both early deltas are on the wire while the model is still waiting: nothing is held back for the end.
    const early = await open.waitFor((text) => text.includes("\\n3\\n4"))
    expect(sseData(early).map((chunk) => chunk.candidates[0].content.parts[0].text)).toEqual(["1\n2", "\n3\n4"])
    release.open()
    const chunks = sseData(await open.ended)
    expect(chunks.map((chunk) => chunk.candidates[0].content.parts[0].text)).toEqual(["1\n2", "\n3\n4", "\n5", ""])
    expect(chunks.slice(0, -1).every((chunk) => chunk.candidates[0].finishReason === undefined && chunk.usageMetadata === undefined)).toBe(true)
    expect(chunks.at(-1)).toMatchObject({ candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3, totalTokenCount: 10 } })
  })

  test("#38 a stream failing before output keeps its HTTP status", async () => {
    await route([ev.error({ status: 503, message: "down" })])
    const reply = await server!.send(stream())
    expect(reply.status).toBe(503)
    expect(reply.json()).toEqual({ error: { code: 503, message: "down", status: "UNAVAILABLE" } })
  })

  test("#38 a stream failing after output ends with one Google error object", async () => {
    await route([ev.text("part"), ev.error({ status: 502, message: "died", code: "upstream" })])
    const chunks = sseData(await (await server!.open(stream())).ended)
    expect(chunks.at(-1)).toEqual({ error: { code: 502, message: "died", status: "INTERNAL" } })
    expect(logs.of("request.failed")[0]!.fields).toMatchObject({ outcome: "error", error: "upstream" })
  })

  test("#49 reasoning commits the stream, so a later failure is still the error object", async () => {
    const release = gate()
    await route([ev.reasoning("x"), { wait: release.promise }, ev.error({ message: "died" })])
    const open = await server!.open(stream())
    expect(open.status).toBe(200)
    release.open()
    expect(sseData(await open.ended)).toEqual([{ error: { code: 502, message: "died", status: "INTERNAL" } }])
  })

  test("#32 the deadline is a 504 DEADLINE_EXCEEDED", async () => {
    await route(["hang"], { requestTimeoutMs: 20 })
    const reply = await server!.send(generate())
    expect(reply.status).toBe(504)
    expect(reply.json()).toEqual(googleError(504, "DEADLINE_EXCEEDED"))
  })
})

describe("#150 a /v1beta path that matches no Gemini route", () => {
  // The AI SDK and LangChain send `/v1beta/<provider>/<model>:generateContent` (no `models/` prefix).
  const unknown = (path = "/v1beta/test/echo:generateContent", headers: Record<string, string> = {}): SendInit => ({ method: "POST", path, headers, body: {} })

  test("an authenticated unknown path is a 404 in Google's body, naming the expected shape", async () => {
    await route([ev.finish()], { keys: { app: "secret" } })
    const reply = await server!.send(unknown(undefined, { "x-goog-api-key": "secret" }))
    expect(reply.status).toBe(404)
    expect(reply.json()).toEqual(googleError(404, "NOT_FOUND"))
    expect(reply.json()).toEqual({ error: expect.objectContaining({ message: expect.stringContaining("/v1beta/models/{model}:generateContent") }) })
  })

  test("the same path with the key as Bearer is also a 404, not a 401", async () => {
    await route([ev.finish()], { keys: { app: "secret" } })
    expect((await server!.send(unknown(undefined, { authorization: "Bearer secret" }))).status).toBe(404)
  })

  test("an unauthenticated unknown path keeps the 401, so the route table is not revealed (#91, #137)", async () => {
    await route([ev.finish()], { keys: { app: "secret" } })
    const reply = await server!.send(unknown())
    expect(reply.status).toBe(401)
    expect(reply.json()).toEqual(googleError(401, "UNAUTHENTICATED"))
  })

  test("an authenticated unknown path on a keyless loopback endpoint is a 404", async () => {
    await route([ev.finish()])
    expect((await server!.send(unknown())).status).toBe(404)
  })
})

describe("#151 generateContent JSON answers: tool calls and structured output", () => {
  const weather = [{ functionDeclarations: [{ name: "weather", description: "Weather in a city", parametersJsonSchema: { type: "object", properties: { city: { type: "string" } } } }] }]
  const city = { type: "object", properties: { city: { type: "string" } }, required: ["city"] }

  test("a JSON tool call is a candidate with a functionCall part (no id), finishReason STOP, and the tool is offered to the model", async () => {
    const caller = await route([ev.call("call_1", "weather", { city: "Oslo" }), ev.finish("tool-calls", { inputTokens: 4, outputTokens: 2 })])
    const reply = await server!.send(generate(undefined, { tools: weather }))
    expect(reply.status).toBe(200)
    expect(reply.json()).toMatchObject({
      candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "weather", args: { city: "Oslo" } } }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 4, totalTokenCount: 6 },
    })
    expect(reply.json().candidates[0].content.parts[0].functionCall).not.toHaveProperty("id")
    expect(caller.call!.request.tools.map((tool) => tool.name)).toEqual(["weather"])
  })

  test("a JSON structured answer is the text of the respond call's input, as JSON", async () => {
    const caller = await route([ev.call("call_1", "respond", { city: "Oslo" }), ev.finish("tool-calls")])
    const reply = await server!.send(generate(undefined, { generationConfig: { responseMimeType: "application/json", responseSchema: city } }))
    expect(reply.status).toBe(200)
    expect(reply.json()).toMatchObject({ candidates: [{ content: { role: "model", parts: [{ text: '{"city":"Oslo"}' }] }, finishReason: "STOP" }] })
    expect(caller.call!.request.tools.map((tool) => tool.name)).toEqual(["respond"])
  })

  test("a JSON structured answer with no respond call is a 502 in Google's shape, not an empty 200", async () => {
    await route([ev.text("Sure, Oslo."), ev.finish("stop")])
    const reply = await server!.send(generate(undefined, { generationConfig: { responseMimeType: "application/json", responseSchema: city } }))
    expect(reply.status).toBe(502)
    expect(reply.json()).toMatchObject({ error: { code: 502, status: "INTERNAL", message: expect.stringContaining("did not return JSON matching the response schema") } })
  })
})

describe("#173 structured output as text, on generateContent and streamGenerateContent", () => {
  const schema = { type: "object", properties: { a: { type: "number" } }, required: ["a"] }
  const config = { generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema } }

  test("a JSON text answer that matches the schema is the answer, with x-plugboard-structured-fallback: text", async () => {
    await route([ev.text('{"a":3}'), ev.finish("stop")])
    const reply = await server!.send(generate(undefined, config))
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-structured-fallback"]).toBe("text")
    expect(reply.json().candidates[0].content.parts).toEqual([{ text: '{"a":3}' }])
  })

  test("a respond call is answered without the header", async () => {
    await route([ev.call("c1", "respond", { a: 3 }), ev.finish("tool-calls")])
    const reply = await server!.send(generate(undefined, config))
    expect(reply.headers["x-plugboard-structured-fallback"]).toBeUndefined()
    expect(reply.json().candidates[0].content.parts).toEqual([{ text: '{"a":3}' }])
  })

  test("a MAX_TOKENS finish with no answer is a 502 in Google's shape, not a candidate with no content", async () => {
    await route([ev.finish("length")])
    const reply = await server!.send(generate(undefined, config))
    expect(reply.status).toBe(502)
    expect(reply.json()).toMatchObject({ error: { code: 502, message: expect.stringContaining("did not return JSON matching the response schema") } })
  })

  test("a streamed JSON text answer that matches the schema streams it as one text chunk, with no error", async () => {
    await route([ev.text('{"a":3}'), ev.finish("stop")])
    const streamed = stream()
    const text = await (await server!.open({ ...streamed, body: { ...(streamed.body as object), ...config } })).ended
    const chunks = sseData(text)
    expect(chunks.flatMap((chunk) => chunk.candidates[0].content.parts.map((part: { text?: string }) => part.text)).filter((part) => part)).toEqual(['{"a":3}'])
    expect(chunks.some((chunk) => "error" in chunk)).toBe(false)
  })
})

describe("#201 countTokens counts the persona, skill and server tools the session sends", () => {
  /** Starts the route with a session port; the persona lookup reads the options the server parsed. */
  async function countServerWith(options: Record<string, unknown>, port: FakeSessionPort) {
    server = await startRoute({ caller: new FakeModelCaller([ev.finish()]), options, session: { port, persona: (model) => personaOf(server!.options, model) } })
  }
  const count = (model: string, headers: Record<string, string> = {}) => generate(`/v1beta/models/${model}:countTokens`, {}, headers)

  test("a skill alias counts the skill's content, which leads the system prompt", async () => {
    const port = new FakeSessionPort()
    port.skills.set("invoice-parser", "S".repeat(400))
    await countServerWith({ models: ["test/*"], aliases: { fast: "test/echo", "invoice-parser": "skill:invoice-parser@test/echo" } }, port)
    // 21 request + 4 message + (400 skill characters + 2 for "hi") / 5, rounded up (the echo model gets the Claude profile)
    expect((await server!.send(count("invoice-parser"))).json()).toEqual({ totalTokens: Math.ceil(21 + 4 + 402 / 5) })
    expect((await server!.send(count("fast"))).json()).toEqual({ totalTokens: Math.ceil(21 + 4 + 2 / 5) })
  })

  test("a skill missing from the app directory is the 404 the request would get", async () => {
    await countServerWith({ models: ["test/*"], aliases: { fast: "test/echo", "invoice-parser": "skill:invoice-parser@test/echo" } }, new FakeSessionPort())
    const reply = await server!.send(count("invoice-parser"))
    expect(reply.status).toBe(404)
    expect(reply.json()).toMatchObject({ error: { message: "Skill invoice-parser is not available" } })
  })

  test("the app's server tools count with their schemas", async () => {
    const port = new FakeSessionPort()
    port.toolIDs.push("websearch")
    const input = { type: "object", properties: { q: { type: "string" } } }
    port.toolSchemas.set("websearch", { description: "D".repeat(200), input })
    await countServerWith({ aliases: { fast: "test/echo" }, keys: { app: "secret" }, apps: { app: { opencodeTools: ["websearch"] } } }, port)
    // 21 request + 4 message + 534 tool preamble + 40 per tool + (2 for "hi" + name + description + JSON schema characters) / 5
    const reply = await server!.send(count("fast", { "x-goog-api-key": "secret" }))
    expect(reply.json()).toEqual({ totalTokens: Math.ceil(21 + 4 + 534 + 40 + (2 + "websearch".length + 200 + JSON.stringify(input).length) / 5) })
  })
})

/** The streamed JSON array: the whole body is one JSON document. */
const arrayOf = (text: string): any[] => JSON.parse(text)

describe("streamGenerateContent without alt=sse (since 0.50.0): the default JSON array", () => {
  const plainStream = () => stream("")

  test("the body is one JSON array of the same chunks as the SSE stream, as application/json", async () => {
    await route([ev.text("Hel"), ev.text("lo"), ev.finish("stop", { inputTokens: 2, outputTokens: 1 })])
    const open = await server!.open(plainStream())
    const text = await open.ended
    expect(open.status).toBe(200)
    expect(open.headers["content-type"]).toBe("application/json; charset=utf-8")
    expect(text).not.toContain("data:")
    const chunks = arrayOf(text)
    expect(chunks.map((chunk) => chunk.candidates[0].content.parts[0].text)).toEqual(["Hel", "lo", ""])
    expect(chunks.at(-1)).toMatchObject({ candidates: [{ finishReason: "STOP", index: 0 }], usageMetadata: { totalTokenCount: 3 }, modelVersion: "fast" })
  })

  test("the array is written as it goes: the first element is on the wire before the model finishes", async () => {
    const release = gate()
    await route([ev.text("A"), { wait: release.promise }, ev.text("B"), ev.finish()])
    const open = await server!.open(plainStream())
    const early = await open.waitFor((text) => text.includes('"A"'))
    // Open: it starts the array and is not yet a complete document.
    expect(early.trimStart().startsWith("[")).toBe(true)
    expect(() => JSON.parse(early)).toThrow()
    release.open()
    expect(arrayOf(await open.ended)).toHaveLength(3)
  })

  test("alt=json is the same as no alt", async () => {
    await route([ev.text("x"), ev.finish()])
    const open = await server!.open(stream("?alt=json"))
    expect(open.headers["content-type"]).toBe("application/json; charset=utf-8")
    expect(arrayOf(await open.ended)).toHaveLength(2)
  })

  test("alt=sse still streams SSE", async () => {
    await route([ev.text("x"), ev.finish()])
    expect((await server!.open(stream("?alt=sse"))).headers["content-type"]).toBe("text/event-stream; charset=utf-8")
  })

  test("a failure before output keeps its HTTP status and Google's error body", async () => {
    await route([ev.error({ status: 503, message: "down" })])
    const reply = await server!.send(plainStream())
    expect(reply.status).toBe(503)
    expect(reply.json()).toEqual({ error: { code: 503, message: "down", status: "UNAVAILABLE" } })
  })

  test("a failure after output ends the array with one error object, still valid JSON", async () => {
    await route([ev.text("part"), ev.error({ status: 502, message: "died", code: "upstream" })])
    const chunks = arrayOf(await (await server!.open(plainStream())).ended)
    expect(chunks.map((chunk) => (chunk.error ? "error" : chunk.candidates[0].content.parts[0].text))).toEqual(["part", "error"])
    expect(chunks.at(-1)).toEqual({ error: { code: 502, message: "died", status: "INTERNAL" } })
    expect(logs.of("request.failed")[0]!.fields).toMatchObject({ outcome: "error", error: "upstream" })
  })

  test("reasoning commits the stream; a later failure is a one-element array holding the error", async () => {
    const release = gate()
    await route([ev.reasoning("x"), { wait: release.promise }, ev.error({ message: "died" })])
    const open = await server!.open(plainStream())
    expect(open.status).toBe(200)
    release.open()
    expect(arrayOf(await open.ended)).toEqual([{ error: { code: 502, message: "died", status: "INTERNAL" } }])
  })
})

describe("candidateCount above 1 (since 0.50.0), non-streaming", () => {
  const usage = (input: number, output: number) => ({ inputTokens: input, outputTokens: output, cacheReadTokens: 1 })
  const two = { generationConfig: { candidateCount: 2 } }
  /** A route that answers each call by its number, like the fan-out tests. */
  async function routeCalls(script: (request: unknown, call: number) => Script, options: Record<string, unknown> = {}) {
    const caller = new FakeModelCaller(script as never)
    server = await startRoute({ caller, options: { aliases: { fast: "test/echo" }, maxChoices: 4, ...options } })
    return caller
  }

  test("one model call per candidate; candidates in order with their index, usageMetadata summed, every session id", async () => {
    const caller = await routeCalls((_request, call) => [{ record: `ses_${call}` }, ev.text(`answer ${call}`), ev.finish("stop", usage(10, call + 1))])
    const reply = await server!.send(generate(undefined, { generationConfig: { candidateCount: 3 } }))
    expect(caller.calls).toHaveLength(3)
    expect(reply.status).toBe(200)
    const body = reply.json()
    expect(body.candidates.map((candidate: any) => [candidate.index, candidate.content.parts[0].text, candidate.finishReason])).toEqual([
      [0, "answer 0", "STOP"],
      [1, "answer 1", "STOP"],
      [2, "answer 2", "STOP"],
    ])
    expect(body.usageMetadata).toEqual({ promptTokenCount: 30, candidatesTokenCount: 6, totalTokenCount: 36, cachedContentTokenCount: 3 })
    expect(body.modelVersion).toBe("fast")
    expect(reply.headers["x-plugboard-session"]).toBe("ses_0,ses_1,ses_2")
  })

  test("candidateCount 1 is the single call it always was", async () => {
    const caller = await routeCalls(() => [ev.text("one"), ev.finish()])
    const reply = await server!.send(generate(undefined, { generationConfig: { candidateCount: 1 } }))
    expect(caller.calls).toHaveLength(1)
    expect(reply.json().candidates).toHaveLength(1)
  })

  test("above maxChoices is a 400 INVALID_ARGUMENT naming generationConfig.candidateCount and the option, before any model call", async () => {
    const caller = await routeCalls(() => [ev.finish()], { maxChoices: 2 })
    const reply = await server!.send(generate(undefined, { generationConfig: { candidateCount: 3 } }))
    expect(reply.status).toBe(400)
    expect(reply.json().error).toMatchObject({
      status: "INVALID_ARGUMENT",
      message: expect.stringContaining("option `maxChoices`"),
      details: [{ fieldViolations: [{ field: "generationConfig.candidateCount" }] }],
    })
    expect(caller.calls).toEqual([])
  })

  test("apps.<name>.maxChoices lowers the cap for that app and the message names it; the cap applies to streams too", async () => {
    const caller = await routeCalls(() => [ev.finish()], { keys: { chat: "k" }, apps: { chat: { maxChoices: 1 } } })
    for (const request of [
      generate(undefined, two, { "x-goog-api-key": "k" }),
      { ...stream("", { "x-goog-api-key": "k" }), body: { contents: [{ role: "user", parts: [{ text: "hi" }] }], ...two } },
    ]) {
      const reply = await server!.send(request)
      expect(reply.status).toBe(400)
      expect(reply.json().error.message).toContain("`apps.chat.maxChoices`")
    }
    expect(caller.calls).toEqual([])
  })

  test("one failing candidate fails the request with its status and cancels the others", async () => {
    const caller = await routeCalls((_request, call) => (call === 1 ? [ev.error({ status: 429, kind: "rate_limit", message: "slow" })] : ["hang"]), { maxChoices: 3 })
    const reply = await server!.send(generate(undefined, { generationConfig: { candidateCount: 3 } }))
    expect(reply.status).toBe(429)
    expect(reply.json()).toEqual({ error: { code: 429, message: "slow", status: "RESOURCE_EXHAUSTED" } })
    for (const index of [0, 2]) expect(await caller.calls[index]!.aborted).toBeInstanceOf(RequestAborted)
  })

  test("a structured answer is per candidate, and the fallback header is set when any candidate used the text", async () => {
    await routeCalls((_request, call) => (call === 0 ? [ev.call("c1", "respond", { a: 1 }), ev.finish("tool-calls")] : [ev.text('{"a":2}'), ev.finish("stop")]))
    const reply = await server!.send(
      generate(undefined, {
        generationConfig: { candidateCount: 2, responseMimeType: "application/json", responseJsonSchema: { type: "object", properties: { a: { type: "number" } }, required: ["a"] } },
      }),
    )
    expect(reply.status).toBe(200)
    expect(reply.json().candidates.map((candidate: any) => candidate.content.parts[0].text)).toEqual(['{"a":1}', '{"a":2}'])
    expect(reply.headers["x-plugboard-structured-fallback"]).toBe("text")
  })
})

describe("candidateCount above 1 (since 0.50.0), streaming", () => {
  const usage = (input: number, output: number) => ({ inputTokens: input, outputTokens: output })
  const two = { generationConfig: { candidateCount: 2 } }
  const streamTwo = (query: string): SendInit => ({ ...stream(query), body: { contents: [{ role: "user", parts: [{ text: "hi" }] }], ...two } })
  async function routeCalls(script: (request: unknown, call: number) => Script, options: Record<string, unknown> = {}) {
    const caller = new FakeModelCaller(script as never)
    server = await startRoute({ caller, options: { aliases: { fast: "test/echo" }, maxChoices: 4, ...options } })
    return caller
  }
  const textOf = (chunk: any) => chunk.candidates?.[0]?.content?.parts?.[0]?.text

  test("SSE: candidates interleave under one responseId, each chunk carrying its index; one final usage chunk; no [DONE]", async () => {
    const release = gate()
    await routeCalls((_request, call) => (call === 0 ? [ev.text("A1"), { wait: release.promise }, ev.text("A2"), ev.finish("stop", usage(5, 2))] : [ev.text("B1"), ev.finish("stop", usage(5, 1))]))
    const open = await server!.open(streamTwo("?alt=sse"))
    await open.waitFor((text) => text.includes('"finishReason":"STOP"'))
    release.open()
    const text = await open.ended
    const chunks = sseData(text)
    expect(open.headers["content-type"]).toBe("text/event-stream; charset=utf-8")
    expect(text).not.toContain("[DONE]")
    const candidates = chunks.filter((chunk) => chunk.candidates)
    expect(new Set(candidates.map((chunk) => chunk.responseId)).size).toBe(1)
    const order = candidates.map((chunk) => `${chunk.candidates[0].index}:${textOf(chunk)}`)
    // Candidate 1 finished while candidate 0 was still waiting.
    expect(order.indexOf("1:")).toBeLessThan(order.indexOf("0:A2"))
    expect(order.filter((entry) => entry.startsWith("0:"))).toEqual(["0:A1", "0:A2", "0:"])
    expect(
      candidates
        .filter((chunk) => chunk.candidates[0].finishReason)
        .map((chunk) => chunk.candidates[0].index)
        .sort(),
    ).toEqual([0, 1])
    expect(candidates.some((chunk) => chunk.usageMetadata)).toBe(false)
    expect(chunks.at(-1)).toEqual({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, totalTokenCount: 13 }, modelVersion: "fast", responseId: candidates[0].responseId })
  })

  test("array (no alt): the same chunks as one valid JSON array, ending with the summed usage chunk", async () => {
    await routeCalls((_request, call) => [ev.text(`t${call}`), ev.finish("stop", usage(4, 1))])
    const open = await server!.open(streamTwo(""))
    const chunks = arrayOf(await open.ended)
    expect(open.headers["content-type"]).toBe("application/json; charset=utf-8")
    expect(
      chunks
        .filter((chunk) => textOf(chunk))
        .map((chunk) => [chunk.candidates[0].index, textOf(chunk)])
        .sort(),
    ).toEqual([
      [0, "t0"],
      [1, "t1"],
    ])
    expect(chunks.at(-1)).toMatchObject({ usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2, totalTokenCount: 10 } })
  })

  test("a failure after the stream committed is one error object, in SSE and in the array; the other candidate is cancelled", async () => {
    for (const query of ["?alt=sse", ""]) {
      const caller = await routeCalls((_request, call) => (call === 0 ? [ev.text("A1"), "hang"] : [ev.text("B1"), ev.error({ status: 502, message: "died", code: "upstream" })]))
      const open = await server!.open(streamTwo(query))
      const text = await open.ended
      const chunks = query ? sseData(text) : arrayOf(text)
      expect(open.status).toBe(200)
      expect(chunks.at(-1)).toEqual({ error: { code: 502, message: "died", status: "INTERNAL" } })
      expect(chunks.filter((chunk) => chunk.error)).toHaveLength(1)
      expect(await caller.calls[0]!.aborted).toBeInstanceOf(RequestAborted)
      await server!.close()
      server = undefined
    }
  })

  test("a failure before anything was sent keeps its HTTP status", async () => {
    await routeCalls((_request, call) => (call === 0 ? ["hang"] : [ev.error({ status: 503, message: "down" })]))
    const reply = await server!.send(streamTwo(""))
    expect(reply.status).toBe(503)
    expect(reply.json()).toEqual({ error: { code: 503, message: "down", status: "UNAVAILABLE" } })
  })

  test("a client that hangs up cancels every candidate", async () => {
    const caller = await routeCalls(() => [ev.text("x"), "hang"])
    const open = await server!.open(streamTwo("?alt=sse"))
    await open.waitFor((text) => text.includes('"x"'))
    open.destroy()
    for (const call of [0, 1]) expect(((await caller.calls[call]!.aborted) as RequestAborted).kind).toBe("disconnected")
  })
})
