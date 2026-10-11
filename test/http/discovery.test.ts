/**
 * #136: the discovery document (`GET /v1`) lists every endpoint the router serves. Each probe is a
 * request the router answers (anything other than its own "No route for" 404), and each must be
 * listed under its template. The list must not name an endpoint that no probe reaches.
 * Adding a route means adding a probe here; the probe table is the router's contract.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { ev } from "../support/fixtures.js"
import { startRoute, type RouteServer } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

const KEYS = { alpha: "key-alpha-secret" }
const headers = { authorization: `Bearer ${KEYS.alpha}` }

/** [method, a path the router answers, the template the document lists]. */
const PROBES: ReadonlyArray<readonly [string, string, string]> = [
  ["GET", "/", "/"],
  ["GET", "/v1", "/v1"],
  ["GET", "/healthz", "/healthz"],
  ["GET", "/v1/models", "/v1/models"],
  ["GET", "/v1/models/test%2Fecho", "/v1/models/{id}"],
  ["POST", "/v1/chat/completions", "/v1/chat/completions"],
  ["POST", "/v1/completions", "/v1/completions"],
  ["POST", "/v1/responses", "/v1/responses"],
  ["POST", "/v1/messages", "/v1/messages"],
  ["GET", "/v1beta/models", "/v1beta/models"],
  ["GET", "/v1beta/models/test%2Fecho", "/v1beta/models/{model}"],
  ["POST", "/v1beta/models/fast:generateContent", "/v1beta/models/{model}:generateContent"],
  ["POST", "/v1beta/models/fast:streamGenerateContent?alt=sse", "/v1beta/models/{model}:streamGenerateContent"],
  ["GET", "/v1/status", "/v1/status"],
  ["GET", "/metrics", "/metrics"],
]

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const start = async () => {
  server = await startRoute({ caller: new FakeModelCaller([ev.finish()]), options: { keys: KEYS, metrics: true } })
  return server
}
const listed = async (): Promise<Array<{ method: string; path: string }>> => (await server!.send({ path: "/v1", headers })).json().endpoints

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
