/**
 * The capture proxy's control routes (examples/_harness/capture.ts, #357). The routes answer loopback callers only, and
 * `GET /__exchanges` never returns a credential or a request header. A test cannot place a non-loopback peer, so the
 * address rule is tested as a function and the route is tested from loopback.
 */
import { describe, expect, test } from "bun:test"
import { isLoopback, readableExchanges, startCapture, type Exchange } from "../../examples/_harness/capture.ts"

describe("control routes are local to the runner", () => {
  test("only loopback addresses are local; a LAN address, a v4-mapped LAN address and no address are not", () => {
    expect(isLoopback("127.0.0.1")).toBe(true)
    expect(isLoopback("127.0.0.53")).toBe(true)
    expect(isLoopback("::1")).toBe(true)
    expect(isLoopback("::ffff:127.0.0.1")).toBe(true)
    expect(isLoopback("192.0.2.10")).toBe(false)
    expect(isLoopback("10.0.1.30")).toBe(false)
    expect(isLoopback("::ffff:192.0.2.10")).toBe(false)
    expect(isLoopback(undefined)).toBe(false)
  })
})

describe("GET /__exchanges returns no credential", () => {
  test("the rows are seq, path, status and body; the key in the header, the query and the echoed body is gone", async () => {
    const secret = "sk-test-secret-0123456789"
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => new Response(JSON.stringify({ echo: request.headers.get("authorization") }), { headers: { "content-type": "application/json" } }),
    })
    const capture = await startCapture(`http://127.0.0.1:${upstream.port}`)
    try {
      await fetch(`${capture.url}/__mark`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: "S2", model: "fast" }) })
      await fetch(`${capture.url}/v1/chat/completions?key=${secret}`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: "{}",
      })
      const text = await (await fetch(`${capture.url}/__exchanges`)).text()
      expect(text).not.toContain(secret)
      expect(text).not.toContain("authorization")
      const rows = JSON.parse(text) as Array<Record<string, unknown>>
      expect(rows).toHaveLength(1)
      expect(Object.keys(rows[0]!).sort()).toEqual(["path", "resBody", "seq", "status"])
      expect(rows[0]!.path).toBe("/v1/chat/completions")
      expect(rows[0]!.status).toBe(200)
      expect(rows[0]!.resBody).toBe('{"echo":"<redacted>"}')
    } finally {
      await capture.close()
      upstream.stop(true)
    }
  })
})

describe("readableExchanges", () => {
  test("only the given mark's exchanges, and a bare Bearer key is removed too", () => {
    const base = { method: "POST", reqBody: "", resHeaders: {}, durationMs: 0 }
    const exchanges: Exchange[] = [
      { ...base, seq: 0, mark: 0, path: "/v1/a?x=1", reqHeaders: { authorization: "Bearer key-one" }, status: 200, resBody: "key-one here" },
      { ...base, seq: 1, mark: 1, path: "/v1/b", reqHeaders: {}, status: 401, resBody: "other" },
    ]
    expect(readableExchanges(exchanges, 0)).toEqual([{ seq: 0, path: "/v1/a", status: 200, resBody: "<redacted> here" }])
  })
})
