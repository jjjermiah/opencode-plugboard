/**
 * #268 `apps.<name>.endpoints`: an app may be limited to some endpoint families. The check runs after
 * authentication (I15), answers 403 `endpoint_forbidden` in each front-end's own error shape, and an
 * unset list keeps every endpoint reachable. Real loopback HTTP, fake model caller.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { ev } from "../support/fixtures.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

/** Two apps: `bot` may only use Chat Completions, `pal` may only list models. */
const LIMITED = {
  keys: { bot: "k-bot", pal: "k-pal" },
  apps: { bot: { endpoints: ["chat"] }, pal: { endpoints: ["models"] } },
}
const BOT = { authorization: "Bearer k-bot" }
const PAL = { authorization: "Bearer k-pal" }

async function route(options: Record<string, unknown>) {
  const caller = new FakeModelCaller(() => [ev.text("ok"), ev.finish()])
  server = await startRoute({ caller, options })
  return { server, caller }
}

const chat = (headers: Record<string, string>): SendInit => ({
  method: "POST",
  path: "/v1/chat/completions",
  headers,
  body: { model: "test/echo", messages: [{ role: "user", content: "hi" }] },
})

describe("#268 apps.<name>.endpoints on the OpenAI routes", () => {
  test("an app limited to chat reaches /v1/chat/completions", async () => {
    await route(LIMITED)
    expect((await server!.send(chat(BOT))).status).toBe(200)
  })

  test.each([
    ["/v1/responses", { method: "POST", path: "/v1/responses", body: { model: "test/echo", input: "hi" } }],
    ["/v1/completions", { method: "POST", path: "/v1/completions", body: { model: "test/echo", prompt: "hi" } }],
    ["/v1/models", { method: "GET", path: "/v1/models" }],
  ])("an app limited to chat gets 403 endpoint_forbidden on %s, and the model is never called", async (_name, init) => {
    const { caller } = await route(LIMITED)
    const reply = await server!.send({ ...init, headers: BOT })
    expect(reply.status).toBe(403)
    expect(reply.headers["content-type"]).toBe("application/json")
    expect(reply.json().error).toMatchObject({ type: "permission_error", code: "endpoint_forbidden" })
    expect(reply.json().error.message).toContain("apps.bot.endpoints")
    expect(caller.calls).toEqual([])
  })

  test("an app limited to models can list and cannot call", async () => {
    const { caller } = await route(LIMITED)
    expect((await server!.send({ method: "GET", path: "/v1/models", headers: PAL })).status).toBe(200)
    const refused = await server!.send(chat(PAL))
    expect(refused.status).toBe(403)
    expect(refused.json().error).toMatchObject({ code: "endpoint_forbidden" })
    expect(caller.calls).toEqual([])
  })

  test("a refusal is 403 for an authenticated caller and 401 for an unauthenticated one (I15)", async () => {
    await route(LIMITED)
    const anonymous = await server!.send({ method: "POST", path: "/v1/responses", body: { model: "test/echo", input: "hi" } })
    expect(anonymous.status).toBe(401)
    expect(anonymous.json().error).toMatchObject({ code: "invalid_api_key" })
  })

  test("a refusal on an unknown route is still a 404 not_found: the endpoint check runs after route existence", async () => {
    await route(LIMITED)
    const reply = await server!.send({ method: "GET", path: "/v1/chat/completions", headers: BOT })
    expect(reply.status).toBe(404)
    expect(reply.json().error).toMatchObject({ code: "not_found" })
  })

  test("with apps.<name>.endpoints unset, every endpoint is reachable, as before", async () => {
    await route({ keys: { app: "secret" } })
    const headers = { authorization: "Bearer secret" }
    expect((await server!.send({ method: "POST", path: "/v1/responses", headers, body: { model: "test/echo", input: "hi" } })).status).toBe(200)
    expect((await server!.send({ method: "GET", path: "/v1/models", headers })).status).toBe(200)
  })
})

describe("#268 apps.<name>.endpoints on the Anthropic and Gemini routes, in their own error shapes", () => {
  test("a refused POST /v1/messages is an Anthropic-shaped permission_error", async () => {
    const { caller } = await route(LIMITED)
    const reply = await server!.send({
      method: "POST",
      path: "/v1/messages",
      headers: { "x-api-key": "k-bot" },
      body: { model: "test/echo", max_tokens: 16, messages: [{ role: "user", content: "hi" }] },
    })
    expect(reply.status).toBe(403)
    expect(reply.json()).toMatchObject({ type: "error", error: { type: "permission_error", message: expect.any(String) } })
    expect(caller.calls).toEqual([])
  })

  test("a refused Gemini generateContent is Google-shaped PERMISSION_DENIED", async () => {
    const { caller } = await route(LIMITED)
    const reply = await server!.send({
      method: "POST",
      path: "/v1beta/models/test%2Fecho:generateContent",
      headers: BOT,
      body: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
    })
    expect(reply.status).toBe(403)
    expect(reply.json()).toEqual({ error: expect.objectContaining({ code: 403, status: "PERMISSION_DENIED", message: expect.stringContaining("apps.bot.endpoints") }) })
    expect(caller.calls).toEqual([])
  })
})
