/**
 * The usage tag: what is kept from the `x-plugboard-tag` header or `metadata.tag` (src/tag.ts), and the
 * per-tag counts of the usage recorder (src/usage.ts): requests, errors, tokens and cost per tag, the
 * 100-tag cap per app and day with its `_other` overflow, names an object inherits, and the `tag` query filter.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { setLogLevel } from "../../src/log.js"
import { bodyTag, noteTag, requestTag, sanitizeTag, tagField, validTag } from "../../src/tag.js"
import { createUsageRecorder, createUsageState, TAGS_PER_DAY, type UsageRecorder, type UsageReport } from "../../src/usage.js"
import { until } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { FakeStorage } from "../support/usage.js"

const logs = captureLogs()
const NOW = Date.parse("2026-10-12T10:00:00Z")
const ROUTE = "POST /v1/chat/completions"

function recorder(storage = new FakeStorage()): UsageRecorder {
  return createUsageRecorder({ state: createUsageState(), storage, loadCatalog: async () => [], retentionDays: 90, now: () => NOW })
}

/** The app's report once `count` requests are recorded (the recorder writes asynchronously). */
async function report(rec: UsageRecorder, count: number, tag?: string): Promise<UsageReport> {
  let last: UsageReport | undefined
  await until(async () => (last = (await rec.query({ app: "app", ...(tag === undefined ? {} : { tag }) })) as UsageReport).totals.requests >= count, 1_000, `${count} requests`)
  return last!
}

describe("usage tag: what is kept", () => {
  test.each([
    ["cron", "cron"],
    ["  chat  ", "chat"],
    ["a.b_c:d-e", "a.b_c:d-e"],
    ["x".repeat(64), "x".repeat(64)],
    ["x".repeat(65), undefined],
    ["a b", undefined],
    ["a/b", undefined],
    ["a@b", undefined],
    ["../etc", undefined],
    ["a,b", undefined],
    ["\u00e9", undefined],
    ["", undefined],
    ["__proto__", undefined],
    [" constructor ", undefined],
    ["prototype", undefined],
    ["_other", undefined],
    [7, undefined],
    [null, undefined],
  ])("%j is kept as %j", (raw, kept) => {
    expect(sanitizeTag(raw)).toBe(kept)
  })

  test("the filter check takes the reserved names by charset and length, so a stored name stays queryable", () => {
    for (const name of ["__proto__", "constructor", "prototype", "_other"]) expect(validTag(name)).toBe(name)
    expect(validTag("a b")).toBeUndefined()
  })

  test("tagField spreads only a kept tag, and bodyTag reads metadata.tag", () => {
    expect(tagField("cron")).toEqual({ tag: "cron" })
    expect(tagField(undefined)).toEqual({})
    expect(bodyTag({ metadata: { tag: "cron" } })).toBe("cron")
    expect(bodyTag({ metadata: "cron" })).toBeUndefined()
    expect(bodyTag(null)).toBeUndefined()
  })
})

