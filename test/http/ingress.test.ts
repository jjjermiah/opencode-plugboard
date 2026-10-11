/**
 * Everything the route decides before a model is called: routing, `/healthz`, the Host and
 * Origin checks, authentication, content type, body limits and the `/v1/models` endpoints, plus
 * the one request log line. Real loopback HTTP, fake model caller.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { ev } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

const logs = captureLogs()
let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

async function route(options: Record<string, unknown> = {}, caller = new FakeModelCaller([ev.text("ok"), ev.finish()])) {
  server = await startRoute({ caller, options })
  return { server, caller }
}

const chat = (extra: Partial<SendInit> = {}): SendInit => ({
  method: "POST",
  path: "/v1/chat/completions",
  body: { model: "test/echo", messages: [{ role: "user", content: "hi" }] },
  ...extra,
})

const wireError = (status: number, type: string, code: string | null, param: string | null = null) => ({ status, error: { type, code, param } })

async function expectError(init: SendInit, expected: ReturnType<typeof wireError>) {
  const reply = await server!.send(init)
  expect(reply.status).toBe(expected.status)
  expect(reply.headers["content-type"]).toBe("application/json")
  expect(reply.json().error).toMatchObject(expected.error)
  return reply
}

describe("routing", () => {
  test("GET /healthz answers ok without auth and writes no log line", async () => {
    await route({ keys: { app: "secret" } })
    const reply = await server!.send({ path: "/healthz" })
    expect(reply.status).toBe(200)
    expect(reply.json()).toEqual({ ok: true })
    expect(logs.of("request")).toEqual([])
  })

  test.each([
    ["an unknown path", { path: "/v2/chat" }],
    ["the wrong method on a known path", { method: "GET", path: "/v1/chat/completions" }],
    ["POST to the models list", { method: "POST", path: "/v1/models", body: {} }],
  ])("%s is a 404 not_found", async (_name, init) => {
    await route()
    await expectError(init, wireError(404, "not_found_error", "not_found"))
  })

  test("an unknown path is logged as route=unknown, never the client's path", async () => {
    await route()
    await server!.send({ path: "/secret-looking/path?token=abc" })
    expect(logs.of("request")).toHaveLength(1)
    expect(logs.of("request")[0]!.fields).toMatchObject({ route: "unknown", status: "404", outcome: "status_404" })
    expect(logs.lines.map((line) => line.raw).join("\n")).not.toContain("secret-looking")
  })

  test("a malformed request target is a 400 invalid_request_target", async () => {
    await route()
    await expectError({ path: "//" }, wireError(400, "invalid_request_error", "invalid_request_target"))
  })

  test("query strings do not change the route", async () => {
    await route()
    expect((await server!.send({ path: "/healthz?probe=1" })).status).toBe(200)
  })
})

describe("Host and Origin checks on a loopback listener", () => {
  test.each([
    ["127.0.0.1 with the port", (port: number) => `127.0.0.1:${port}`],
    ["localhost with the port", (port: number) => `localhost:${port}`],
    ["LOCALHOST in capitals", (port: number) => `LOCALHOST:${port}`],
    ["[::1] with the port", (port: number) => `[::1]:${port}`],
  ])("Host %s is allowed", async (_name, host) => {
    await route()
    expect((await server!.send({ path: "/healthz", headers: { host: host(server!.port) } })).status).toBe(200)
  })

  test.each([
    ["another name (DNS rebinding)", (port: number) => `evil.example:${port}`],
    ["the right name on another port", (port: number) => `127.0.0.1:${port + 1}`],
    ["no port (means 80)", () => "127.0.0.1"],
    ["127.0.0.2", (port: number) => `127.0.0.2:${port}`],
  ])("Host %s is a 403 invalid_host, even for /healthz", async (_name, host) => {
    await route()
    await expectError({ path: "/healthz", headers: { host: host(server!.port) } }, wireError(403, "permission_error", "invalid_host"))
  })

  test("a keyless endpoint refuses any Origin header (cross-site browser calls)", async () => {
    await route()
    await expectError(chat({ headers: { origin: "https://example.com" } }), wireError(403, "permission_error", "cross_origin_forbidden"))
  })

  test("with keys, an Origin header is allowed (the key is the protection)", async () => {
    await route({ keys: { app: "secret" } })
    expect((await server!.send(chat({ headers: { origin: "https://example.com", authorization: "Bearer secret" } }))).status).toBe(200)
  })
})

describe("authentication", () => {
  test.each([
    ["no Authorization header", {}],
    ["a wrong key", { authorization: "Bearer nope" }],
    ["a prefix of the key", { authorization: "Bearer secre" }],
  ])("%s is a 401 invalid_api_key and never reaches the model", async (_name, headers) => {
    const { caller } = await route({ keys: { app: "secret" } })
    await expectError(chat({ headers }), wireError(401, "authentication_error", "invalid_api_key"))
    await expectError({ path: "/v1/models", headers }, wireError(401, "authentication_error", "invalid_api_key"))
    expect(caller.calls).toEqual([])
  })

  test("the key decides the app the model call runs as", async () => {
    const { caller } = await route({ keys: { alpha: "key-a", beta: "key-b" } })
    await server!.send(chat({ headers: { authorization: "Bearer key-b" } }))
    expect(caller.call.context.app).toBe("beta")
    expect(logs.of("request")[0]!.fields.app).toBe("beta")
  })

  test("a keyless endpoint runs as the app default", async () => {
    const { caller } = await route()
    await server!.send(chat())
    expect(caller.call.context.app).toBe("default")
  })

  test("the log line never carries the key", async () => {
    await route({ keys: { app: "super-secret-key" } })
    await server!.send(chat({ headers: { authorization: "Bearer super-secret-key" } }))
    await server!.send(chat({ headers: { authorization: "Bearer wrong-secret-key" } }))
    expect(logs.lines.map((line) => line.raw).join("\n")).not.toMatch(/secret-key/)
  })
})

describe("request bodies", () => {
  test.each([
    ["no Content-Type", { "content-type": "" }],
    ["text/plain", { "content-type": "text/plain" }],
  ])("%s is a 415 unsupported_media_type", async (_name, headers) => {
    await route()
    await expectError(chat({ headers, body: '{"model":"test/echo"}' }), wireError(415, "invalid_request_error", "unsupported_media_type"))
  })

  test("application/json with a charset is accepted", async () => {
    await route()
    expect((await server!.send(chat({ headers: { "content-type": "Application/JSON; charset=utf-8" } }))).status).toBe(200)
  })

  test("invalid JSON is a 400 and logged as body_400", async () => {
    await route()
    const reply = await expectError(chat({ body: "{" }), wireError(400, "invalid_request_error", null))
    expect(reply.json().error.message).toBe("Request body is not valid JSON")
    expect(logs.of("request")[0]!.fields.outcome).toBe("body_400")
  })

  test("a declared body over 32 MiB is a 413 that closes the connection", async () => {
    await route()
    const reply = await server!.send(chat({ headers: { "content-length": 32 * 1024 * 1024 + 1 }, body: "{}" }))
    expect(reply.status).toBe(413)
    expect(reply.headers.connection).toBe("close")
    expect(logs.of("request")[0]!.fields.outcome).toBe("body_413")
  })

  test("a request rejected before its body is read still gets its answer", async () => {
    await route({ keys: { app: "secret" } })
    const big = JSON.stringify({ model: "x", messages: [{ role: "user", content: "x".repeat(4 * 1024 * 1024) }] })
    expect((await server!.send(chat({ body: big }))).status).toBe(401)
  })
})

describe("GET /v1/models and /v1/models/{id}", () => {
  test("lists the allowed models and aliases", async () => {
    await route({ models: ["test/echo"], aliases: { fast: "test/echo#low" } })
    const reply = await server!.send({ path: "/v1/models" })
    expect(reply.status).toBe(200)
    expect(reply.json().data.map((entry: { id: string }) => entry.id)).toEqual(["test/echo", "test/echo#low", "test/echo#high", "fast"])
  })

  test("one model by id, with a percent-encoded variant", async () => {
    await route()
    const reply = await server!.send({ path: "/v1/models/test%2Fecho%23high" })
    expect(reply.status).toBe(200)
    expect(reply.json()).toMatchObject({ id: "test/echo#high", object: "model", owned_by: "test" })
    expect(logs.of("request")[0]!.fields).toMatchObject({ route: "GET /v1/models/{id}", model: "test/echo#high" })
  })

  test("an id containing slashes is looked up as is", async () => {
    await route()
    expect((await server!.send({ path: "/v1/models/test/vision" })).json()).toMatchObject({ id: "test/vision" })
  })

  test("a model that is not listed is a 404 model_not_found on param model", async () => {
    await route()
    await expectError({ path: "/v1/models/other%2Fghost" }, wireError(404, "not_found_error", "model_not_found", "model"))
  })

  test("#61 ?capability=vision and ?capability=tools list only the models the catalog flags", async () => {
    await route({ models: ["test/*"] })
    const ids = async (query: string) => (await server!.send({ path: `/v1/models?capability=${query}` })).json().data.map((entry: { id: string }) => entry.id)
    expect(await ids("vision")).toEqual(["test/vision"])
    expect(await ids("tools")).toEqual(expect.arrayContaining(["test/echo", "test/vision"]))
  })

  test.each(["json", "", "toString"])("#61 ?capability=%s is a 400 invalid_request, refused before the catalog loads", async (value) => {
    server = await startRoute({ caller: new FakeModelCaller(), catalog: () => Promise.reject(new Error("should not load")) })
    const reply = await server.send({ path: `/v1/models?capability=${value}` })
    expect(reply.status).toBe(400)
    expect(reply.json().error).toMatchObject({ type: "invalid_request_error", code: "invalid_capability", param: "capability", message: "capability must be vision or tools" })
  })

  test("a catalog that fails to load is a 500 with a generic message; the cause goes to the log only", async () => {
    server = await startRoute({ caller: new FakeModelCaller(), catalog: () => Promise.reject(new Error("host exploded at /private/path")) })
    const reply = await server.send({ path: "/v1/models" })
    expect(reply.status).toBe(500)
    expect(reply.json()).toEqual({ error: { message: "Internal server error", type: "server_error", param: null, code: null } })
    expect(logs.of("request.failed")[0]!.fields).toMatchObject({ outcome: "error", error: "host exploded at /private/path" })
  })
})

describe("the request log line", () => {
  test("every request writes exactly one line with id, route, app, status, duration and outcome", async () => {
    await route()
    await server!.send(chat())
    await server!.send({ path: "/v1/models" })
    const lines = logs.of("request")
    expect(lines).toHaveLength(2)
    expect(lines[0]!.fields).toMatchObject({ route: "POST /v1/chat/completions", app: "default", model: "test/echo", status: "200", outcome: "ok" })
    expect(lines[0]!.fields.id).toMatch(/^[0-9a-f]{12}$/)
    expect(Number(lines[0]!.fields.ms)).toBeGreaterThanOrEqual(0)
    expect(lines[1]!.fields).toMatchObject({ route: "GET /v1/models", status: "200" })
  })

  test("a 5xx answer is logged as request.failed on stderr", async () => {
    await route({}, new FakeModelCaller([ev.error({ status: 503, code: "backend_unavailable" })]))
    await server!.send(chat())
    expect(logs.of("request")).toEqual([])
    expect(logs.of("request.failed")).toHaveLength(1)
    expect(logs.of("request.failed")[0]).toMatchObject({ level: "error", fields: { status: "503", outcome: "status_503" } })
  })
})
