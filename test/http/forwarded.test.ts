/**
 * #266 `listen.trustProxy` over real loopback HTTP: a trusted proxy's forwarded host passes the Host check on a keyed
 * endpoint, an untrusted peer's is ignored, a keyless endpoint never takes it, the discovery base URL shows the public
 * origin, the request log names the real client, and no forwarded header authenticates.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { ev } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

const logs = captureLogs()
let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

async function route(options: Record<string, unknown>) {
  const caller = new FakeModelCaller(() => [ev.text("ok"), ev.finish()])
  server = await startRoute({ caller, options })
  return { server, caller }
}

const PUBLIC = { "x-forwarded-host": "chat.example.net", "x-forwarded-proto": "https" }
const KEY = { authorization: "Bearer secret" }

describe("#266 a trusted proxy on a keyed endpoint", () => {
  test("the forwarded host passes the Host check, where the listener's own name would be refused", async () => {
    await route({ keys: { app: "secret" }, listen: { trustProxy: ["127.0.0.1"] } })
    expect((await server!.send({ path: "/healthz", headers: { host: "chat.example.net", ...PUBLIC } })).status).toBe(200)
    // Same peer, no forwarded host: the Host check runs on the Host header as before.
    expect((await server!.send({ path: "/healthz", headers: { host: "chat.example.net" } })).status).toBe(403)
  })

  test("the discovery page's base URL is the public origin the proxy names", async () => {
    await route({ keys: { app: "secret" }, listen: { trustProxy: ["127.0.0.1"] } })
    const reply = await server!.send({ path: "/v1", headers: { ...KEY, ...PUBLIC } })
    expect(reply.json().baseUrl).toBe("https://chat.example.net/v1")
  })

  test("a forwarded header never authenticates: no key is still a 401", async () => {
    const { caller } = await route({ keys: { app: "secret" }, listen: { trustProxy: ["127.0.0.1"] } })
    const reply = await server!.send({ method: "POST", path: "/v1/chat/completions", headers: PUBLIC, body: { model: "test/echo", messages: [{ role: "user", content: "hi" }] } })
    expect(reply.status).toBe(401)
    expect(caller.calls).toEqual([])
  })

  test("the request log names the client the proxy recorded, not the proxy", async () => {
    await route({ keys: { app: "secret" }, listen: { trustProxy: ["127.0.0.1"] } })
    await server!.send({ path: "/v1", headers: { ...KEY, "x-forwarded-for": "203.0.113.7" } })
    expect(logs.of("request").at(-1)!.fields.client).toBe("203.0.113.7")
  })
})

describe("#266 forwarded headers from an untrusted peer, or with the option off", () => {
  test("an untrusted peer's forwarded host is ignored: the Host check still refuses it", async () => {
    await route({ keys: { app: "secret" }, listen: { trustProxy: ["10.0.0.0/8"] } })
    const reply = await server!.send({ path: "/healthz", headers: { host: "chat.example.net", ...PUBLIC } })
    expect(reply.status).toBe(403)
    expect(reply.json().error).toMatchObject({ code: "invalid_host" })
  })

  test("an untrusted peer's base URL and log client are the socket's own", async () => {
    await route({ keys: { app: "secret" }, listen: { trustProxy: ["10.0.0.0/8"] } })
    expect((await server!.send({ path: "/v1", headers: { ...KEY, ...PUBLIC } })).json().baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/)
    await server!.send({ path: "/v1", headers: { ...KEY, "x-forwarded-for": "203.0.113.7" } })
    expect(logs.of("request").at(-1)!.fields.client).toBe("127.0.0.1")
  })

  test("with the option unset, the forwarded host is ignored and the log has no client field", async () => {
    await route({ keys: { app: "secret" } })
    expect((await server!.send({ path: "/healthz", headers: { host: "chat.example.net", ...PUBLIC } })).status).toBe(403)
    await server!.send({ path: "/v1", headers: { ...KEY, "x-forwarded-for": "203.0.113.7" } })
    expect(logs.of("request").at(-1)!.fields).not.toHaveProperty("client")
  })

  test("a keyless endpoint never takes a trusted proxy's forwarded host: a rebinding page could send the same header", async () => {
    await route({ listen: { trustProxy: ["127.0.0.1"] } })
    expect((await server!.send({ path: "/healthz", headers: { host: "chat.example.net", ...PUBLIC } })).status).toBe(403)
  })
})
