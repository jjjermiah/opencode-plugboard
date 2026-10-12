/**
 * The Gemini front-end over loopback HTTP: `generateContent`, `streamGenerateContent?alt=sse`,
 * the model routes, the three key sources and Google's error body.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { CATALOG, ev, gate } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { parseSse, sseData, startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller, type Script } from "../support/model-caller.js"

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
    expect((await server!.send({ path: "/v1beta/models" })).json().models.map((model: { name: string }) => model.name)).toEqual(["models/test/echo", "models/test/echo#low", "models/test/echo#high", "models/fast"])
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

  test("streamGenerateContent without alt=sse is a 400 on param alt", async () => {
    const caller = await route([ev.finish()])
    const reply = await server!.send(stream(""))
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
    expect(reply.json()).toMatchObject({ error: { code: 502, status: "INTERNAL", message: expect.stringContaining("respond") } })
  })
})
