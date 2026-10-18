/**
 * The route x format x mode manifest (#116, test/coverage-manifest.ts) against the router: every route
 * the router has needs a row, every row a route, and every cover must resolve to a real test.
 */
import { afterAll, describe, expect, test } from "bun:test"
import { problems, MANUAL_ROUTES, ROWS, scanRouteNames, type Row } from "../coverage-manifest.js"
import { ev } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"

const routes = async () => [...new Set([...(await scanRouteNames()), ...MANUAL_ROUTES])].sort()

/** One request per manual route (a template or a constant in src/), enough to reach the route. */
const PROBES: Record<(typeof MANUAL_ROUTES)[number], SendInit> = {
  "GET /v1/models/{id}": { method: "GET", path: "/v1/models/test%2Fecho" },
  "POST /v1/messages": { method: "POST", path: "/v1/messages", body: { model: "test/echo", max_tokens: 8, messages: [{ role: "user", content: "hi" }] } },
  "POST /v1/messages/count_tokens": { method: "POST", path: "/v1/messages/count_tokens", body: {} },
  "POST /v1beta/models/{model}:generateContent": { method: "POST", path: "/v1beta/models/test%2Fecho:generateContent", body: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } },
  "POST /v1beta/models/{model}:streamGenerateContent": {
    method: "POST",
    path: "/v1beta/models/test%2Fecho:streamGenerateContent?alt=sse",
    body: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
  },
}

const UNKNOWN = "No route for"
let server: RouteServer | undefined
afterAll(() => server?.close())

describe("#116 route x format coverage manifest", () => {
  captureLogs()
  test("#116 the scan finds the routes the routers spell out", async () => {
    expect(await scanRouteNames()).toEqual(
      expect.arrayContaining(["POST /v1/chat/completions", "POST /v1/completions", "POST /v1/responses", "GET /plugboard/status", "GET /plugboard/metrics", "GET /healthz", "GET /v1beta/models"]),
    )
  })

  // Each problem names its route and mode, so a failure says which cell to fix.
  test("#116 every route has a row, every row a route, and every cell a covering test, n/a with a reason, or a gap that names its issue", async () => {
    expect(problems(ROWS, await routes())).toEqual([])
  })

  test("#116 an empty selection, a missing file, a missing title and an unexplained gap are all problems", () => {
    const na = "not applicable in this test"
    const cells = (json: Row["cells"]["json"]): Row["cells"] => ({ json, stream: { na }, tools: { na }, images: { na }, structured: { na }, n: { na }, errors: { na } })
    const row = (json: Row["cells"]["json"]): Row => ({ route: "POST /x", format: "f", cells: cells(json) })
    expect(problems([row({ tests: [] })], ["POST /x"]).join("\n")).toContain("no test covers it")
    expect(problems([row({ tests: [{ file: "test/http/does-not-exist.test.ts", text: "x" }] })], ["POST /x"]).join("\n")).toContain("does not exist")
    expect(problems([row({ tests: [{ file: "test/http/chat.test.ts", text: "a title that is not there" }] })], ["POST /x"]).join("\n")).toContain("has no test titled")
    expect(problems([row({ gap: "not tracked" })], ["POST /x"]).join("\n")).toContain("must name its issue")
    expect(problems([row({ tests: [{ file: "test/http/chat.test.ts", text: "a text answer is a chat.completion" }] })], ["POST /x"])).toEqual([])
  })

  test("#116 a route missing from the manifest, or a row for a route the router lacks, is a problem", () => {
    expect(problems([], ["POST /v1/new"]).join("\n")).toContain("the router has this route and no manifest row")
    expect(problems(ROWS, [...ROWS.map((row) => row.route).filter((route) => route !== "GET /healthz")]).join("\n")).toContain("GET /healthz")
  })

  test.each(MANUAL_ROUTES.map((route) => [route] as const))("#116 %s is served by the live router, not the unknown-route 404", async (route) => {
    server ??= await startRoute({ caller: new FakeModelCaller((_request, call) => (call === 0 ? [ev.text("hi"), ev.finish()] : [ev.finish()])) })
    const reply = await server.send(PROBES[route])
    expect(reply.text).not.toContain(UNKNOWN)
  })

  test("#116 the probe itself is meaningful: an unknown path gets the unknown-route 404", async () => {
    server ??= await startRoute({ caller: new FakeModelCaller([ev.finish()]) })
    const reply = await server.send({ method: "POST", path: "/v1/nope", body: {} })
    expect(reply.status).toBe(404)
    expect(reply.text).toContain(UNKNOWN)
  })
})