describe("usage tag: where it comes from", () => {
  afterEach(() => setLogLevel("info"))

  test("the header wins over the body, and a blank header leaves the body's tag", () => {
    expect(requestTag({ "x-plugboard-tag": "cron" }, "chat")).toBe("cron")
    expect(requestTag({}, "chat")).toBe("chat")
    expect(requestTag({ "x-plugboard-tag": "  " }, "chat")).toBe("chat")
    expect(requestTag({})).toBeUndefined()
    expect(requestTag({ "x-plugboard-tag": ["first", "second"] })).toBe("first")
  })

  test("a refused header is ignored, not replaced by the body's tag, and the debug line never carries the value", () => {
    setLogLevel("debug")
    expect(requestTag({ "x-plugboard-tag": "bad tag value" }, "chat")).toBeUndefined()
    expect(requestTag({}, "bad/body")).toBeUndefined()
    expect(requestTag({ "x-plugboard-tag": "cron, chat" })).toBeUndefined()
    const lines = logs.of("request.tag_ignored")
    expect(lines.map((line) => line.fields.source)).toEqual(["header", "body", "header"])
    expect(logs.lines.map((line) => line.raw).join("\n")).not.toMatch(/bad tag|bad\/body|cron, chat/)
  })

  test("an absent or blank tag logs nothing, and an invalid one logs nothing below debug", () => {
    setLogLevel("debug")
    requestTag({})
    requestTag({ "x-plugboard-tag": " " })
    expect(logs.of("request.tag_ignored")).toEqual([])
    setLogLevel("info")
    requestTag({ "x-plugboard-tag": "a b" })
    expect(logs.of("request.tag_ignored")).toEqual([])
  })

  test("noteTag sets the request info only for a kept tag", () => {
    const info: { tag?: string } = {}
    noteTag(info, { "x-plugboard-tag": "a b" })
    expect(info.tag).toBeUndefined()
    noteTag(info, {}, " cron ")
    expect(info.tag).toBe("cron")
  })
})

describe("usage tag: names an object inherits", () => {
  // A name like `__proto__` once wrote the user counters onto Object.prototype of the whole process. Undo any such write here.
  afterEach(() => {
    for (const key of ["requests", "tokens", "costUsd", "errors"]) delete (Object.prototype as Record<string, unknown>)[key]
  })

  test.each(["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"])("%j counts as an ordinary tag and leaves Object.prototype alone", async (name) => {
    const rec = recorder()
    rec.request({ app: "app", route: ROUTE, status: 200, outcome: "ok", ms: 1, tag: name })
    rec.call({ app: "app", answered: true, tag: name, usage: { inputTokens: 3, outputTokens: 2 } })
    await until(async () => ((await rec.query({ app: "app" })) as UsageReport).apps.app?.tags?.[name]?.tokens === 5, 1_000, `${name} tokens`)
    const tags = ((await rec.query({ app: "app" })) as UsageReport).apps.app!.tags!
    expect(Object.keys(tags)).toEqual([name])
    expect(tags[name]).toEqual({ requests: 1, tokens: 5, costUsd: 0, errors: 0 })
    for (const key of ["requests", "tokens", "costUsd", "errors"]) expect(({} as Record<string, unknown>)[key]).toBeUndefined()
  })

  test("a stored day that names inherited keys loads them as ordinary tags, and Object.prototype stays clean", async () => {
    const storage = new FakeStorage()
    storage.values.set("usage/app/2026-10-12", '{"requests":2,"tags":{"__proto__":{"requests":2,"tokens":7,"costUsd":0,"errors":1},"constructor":{"requests":0,"tokens":0,"costUsd":0}}}')
    const app = ((await recorder(storage).query({ app: "app" })) as UsageReport).apps.app!
    const tags = app.tags!
    expect(Object.keys(tags).sort()).toEqual(["__proto__", "constructor"])
    // biome-ignore lint/complexity/useLiteralKeys: the test reads the own key named __proto__ on purpose
    // biome-ignore lint/suspicious/noProto: same: the key is data here, not the prototype accessor
    expect(tags["__proto__"]).toEqual({ requests: 2, tokens: 7, costUsd: 0, errors: 1 })
    // biome-ignore lint/complexity/useLiteralKeys: the test reads the own key named constructor on purpose
    expect(tags["constructor"]).toEqual({ requests: 0, tokens: 0, costUsd: 0, errors: 0 })
    expect(({} as Record<string, unknown>).requests).toBeUndefined()
  })
})

