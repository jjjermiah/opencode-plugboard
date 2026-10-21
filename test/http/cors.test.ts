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
    expect(reply.headers["access-control-allow-methods"]).toBe("GET, POST, DELETE, OPTIONS")
    expect(reply.headers["access-control-allow-headers"]).toBe(
      "authorization, content-type, x-api-key, x-goog-api-key, x-request-id, cache-control, x-plugboard-cache, x-plugboard-cache-namespace, x-portkey-cache-namespace, x-portkey-cache-force-refresh, helicone-cache-seed, x-plugboard-tag",
    )
    expect(reply.headers.vary).toBe("Origin")
    expect(caller.calls).toEqual([])
  })

  test("#514 the preflight lets a browser send x-request-id", async () => {
    await route({ cors })
    const reply = await server!.send(preflight(APP, { "access-control-request-headers": "x-request-id" }))
    expect(reply.headers["access-control-allow-headers"]!.split(", ")).toContain("x-request-id")
  })

  test("a browser may send the response-cache headers", async () => {
    await route({ cors })
    const reply = await server!.send(preflight(APP, { "access-control-request-headers": "x-plugboard-cache, x-plugboard-cache-namespace, cache-control" }))
    const allowed = reply.headers["access-control-allow-headers"]!.split(", ")
    for (const name of ["x-plugboard-cache", "x-plugboard-cache-namespace", "cache-control"]) expect(allowed).toContain(name)
  })

  test("a DELETE preflight on a stored response from an allowed origin is allowed, and needs no key", async () => {
    const { caller } = await route({ keys: { app: "secret" }, cors })
    const path = `/v1/responses/resp_${"a".repeat(32)}`
    const reply = await server!.send({ method: "OPTIONS", path, headers: { origin: APP, "access-control-request-method": "DELETE" } })
    expect(reply.status).toBe(204)
    expect(reply.headers["access-control-allow-origin"]).toBe(APP)
    expect(reply.headers["access-control-allow-methods"]).toContain("DELETE")
    // The actual DELETE still needs its key.
    expect((await server!.send({ method: "DELETE", path, headers: { origin: APP } })).status).toBe(401)
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

describe("#314 cors: the plugboard response headers are exposed to the browser", () => {
  test("an allowed origin's actual answer lists the x-plugboard-* headers and retry-after in Access-Control-Expose-Headers", async () => {
    await route({ cors })
    const reply = await server!.send(chat({ origin: APP }))
    const exposed = (reply.headers["access-control-expose-headers"] ?? "").split(", ")
    for (const name of ["x-plugboard-request-id", "x-plugboard-model", "x-plugboard-session", "x-plugboard-usage", "retry-after"]) expect(exposed).toContain(name)
    // The header the answer really carries is one of the exposed ones.
    expect(reply.headers["x-plugboard-request-id"]).toBeDefined()
  })

  test("an origin off the list gets no Access-Control-Expose-Headers either", async () => {
    await route({ cors })
    const reply = await server!.send(preflight("https://evil.example"))
    expect(reply.headers["access-control-expose-headers"]).toBeUndefined()
  })

  test("with cors absent, no CORS header is sent (the answer is unchanged)", async () => {
    await route({})
    const reply = await server!.send(chat({}))
    expect(reply.headers["access-control-expose-headers"]).toBeUndefined()
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

/** Review of #319 (SHOULD 5): the preflight and an error answer carry the list too, and the list is the whole set of names. */
describe("#314 review: Access-Control-Expose-Headers on every allowed answer, the whole list", () => {
  const exposed = (headers: Record<string, string | string[] | undefined>) => String(headers["access-control-expose-headers"] ?? "").split(", ")

  test("an allowed origin's 204 preflight carries the list", async () => {
    await route({ cors })
    const reply = await server!.send(preflight(APP))
    expect(reply.status).toBe(204)
    expect(exposed(reply.headers).length).toBeGreaterThan(0)
  })

  test("an allowed origin's 401 answer (a wrong key) carries the list, so the page can read the refusal headers", async () => {
    await route({ keys: { app: "secret" }, cors })
    const reply = await server!.send(chat({ origin: APP, authorization: "Bearer wrong" }))
    expect(reply.status).toBe(401)
    expect(exposed(reply.headers)).toContain("x-plugboard-request-id")
    expect(exposed(reply.headers)).toContain("retry-after")
  })

  test("the list is exactly the x-plugboard-* names the source sets, plus retry-after", async () => {
    await route({ cors })
    const reply = await server!.send(chat({ origin: APP }))
    const names = new Set<string>()
    for (const path of new Bun.Glob("src/**/*.ts").scanSync({ cwd: `${import.meta.dir}/../..` })) {
      const text = await Bun.file(`${import.meta.dir}/../../${path}`).text()
      for (const match of text.matchAll(/"(x-plugboard-[a-z-]+)"/g)) names.add(match[1]!)
    }
    // Request headers the caller sends: they are allowed on the preflight, not exposed on the answer.
    names.delete("x-plugboard-tag")
    expect(exposed(reply.headers).sort()).toEqual([...names, "retry-after"].sort())
  })
})
