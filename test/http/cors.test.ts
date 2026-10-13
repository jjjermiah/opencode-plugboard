/**
 * #256 `cors`: a browser origin on the allowlist may call plugboard. Its preflight is answered before
 * authentication (a preflight has no credentials), the Host check still runs, the actual request still
 * needs its key, and an origin off the list gets no CORS header. Real loopback HTTP, fake model caller.
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

const APP = "https://chat.example.net"
const cors = { origins: [APP, "http://localhost:3000"], allowPrivateNetwork: true }

async function route(options: Record<string, unknown>) {
  const caller = new FakeModelCaller(() => [ev.text("ok"), ev.finish()])
  server = await startRoute({ caller, options })
  return { server, caller }
}

const preflight = (origin: string, headers: Record<string, string> = {}): SendInit => ({
  method: "OPTIONS",
  path: "/v1/chat/completions",
  headers: { origin, "access-control-request-method": "POST", ...headers },
})

const chat = (headers: Record<string, string>): SendInit => ({
  method: "POST",
  path: "/v1/chat/completions",
  headers,
  body: { model: "test/echo", messages: [{ role: "user", content: "hi" }] },
})

describe("#256 cors: a preflight from an allowed origin is answered before authentication", () => {
  test("a keyless endpoint answers the preflight 204 with the allowlist headers, and calls no model", async () => {
    const { caller } = await route({ cors })
    const reply = await server!.send(preflight(APP))
    expect(reply.status).toBe(204)
    expect(reply.headers["access-control-allow-origin"]).toBe(APP)
    expect(reply.headers["access-control-allow-methods"]).toBe("GET, POST, OPTIONS")
    expect(reply.headers["access-control-allow-headers"]).toBe("authorization, content-type, x-api-key, x-goog-api-key")
    expect(reply.headers.vary).toBe("Origin")
    expect(caller.calls).toEqual([])
  })

  test("with keys, the preflight needs no key, but the actual request still does (no auth bypass)", async () => {
    const { caller } = await route({ keys: { app: "secret" }, cors })
    expect((await server!.send(preflight(APP))).status).toBe(204)
    const actual = await server!.send(chat({ origin: APP }))
    expect(actual.status).toBe(401)
    expect(actual.headers["access-control-allow-origin"]).toBe(APP)
    expect(actual.json().error).toMatchObject({ code: "invalid_api_key" })
    expect(caller.calls).toEqual([])
  })

  test("a preflight from an origin off the list gets no CORS headers", async () => {
    await route({ cors })
    const reply = await server!.send(preflight("https://evil.example"))
    expect(reply.headers["access-control-allow-origin"]).toBeUndefined()
    expect(reply.headers["access-control-allow-methods"]).toBeUndefined()
    // Keyless, so the Origin refusal answers it: the browser never gets a success to read.
    expect(reply.status).toBe(403)
  })

  test("with keys, an origin off the list gets no CORS headers, even with the right key", async () => {
    await route({ keys: { app: "secret" }, cors })
    const reply = await server!.send(chat({ origin: "https://evil.example", authorization: "Bearer secret" }))
    expect(reply.status).toBe(200)
    expect(reply.headers["access-control-allow-origin"]).toBeUndefined()
  })

  test("a preflight with a refused Host is a 403 invalid_host: CORS does not bypass the rebinding check", async () => {
    await route({ cors })
    const reply = await server!.send(preflight(APP, { host: "evil.example:1" }))
    expect(reply.status).toBe(403)
    expect(reply.json().error).toMatchObject({ code: "invalid_host" })
  })

  test("the Messages route answers its preflight from an allowed origin too", async () => {
    await route({ keys: { app: "secret" }, cors })
    const reply = await server!.send({ method: "OPTIONS", path: "/v1/messages", headers: { origin: APP, "access-control-request-method": "POST" } })
    expect(reply.status).toBe(204)
    expect(reply.headers["access-control-allow-origin"]).toBe(APP)
  })
})

describe("#256 cors: an allowed origin's actual answer", () => {
  test("carries Access-Control-Allow-Origin and the rest of the answer is unchanged", async () => {
    await route({ cors })
    const reply = await server!.send(chat({ origin: APP }))
    expect(reply.status).toBe(200)
    expect(reply.headers["access-control-allow-origin"]).toBe(APP)
    expect(reply.json()).toHaveProperty("choices")
  })

  test("* echoes * for any origin, and needs keys", async () => {
    await route({ keys: { app: "secret" }, cors: { origins: ["*"], allowPrivateNetwork: false } })
    const reply = await server!.send(chat({ origin: "https://anything.example", authorization: "Bearer secret" }))
    expect(reply.headers["access-control-allow-origin"]).toBe("*")
  })
})

describe("#256 cors: Private Network Access", () => {
  test("the header is sent only when allowPrivateNetwork is on and the preflight asks for it", async () => {
    const asks = { "access-control-request-private-network": "true" }
    await route({ cors: { origins: [APP], allowPrivateNetwork: false } })
    expect((await server!.send(preflight(APP, asks))).headers["access-control-allow-private-network"]).toBeUndefined()
    await server!.close()
    await route({ cors: { origins: [APP], allowPrivateNetwork: true } })
    expect((await server!.send(preflight(APP, asks))).headers["access-control-allow-private-network"]).toBe("true")
    expect((await server!.send(preflight(APP))).headers["access-control-allow-private-network"]).toBeUndefined()
  })
})
