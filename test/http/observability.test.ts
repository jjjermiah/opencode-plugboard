/**
 * Observability routes over loopback HTTP: #73 discovery (`GET /`, `GET /v1`), #56 `/plugboard/status`
 * and `/metrics`, #76 the request id header, and #91 authentication before route lookup.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { PACKAGE_VERSION } from "../../src/version.js"
import { ev } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { startRoute, TEST_STATUS, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

const logs = captureLogs()
let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const KEYS = { alpha: "key-alpha-secret", beta: "key-beta-secret" }
async function route(options: Record<string, unknown> = {}) {
  server = await startRoute({ caller: new FakeModelCaller([ev.text("x"), ev.finish("stop", { inputTokens: 4, outputTokens: 2 })]), options })
  return server
}
const bearer = (key: string) => ({ authorization: `Bearer ${key}` })
const chat: SendInit = { method: "POST", path: "/v1/chat/completions", body: { model: "test/echo", messages: [{ role: "user", content: "hi" }] } }

describe("#76 x-plugboard-request-id", () => {
  test.each([
    ["a success", { path: "/healthz" }],
    ["a 404", { path: "/nope" }],
    ["a 400", { ...chat, body: { model: "" } }],
    ["a chat completion", chat],
    ["a Messages error", { method: "POST", path: "/v1/messages", body: {} }],
  ])("is on %s, and is the id of its log line", async (_name, init) => {
    await route()
    const reply = await server!.send(init)
    expect(reply.headers["x-plugboard-request-id"]).toMatch(/^[0-9a-f]{12}$/)
    const line = [...logs.of("request"), ...logs.of("request.failed")][0]
    if (line) expect(line.fields.id).toBe(reply.headers["x-plugboard-request-id"] as string)
  })

  test("is generated per request, never taken from the client", async () => {
    await route()
    const one = await server!.send({ path: "/healthz", headers: { "x-plugboard-request-id": "client-chosen" } })
    const two = await server!.send({ path: "/healthz" })
    expect(one.headers["x-plugboard-request-id"]).not.toBe("client-chosen")
    expect(one.headers["x-plugboard-request-id"]).not.toBe(two.headers["x-plugboard-request-id"])
  })
})

describe("#514 a caller's x-request-id", () => {
  const lineOf = () => [...logs.of("request"), ...logs.of("request.failed")][0]!

  test.each([
    ["a UUID", "3f2504e0-4f89-41d3-9a0c-0305e82c3301"],
    ["a trace-style id", "gw:7/ab_c.d+e=f-1"],
    ["the longest accepted id", "a".repeat(128)],
  ])("%s is echoed, logged as clientRequestId, and leaves x-plugboard-request-id alone", async (_name, sent) => {
    await route()
    const reply = await server!.send({ ...chat, headers: { "x-request-id": sent } })
    expect(reply.status).toBe(200)
    expect(reply.headers["x-request-id"]).toBe(sent)
    expect(reply.headers["x-plugboard-request-id"]).toMatch(/^[0-9a-f]{12}$/)
    expect(lineOf().fields).toMatchObject({ clientRequestId: sent, id: reply.headers["x-plugboard-request-id"] })
  })

  test.each([
    ["one character too long", "a".repeat(129)],
    ["a space", "has space"],
    ["a quote", 'say"hi'],
    ["a semicolon", "a;b"],
    ["a non-ASCII character", "caf\u00e9"],
    ["an empty value", ""],
  ])("%s is ignored: nothing echoed, nothing logged", async (_name, sent) => {
    await route()
    const reply = await server!.send({ ...chat, headers: { "x-request-id": sent } })
    expect(reply.status).toBe(200)
    expect(reply.headers).not.toHaveProperty("x-request-id")
    expect(lineOf().fields.clientRequestId).toBeUndefined()
  })

  test("two x-request-id headers are ignored, not merged", async () => {
    await route()
    const reply = await server!.send({ ...chat, headers: { "x-request-id": ["one", "two"] as unknown as string } })
    expect(reply.headers).not.toHaveProperty("x-request-id")
    expect(lineOf().fields.clientRequestId).toBeUndefined()
  })

  test.each([
    ["a refused request", { path: "/nope" }],
    ["a Messages error", { method: "POST", path: "/v1/messages", body: {} }],
    ["a health probe", { path: "/healthz" }],
  ])("is echoed on %s too", async (_name, init) => {
    await route()
    const reply = await server!.send({ ...init, headers: { "x-request-id": "abc-123" } })
    expect(reply.headers["x-request-id"]).toBe("abc-123")
  })

  test("a request without one carries no x-request-id", async () => {
    await route()
    const reply = await server!.send(chat)
    expect(reply.headers).not.toHaveProperty("x-request-id")
    expect(lineOf().fields).not.toHaveProperty("clientRequestId", expect.anything())
  })
})

describe("#91 authentication comes before route lookup", () => {
  test.each([
    ["an unknown path", { path: "/v2/secret" }],
    ["a known path with the wrong method", { path: "/v1/chat/completions" }],
    ["/plugboard/status", { path: "/plugboard/status" }],
    ["/plugboard/metrics while disabled", { path: "/plugboard/metrics" }],
  ])("without a key, %s is a 401, so the surface cannot be mapped", async (_name, init) => {
    await route({ keys: KEYS })
    expect((await server!.send(init)).status).toBe(401)
  })

  test("with a key, an unknown path is a 404", async () => {
    await route({ keys: KEYS })
    expect((await server!.send({ path: "/v2/secret", headers: bearer(KEYS.alpha) })).status).toBe(404)
  })

  test("/healthz and the first-run pages stay open", async () => {
    await route({ keys: KEYS })
    for (const path of ["/healthz", "/", "/v1"]) expect((await server!.send({ path })).status).toBe(200)
  })
})

describe("#73 GET / and GET /v1", () => {
  test("keyed, no credentials: the minimal document", async () => {
    await route({ keys: KEYS })
    const doc = (await server!.send({ path: "/v1" })).json()
    expect(doc.authentication).toEqual({ required: true, scheme: "Bearer" })
    expect(doc).not.toHaveProperty("models")
    // `(?<!v1)beta`: the Gemini endpoints are `/v1beta/...`, a path and not an app name (#136).
    expect(JSON.stringify(doc)).not.toMatch(/alpha|(?<!v1)beta|secret/)
  })

  test("keyed, a valid key: its own app only; a wrong key is a 401", async () => {
    await route({ keys: KEYS })
    const doc = (await server!.send({ path: "/v1", headers: bearer(KEYS.beta) })).json()
    expect(doc.apps).toEqual(["beta"])
    expect(doc.models.allowlist).toEqual(["test/*"])
    expect(JSON.stringify(doc)).not.toMatch(/alpha|secret/)
    expect((await server!.send({ path: "/v1", headers: bearer("wrong") })).status).toBe(401)
  })

  test("the HTML page has a strict CSP, no framing, no sniffing, no caching", async () => {
    await route()
    const reply = await server!.send({ path: "/" })
    expect(reply.status).toBe(200)
    expect(reply.headers).toMatchObject({
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    })
    expect(reply.text).toContain("<h1>opencode-plugboard</h1>")
  })

  test("a catalog that fails to load is reported on the page, not as an error", async () => {
    server = await startRoute({ caller: new FakeModelCaller(), catalog: () => Promise.reject(new Error("host down")) })
    const reply = await server.send({ path: "/v1" })
    expect(reply.status).toBe(200)
    expect(reply.json().models.state).toBe("catalog_unavailable")
    expect(logs.of("catalog.failed")[0]!.fields.error).toBe("host down")
  })
})

describe("#56 GET /plugboard/status", () => {
  test("authenticated runtime facts for the caller's app", async () => {
    await route({ keys: KEYS })
    const reply = await server!.send({ path: "/plugboard/status", headers: bearer(KEYS.alpha) })
    expect(reply.status).toBe(200)
    expect(reply.json()).toMatchObject({ ok: true, app: "alpha", runtimeVersion: TEST_STATUS.runtimeVersion, generations: 1, models: { catalog: 3, available: 4 } })
    expect(reply.text).not.toMatch(/beta|secret/)
  })

  test("#347 names the package version from package.json and the host OpenCode version, for an app key", async () => {
    server = await startRoute({ caller: new FakeModelCaller([]), options: { keys: KEYS }, opencodeVersion: "2.0.27" })
    const reply = await server.send({ path: "/plugboard/status", headers: bearer(KEYS.alpha) })
    expect(reply.json()).toMatchObject({ packageVersion: PACKAGE_VERSION, opencodeVersion: "2.0.27" })
  })

  test("#347 omits opencodeVersion when the host does not expose one; the auth stays on the route", async () => {
    await route({ keys: KEYS })
    expect(Object.keys((await server!.send({ path: "/plugboard/status", headers: bearer(KEYS.alpha) })).json())).not.toContain("opencodeVersion")
    expect((await server!.send({ path: "/plugboard/status" })).status).toBe(401)
  })
})

describe("#56 GET /plugboard/metrics", () => {
  test("off by default: an unknown path", async () => {
    await route()
    expect((await server!.send({ path: "/plugboard/metrics" })).status).toBe(404)
  })

  test("on: needs a key like /v1, and serves Prometheus text", async () => {
    await route({ keys: KEYS, metrics: true })
    expect((await server!.send({ path: "/plugboard/metrics" })).status).toBe(401)
    await server!.send({ ...chat, headers: bearer(KEYS.alpha) })
    const reply = await server!.send({ path: "/plugboard/metrics", headers: bearer(KEYS.beta) })
    expect(reply.status).toBe(200)
    expect(reply.headers["content-type"]).toBe("text/plain; version=0.0.4; charset=utf-8")
    expect(reply.text).toContain('plugboard_requests_total{app="alpha",route="POST /v1/chat/completions",status="200",outcome="ok"} 1')
    expect(reply.text).toContain('plugboard_requests_total{app="_none",route="GET /plugboard/metrics",status="401",outcome="rejected"} 1')
    expect(reply.text).toContain('plugboard_tokens_total{app="alpha",kind="input"} 4')
    expect(reply.text).not.toContain("secret")
  })

  test("#285 with adminKey, /metrics needs the admin key: none is 401, an app key is 403, the admin key reads every app", async () => {
    const ADMIN = "admin-secret-value"
    await route({ keys: KEYS, metrics: true, adminKey: ADMIN })
    await server!.send({ ...chat, headers: bearer(KEYS.alpha) })
    expect((await server!.send({ path: "/plugboard/metrics" })).status).toBe(401)
    const denied = await server!.send({ path: "/plugboard/metrics", headers: bearer(KEYS.beta) })
    expect(denied.status).toBe(403)
    expect(denied.headers["content-type"]).toBe("application/problem+json")
    expect(denied.json()).toMatchObject({ code: "admin_key_required", status: 403 })
    expect(denied.text).not.toContain("plugboard_")
    const reply = await server!.send({ path: "/plugboard/metrics", headers: bearer(ADMIN) })
    expect(reply.status).toBe(200)
    expect(reply.text).toContain('plugboard_requests_total{app="alpha",route="POST /v1/chat/completions"')
  })

  test("#285 without adminKey, any app key reads every app's series (the documented choice)", async () => {
    await route({ keys: KEYS, metrics: true })
    await server!.send({ ...chat, headers: bearer(KEYS.alpha) })
    const reply = await server!.send({ path: "/plugboard/metrics", headers: bearer(KEYS.beta) })
    expect(reply.status).toBe(200)
    expect(reply.text).toContain('app="alpha"')
  })

  test("a successful scrape writes no log line", async () => {
    await route({ metrics: true })
    await server!.send({ path: "/plugboard/metrics" })
    expect(logs.lines).toEqual([])
  })

  test("off: the route records no metrics at all", async () => {
    await route()
    await server!.send(chat)
    expect(await server!.metrics.render(TEST_STATUS)).not.toContain("plugboard_requests_total{")
  })
})
