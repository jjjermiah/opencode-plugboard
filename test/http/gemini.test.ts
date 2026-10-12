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

  // #135 (open): the unsupported-method label carries the client's verb, so metric and log labels grow
  // with every made-up verb. Flip to `test` when the label is bounded.
  test.failing("#135 made-up methods share one bounded route label", async () => {
    await route([ev.finish()], { metrics: true })
    for (const verb of ["aaa", "bbb", "ccc"]) await server!.send(generate(`/v1beta/models/fast:${verb}`))
    const routes = new Set(logs.of("request").map((line) => line.fields.route))
    expect(routes.size).toBe(1)
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
