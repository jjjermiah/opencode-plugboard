/**
 * #253 and #254 over loopback HTTP: plugboard's own routes live under `/plugboard/`, the probes stay
 * at the root, the old paths are the namespace's 404, and every error under `/plugboard/` is
 * `application/problem+json` (RFC 9457). The model routes keep their provider's error shape: one
 * test per dialect pins it. `docs/errors.md` has an anchor for each problem code (`PROBLEM_CODES`).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { PROBLEM_DOCS } from "../../src/http.js"
import { createKeyState, createKeyStore } from "../../src/keys.js"
import { createUsageRecorder, createUsageState } from "../../src/usage.js"
import { ev } from "../support/fixtures.js"
import { startRoute, TEST_STATUS, type RouteServer } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { FakeStorage } from "../support/usage.js"

const KEYS = { alpha: "key-alpha-secret" }
const ADMIN = "admin-root-secret"
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
const READY = { ...TEST_STATUS, generations: 1, servingConfirmed: true, pumpRunning: true, catalogLoaded: true }

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

/** A server with every optional route on: usage, metrics and the admin key. */
const start = async (status = READY) => {
  const usage = createUsageRecorder({ state: createUsageState(), storage: new FakeStorage(), loadCatalog: async () => [], retentionDays: 90 })
  server = await startRoute({
    caller: new FakeModelCaller([ev.finish()]),
    options: { keys: KEYS, adminKey: ADMIN, metrics: true },
    usage,
    keys: createKeyStore({ state: createKeyState(), storage: new FakeStorage() }),
    status: () => status,
  })
  return server
}

describe("#253 plugboard's own routes live under /plugboard/", () => {
  test("#253 GET /plugboard/health and /plugboard/ready answer like the root probes, with no key", async () => {
    await start()
    for (const [root, moved] of [
      ["/healthz", "/plugboard/health"],
      ["/readyz", "/plugboard/ready"],
    ]) {
      const a = await server!.send({ path: root })
      const b = await server!.send({ path: moved })
      expect(a.status).toBe(200)
      expect(b.status).toBe(200)
      expect(b.json()).toEqual(a.json())
    }
    expect((await server!.send({ path: "/plugboard/health" })).json()).toEqual({ ok: true })
  })

  test("#253 the old paths are the namespace's 404, with the key or without it", async () => {
    await start()
    // Authentication comes first (I15): the old paths need an app key, and then answer their namespace's 404.
    for (const path of ["/v1/usage", "/v1/status", "/v1/admin/keys", "/metrics", "/dashboard"]) {
      const reply = await server!.send({ path, headers: bearer(KEYS.alpha) })
      expect(reply.status).toBe(404)
      expect(reply.headers["content-type"]).toBe("application/json")
      expect(reply.json().error.code).toBe("not_found")
    }
    expect((await server!.send({ path: "/v1/usage" })).status).toBe(401)
  })

  test("#253 the moved routes answer under /plugboard/, the usage RPC path unchanged", async () => {
    await start()
    expect((await server!.send({ path: "/plugboard/usage", headers: bearer(ADMIN) })).status).toBe(200)
    expect((await server!.send({ path: "/plugboard/status", headers: bearer(KEYS.alpha) })).status).toBe(200)
    expect((await server!.send({ path: "/plugboard/metrics", headers: bearer(ADMIN) })).status).toBe(200)
    expect((await server!.send({ path: "/plugboard/dashboard" })).status).toBe(200)
    expect((await server!.send({ path: "/plugboard/admin/keys", headers: bearer(ADMIN) })).status).toBe(200)
  })
})

