/**
 * History pruning (src/session/prune.ts): the index keys and the bounded sweep over a fake host
 * storage. #85: nothing is indexed without limits (tested in test/runtime/generations.test.ts).
 */
import { describe, expect, test } from "bun:test"
import { indexKey, recordSession, sweepHistory, type SweepInput } from "../../src/session/prune.js"
import { createSessionStore } from "../../src/session/state.js"
import { plugRequest } from "../support/fixtures.js"
import { FakeHistoryPort } from "../support/session.js"

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 11)

/** A history with `count` sessions per app, one a day, oldest first (`<app>-0` is the oldest). */
async function history(apps: Record<string, number>) {
  const port = new FakeHistoryPort()
  for (const [app, count] of Object.entries(apps))
    for (let index = 0; index < count; index++) {
      const id = `${app}-${index}`
      port.sessions.add(id)
      await recordSession(port, app, id, NOW - (count - index) * DAY)
    }
  return port
}

const sweep = (port: FakeHistoryPort, input: Partial<SweepInput> = {}) =>
  sweepHistory({ port, limits: {}, sessions: createSessionStore(), now: NOW, signal: new AbortController().signal, ...input })

describe("the history index", () => {
  test("keys sort by app, then creation time, then session id", () => {
    expect(indexKey("app", 1_700_000_000_000, "ses_1")).toBe("history/app/001700000000000/ses_1")
    expect(indexKey("app", -5, "ses_1")).toBe("history/app/000000000000000/ses_1")
  })
})

describe("sweepHistory", () => {
  test("no limits: nothing is removed", async () => {
    const port = await history({ app: 3 })
    expect(await sweep(port)).toEqual({ apps: 1, scanned: 3, removed: 0, missing: 0, failed: 0, active: 0, more: false })
  })

  test("maxSessions keeps the newest per app, each app on its own", async () => {
    const port = await history({ alpha: 5, beta: 2 })
    expect(await sweep(port, { limits: { maxSessions: 2 } })).toMatchObject({ apps: 2, scanned: 7, removed: 3 })
    expect(port.removed).toEqual(["alpha-0", "alpha-1", "alpha-2"])
    expect([...port.entries.values()].sort()).toEqual(["alpha-3", "alpha-4", "beta-0", "beta-1"])
  })

  test("maxAgeDays removes what is older; both set, the stricter wins", async () => {
    const port = await history({ app: 6 })
    expect((await sweep(port, { limits: { maxAgeDays: 3 } })).removed).toBe(3)
    const both = await history({ app: 6 })
    expect((await sweep(both, { limits: { maxAgeDays: 5, maxSessions: 2 } })).removed).toBe(4)
  })

  test("a session whose request guard is still active is skipped and counted", async () => {
    const port = await history({ app: 3 })
    const sessions = createSessionStore()
    sessions.register({ sessionID: "app-0", app: "app", requestID: "r", request: plugRequest(), collector: { push() {} } })
    expect(await sweep(port, { limits: { maxSessions: 1 }, sessions })).toMatchObject({ removed: 1, active: 1 })
    expect(port.removed).toEqual(["app-1"])
  })

  test("a session the host no longer has only loses its index entry", async () => {
    const port = await history({ app: 2 })
    port.sessions.delete("app-0")
    expect(await sweep(port, { limits: { maxSessions: 1 } })).toMatchObject({ removed: 0, missing: 1 })
    expect(port.entries.size).toBe(1)
  })

  test("a failed delete keeps its entry for the next sweep", async () => {
    const port = await history({ app: 2 })
    port.failing.add("app-0")
    expect(await sweep(port, { limits: { maxSessions: 1 } })).toMatchObject({ failed: 1 })
    expect(port.entries.size).toBe(2)
  })

  test("the delete budget leaves the rest for the next sweep", async () => {
    const port = await history({ app: 10 })
    expect(await sweep(port, { limits: { maxSessions: 1 }, maxDeletes: 3 })).toMatchObject({ removed: 3, more: true })
  })

  test("a capped scan undercounts: it deletes fewer than the limit asks, never more", async () => {
    const port = await history({ app: 10 })
    expect(await sweep(port, { limits: { maxSessions: 5 }, maxScan: 6 })).toMatchObject({ scanned: 6, removed: 1, more: true })
  })

  test("an aborted sweep stops between host calls", async () => {
    const port = await history({ a: 2, b: 2 })
    const controller = new AbortController()
    controller.abort()
    expect(await sweep(port, { limits: { maxSessions: 1 }, signal: controller.signal })).toMatchObject({ apps: 0, removed: 0 })
  })

  test("malformed index keys are ignored", async () => {
    const port = await history({ app: 1 })
    await port.put("history/app/not-a-time/x", "x")
    await port.put("history/app/000000000000001/", "y")
    expect((await sweep(port, { limits: { maxSessions: 1 } })).scanned).toBe(1)
  })
})
