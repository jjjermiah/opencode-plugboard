/**
 * #160 `GET /readyz` (src/openai/route.ts, `readiness` in src/discovery.ts): an unauthenticated
 * readiness probe. It answers `{ ready: true }` only when a generation serves, the event pump runs
 * and the catalog has loaded; otherwise 503 with the first missing piece as the reason. A recorded
 * options error (#159) is the reason on its own.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { ev } from "../support/fixtures.js"
import { startRoute, TEST_STATUS, type RouteServer } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

const KEYS = { alpha: "key-alpha-secret" }
const READY = { ...TEST_STATUS, generations: 1, servingConfirmed: true, pumpRunning: true, catalogLoaded: true }

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const start = async (status = READY, options: Record<string, unknown> = {}) => {
  server = await startRoute({ caller: new FakeModelCaller([ev.finish()]), options, status: () => status })
  return server
}

describe("#160 GET /readyz", () => {
  test("#160 /readyz answers ready with no key, and only once every piece is up", async () => {
    await start(READY, { keys: KEYS })
    const reply = await server!.send({ path: "/readyz" })
    expect(reply.status).toBe(200)
    expect(reply.json()).toEqual({ ready: true })
  })

  test("#160 not ready is a 503 with the first missing piece as the reason", async () => {
    const cases: Array<[Partial<typeof READY>, string]> = [
      [{ generations: 0 }, "no plugboard generation is live"],
      [{ servingConfirmed: false }, "no app directory has been used since start"],
      [{ pumpRunning: false }, "the event pump is not running"],
      [{ catalogLoaded: false }, "the model catalog has not loaded yet"],
    ]
    for (const [change, reason] of cases) {
      await start({ ...READY, ...change })
      const reply = await server!.send({ path: "/readyz" })
      expect(reply.status).toBe(503)
      expect(reply.json()).toMatchObject({ ready: false, reason: expect.stringContaining(reason) })
      await server!.close()
      server = undefined
    }

    // A recorded options error is the whole reason, and it is checked before the other pieces (#159).
    const message = "plugboard option `models` must be an array of strings"
    await start({ ...READY, generations: 0, configError: { message, at: 1 } })
    expect((await server!.send({ path: "/readyz" })).json()).toEqual({ ready: false, reason: message })
  })

  test("an unconfirmed app directory says why and what to do, with the docs link", async () => {
    await start({ ...READY, servingConfirmed: false })
    const reply = await server!.send({ path: "/readyz" })
    expect(reply.status).toBe(503)
    expect(reply.json().reason).toBe(
      "waiting for OpenCode to load plugboard: no app directory has been used since start. The first model request to an app, or a warm-up call, makes this ready. See https://jjjermiah.github.io/opencode-plugboard/warm-up#readiness-readyz",
    )
  })

  test("#160 /readyz never asks for a key, not even a wrong one, and never shows one", async () => {
    await start({ ...READY, catalogLoaded: false }, { keys: KEYS })
    for (const headers of [undefined, { authorization: "Bearer wrong-key" }]) {
      const reply = await server!.send({ path: "/readyz", headers })
      expect(reply.status).toBe(503)
      expect(reply.text).not.toContain(KEYS.alpha)
    }
  })
})