describe("#254 errors under /plugboard/ are problem+json", () => {
  test("#254 a /plugboard/ error is RFC 9457 with a docs type, the instance, code, param and request id", async () => {
    await start()
    const reply = await server!.send({ path: "/plugboard/usage?from=2026-02-30", headers: bearer(ADMIN) })
    expect(reply.status).toBe(400)
    expect(reply.headers["content-type"]).toBe("application/problem+json")
    const problem = reply.json()
    expect(problem).toEqual({
      type: `${PROBLEM_DOCS}#invalid-date`,
      title: "Bad Request",
      status: 400,
      detail: expect.stringContaining("`from` must be a UTC date"),
      instance: "/plugboard/usage?from=2026-02-30",
      code: "invalid_date",
      param: "from",
      requestId: reply.headers["x-plugboard-request-id"],
    })
    expect(problem.requestId).toMatch(/^[0-9a-f]{12}$/)
  })

  test("#254 a mapped code is typed by its anchor, and a missing key is a 401 problem", async () => {
    await start()
    const unknown = await server!.send({ path: "/plugboard/nope", headers: bearer(KEYS.alpha) })
    expect(unknown.status).toBe(404)
    expect(unknown.headers["content-type"]).toBe("application/problem+json")
    expect(unknown.json()).toMatchObject({ type: `${PROBLEM_DOCS}#not-found`, code: "not_found", status: 404 })
    const anonymous = await server!.send({ path: "/plugboard/status" })
    expect(anonymous.headers["content-type"]).toBe("application/problem+json")
    expect(anonymous.json()).toMatchObject({ type: `${PROBLEM_DOCS}#invalid-api-key`, status: 401, code: "invalid_api_key", instance: "/plugboard/status" })
  })

  test("#254 a code with no anchor in docs/errors.md is typed about:blank", async () => {
    await start()
    // A body that is not JSON is `invalid_request`, which has no anchor of its own.
    const reply = await server!.send({ method: "POST", path: "/plugboard/admin/keys", headers: bearer(ADMIN), body: "{" })
    expect(reply.status).toBe(400)
    expect(reply.headers["content-type"]).toBe("application/problem+json")
    expect(reply.json()).toMatchObject({ type: "about:blank", code: "invalid_request", status: 400, instance: "/plugboard/admin/keys" })
  })

  test("#254 not ready on /plugboard/ready is a problem 503 with the reason as detail; /readyz keeps its document", async () => {
    await start({ ...READY, catalogLoaded: false })
    const moved = await server!.send({ path: "/plugboard/ready" })
    expect(moved.status).toBe(503)
    expect(moved.headers["content-type"]).toBe("application/problem+json")
    expect(moved.json()).toMatchObject({ type: `${PROBLEM_DOCS}#not-ready`, code: "not_ready", status: 503, detail: "the model catalog has not loaded yet" })
    const root = await server!.send({ path: "/readyz" })
    expect(root.headers["content-type"]).toBe("application/json")
    expect(root.json()).toEqual({ ready: false, reason: "the model catalog has not loaded yet" })
  })

  test("#254 an error on a model route keeps its provider's shape (OpenAI: error.message/type/param/code)", async () => {
    await start()
    const reply = await server!.send({ method: "POST", path: "/v1/chat/completions", body: { model: "test/echo" } })
    expect(reply.status).toBe(401)
    expect(reply.headers["content-type"]).toBe("application/json")
    expect(Object.keys(reply.json())).toEqual(["error"])
    expect(Object.keys(reply.json().error).sort()).toEqual(["code", "message", "param", "type"])
    const unknown = await server!.send({ path: "/v1/nope", headers: bearer(KEYS.alpha) })
    expect(unknown.headers["content-type"]).toBe("application/json")
    expect(unknown.json().error.code).toBe("not_found")
  })

  test("#254 an error on /v1/messages keeps Anthropic's shape ({ type: error, error: { type, message } })", async () => {
    await start()
    const reply = await server!.send({ method: "POST", path: "/v1/messages", body: {} })
    expect(reply.status).toBe(401)
    expect(reply.headers["content-type"]).toBe("application/json")
    expect(Object.keys(reply.json()).sort()).toEqual(["error", "type"])
    expect(reply.json().type).toBe("error")
    expect(Object.keys(reply.json().error).sort()).toEqual(["message", "type"])
  })

  test("#254 an error on /v1beta keeps Google's shape ({ error: { code, message, status } })", async () => {
    await start()
    const reply = await server!.send({ path: "/v1beta/models" })
    expect(reply.status).toBe(401)
    expect(reply.headers["content-type"]).toBe("application/json")
    expect(Object.keys(reply.json().error).sort()).toEqual(["code", "message", "status"])
  })

})
