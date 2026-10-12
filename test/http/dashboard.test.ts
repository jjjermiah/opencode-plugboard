/**
 * #141 the usage dashboard over loopback HTTP: the page and its files are served without a key, with
 * the Content-Security-Policy and caching headers they need; the page holds no usage data (the
 * numbers come from `GET /plugboard/usage`, behind a key); and every route is absent when option `usage` is off.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createUsageRecorder, createUsageState, withUsage } from "../../src/usage.js"
import { CATALOG, ev, until } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { FakeStorage } from "../support/usage.js"

captureLogs()

const KEY = "key-probe-secret"
const bearer = { authorization: `Bearer ${KEY}` }
const chat: SendInit = { method: "POST", path: "/v1/chat/completions", headers: bearer, body: { model: "test/echo", messages: [{ role: "user", content: "hi" }] } }
/** The Content-Security-Policy every dashboard response carries, written out so a change to the constant is seen. */
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

/** A route answering chat calls with 10 input and 5 output tokens, with usage on unless `usage` is false. */
async function start(options: Record<string, unknown> = { keys: { probeapp: KEY } }, usage = true): Promise<RouteServer> {
  const recorder = usage ? createUsageRecorder({ state: createUsageState(), storage: new FakeStorage(), loadCatalog: async () => CATALOG, retentionDays: 90 }) : undefined
  const caller = withUsage(
    new FakeModelCaller(() => [ev.text("hi"), ev.finish("stop", { inputTokens: 10, outputTokens: 5 })]),
    recorder,
  )
  server = await startRoute({ caller, options, ...(recorder ? { usage: recorder } : {}) })
  return server
}

describe("#141 the dashboard page", () => {
  test("GET /plugboard/dashboard is served without a key, with the CSP and no inline script or style", async () => {
    const srv = await start()
    const reply = await srv.send({ path: "/plugboard/dashboard" })
    expect(reply.status).toBe(200)
    expect(reply.headers["content-type"]).toBe("text/html; charset=utf-8")
    expect(reply.headers["content-security-policy"]).toBe(CSP)
    expect(reply.headers["x-frame-options"]).toBe("DENY")
    expect(reply.headers["referrer-policy"]).toBe("no-referrer")
    expect(reply.headers["cache-control"]).toBe("no-store")
    expect(reply.text).toContain('<script src="/plugboard/dashboard/uplot.js" defer></script>')
    expect(reply.text).toContain('<script src="/plugboard/dashboard/app.js" defer></script>')
    expect(reply.text).toContain('<link rel="stylesheet" href="/plugboard/dashboard/app.css">')
    // Every script has a src, and nothing is styled or wired inline.
    expect(reply.text).not.toMatch(/<script(?![^>]*\ssrc=)/)
    expect(reply.text).not.toMatch(/<style|\sstyle=|\son[a-z]+=|javascript:/i)
  })

  test("the page holds no usage: its bytes do not change after a model call, and it names no app", async () => {
    const srv = await start()
    const before = (await srv.send({ path: "/plugboard/dashboard" })).text
    expect((await srv.send(chat)).status).toBe(200)
    await until(async () => (await srv.send({ path: "/plugboard/usage", headers: bearer })).json().totals.requests === 1, 1_000, "the call is counted")
    const after = (await srv.send({ path: "/plugboard/dashboard" })).text
    expect(after).toBe(before)
    expect(after).not.toContain("probeapp")
  })

  test("the discovery page and document link to the dashboard when usage is on", async () => {
    const srv = await start()
    expect((await srv.send({ path: "/" })).text).toContain('<a href="/plugboard/dashboard">Usage dashboard</a>')
    expect((await srv.send({ path: "/v1" })).json().endpoints).toContainEqual(expect.objectContaining({ method: "GET", path: "/plugboard/dashboard", auth: false }))
  })
})

describe("#141 the dashboard files", () => {
  test.each([
    ["app.js", "text/javascript; charset=utf-8"],
    ["app.css", "text/css; charset=utf-8"],
    ["uplot.js", "text/javascript; charset=utf-8"],
    ["uplot.css", "text/css; charset=utf-8"],
  ])("/plugboard/dashboard/%s is served with its type, the page's headers, and an ETag that revalidates to 304", async (name, type) => {
    const srv = await start()
    const reply = await srv.send({ path: `/plugboard/dashboard/${name}` })
    expect(reply.status).toBe(200)
    expect(reply.headers["content-type"]).toBe(type)
    expect(reply.headers["content-security-policy"]).toBe(CSP)
    expect(reply.headers["x-content-type-options"]).toBe("nosniff")
    expect(reply.headers["cache-control"]).toBe("no-cache")
    const etag = String(reply.headers.etag)
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/)
    expect(reply.text.length).toBeGreaterThan(100)

    const again = await srv.send({ path: `/plugboard/dashboard/${name}`, headers: { "if-none-match": etag } })
    expect(again.status).toBe(304)
    expect(again.text).toBe("")
    expect((await srv.send({ path: `/plugboard/dashboard/${name}`, headers: { "if-none-match": '"other"' } })).status).toBe(200)
  })

  test("the page's script reads the data only from /plugboard/usage and writes it as text, never as HTML", async () => {
    const srv = await start()
    const js = (await srv.send({ path: "/plugboard/dashboard/app.js" })).text
    expect(js).toContain('"/plugboard/usage?from="')
    expect(js).toContain('authorization: "Bearer "')
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(/)
  })

  test("the uPlot files are the ones the uplot package ships", async () => {
    const srv = await start()
    expect((await srv.send({ path: "/plugboard/dashboard/uplot.js" })).text).toContain("uPlot")
    expect((await srv.send({ path: "/plugboard/dashboard/uplot.css" })).text).toContain(".uplot")
  })

  test("an unknown file under /plugboard/dashboard is a 404; a path can never reach a file outside the dashboard", async () => {
    const srv = await start({})
    expect((await srv.send({ path: "/plugboard/dashboard/../../package.json" })).status).not.toBe(200)
    expect((await srv.send({ path: "/plugboard/dashboard/nope.js" })).status).toBe(404)
  })
})

describe("#141 the dashboard is absent when usage is off", () => {
  test("keyless: every dashboard route is a 404, as for any unknown path", async () => {
    const srv = await start({ usage: { enabled: false } }, false)
    for (const path of ["/plugboard/dashboard", "/plugboard/dashboard/app.js", "/plugboard/dashboard/uplot.js"]) {
      const reply = await srv.send({ path })
      expect(reply.status).toBe(404)
      expect(reply.json().code).toBe("not_found")
    }
  })

  test("with keys: an unauthenticated caller gets 401 (I15), a valid key gets 404", async () => {
    const srv = await start({ usage: { enabled: false }, keys: { probeapp: KEY } }, false)
    expect((await srv.send({ path: "/plugboard/dashboard" })).status).toBe(401)
    expect((await srv.send({ path: "/plugboard/dashboard", headers: bearer })).status).toBe(404)
  })

  test("the discovery pages do not list or link the dashboard", async () => {
    const srv = await start({ usage: { enabled: false }, keys: { probeapp: KEY } }, false)
    expect((await srv.send({ path: "/" })).text).not.toContain("/plugboard/dashboard")
    expect((await srv.send({ path: "/v1", headers: bearer })).json().endpoints.map((endpoint: { path: string }) => endpoint.path)).not.toContain("/plugboard/dashboard")
  })
})
