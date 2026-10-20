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
  ["GET", "/healthz", "/plugboard/health"],
  ["GET", "/plugboard/health", "/plugboard/health"],
  ["GET", "/readyz", "/plugboard/ready"],
  ["GET", "/plugboard/ready", "/plugboard/ready"],
  ["GET", "/v1/models", "/v1/models"],
  ["GET", "/v1/models/test%2Fecho", "/v1/models/{id}"],
  ["POST", "/v1/chat/completions", "/v1/chat/completions"],
  ["POST", "/v1/completions", "/v1/completions"],
  ["POST", "/v1/responses", "/v1/responses"],
  ["GET", `/v1/responses/resp_${"0".repeat(32)}`, "/v1/responses/{id}"],
  ["DELETE", `/v1/responses/resp_${"0".repeat(32)}`, "/v1/responses/{id}"],
  ["GET", `/v1/responses/resp_${"0".repeat(32)}/input_items`, "/v1/responses/{id}/input_items"],
  ["POST", "/v1/files", "/v1/files"],
  ["GET", "/v1/files", "/v1/files"],
  ["GET", `/v1/files/file-${"0".repeat(32)}`, "/v1/files/{id}"],
  ["GET", `/v1/files/file-${"0".repeat(32)}/content`, "/v1/files/{id}/content"],
  ["DELETE", `/v1/files/file-${"0".repeat(32)}`, "/v1/files/{id}"],
  ["POST", "/v1/messages", "/v1/messages"],
  ["POST", "/v1/messages/count_tokens", "/v1/messages/count_tokens"],
  ["GET", "/v1beta/models", "/v1beta/models"],
  ["GET", "/v1beta/models/test%2Fecho", "/v1beta/models/{model}"],
  ["POST", "/v1beta/models/fast:generateContent", "/v1beta/models/{model}:generateContent"],
  ["POST", "/v1beta/models/fast:streamGenerateContent?alt=sse", "/v1beta/models/{model}:streamGenerateContent"],
  ["POST", "/v1beta/models/fast:countTokens", "/v1beta/models/{model}:countTokens"],
  ["POST", "/upload/v1beta/files", "/upload/v1beta/files"],
  ["GET", "/v1beta/files", "/v1beta/files"],
  ["GET", `/v1beta/files/${"0".repeat(32)}`, "/v1beta/files/{name}"],
  ["DELETE", `/v1beta/files/${"0".repeat(32)}`, "/v1beta/files/{name}"],
  ["GET", "/plugboard/status", "/plugboard/status"],
  ["GET", "/plugboard/metrics", "/plugboard/metrics"],
  ["GET", "/plugboard/usage", "/plugboard/usage"],
  ["GET", "/plugboard/dashboard", "/plugboard/dashboard"],
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
  ["GET", "/plugboard/admin/keys", "/plugboard/admin/keys"],
  ["POST", "/plugboard/admin/keys", "/plugboard/admin/keys"],
  ["DELETE", "/plugboard/admin/keys/00000000", "/plugboard/admin/keys/{keyId}"],
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
    // Two probes may reach one endpoint (the root alias and the `/plugboard/` path), so compare the set of templates.
    expect((await listed()).map((endpoint) => `${endpoint.method} ${endpoint.path}`).sort()).toEqual([...new Set(PROBES.map(([method, , template]) => `${method} ${template}`))].sort())
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
    expect(without.some((line) => line.includes("/plugboard/admin/keys"))).toBe(false)
  })
})
