/**
 * `GET /plugboard/usage` over loopback HTTP: who may read which app's usage (the admin key sees every app,
 * an app key only its own, keyless loopback is `default`), the 401 and 403 answers, and the dates.
 * The model calls are wrapped with `withUsage`, so the numbers come from the same path a server uses.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { withUsage, createUsageRecorder, createUsageState, type UsageRecorder } from "../../src/usage.js"
import { CATALOG, ev, until } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { FakeStorage } from "../support/usage.js"

captureLogs()

const KEYS = { alpha: "key-alpha-secret", beta: "key-beta-secret" }
const ADMIN = "root-key-secret"
const bearer = (key: string) => ({ authorization: `Bearer ${key}` })
const chat = (key?: string, body: unknown = { model: "test/echo", messages: [{ role: "user", content: "hi" }] }): SendInit => ({
  method: "POST",
  path: "/v1/chat/completions",
  ...(key === undefined ? {} : { headers: bearer(key) }),
  body,
})

let server: RouteServer | undefined
let recorder: UsageRecorder | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
  recorder = undefined
})

/** Starts a route that answers every chat call with 10 input and 5 output tokens. `usage: false` leaves the route out. */
async function start(options: Record<string, unknown> = {}, usage = true): Promise<RouteServer> {
  const storage = new FakeStorage()
  recorder = usage ? createUsageRecorder({ state: createUsageState(), storage, loadCatalog: async () => CATALOG, retentionDays: 90 }) : undefined
  const caller = withUsage(
    new FakeModelCaller(() => [ev.text("hi"), ev.finish("stop", { inputTokens: 10, outputTokens: 5 })]),
    recorder,
  )
  server = await startRoute({ caller, options, ...(recorder ? { usage: recorder } : {}) })
  return server
}

/** Waits until the recorder has counted `count` requests of `app` (the route counts after the response ends). */
async function counted(app: string, count: number): Promise<void> {
  await until(async () => ((await recorder!.query({ app })) as { totals: { requests: number } }).totals.requests >= count, 1_000, `${count} request(s) of ${app}`)
}

describe("GET /plugboard/usage: who may read which app", () => {
  test("keyless loopback reads the default app, with its tokens and cost", async () => {
    const srv = await start()
    expect((await srv.send(chat())).status).toBe(200)
    await counted("default", 1)
    const reply = await srv.send({ path: "/plugboard/usage" })
    expect(reply.status).toBe(200)
    const body = reply.json()
    expect(Object.keys(body.apps)).toEqual(["default"])
    expect(body.apps.default.totals.requests).toBe(1)
    expect(body.apps.default.days[0].tokens).toEqual({ input: 10, cacheRead: 0, cacheWrite: 0, output: 5, reasoning: 0 })
    expect(body.apps.default.models["test/echo"]).toEqual({ requests: 1, tokens: 15, costUsd: 0 })
  })

  test("an app key sees only its own app; naming another app is a 403", async () => {
    const srv = await start({ keys: KEYS, adminKey: ADMIN })
    expect((await srv.send(chat(KEYS.alpha))).status).toBe(200)
    expect((await srv.send(chat(KEYS.beta))).status).toBe(200)
    await counted("alpha", 1)
    await counted("beta", 1)

    const own = (await srv.send({ path: "/plugboard/usage", headers: bearer(KEYS.alpha) })).json()
    expect(Object.keys(own.apps)).toEqual(["alpha"])
    expect((await srv.send({ path: "/plugboard/usage?app=alpha", headers: bearer(KEYS.alpha) })).status).toBe(200)

    const forbidden = await srv.send({ path: "/plugboard/usage?app=beta", headers: bearer(KEYS.alpha) })
    expect(forbidden.status).toBe(403)
    expect(forbidden.json().code).toBe("app_forbidden")
  })

  test("the admin key reads every app, and may narrow to one or name an empty one", async () => {
    const srv = await start({ keys: KEYS, adminKey: ADMIN })
    expect((await srv.send(chat(KEYS.alpha))).status).toBe(200)
    expect((await srv.send(chat(KEYS.beta))).status).toBe(200)
    await counted("beta", 1)

    const all = (await srv.send({ path: "/plugboard/usage", headers: bearer(ADMIN) })).json()
    expect(Object.keys(all.apps).sort()).toEqual(["alpha", "beta"])
    expect(all.totals.requests).toBe(2)

    const one = (await srv.send({ path: "/plugboard/usage?app=beta", headers: bearer(ADMIN) })).json()
    expect(Object.keys(one.apps)).toEqual(["beta"])

    const empty = (await srv.send({ path: "/plugboard/usage?app=nobody", headers: bearer(ADMIN) })).json()
    expect(empty.apps.nobody.totals.requests).toBe(0)
  })

  test("without a valid key it is a 401; the admin key is not an app key on a model route", async () => {
    const srv = await start({ keys: KEYS, adminKey: ADMIN })
    expect((await srv.send({ path: "/plugboard/usage" })).status).toBe(401)
    expect((await srv.send({ path: "/plugboard/usage", headers: bearer("wrong") })).status).toBe(401)
    expect((await srv.send(chat(ADMIN))).status).toBe(401)
  })

  test("a bad date or app name is a 400 that names the parameter", async () => {
    const srv = await start({ keys: KEYS, adminKey: ADMIN })
    const bad = await srv.send({ path: "/plugboard/usage?from=2026-02-30", headers: bearer(ADMIN) })
    expect(bad.status).toBe(400)
    expect(bad.json()).toMatchObject({ code: "invalid_date", param: "from" })
    expect((await srv.send({ path: "/plugboard/usage?to=tomorrow", headers: bearer(ADMIN) })).status).toBe(400)
    expect((await srv.send({ path: "/plugboard/usage?from=2026-10-12&to=2026-10-11", headers: bearer(ADMIN) })).json().code).toBe("invalid_range")
    expect((await srv.send({ path: "/plugboard/usage?app=Not_An_App", headers: bearer(ADMIN) })).status).toBe(400)
  })

  test("a rejected model request is counted as a client error and the usage GET does not count itself", async () => {
    const srv = await start({ keys: KEYS, adminKey: ADMIN })
    expect((await srv.send(chat(KEYS.alpha, { model: "" }))).status).toBe(400)
    await until(async () => ((await recorder!.query({ app: "alpha" })) as { totals: { errors: { client: number } } }).totals.errors.client === 1, 1_000, "a client error")
    await srv.send({ path: "/plugboard/usage", headers: bearer(KEYS.alpha) })
    const after = (await srv.send({ path: "/plugboard/usage", headers: bearer(KEYS.alpha) })).json()
    expect(after.apps.alpha.totals.requests).toBe(1)
  })

  test("the discovery document lists GET /plugboard/usage unless the option is off", async () => {
    const paths = async (srv: RouteServer) => ((await srv.send({ path: "/v1" })).json().endpoints as Array<{ path: string }>).map((endpoint) => endpoint.path)
    expect(await paths(await start())).toContain("/plugboard/usage")
    await server!.close()
    expect(await paths(await start({ usage: { enabled: false } }, false))).not.toContain("/plugboard/usage")
  })

  test("without a usage recorder the route is an unknown path, once the caller is authenticated", async () => {
    const srv = await start({ keys: KEYS }, false)
    expect((await srv.send({ path: "/plugboard/usage", headers: bearer(KEYS.alpha) })).status).toBe(404)
    expect((await srv.send({ path: "/plugboard/usage" })).status).toBe(401)
  })
})
