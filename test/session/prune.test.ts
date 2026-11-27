/**
 * History pruning (src/session/prune.ts): the index keys and the bounded sweep over a fake host
 * storage. #85: nothing is indexed without limits (tested in test/runtime/generations.test.ts).
 */
import { describe, expect, test } from "bun:test"
import { indexKey, limitsFor, recordSession, sweepSessions, type SweepInput } from "../../src/session/prune.js"
import { createSessionStore } from "../../src/session/state.js"
import { plugRequest } from "../support/fixtures.js"
import { FakeChildHistoryPort, FakeHistoryPort } from "../support/session.js"

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
  sweepSessions({ port, limits: {}, sessions: createSessionStore(), now: NOW, signal: new AbortController().signal, position: new Map(), ...input })

describe("the history index", () => {
  test("keys sort by app, then creation time, then session id", () => {
    expect(indexKey("app", 1_700_000_000_000, "ses_1")).toBe("history/app/001700000000000/ses_1")
    expect(indexKey("app", -5, "ses_1")).toBe("history/app/000000000000000/ses_1")
  })
})

describe("sweepSessions", () => {
  test("no limits: nothing is removed", async () => {
    const port = await history({ app: 3 })
    // An app with no limit is not read at all (#319): nothing scanned, so nothing left for a later sweep.
    expect(await sweep(port)).toEqual({ apps: 1, scanned: 0, removed: 0, missing: 0, failed: 0, active: 0, children: 0, more: false })
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

/** #265 `apps.<name>.sessions`: an app's own limits replace the global ones field by field; the other apps keep theirs. */
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

/** Review of #319 (SHOULD 1, 3): an app limit looser than the global one must win, not be clamped to it. */
describe("#265 review: a looser app limit replaces the global one, in both directions", () => {
  test("the sweep keeps more sessions for an app whose own count is higher than the global one", async () => {
    const port = await history({ bot: 5, coding: 5 })
    const result = await sweep(port, { limits: { maxSessions: 2 }, apps: { coding: { maxSessions: 5000 } } })
    expect(result).toMatchObject({ removed: 3 })
    expect(port.removed).toEqual(["bot-0", "bot-1", "bot-2"])
    expect([...port.entries.values()].sort()).toEqual(["bot-3", "bot-4", "coding-0", "coding-1", "coding-2", "coding-3", "coding-4"])
  })

  test("the sweep keeps sessions for an app whose own age is longer than the global one", async () => {
    const port = await history({ bot: 6 })
    expect((await sweep(port, { limits: { maxAgeDays: 3 }, apps: { bot: { maxAgeDays: 10 } } })).removed).toBe(0)
  })

  test("limitsFor: a looser own maxAgeDays replaces the global one", () => {
    expect(limitsFor({ maxAgeDays: 3 }, { chat: { maxAgeDays: 10 } }, "chat")).toEqual({ maxAgeDays: 10 })
  })

  test("an app with no effective limit is not even read: no scan, no 'more', so no re-sweep", async () => {
    const port = await history({ old: 3 })
    expect(await sweep(port, { limits: {}, maxScan: 2 })).toEqual({ apps: 1, scanned: 0, removed: 0, missing: 0, failed: 0, active: 0, children: 0, more: false })
  })
})

/**
 * Review of #200: a removal deletes the session's children with it (`Session.remove` lists them by `parentID` and removes each), and a
 * child of a request session is never plugboard's: the session's permissions run no tool that could start one. So a session with a
 * child is kept, index entry included, and the next sweep asks again.
 */
describe("#200 review: a request session with a child session is kept", () => {
  /** `count` request sessions of `app`, one a day, oldest first (`app-0` is the oldest). */
  async function indexed(port: FakeHistoryPort, count: number): Promise<void> {
    for (let index = 0; index < count; index++) {
      const id = `app-${index}`
      port.sessions.add(id)
      await recordSession(port, "app", id, NOW - (count - index) * DAY)
    }
  }

  test("a session with a child is not removed, keeps its index entry, and the child survives", async () => {
    const port = new FakeChildHistoryPort()
    await indexed(port, 3)
    port.addChild("app-0", "human-1")
    // maxSessions 1 over three sessions: the two oldest are candidates, and the oldest has a child.
    expect(await sweep(port, { limits: { maxSessions: 1 } })).toMatchObject({ scanned: 3, removed: 1, children: 1 })
    expect(port.removed).toEqual(["app-1"])
    expect(port.destroyed.size).toBe(0)
    expect([...port.sessions].sort()).toEqual(["app-0", "app-2", "human-1"])
    // Kept, not dropped: the next sweep asks again, and once the child is gone the parent can be pruned.
    expect(port.entries.size).toBe(2)
  })

  test("a session without children is removed as before", async () => {
    const port = new FakeChildHistoryPort()
    await indexed(port, 2)
    expect(await sweep(port, { limits: { maxSessions: 1 } })).toMatchObject({ removed: 1, children: 0 })
    expect(port.removed).toEqual(["app-0"])
    expect(port.entries.size).toBe(1)
  })

  test("a host without the check (OpenCode 2.0.x) removes as before", async () => {
    const port = new FakeHistoryPort()
    await indexed(port, 2)
    expect("hasChild" in port).toBe(false)
    expect(await sweep(port, { limits: { maxSessions: 1 } })).toMatchObject({ removed: 1, children: 0 })
    expect(port.removed).toEqual(["app-0"])
  })

  test("a child check that fails keeps the session and is counted for the next sweep", async () => {
    const port = new FakeChildHistoryPort()
    await indexed(port, 2)
    port.hasChild = async () => {
      throw new Error("session.list failed")
    }
    expect(await sweep(port, { limits: { maxSessions: 1 } })).toMatchObject({ removed: 0, failed: 1 })
    expect(port.removed).toEqual([])
    expect(port.entries.size).toBe(2)
  })

  test("a kept session uses one removal budget slot, so a sweep stays bounded", async () => {
    const port = new FakeChildHistoryPort()
    await indexed(port, 3)
    for (const id of ["app-0", "app-1"]) port.addChild(id, `${id}-child`)
    expect(await sweep(port, { limits: { maxSessions: 1 }, maxDeletes: 1 })).toMatchObject({ removed: 0, children: 1, more: true })
    expect(port.entries.size).toBe(3)
  })

  test("kept sessions do not starve the removable ones behind them: the next sweep resumes after the last kept one", async () => {
    const port = new FakeChildHistoryPort()
    await indexed(port, 202)
    // The first 200 sessions have a child, the app holds 202, and maxSessions 1 leaves 201 candidates: exactly one sweep of budget of kept
    // entries before the first removable one.
    for (let index = 0; index < 200; index++) port.addChild(`app-${index}`, `human-${index}`)
    const position = new Map<string, string>()
    const runOnce = () => sweep(port, { limits: { maxSessions: 1 }, position })
    const first = await runOnce()
    expect(first).toMatchObject({ children: 200, removed: 0, more: true })
    // The second sweep starts after app-199 and reaches app-200, which has no child.
    const second = await runOnce()
    expect(second.removed).toBe(1)
    expect(port.removed).toEqual(["app-200"])
    expect(port.sessions.has("app-201")).toBe(true)
  })

  test("a kept session is rechecked later and pruned once its child is gone", async () => {
    const port = new FakeChildHistoryPort()
    await indexed(port, 3)
    port.addChild("app-0", "human-1")
    const position = new Map<string, string>()
    const runOnce = () => sweep(port, { limits: { maxSessions: 1 }, position })
    expect(await runOnce()).toMatchObject({ removed: 1, children: 1 })
    expect(port.removed).toEqual(["app-1"])
    // Still kept while the child exists, even though it is now the only candidate and the walk starts over at it.
    expect(await runOnce()).toMatchObject({ removed: 0, children: 1 })
    port.childrenOf.delete("app-0")
    expect(await runOnce()).toMatchObject({ removed: 1, children: 0 })
    expect(port.removed).toEqual(["app-1", "app-0"])
  })

  test("one app's kept sessions cannot spend another app's budget", async () => {
    const port = new FakeChildHistoryPort()
    for (const [app, count] of [
      ["a", 3],
      ["b", 2],
    ] as const)
      for (let index = 0; index < count; index++) {
        port.sessions.add(`${app}-${index}`)
        await recordSession(port, app, `${app}-${index}`, NOW - (count - index) * DAY)
      }
    port.addChild("a-0", "human-1")
    port.addChild("a-1", "human-2")
    // Two apps in index order (a, then b), maxSessions 1, budget 2: app a has two candidates and keeps both, app b's candidate is removed.
    // With one sweep-wide budget of 2, app b would not be read at all.
    expect(await sweep(port, { limits: { maxSessions: 1 }, maxDeletes: 2 })).toMatchObject({ apps: 2, removed: 1, children: 2 })
    expect(port.removed).toEqual(["b-0"])
  })
})
