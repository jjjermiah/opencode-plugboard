/**
 * #270 `apps.<name>.maxN`: a per-app cap on the choices (`n`) one request may ask for. It only lowers the global
 * `maxN`, and a request above it is the existing 400 `too_many_choices` before any model call. Real loopback HTTP.
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

const KEYS = { chat: "k-chat", batch: "k-batch" }
const options = { keys: KEYS, maxN: 4, apps: { chat: { maxN: 1 } } }

const chat = (key: string, body: Record<string, unknown> = {}): SendInit => ({
  method: "POST",
  path: "/v1/chat/completions",
  headers: { authorization: `Bearer ${key}` },
  body: { model: "test/echo", messages: [{ role: "user", content: "hi" }], ...body },
})

const completions = (key: string, body: Record<string, unknown> = {}): SendInit => ({
  method: "POST",
  path: "/v1/completions",
  headers: { authorization: `Bearer ${key}` },
  body: { model: "test/echo", prompt: "Once", ...body },
})

async function route() {
  const caller = new FakeModelCaller(() => [ev.text("answer"), ev.finish()])
  server = await startRoute({ caller, options })
  return caller
}

describe("#270 apps.<name>.maxN: a per-app cap on n", () => {
  test("an app capped at 1 gets 400 on n: 2 before any model call, while another app with the global cap succeeds", async () => {
    const caller = await route()
    const refused = await server!.send(chat(KEYS.chat, { n: 2 }))
    expect(refused.status).toBe(400)
    expect(refused.json().error).toMatchObject({ code: "too_many_choices", param: "n" })
    expect(refused.json().error.message).toContain("`apps.chat.maxN`")
    expect(caller.calls).toEqual([])

    const allowed = await server!.send(chat(KEYS.batch, { n: 2 }))
    expect(allowed.status).toBe(200)
    expect(allowed.json().choices).toHaveLength(2)
  })

  test("review NIT 7: an app with no cap of its own gets the global option named, not apps.<name>.maxN", async () => {
    await route()
    const reply = await server!.send(chat(KEYS.batch, { n: 5 }))
    expect(reply.status).toBe(400)
    expect(reply.json().error.message).toContain("option `maxN`")
    expect(reply.json().error.message).not.toContain("apps.")
  })

  test("the app's cap lets n: 1 through", async () => {
    await route()
    expect((await server!.send(chat(KEYS.chat, { n: 1 }))).status).toBe(200)
  })

  test("the cap applies to legacy completions too: prompts times n is checked against the app's cap", async () => {
    const caller = await route()
    const reply = await server!.send(completions(KEYS.chat, { n: 2 }))
    expect(reply.status).toBe(400)
    expect(reply.json().error).toMatchObject({ code: "too_many_choices" })
    expect(caller.calls).toEqual([])
  })

  test("review NIT 7: completions name the applied option the same way", async () => {
    await route()
    expect((await server!.send(completions(KEYS.chat, { n: 2 }))).json().error.message).toContain("`apps.chat.maxN`")
    const global = await server!.send(completions(KEYS.batch, { n: 5 }))
    expect(global.json().error.message).toContain("option `maxN`")
    expect(global.json().error.message).not.toContain("apps.")
  })

  test("without an app maxN, the global cap still applies unchanged", async () => {
    server = await startRoute({ caller: new FakeModelCaller(() => [ev.text("a"), ev.finish()]), options: { keys: KEYS, maxN: 2 } })
    expect((await server.send(chat(KEYS.batch, { n: 3 }))).status).toBe(400)
    expect((await server.send(chat(KEYS.batch, { n: 2 }))).status).toBe(200)
  })
})
