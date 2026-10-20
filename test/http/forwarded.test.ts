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

describe("#544 the setup page on a wildcard listen address", () => {
  const wildcard = async (options: Record<string, unknown> = {}) => {
    server = await startRoute({ caller: new FakeModelCaller(() => [ev.finish()]), options: { keys: { app: "secret" }, ...options }, listenHost: "0.0.0.0" })
    return server
  }

  test("GET /v1 and GET / show the Host the caller used, never 0.0.0.0", async () => {
    await wildcard()
    const doc = (await server!.send({ path: "/v1", headers: { ...KEY, host: "192.0.2.10:4010" } })).json()
    expect(doc.baseUrl).toBe("http://192.0.2.10:4010/v1")
    expect(doc.example.curl).toContain("curl -s http://192.0.2.10:4010/v1/chat/completions")
    const page = await server!.send({ path: "/", headers: { ...KEY, host: "192.0.2.10:4010" } })
    expect(page.text).toContain("<code>http://192.0.2.10:4010/v1</code>")
    expect(page.text).not.toContain("0.0.0.0")
  })

  test("a caller without a key sees the same address", async () => {
    await wildcard()
    expect((await server!.send({ path: "/v1", headers: { host: "192.0.2.10:4010" } })).json().baseUrl).toBe("http://192.0.2.10:4010/v1")
  })

  test("a Host that is itself 0.0.0.0, or not a plain host, gets the placeholder and a hint", async () => {
    await wildcard()
    for (const host of ["0.0.0.0:4010", "evil.example/x'y"]) {
      const reply = await server!.send({ path: "/v1", headers: { ...KEY, host } })
      expect(reply.status).toBe(200)
      const doc = reply.json()
      expect(doc.baseUrl).toBe(`http://<this-host>:${server!.port}/v1`)
      expect(doc.baseUrlHint).toContain("<this-host>")
    }
    const page = await server!.send({ path: "/", headers: { ...KEY, host: "0.0.0.0:4010" } })
    expect(page.text).toContain('<p class="hint">The server listens on every address')
  })

  test("behind a trusted proxy the public origin wins over the Host header", async () => {
    await wildcard({ listen: { trustProxy: ["127.0.0.1"] } })
    const doc = (await server!.send({ path: "/v1", headers: { ...KEY, ...PUBLIC, host: "192.0.2.10:4010" } })).json()
    expect(doc.baseUrl).toBe("https://chat.example.net/v1")
    expect(doc).not.toHaveProperty("baseUrlHint")
  })

  test("an untrusted peer's forwarded headers are ignored: the Host header is used", async () => {
    await wildcard({ listen: { trustProxy: ["10.0.0.0/8"] } })
    const doc = (await server!.send({ path: "/v1", headers: { ...KEY, ...PUBLIC, host: "192.0.2.10:4010" } })).json()
    expect(doc.baseUrl).toBe("http://192.0.2.10:4010/v1")
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
