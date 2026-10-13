/**
 * #311: which key each `/plugboard/` route accepts, over loopback HTTP. The table is the same one
 * docs/configuration.md documents ("Which key opens which route"). Every row is checked with four
 * credentials: none, the app key, the admin key and a wrong key.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createKeyState, createKeyStore } from "../../src/keys.js"
import { createUsageRecorder, createUsageState } from "../../src/usage.js"
import { startRoute, TEST_STATUS, type RouteServer } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { ev } from "../support/fixtures.js"
import { FakeStorage } from "../support/usage.js"

const KEYS = { alpha: "key-alpha-secret" }
const ADMIN = "admin-root-secret"
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
const CREDENTIALS = {
  none: undefined,
  app: bearer(KEYS.alpha),
  admin: bearer(ADMIN),
  wrong: bearer("not-a-key"),
} as const
const READY = { ...TEST_STATUS, generations: 1, servingConfirmed: true, pumpRunning: true, catalogLoaded: true }

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

/** Every optional route on: usage, the dashboard, metrics and the admin key. */
async function start() {
  const usage = createUsageRecorder({ state: createUsageState(), storage: new FakeStorage(), loadCatalog: async () => [], retentionDays: 90 })
  server = await startRoute({
    caller: new FakeModelCaller([ev.finish()]),
    options: { keys: KEYS, adminKey: ADMIN, metrics: true },
    usage,
    keys: createKeyStore({ state: createKeyState(), storage: new FakeStorage() }),
    status: () => READY,
  })
  return server
}

type Credential = keyof typeof CREDENTIALS
/** The status each credential gets: `none`, `app`, `admin`, `wrong`. */
const RULES: ReadonlyArray<readonly [string, Record<Credential, number>, string]> = [
  ["/plugboard/status", { none: 401, app: 200, admin: 200, wrong: 401 }, "app or admin"],
  ["/plugboard/usage", { none: 401, app: 200, admin: 200, wrong: 401 }, "app (its own app) or admin (every app)"],
  ["/plugboard/metrics", { none: 401, app: 403, admin: 200, wrong: 401 }, "admin only, with adminKey set"],
  ["/plugboard/admin/keys", { none: 401, app: 401, admin: 200, wrong: 401 }, "admin only"],
  ["/plugboard/health", { none: 200, app: 200, admin: 200, wrong: 200 }, "none (probe)"],
  ["/plugboard/ready", { none: 200, app: 200, admin: 200, wrong: 200 }, "none (probe)"],
  ["/plugboard/dashboard", { none: 200, app: 200, admin: 200, wrong: 200 }, "none (page; its data needs a key)"],
]

describe("#311 every /plugboard/ route answers the key its rule names", () => {
  for (const [path, expected, rule] of RULES) {
    for (const credential of Object.keys(CREDENTIALS) as Credential[]) {
      test(`#311 ${path} with ${credential} key is ${expected[credential]} (rule: ${rule})`, async () => {
        await start()
        const reply = await server!.send({ path, headers: CREDENTIALS[credential] })
        expect(reply.status).toBe(expected[credential])
      })
    }
  }

  test("#311 /plugboard/status with the admin key answers the operator view, with no app", async () => {
    await start()
    const reply = await server!.send({ path: "/plugboard/status", headers: bearer(ADMIN) })
    expect(reply.status).toBe(200)
    expect(reply.json()).toMatchObject({ ok: true, eventPump: { running: true } })
    expect(reply.json().app).toBeUndefined()
  })

  test("#311 /plugboard/status with an app key still names the app", async () => {
    await start()
    const reply = await server!.send({ path: "/plugboard/status", headers: bearer(KEYS.alpha) })
    expect(reply.json()).toMatchObject({ ok: true, app: "alpha" })
  })

  test("#311 /plugboard/usage with an app key refuses another app (403), and the admin key names any", async () => {
    await start()
    expect((await server!.send({ path: "/plugboard/usage?app=beta", headers: bearer(KEYS.alpha) })).status).toBe(403)
    expect((await server!.send({ path: "/plugboard/usage?app=beta", headers: bearer(ADMIN) })).status).toBe(200)
  })

  test("#311 the admin key is not an app key on the model routes: /v1/models answers it 401", async () => {
    await start()
    expect((await server!.send({ path: "/v1/models", headers: bearer(ADMIN) })).status).toBe(401)
    expect((await server!.send({ path: "/v1/models", headers: bearer(KEYS.alpha) })).status).toBe(200)
  })
})
