/**
 * The admin key routes (#55, src/admin/route.ts) over loopback HTTP: 404 without `adminKey`, 401 for
 * every credential but the admin key, create (the key returned once, then accepted by the chat route),
 * revoke (401 on the next request), config keys refused, and the logs never carry a key value.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createKeyState, createKeyStore, keyIdOf, keyDigest } from "../../src/keys.js"
import { ev } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { FakeStorage } from "../support/usage.js"

const logs = captureLogs()

const ALPHA = "config-alpha-secret"
const ADMIN = "admin-root-secret"
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
const chat = (token?: string): SendInit => ({
  method: "POST",
  path: "/v1/chat/completions",
  ...(token === undefined ? {} : { headers: bearer(token) }),
  body: { model: "test/echo", messages: [{ role: "user", content: "hi" }] },
})

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

/** A route with config key `alpha`, the admin key (unless `adminKey` is false) and a runtime key store on fake storage. */
async function start({ adminKey = true }: { adminKey?: boolean } = {}): Promise<RouteServer> {
  const keys = createKeyStore({ state: createKeyState(), storage: new FakeStorage() })
  server = await startRoute({
    caller: new FakeModelCaller(() => [ev.text("hi"), ev.finish()]),
    options: { keys: { alpha: ALPHA }, ...(adminKey ? { adminKey: ADMIN } : {}) },
    keys,
  })
  return server
}

describe("#55 admin routes: who may call them", () => {
  test("#55 without adminKey every admin path is a 404, whatever the credential", async () => {
    const srv = await start({ adminKey: false })
    for (const init of [{ path: "/plugboard/admin/keys" }, { path: "/plugboard/admin/keys", method: "POST", body: { app: "bot" } }, { path: "/plugboard/admin/keys/deadbeef", method: "DELETE" }]) {
      const reply = await srv.send({ ...init, headers: bearer(ADMIN) })
      expect(reply.status).toBe(404)
      expect(reply.json().code).toBe("not_found")
    }
  })

  test("#55 an app key, a wrong key and no key are all 401 on the admin routes", async () => {
    const srv = await start()
    expect((await srv.send({ path: "/plugboard/admin/keys", headers: bearer(ALPHA) })).status).toBe(401)
    expect((await srv.send({ path: "/plugboard/admin/keys", headers: bearer("nope") })).status).toBe(401)
    const none = await srv.send({ path: "/plugboard/admin/keys" })
    expect(none.status).toBe(401)
    expect(none.json().code).toBe("invalid_api_key")
  })

  test("#55 a wrong method on the collection is a 405", async () => {
    const srv = await start()
    expect((await srv.send({ method: "PUT", path: "/plugboard/admin/keys", headers: bearer(ADMIN), body: {} })).status).toBe(405)
  })
})

describe("the body budget and the admin key API (since 0.39.0)", () => {
  const MIB = 1024 * 1024
  const threeApps = { alpha: ALPHA, beta: "beta-config-secret", gamma: "gamma-config-secret" }

  test("an explicit budget that cannot hold one more app's body refuses the new key with 409, and creates nothing", async () => {
    const keys = createKeyStore({ state: createKeyState(), storage: new FakeStorage() })
    server = await startRoute({
      caller: new FakeModelCaller(() => [ev.text("hi"), ev.finish()]),
      options: { keys: threeApps, adminKey: ADMIN, limits: { maxBodyBytesInFlight: 96 * MIB } },
      keys,
    })
    const srv = server
    const refused = await srv.send({ method: "POST", path: "/plugboard/admin/keys", headers: bearer(ADMIN), body: { app: "delta" } })
    expect(refused.status).toBe(409)
    expect(refused.json().code).toBe("body_budget_insufficient")
    expect((await srv.send({ path: "/plugboard/admin/keys", headers: bearer(ADMIN) })).json().keys).toHaveLength(3)
  })

  test("without an explicit budget the new app is accepted: the budget grows with it", async () => {
    const keys = createKeyStore({ state: createKeyState(), storage: new FakeStorage() })
    server = await startRoute({
      caller: new FakeModelCaller(() => [ev.text("hi"), ev.finish()]),
      options: { keys: threeApps, adminKey: ADMIN },
      keys,
    })
    expect((await server.send({ method: "POST", path: "/plugboard/admin/keys", headers: bearer(ADMIN), body: { app: "delta" } })).status).toBe(201)
  })
})

describe("#418 an app name is at most 255 characters, the longest file name a filesystem takes", () => {
  test("a 255-character name mints a key; a 256-character name is refused with 400 invalid_app and mints nothing", async () => {
    const srv = await start()
    const created = await srv.send({ method: "POST", path: "/plugboard/admin/keys", headers: bearer(ADMIN), body: { app: "x".repeat(255) } })
    expect(created.status).toBe(201)
    const refused = await srv.send({ method: "POST", path: "/plugboard/admin/keys", headers: bearer(ADMIN), body: { app: "x".repeat(256) } })
    expect(refused.status).toBe(400)
    expect(refused.json()).toMatchObject({ code: "invalid_app", status: 400 })
    expect(JSON.stringify(refused.json())).toContain("255")
    expect((await srv.send({ path: "/plugboard/admin/keys", headers: bearer(ADMIN) })).json().keys).toHaveLength(2)
  })
})

