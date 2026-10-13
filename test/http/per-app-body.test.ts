/**
 * #258 `limits.apps.<name>.maxBodyBytes` and `limits.maxBodyBytes`: a body over the caller's cap is a 413 before it is
 * read (I28), so one app can be capped well below another. The cap only lowers the 32 MiB hard cap. Real loopback HTTP.
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

const KEYS = { widget: "k-widget", bot: "k-bot" }

/** A chat request whose message is `chars` long, so its body is about that size plus the envelope. */
const chat = (key: string, chars: number, init: Partial<SendInit> = {}): SendInit => ({
  method: "POST",
  path: "/v1/chat/completions",
  headers: { authorization: `Bearer ${key}` },
  body: { model: "test/echo", messages: [{ role: "user", content: "x".repeat(chars) }] },
  ...init,
})

async function route(options: Record<string, unknown>) {
  const caller = new FakeModelCaller(() => [ev.text("answer"), ev.finish()])
  server = await startRoute({ caller, options: { keys: KEYS, ...options } })
  return caller
}

describe("#258 limits.apps.<name>.maxBodyBytes: a per-app body cap", () => {
  test("a body over the app's cap is a 413, and the same body is accepted for an app without that cap", async () => {
    const caller = await route({ limits: { apps: { widget: { maxBodyBytes: 256 } } } })
    const refused = await server!.send(chat(KEYS.widget, 400))
    expect(refused.status).toBe(413)
    expect(caller.calls).toEqual([])
    expect((await server!.send(chat(KEYS.bot, 400))).status).toBe(200)
  })

  test("a body under the app's cap is accepted", async () => {
    await route({ limits: { apps: { widget: { maxBodyBytes: 4096 } } } })
    expect((await server!.send(chat(KEYS.widget, 100))).status).toBe(200)
  })

  test("the app's cap is checked from the declared Content-Length, before the body is read", async () => {
    await route({ limits: { apps: { widget: { maxBodyBytes: 256 } } } })
    const reply = await server!.send(chat(KEYS.widget, 0, { headers: { authorization: `Bearer ${KEYS.widget}`, "content-length": 300 }, body: "{}" }))
    expect(reply.status).toBe(413)
    expect(reply.headers.connection).toBe("close")
  })
})

describe("#258 limits.maxBodyBytes: the global ceiling for every app", () => {
  test("a body over the global cap is a 413 for every app", async () => {
    await route({ limits: { maxBodyBytes: 1024 } })
    expect((await server!.send(chat(KEYS.widget, 2000))).status).toBe(413)
    expect((await server!.send(chat(KEYS.bot, 2000))).status).toBe(413)
  })

  test("with the global cap set, an app cap lowers it further for that app only", async () => {
    await route({ limits: { maxBodyBytes: 4096, apps: { widget: { maxBodyBytes: 256 } } } })
    expect((await server!.send(chat(KEYS.widget, 400))).status).toBe(413)
    expect((await server!.send(chat(KEYS.bot, 400))).status).toBe(200)
  })

  test("with neither field set, a body of this size is accepted as before", async () => {
    await route({})
    expect((await server!.send(chat(KEYS.widget, 4000))).status).toBe(200)
  })
})