describe("usage tag: per-tag usage", () => {
  test("requests, errors, tokens and cost are counted per tag, and the tags sum over the range", async () => {
    const rec = recorder()
    rec.request({ app: "app", route: ROUTE, status: 200, outcome: "ok", ms: 5, tag: "cron" })
    rec.request({ app: "app", route: ROUTE, status: 200, outcome: "ok", ms: 5, tag: "cron" })
    rec.request({ app: "app", route: ROUTE, status: 502, outcome: "failed", ms: 5, tag: "cron" })
    rec.request({ app: "app", route: ROUTE, status: 400, outcome: "rejected", ms: 5, tag: "chat" })
    rec.request({ app: "app", route: ROUTE, status: 200, outcome: "ok", ms: 5 })
    rec.call({ app: "app", answered: true, tag: "cron", usage: { inputTokens: 10, outputTokens: 5 } })
    rec.call({ app: "app", answered: true, tag: "chat", usage: { inputTokens: 1, outputTokens: 1 } })
    await report(rec, 5)
    await until(async () => ((await rec.query({ app: "app" })) as UsageReport).apps.app!.tags!.cron?.tokens === 15, 1_000, "cron tokens")
    const app = ((await rec.query({ app: "app" })) as UsageReport).apps.app!
    expect(app.tags!.cron).toEqual({ requests: 3, tokens: 15, costUsd: 0, errors: 1 })
    expect(app.tags!.chat).toEqual({ requests: 1, tokens: 2, costUsd: 0, errors: 1 })
    expect(Object.keys(app.tags!)).toHaveLength(2)
    // The untagged request is in the totals and in no tag.
    expect(app.totals.requests).toBe(5)
  })

  test("a call that spent tokens without an answer still counts them under its tag", async () => {
    const rec = recorder()
    rec.call({ app: "app", answered: false, tag: "cron", usage: { inputTokens: 4, outputTokens: 1 } })
    await until(async () => ((await rec.query({ app: "app" })) as UsageReport).apps.app?.tags?.cron?.tokens === 5, 1_000, "cron tokens")
  })

  test("the tags of two days add up", async () => {
    const storage = new FakeStorage()
    storage.values.set("usage/app/2026-10-11", '{"requests":1,"tags":{"cron":{"requests":1,"tokens":4,"costUsd":0.5,"errors":1}}}')
    storage.values.set("usage/app/2026-10-12", '{"requests":1,"tags":{"cron":{"requests":2,"tokens":6,"costUsd":0.25,"errors":0},"chat":{"requests":1,"tokens":1,"costUsd":0,"errors":0}}}')
    const app = ((await recorder(storage).query({ app: "app", from: "2026-10-11", to: "2026-10-12" })) as UsageReport).apps.app!
    expect(app.tags).toEqual({ cron: { requests: 3, tokens: 10, costUsd: 0.75, errors: 1 }, chat: { requests: 1, tokens: 1, costUsd: 0, errors: 0 } })
  })

  test("a day stored before tags existed reads with none", async () => {
    const storage = new FakeStorage()
    storage.values.set("usage/app/2026-10-12", '{"requests":3}')
    const app = ((await recorder(storage).query({ app: "app" })) as UsageReport).apps.app!
    expect(app.tags).toEqual({})
    expect(app.totals.requests).toBe(3)
  })

  test("past 100 distinct tags a day, the next ones count under _other", async () => {
    const rec = recorder()
    const total = TAGS_PER_DAY + 2
    for (let index = 0; index < total; index++) rec.request({ app: "app", route: ROUTE, status: 200, outcome: "ok", ms: 1, tag: `t${index}` })
    const tags = (await report(rec, total)).apps.app!.tags!
    expect(TAGS_PER_DAY).toBe(100)
    expect(Object.keys(tags)).toHaveLength(TAGS_PER_DAY + 1)
    expect(tags.t99!.requests).toBe(1)
    expect(tags.t100).toBeUndefined()
    expect(tags._other).toEqual({ requests: 2, tokens: 0, costUsd: 0, errors: 0 })
  })

  test("a tag already kept keeps counting after the cap, and an overflow call's tokens go to _other", async () => {
    const rec = recorder()
    for (let index = 0; index < TAGS_PER_DAY; index++) rec.request({ app: "app", route: ROUTE, status: 200, outcome: "ok", ms: 1, tag: `t${index}` })
    rec.request({ app: "app", route: ROUTE, status: 200, outcome: "ok", ms: 1, tag: "late" })
    rec.request({ app: "app", route: ROUTE, status: 200, outcome: "ok", ms: 1, tag: "t0" })
    await report(rec, TAGS_PER_DAY + 2)
    rec.call({ app: "app", answered: true, tag: "late", usage: { inputTokens: 3, outputTokens: 2 } })
    await until(async () => ((await rec.query({ app: "app" })) as UsageReport).apps.app!.tags!._other?.tokens === 5, 1_000, "_other tokens")
    const tags = ((await rec.query({ app: "app" })) as UsageReport).apps.app!.tags!
    expect(tags.t0!.requests).toBe(2)
    expect(tags.late).toBeUndefined()
    expect(tags._other).toEqual({ requests: 1, tokens: 5, costUsd: 0, errors: 0 })
  })

  test("the cap is per app and per day", async () => {
    const rec = recorder()
    for (let index = 0; index < TAGS_PER_DAY; index++) rec.request({ app: "app", route: ROUTE, status: 200, outcome: "ok", ms: 1, tag: `t${index}` })
    rec.request({ app: "other", route: ROUTE, status: 200, outcome: "ok", ms: 1, tag: "fresh" })
    await until(async () => ((await rec.query({ app: "other" })) as UsageReport).apps.other?.totals.requests === 1, 1_000, "other app")
    expect(Object.keys(((await rec.query({ app: "other" })) as UsageReport).apps.other!.tags!)).toEqual(["fresh"])
  })

  test("a tag filter keeps only that tag in tags, and a value that is not a tag is a 400", async () => {
    const rec = recorder()
    rec.request({ app: "app", route: ROUTE, status: 200, outcome: "ok", ms: 1, tag: "cron" })
    rec.request({ app: "app", route: ROUTE, status: 200, outcome: "ok", ms: 1, tag: "chat" })
    const filtered = await report(rec, 2, "cron")
    expect(Object.keys(filtered.apps.app!.tags!)).toEqual(["cron"])
    expect(filtered.apps.app!.totals.requests).toBe(2)
    expect(Object.keys(((await rec.query({ app: "app", tag: "unknown" })) as UsageReport).apps.app!.tags!)).toEqual([])
    expect(await rec.query({ tag: "a b" })).toMatchObject({ status: 400, code: "invalid_tag", param: "tag" })
    expect(await rec.query({ tag: "" })).toMatchObject({ status: 400, code: "invalid_tag", param: "tag" })
  })

  test("the tag filter queries a name a stored record can hold: _other and the reserved names pass by charset and length", async () => {
    const rec = recorder()
    for (const tag of ["prototype", "_other", "constructor", "__proto__"]) rec.request({ app: "app", route: ROUTE, status: 200, outcome: "ok", ms: 1, tag })
    await report(rec, 4)
    for (const tag of ["prototype", "_other", "constructor", "__proto__"]) {
      const filtered = (await rec.query({ app: "app", tag })) as UsageReport
      expect(Object.keys(filtered.apps.app!.tags!)).toEqual([tag])
      expect(filtered.apps.app!.tags![tag]).toEqual({ requests: 1, tokens: 0, costUsd: 0, errors: 0 })
    }
  })

  test("a request that names both a user and a tag counts under each", async () => {
    const rec = recorder()
    rec.request({ app: "app", route: ROUTE, status: 200, outcome: "ok", ms: 1, user: "alice", tag: "cron" })
    const app = (await report(rec, 1)).apps.app!
    expect(app.users).toEqual({ alice: { requests: 1, tokens: 0, costUsd: 0 } })
    expect(app.tags).toEqual({ cron: { requests: 1, tokens: 0, costUsd: 0, errors: 0 } })
  })
})