describe("#55 admin routes: create, list, revoke", () => {
  test("#55 GET lists the config key and no runtime keys on a fresh server", async () => {
    const srv = await start()
    const reply = await srv.send({ path: "/plugboard/admin/keys", headers: bearer(ADMIN) })
    expect(reply.status).toBe(200)
    expect(reply.json()).toEqual({ keys: [{ id: keyIdOf(keyDigest(ALPHA)), app: "alpha", source: "config" }] })
  })

  test("#55 POST returns the new key once, and that key authenticates on /v1/chat/completions", async () => {
    const srv = await start()
    const created = await srv.send({ method: "POST", path: "/plugboard/admin/keys", headers: bearer(ADMIN), body: { app: "bot" } })
    expect(created.status).toBe(201)
    expect(created.headers["cache-control"]).toBe("no-store")
    const { id, app, key, createdAt } = created.json()
    expect(app).toBe("bot")
    expect(typeof key).toBe("string")
    expect(id).toBe(keyIdOf(keyDigest(key)))
    expect(typeof createdAt).toBe("string")

    expect((await srv.send(chat(key))).status).toBe(200)
    // Listed by id and source, never by value.
    const listed = (await srv.send({ path: "/plugboard/admin/keys", headers: bearer(ADMIN) })).json().keys
    expect(listed).toContainEqual({ id, app: "bot", source: "runtime", createdAt })
    expect(JSON.stringify(listed)).not.toContain(key)
    // The log line names the id and the app, never the key.
    const line = logs.of("admin.key_created")[0]!
    expect(line.fields).toMatchObject({ id, app: "bot" })
    expect(line.raw).not.toContain(key)
  })

  test("#55 DELETE revokes a runtime key: the next request with it is a 401", async () => {
    const srv = await start()
    const { id, key } = (await srv.send({ method: "POST", path: "/plugboard/admin/keys", headers: bearer(ADMIN), body: { app: "bot" } })).json()
    expect((await srv.send(chat(key))).status).toBe(200)
    const gone = await srv.send({ method: "DELETE", path: `/plugboard/admin/keys/${id}`, headers: bearer(ADMIN) })
    expect(gone.status).toBe(200)
    expect(gone.json()).toEqual({ id, revoked: true })
    expect((await srv.send(chat(key))).status).toBe(401)
    expect((await srv.send({ method: "DELETE", path: `/plugboard/admin/keys/${id}`, headers: bearer(ADMIN) })).status).toBe(404)
  })

  test("#55 a config key cannot be revoked through the API: 409, pointing at the config", async () => {
    const srv = await start()
    const reply = await srv.send({ method: "DELETE", path: `/plugboard/admin/keys/${keyIdOf(keyDigest(ALPHA))}`, headers: bearer(ADMIN) })
    expect(reply.status).toBe(409)
    expect(reply.json().detail).toContain("plugboard config")
    // The config key still works.
    expect((await srv.send(chat(ALPHA))).status).toBe(200)
  })

  test("#55 POST refuses a name that is not an app, the reserved default, and an app with a config key", async () => {
    const srv = await start()
    const post = (body: unknown) => srv.send({ method: "POST", path: "/plugboard/admin/keys", headers: bearer(ADMIN), body })
    expect((await post({ app: "Bad_Name" })).status).toBe(400)
    expect((await post({ app: "default" })).status).toBe(400)
    expect((await post({})).status).toBe(400)
    const taken = await post({ app: "alpha" })
    expect(taken.status).toBe(409)
    expect(taken.json().code).toBe("app_has_config_key")
  })

  test("#197 POST refuses an app with opencodeTools: 409 app_has_opencode_tools, and mints no key", async () => {
    // The config already refuses a opencodeTools app without a key (parseApps), so the app here has a config key;
    // the route's own check must still refuse before it reaches the config-key rule (app_has_config_key).
    const keys = createKeyStore({ state: createKeyState(), storage: new FakeStorage() })
    server = await startRoute({
      caller: new FakeModelCaller(() => [ev.text("hi"), ev.finish()]),
      options: { keys: { alpha: ALPHA, bot: "bot-config-secret" }, adminKey: ADMIN, apps: { bot: { opencodeTools: ["websearch"] } } },
      keys,
    })
    const reply = await server.send({ method: "POST", path: "/plugboard/admin/keys", headers: bearer(ADMIN), body: { app: "bot" } })
    expect(reply.status).toBe(409)
    expect(reply.json().code).toBe("app_has_opencode_tools")
    expect((await server.send({ path: "/plugboard/admin/keys", headers: bearer(ADMIN) })).json().keys.every((key: { source: string }) => key.source === "config")).toBe(true)
  })

  test("#55 an unknown or malformed key id is a 404", async () => {
    const srv = await start()
    expect((await srv.send({ method: "DELETE", path: "/plugboard/admin/keys/notanid", headers: bearer(ADMIN) })).status).toBe(404)
    expect((await srv.send({ method: "DELETE", path: "/plugboard/admin/keys/00000000", headers: bearer(ADMIN) })).status).toBe(404)
  })
})
