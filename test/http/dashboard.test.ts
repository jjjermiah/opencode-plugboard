/**
 * #141 the usage dashboard over loopback HTTP: the page and its files are served without a key, with
 * the Content-Security-Policy and caching headers they need; the page holds no usage data (the
 * numbers come from `GET /plugboard/usage`, behind a key); and every route is absent when option `usage` is off.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createUsageRecorder, createUsageState, withUsage } from "../../src/usage.js"
import { CATALOG, ev, model, until } from "../support/fixtures.js"
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
  const caller = withUsage(new FakeModelCaller(() => [ev.text("hi"), ev.finish("stop", { inputTokens: 10, outputTokens: 5 })]), recorder)
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

describe("#141 the dashboard's Usage and Models tabs", () => {
  test("the page has the Usage and Models tabs, a range picker for 1, 7, 30 and 90 days, and its empty and error states", async () => {
    const srv = await start()
    const page = (await srv.send({ path: "/plugboard/dashboard" })).text
    for (const marker of [
      'data-tab="usage"',
      'data-tab="models"',
      'id="view-models"',
      'data-days="1"',
      'data-days="7"',
      'data-days="30"',
      'data-days="90"',
      'id="usage-empty"',
      'id="banner"',
      'id="catalog-auth"',
    ])
      expect(page).toContain(marker)
  })

  test("the Usage tab has a Tags table, hidden until a tag shows up, sortable like the others, and written as text", async () => {
    const srv = await start()
    const page = (await srv.send({ path: "/plugboard/dashboard" })).text
    for (const marker of ['id="tags-section"', 'id="tags"', 'id="tags-more"', 'id="tags-toggle"', "<h2>Tags</h2>"]) expect(page).toContain(marker)
    expect(page).toMatch(/<div id="tags-section" hidden>/)
    const js = (await srv.send({ path: "/plugboard/dashboard/app.js" })).text
    expect(js).toContain("function renderTags()")
    expect(js).toContain("renderTags();")
    expect(js).toContain('$("tags").addEventListener("click"')
    for (const column of ['sortHeader("Tag", "name"', 'sortHeader("Requests", "requests"', 'sortHeader("Tokens", "tokens"', 'sortHeader("Cost", "costUsd"', 'sortHeader("Errors", "errors"'])
      expect(js).toContain(column)
    // A tag name is the caller's text: it reaches the page as text, and the sums live in a record with no prototype.
    expect(js).toContain("Object.create(null)")
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/)
  })

  test("the script calls only endpoints plugboard has (/plugboard/usage, /v1/models) and sets no inline style, which the CSP would refuse", async () => {
    const srv = await start()
    const js = (await srv.send({ path: "/plugboard/dashboard/app.js" })).text
    expect(js).toContain('fetch("/v1/models"')
    expect([...js.matchAll(/fetch\("([^"?]+)/g)].map((match) => match[1]).sort()).toEqual(["/plugboard/usage", "/v1/models"])
    expect(js).not.toMatch(/\.style\b|cssText|setAttribute\("style"|"style":/)
    // The snippets name a variable for the key, never a key.
    expect(js).toContain("PLUGBOARD_API_KEY")
  })

  test("the stylesheet follows prefers-color-scheme and has a phone layout", async () => {
    const srv = await start()
    const css = (await srv.send({ path: "/plugboard/dashboard/app.css" })).text
    expect(css).toContain("@media (prefers-color-scheme: dark)")
    expect(css).toMatch(/@media \(max-width: \d+rem\)/)
  })

  test("/v1/models answers an app key with the fields the Models tab reads, and the admin key with 401", async () => {
    const priced = model("test", "echo", {
      variants: ["high"],
      capabilities: { tools: true, image: true },
      contextLimit: 200_000,
      limits: { context: 200_000, output: 64_000 },
      modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      cost: [{ input: 3, output: 15 }],
      status: "beta",
    })
    server = await startRoute({
      caller: new FakeModelCaller([]),
      options: { keys: { probeapp: KEY }, adminKey: "admin-secret", aliases: { fast: "test/echo" } },
      catalog: [priced],
    })
    const listed = await server.send({ path: "/v1/models", headers: bearer })
    expect(listed.status).toBe(200)
    const byId = Object.fromEntries((listed.json().data as Array<{ id: string }>).map((entry) => [entry.id, entry]))
    expect(Object.keys(byId).sort()).toEqual(["fast", "test/echo", "test/echo#high"])
    expect(byId["test/echo"]).toMatchObject({
      owned_by: "test",
      context_length: 200_000,
      max_output_tokens: 64_000,
      plugboard: { capabilities: { tools: true, image: true }, modalities: { input: ["text", "image", "pdf"] }, cost: [{ input: 3, output: 15 }], status: "beta" },
    })
    // A keyed server refuses the admin key on the model routes, so the page asks for an app key.
    expect((await server.send({ path: "/v1/models", headers: { authorization: "Bearer admin-secret" } })).status).toBe(401)
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
