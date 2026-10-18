/**
 * The end user (#57): what is kept from the caller's `user` / `metadata.user_id` (src/user.ts), and
 * the per-user counts of the usage recorder (src/usage.ts): requests, tokens and cost per user, the
 * 200-user cap per app and day, and the `user` query filter.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { endUserDropped, noteEndUser, sanitizeEndUser, userField } from "../../src/user.js"
import { createUsageRecorder, createUsageState, USERS_PER_DAY, type UsageRecorder, type UsageReport } from "../../src/usage.js"
import { until } from "../support/fixtures.js"
import { FakeStorage } from "../support/usage.js"

const NOW = Date.parse("2026-10-12T10:00:00Z")

function recorder(): UsageRecorder {
  return createUsageRecorder({ state: createUsageState(), storage: new FakeStorage(), loadCatalog: async () => [], retentionDays: 90, now: () => NOW })
}

/** The app's report once `count` requests are recorded (the recorder writes asynchronously). */
async function report(rec: UsageRecorder, count: number, user?: string): Promise<UsageReport> {
  let last: UsageReport | undefined
  await until(async () => ((last = (await rec.query({ app: "app", ...(user === undefined ? {} : { user }) })) as UsageReport).totals.requests >= count), 1_000, `${count} requests`)
  return last!
}

describe("#57 end user: what is kept", () => {
  test.each([
    ["alice", "alice"],
    ["  bob  ", "bob"],
    ["a.b_c@d:e-f", "a.b_c@d:e-f"],
    ["x".repeat(64), "x".repeat(64)],
    ["x".repeat(65), undefined],
    ["a b", undefined],
    ["a/b", undefined],
    ["../etc", undefined],
    ["a;b", undefined],
    ["\u00e9", undefined],
    ["", undefined],
    ["__proto__", undefined],
    [" constructor ", undefined],
    ["prototype", undefined],
    ["_other", undefined],
    [7, undefined],
    [null, undefined],
  ])("#57 %j is kept as %j", (raw, kept) => {
    expect(sanitizeEndUser(raw)).toBe(kept)
  })

  test("#57 a value that is not kept is reported as dropped; absent and blank values are not", () => {
    expect(endUserDropped("a b")).toBe(true)
    expect(endUserDropped("__proto__")).toBe(true)
    expect(endUserDropped(7)).toBe(true)
    expect(endUserDropped(undefined)).toBe(false)
    expect(endUserDropped(null)).toBe(false)
    expect(endUserDropped("   ")).toBe(false)
  })

  test("#57 userField spreads only a kept user into a request, and noteEndUser sets the header and the log field", () => {
    expect(userField("alice")).toEqual({ user: "alice" })
    expect(userField("a b")).toEqual({})
    const headers: Record<string, string> = {}
    const response = { setHeader: (name: string, value: string) => void (headers[name] = value) }
    const info: { user?: string } = {}
    noteEndUser(response, info, "a b")
    expect(headers).toEqual({ "x-plugboard-user-dropped": "1" })
    expect(info.user).toBeUndefined()
    noteEndUser(response, info, " alice ")
    expect(info.user).toBe("alice")
    expect(headers).toEqual({ "x-plugboard-user-dropped": "1" })
  })
})

describe("#57 end user: names an object inherits", () => {
  // A value like `__proto__` once wrote the counters onto Object.prototype of the whole process. Undo any such write here.
  afterEach(() => {
    for (const key of ["requests", "tokens", "costUsd"]) delete (Object.prototype as Record<string, unknown>)[key]
  })

  test.each(["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"])("#57 %j counts as an ordinary user and leaves Object.prototype alone", async (name) => {
    const rec = recorder()
    rec.request({ app: "app", route: "POST /v1/chat/completions", status: 200, outcome: "ok", ms: 1, user: name })
    rec.call({ app: "app", answered: true, user: name, usage: { inputTokens: 3, outputTokens: 2 } })
    await until(async () => ((await rec.query({ app: "app" })) as UsageReport).apps.app?.users?.[name]?.tokens === 5, 1_000, `${name} tokens`)
    const users = ((await rec.query({ app: "app" })) as UsageReport).apps.app!.users!
    expect(Object.keys(users)).toEqual([name])
    expect(users[name]).toEqual({ requests: 1, tokens: 5, costUsd: 0 })
    expect(({} as Record<string, unknown>).requests).toBeUndefined()
    expect(({} as Record<string, unknown>).tokens).toBeUndefined()
    expect(({} as Record<string, unknown>).costUsd).toBeUndefined()
  })

  test("#57 a stored day that names inherited keys loads them as ordinary users, and Object.prototype stays clean", async () => {
    const storage = new FakeStorage()
    storage.values.set(
      "usage/app/2026-10-12",
      '{"requests":2,"users":{"__proto__":{"requests":2,"tokens":7,"costUsd":0},"constructor":{"requests":0,"tokens":0,"costUsd":0}},"perModel":{"__proto__":{"requests":1,"tokens":7,"costUsd":0}}}',
    )
    const rec = createUsageRecorder({ state: createUsageState(), storage, loadCatalog: async () => [], retentionDays: 90, now: () => NOW })
    const app = (await rec.query({ app: "app" })) as UsageReport
    const users = app.apps.app!.users!
    expect(Object.keys(users).sort()).toEqual(["__proto__", "constructor"])
    // biome-ignore lint/complexity/useLiteralKeys: the test reads the own key named __proto__ on purpose
    // biome-ignore lint/suspicious/noProto: same: the key is data here, not the prototype accessor
    expect(users["__proto__"]).toEqual({ requests: 2, tokens: 7, costUsd: 0 })
    expect(app.apps.app!.totals.requests).toBe(2)
    expect(({} as Record<string, unknown>).requests).toBeUndefined()
  })
})

