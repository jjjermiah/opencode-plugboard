/**
 * `"models": "connected"` over loopback HTTP with a fake catalog: every model the host catalog offers is allowed, resolved
 * on each request (so a provider connected later appears without a restart), under keys and per-app narrowing.
 */
import { afterEach, describe, expect, test } from "bun:test"
import type { CatalogModel } from "../../src/contract.js"
import { CATALOG, ev, model } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

captureLogs()
let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const KEY = { authorization: "Bearer k-main" }
const ids = (reply: { json(): { data: Array<{ id: string }> } }) => reply.json().data.map((entry) => entry.id)
const chat = (modelName: string, headers: Record<string, string> = KEY) => ({
  method: "POST" as const,
  path: "/v1/chat/completions",
  headers,
  body: { model: modelName, messages: [{ role: "user", content: "hi" }] },
})

describe("models: connected", () => {
  test("lists every catalog model and serves any of them, with aliases", async () => {
    const caller = new FakeModelCaller([ev.text("ok"), ev.finish()])
    server = await startRoute({ caller, options: { models: "connected", keys: { main: "k-main" }, aliases: { fast: "other/model" } } })
    expect(ids(await server.send({ path: "/v1/models", headers: KEY }))).toEqual(expect.arrayContaining(["test/echo", "test/echo#low", "test/vision", "other/model", "fast"]))
    expect((await server.send(chat("other/model"))).status).toBe(200)
    expect((await server.send(chat("fast"))).status).toBe(200)
    expect(caller.calls.map((call) => call.request.ref)).toEqual([
      { providerID: "other", id: "model" },
      { providerID: "other", id: "model" },
    ])
  })

  test("a model the catalog lacks is the usual 404, and an alias whose target is gone is not served", async () => {
    server = await startRoute({ caller: new FakeModelCaller([ev.finish()]), options: { models: "connected", keys: { main: "k-main" }, aliases: { gone: "ghost/model" } } })
    expect((await server.send(chat("ghost/model"))).status).toBe(404)
    expect((await server.send(chat("gone"))).status).toBe(404)
    expect(ids(await server.send({ path: "/v1/models", headers: KEY }))).not.toContain("gone")
  })

  test("the catalog is read on every request: a provider connected later is served without a reload", async () => {
    let catalog: ReadonlyArray<CatalogModel> = [model("test", "echo")]
    server = await startRoute({ caller: new FakeModelCaller([ev.finish()]), catalog: async () => catalog, options: { models: "connected", keys: { main: "k-main" } } })
    expect((await server.send(chat("later/model"))).status).toBe(404)
    catalog = [model("test", "echo"), model("later", "model")]
    expect(ids(await server.send({ path: "/v1/models", headers: KEY }))).toContain("later/model")
    expect((await server.send(chat("later/model"))).status).toBe(200)
  })

  test("keys are still required, and without models the answer is still 403", async () => {
    server = await startRoute({ caller: new FakeModelCaller([ev.finish()]), options: { models: "connected", keys: { main: "k-main" } } })
    expect((await server.send(chat("test/echo", {}))).status).toBe(401)
    await server.close()
    server = await startRoute({ caller: new FakeModelCaller([ev.finish()]), options: { models: [], keys: { main: "k-main" } } })
    const reply = await server.send(chat("test/echo"))
    expect(reply.status).toBe(403)
    expect(reply.json().error.code).toBe("no_models_configured")
  })

  test("an app's own models still narrow it; `connected` on an app is the global list", async () => {
    server = await startRoute({
      caller: new FakeModelCaller([ev.finish()]),
      options: { models: "connected", apps: { small: { key: "k-small", models: ["test/*"] }, wide: { key: "k-wide", models: "connected" } } },
    })
    const small = { authorization: "Bearer k-small" }
    const wide = { authorization: "Bearer k-wide" }
    expect(ids(await server.send({ path: "/v1/models", headers: small })).sort()).toEqual(["test/echo", "test/echo#high", "test/echo#low", "test/vision"])
    expect((await server.send({ path: "/v1/models/other%2Fmodel", headers: small })).status).toBe(404)
    expect((await server.send({ path: "/v1/models/other%2Fmodel", headers: wide })).status).toBe(200)
    expect((await server.send(chat("other/model", wide))).status).toBe(200)
    expect(ids(await server.send({ path: "/v1/models", headers: wide }))).toContain("other/model")
  })

  test("the setup page suggests `connected` when models is unset, and lists it once set", async () => {
    server = await startRoute({ caller: new FakeModelCaller([]), options: { models: [] } })
    const page = (await server.send({ path: "/" })).text
    expect(page).toContain("&quot;models&quot;: &quot;connected&quot;")
    expect((await server.send({ path: "/v1" })).json().models).toMatchObject({ state: "no_models_configured", hint: expect.stringContaining('{"models":"connected"}') })
    await server.close()
    server = await startRoute({ caller: new FakeModelCaller([]), catalog: CATALOG, options: { models: "connected" } })
    expect((await server.send({ path: "/v1" })).json().models).toMatchObject({ state: "ready", allowlist: ["connected"], available: 5 })
  })
})
