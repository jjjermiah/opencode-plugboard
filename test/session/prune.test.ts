/**
 * History pruning (src/session/prune.ts): the index keys and the bounded sweep over a fake host
 * storage. #85: nothing is indexed without limits (tested in test/runtime/generations.test.ts).
 */
import { describe, expect, test } from "bun:test"
import { indexKey, limitsFor, recordSession, sweepHistory, type SweepInput } from "../../src/session/prune.js"
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

/** #265 `apps.<name>.history`: an app's own limits replace the global ones field by field; the other apps keep theirs. */
describe("#265 per-app history limits", () => {
  test("limitsFor: an own field replaces the global one, an unset field falls back, and no limit anywhere is {}", () => {
    const global = { maxSessions: 500, maxAgeDays: 30 }
    expect(limitsFor(global, { chat: { maxSessions: 20 } }, "chat")).toEqual({ maxSessions: 20, maxAgeDays: 30 })
    expect(limitsFor(global, { chat: { maxAgeDays: 7 } }, "chat")).toEqual({ maxSessions: 500, maxAgeDays: 7 })
    expect(limitsFor(global, {}, "other")).toEqual(global)
    expect(limitsFor({}, { chat: { maxSessions: 5 } }, "chat")).toEqual({ maxSessions: 5 })
    expect(limitsFor({}, undefined, "chat")).toEqual({})
    // An app name that is only an inherited property never matches.
    expect(limitsFor({}, {}, "constructor")).toEqual({})
  })

  test("the sweep prunes each app by its own limit: a short one loses more, a long one keeps its sessions", async () => {
    const port = await history({ bot: 5, coding: 5 })
    const result = await sweep(port, { limits: { maxSessions: 4 }, apps: { bot: { maxSessions: 1 }, coding: { maxSessions: 4 } } })
    // bot keeps 1 (its own cap); coding is capped by the global 4 and loses only its oldest.
    expect(result).toMatchObject({ removed: 5 })
    expect(port.removed).toEqual(["bot-0", "bot-1", "bot-2", "bot-3", "coding-0"])
    expect([...port.entries.values()].sort()).toEqual(["bot-4", "coding-1", "coding-2", "coding-3", "coding-4"])
  })

  test("an app with a limit and no global limit is pruned; an app with none is kept forever", async () => {
    const port = await history({ bot: 4, notes: 4 })
    expect(await sweep(port, { limits: {}, apps: { bot: { maxSessions: 2 } } })).toMatchObject({ removed: 2 })
    expect(port.removed).toEqual(["bot-0", "bot-1"])
    expect([...port.entries.values()].sort()).toEqual(["bot-2", "bot-3", "notes-0", "notes-1", "notes-2", "notes-3"])
  })

  test("the stricter field wins inside an app, as it does globally", async () => {
    const port = await history({ bot: 6 })
    // The sessions are 1 to 6 days old. The app's own age (2 days) is the stricter limit, so the four older than 2 days go, although the global count of 10 would keep them all.
    expect((await sweep(port, { limits: { maxSessions: 10 }, apps: { bot: { maxAgeDays: 2 } } })).removed).toBe(4)
  })
})