describe("#57 end user: per-user usage", () => {
  test("#57 requests, tokens and cost are counted per user, and the users sum over the range", async () => {
    const rec = recorder()
    rec.request({ app: "app", route: "POST /v1/chat/completions", status: 200, outcome: "ok", ms: 5, user: "alice" })
    rec.request({ app: "app", route: "POST /v1/chat/completions", status: 200, outcome: "ok", ms: 5, user: "alice" })
    rec.request({ app: "app", route: "POST /v1/chat/completions", status: 200, outcome: "ok", ms: 5, user: "bob" })
    rec.call({ app: "app", answered: true, user: "alice", usage: { inputTokens: 10, outputTokens: 5 } })
    rec.call({ app: "app", answered: true, user: "bob", usage: { inputTokens: 1, outputTokens: 1 } })
    const app = await report(rec, 3)
    await until(async () => ((await rec.query({ app: "app" })) as UsageReport).apps.app!.users!.alice!.tokens === 15, 1_000, "alice tokens")
    const users = ((await rec.query({ app: "app" })) as UsageReport).apps.app!.users!
    expect(users.alice).toEqual({ requests: 2, tokens: 15, costUsd: 0 })
    expect(users.bob).toEqual({ requests: 1, tokens: 2, costUsd: 0 })
    expect(app.totals.requests).toBe(3)
  })

  test("#57 past 200 distinct users a day, the next ones count under _other", async () => {
    const rec = recorder()
    const total = USERS_PER_DAY + 1
    for (let index = 0; index < total; index++) rec.request({ app: "app", route: "POST /v1/chat/completions", status: 200, outcome: "ok", ms: 1, user: `u${index}` })
    const app = await report(rec, total)
    const users = app.apps.app!.users!
    expect(Object.keys(users)).toHaveLength(USERS_PER_DAY + 1)
    expect(users.u199!.requests).toBe(1)
    expect(users.u200).toBeUndefined()
    expect(users._other).toEqual({ requests: 1, tokens: 0, costUsd: 0 })
  })

  test("#57 a user filter keeps only that user in users, and a value that is not a user is a 400", async () => {
    const rec = recorder()
    rec.request({ app: "app", route: "POST /v1/chat/completions", status: 200, outcome: "ok", ms: 1, user: "alice" })
    rec.request({ app: "app", route: "POST /v1/chat/completions", status: 200, outcome: "ok", ms: 1, user: "bob" })
    const filtered = await report(rec, 2, "alice")
    expect(Object.keys(filtered.apps.app!.users!)).toEqual(["alice"])
    expect(filtered.apps.app!.totals.requests).toBe(2)
    expect(await rec.query({ user: "a b" })).toMatchObject({ status: 400, code: "invalid_user", param: "user" })
  })

  test("#57 the user filter queries a name a stored record can hold: _other and the reserved names pass by charset and length", async () => {
    // A day an older version wrote can hold these as users; the filter must still reach them (the sanitizer refuses them on input).
    const rec = recorder()
    for (const user of ["prototype", "_other", "constructor", "__proto__"]) rec.request({ app: "app", route: "POST /v1/chat/completions", status: 200, outcome: "ok", ms: 1, user })
    await report(rec, 4)
    for (const user of ["prototype", "_other", "constructor", "__proto__"]) {
      const filtered = (await rec.query({ app: "app", user })) as UsageReport
      expect(Object.keys(filtered.apps.app!.users!)).toEqual([user])
      expect(filtered.apps.app!.users![user]).toEqual({ requests: 1, tokens: 0, costUsd: 0 })
    }
    expect(await rec.query({ user: "" })).toMatchObject({ status: 400, code: "invalid_user", param: "user" })
  })
})
