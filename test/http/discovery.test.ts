/**
 * #136: the discovery document (`GET /v1`) lists every endpoint the router serves. Each probe is a
 * request the router answers (anything other than its own "No route for" 404), and each must be
 * listed under its template. The list must not name an endpoint that no probe reaches.
 * Adding a route means adding a probe here; the probe table is the router's contract.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { ev } from "../support/fixtures.js"
import { startRoute, type RouteServer } from "../support/loopback.js"
import { FakeStorage } from "../support/usage.js"
import { createUsageRecorder, createUsageState } from "../../src/usage.js"
import { createKeyState, createKeyStore } from "../../src/keys.js"
import { FakeModelCaller } from "../support/model-caller.js"

const KEYS = { alpha: "key-alpha-secret" }
const ADMIN = "admin-root-secret"
const headers = { authorization: `Bearer ${KEYS.alpha}` }

/** [method, a path the router answers, the template the document lists]. */
const PROBES: ReadonlyArray<readonly [string, string, string]> = [
  ["GET", "/", "/"],
  ["GET", "/v1", "/v1"],
  ["GET", "/healthz", "/healthz"],
  ["GET", "/readyz", "/readyz"],
  ["GET", "/v1/models", "/v1/models"],
  ["GET", "/v1/models/test%2Fecho", "/v1/models/{id}"],
  ["POST", "/v1/chat/completions", "/v1/chat/completions"],
  ["POST", "/v1/completions", "/v1/completions"],
  ["POST", "/v1/responses", "/v1/responses"],
  ["POST", "/v1/messages", "/v1/messages"],
  ["POST", "/v1/messages/count_tokens", "/v1/messages/count_tokens"],
  ["GET", "/v1beta/models", "/v1beta/models"],
  ["GET", "/v1beta/models/test%2Fecho", "/v1beta/models/{model}"],
  ["POST", "/v1beta/models/fast:generateContent", "/v1beta/models/{model}:generateContent"],
  ["POST", "/v1beta/models/fast:streamGenerateContent?alt=sse", "/v1beta/models/{model}:streamGenerateContent"],
  ["POST", "/v1beta/models/fast:countTokens", "/v1beta/models/{model}:countTokens"],
  ["GET", "/v1/status", "/v1/status"],
  ["GET", "/metrics", "/metrics"],
  ["GET", "/v1/usage", "/v1/usage"],
  ["GET", "/dashboard", "/dashboard"],
]

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const start = async () => {
  const usage = createUsageRecorder({ state: createUsageState(), storage: new FakeStorage(), loadCatalog: async () => [], retentionDays: 90 })
  server = await startRoute({ caller: new FakeModelCaller([ev.finish()]), options: { keys: KEYS, metrics: true }, usage })
  return server
}
const listed = async (): Promise<Array<{ method: string; path: string }>> => (await server!.send({ path: "/v1", headers })).json().endpoints

/** Admin endpoints (#55) are listed and served only when `adminKey` is set. */
const ADMIN_PROBES: ReadonlyArray<readonly [string, string, string]> = [
  ["GET", "/v1/admin/keys", "/v1/admin/keys"],
  ["POST", "/v1/admin/keys", "/v1/admin/keys"],
  ["DELETE", "/v1/admin/keys/00000000", "/v1/admin/keys/{keyId}"],
]

describe("#136 the discovery document lists every endpoint the router serves", () => {
  test.each(PROBES)("%s %s is served and listed as %s", async (method, path, template) => {
    await start()
    const reply = await server!.send({ method, path, headers })
    expect(reply.status === 404 && reply.text.includes("No route for")).toBe(false)
    expect(await listed()).toContainEqual(expect.objectContaining({ method, path: template }))
  })

  test("the document lists no endpoint that the probes do not reach", async () => {
    await start()
    expect((await listed()).map((endpoint) => `${endpoint.method} ${endpoint.path}`).sort()).toEqual(PROBES.map(([method, , template]) => `${method} ${template}`).sort())
  })
})

describe("#55 the admin endpoints are listed and served only with adminKey", () => {
  const startAdmin = async () => {
    server = await startRoute({ caller: new FakeModelCaller([ev.finish()]), options: { keys: KEYS, adminKey: ADMIN }, keys: createKeyStore({ state: createKeyState(), storage: new FakeStorage() }) })
    return server
  }

  test.each(ADMIN_PROBES)("%s %s is served with the admin key and listed as %s", async (method, path, template) => {
    await startAdmin()
    const reply = await server!.send({ method, path, headers: { authorization: `Bearer ${ADMIN}` }, ...(method === "POST" ? { body: { app: "bot" } } : {}) })
    expect(reply.status === 404 && reply.text.includes("No route for")).toBe(false)
    expect(await listed()).toContainEqual(expect.objectContaining({ method, path: template }))
  })

  test("the document lists the admin endpoints when adminKey is set, and not without it", async () => {
    await startAdmin()
    const withAdmin = (await listed()).map((endpoint) => `${endpoint.method} ${endpoint.path}`)
    expect(withAdmin).toEqual(expect.arrayContaining(ADMIN_PROBES.map(([method, , template]) => `${method} ${template}`)))
    await server!.close()
    await start()
    const without = (await listed()).map((endpoint) => `${endpoint.method} ${endpoint.path}`)
    expect(without.some((line) => line.includes("/v1/admin/keys"))).toBe(false)
  })
})
