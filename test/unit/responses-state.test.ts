/**
 * The durable store of stored Responses (src/responses/state.ts): keys, isolation between apps, retention, the size
 * bounds, the sweep, and a restart. The HTTP behaviour is in test/http/responses-stored.test.ts.
 */
import { describe, expect, test } from "bun:test"
import { createResponseState, createResponseStore, retentionDaysFor } from "../../src/responses/state.js"
import { testOptions } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { FakeStorage, clock } from "../support/usage.js"

const logs = captureLogs()
const DAY = 86_400_000
const MINUTE = 60_000

const newResponseId = () => `resp_${crypto.randomUUID().replaceAll("-", "")}`
const answer = (id = newResponseId(), text = "hi") => ({ id, object: "response", output: [{ id: "msg_1", type: "message", role: "assistant", content: [{ type: "output_text", text }] }] })
const user = (text: string) => ({ type: "message", role: "user", content: [{ type: "input_text", text }] })
const recordKeys = (storage: FakeStorage, app: string) => [...storage.values.keys()].filter((key) => key.startsWith(`responses/${app}/id/`))
const indexKeys = (storage: FakeStorage, app: string) => [...storage.values.keys()].filter((key) => key.startsWith(`responses/${app}/at/`))

function fixture(limits: Parameters<typeof createResponseStore>[0]["limits"] = {}) {
  const storage = new FakeStorage()
  const time = clock("2026-10-17T00:00:00Z")
  const state = createResponseState()
  const store = createResponseStore({ storage, state, now: () => time.at, limits })
  return { storage, time, state, store }
}

describe("save and load", () => {
  test("a response comes back with its input (each item with an id) and the response object", async () => {
    const { store } = fixture()
    const response = answer()
    await store.save("alpha", 30, [user("one"), { ...user("two"), id: "msg_given" }], response)
    const loaded = await store.load("alpha", response.id, 30)
    expect(loaded?.response).toEqual(response)
    expect(loaded?.input.map((item) => item.id)).toEqual([expect.stringMatching(/^msg_[0-9a-f]{32}$/), "msg_given"])
    expect(loaded?.input[0]).toMatchObject({ type: "message", role: "user" })
  })

  test("I32 the app is part of every key: another app, and a prefix of the app's name, read nothing", async () => {
    const { store, storage } = fixture()
    const response = answer()
    await store.save("app-two", 30, [user("secret")], response)
    for (const other of ["app", "app-tw", "app-two-x", "beta"]) expect(await store.load(other, response.id, 30)).toBeUndefined()
    expect(await store.remove("app", response.id)).toBe(false)
    expect(recordKeys(storage, "app-two")).toHaveLength(1)
    expect(await store.load("app-two", response.id, 30)).toBeDefined()
  })

  test("an id that is not a response id is a miss with no storage read", async () => {
    const reads: string[] = []
    const storage = new (class extends FakeStorage {
      override async get(key: string) {
        reads.push(key)
        return super.get(key)
      }
    })()
    const store = createResponseStore({ storage, state: createResponseState() })
    for (const id of ["", "resp_short", "../x", "resp_" + "G".repeat(32), `resp_${"a".repeat(32)}/x`]) {
      expect(await store.load("alpha", id, 30)).toBeUndefined()
      expect(await store.remove("alpha", id)).toBe(false)
    }
    expect(reads).toEqual([])
  })

  test("remove deletes the record and its index entry, once", async () => {
    const { store, storage } = fixture()
    const response = answer()
    await store.save("alpha", 30, [user("one")], response)
    expect(indexKeys(storage, "alpha")).toHaveLength(1)
    expect(await store.remove("alpha", response.id)).toBe(true)
    expect(await store.remove("alpha", response.id)).toBe(false)
    expect([...storage.values.keys()]).toEqual([])
  })

  test("a record that is not ours to read is a miss, logged without its content", async () => {
    const { store, storage } = fixture()
    const response = answer()
    storage.values.set(`responses/alpha/id/${response.id}`, '{"v":2,"secret":"x"}')
    expect(await store.load("alpha", response.id, 30)).toBeUndefined()
    storage.values.set(`responses/alpha/id/${response.id}`, "not json")
    expect(await store.load("alpha", response.id, 30)).toBeUndefined()
    expect(logs.of("responses.unreadable")).toHaveLength(2)
    expect(logs.lines.map((line) => line.raw).join("\n")).not.toContain("secret")
  })

  test("a storage read that fails is a generic error that names no id", async () => {
    const storage = new (class extends FakeStorage {
      override async get(): Promise<string | undefined> {
        throw new Error("disk gone")
      }
    })()
    const store = createResponseStore({ storage, state: createResponseState() })
    const id = newResponseId()
    await expect(store.load("alpha", id, 30)).rejects.toThrow("response storage unavailable")
    await expect(store.remove("alpha", id)).rejects.toThrow("response storage unavailable")
    expect(logs.lines.map((line) => line.raw).join("\n")).not.toContain(id)
  })

  test("a record over the record limit is not kept, and the log carries the reason and the size only", async () => {
    const { store, storage } = fixture({ maxRecordBytes: 500 })
    const response = answer(undefined, "x".repeat(2000))
    await store.save("alpha", 30, [user("one")], response)
    expect(storage.puts).toEqual([])
    expect(logs.of("responses.store_skipped")[0]!.fields).toMatchObject({ reason: "too_large" })
    expect(await store.load("alpha", response.id, 30)).toBeUndefined()
  })

  test("a response without a response id is never written", async () => {
    const { store, storage } = fixture()
    await store.save("alpha", 30, [user("one")], { id: "resp_short", output: [] })
    await store.save("alpha", 30, [user("one")], {})
    expect(storage.puts).toEqual([])
  })
})

describe("retention", () => {
  test("a record older than the retention is a miss on read and is deleted with its index entry", async () => {
    const { store, storage, time } = fixture()
    const response = answer()
    await store.save("alpha", 7, [user("one")], response)
    time.at += 6 * DAY
    expect(await store.load("alpha", response.id, 7)).toBeDefined()
    time.at += 2 * DAY
    expect(await store.load("alpha", response.id, 7)).toBeUndefined()
    expect([...storage.values.keys()]).toEqual([])
  })

  test("the retention of the read decides: a record kept 7 days is still there for a reader that keeps 30", async () => {
    const { store, time } = fixture()
    const response = answer()
    await store.save("alpha", 7, [user("one")], response)
    time.at += 10 * DAY
    expect(await store.load("alpha", response.id, 30)).toBeDefined()
  })

  test("the sweep deletes expired records of the app that wrote, oldest first, and no other app's", async () => {
    const { store, storage, time } = fixture()
    const old = answer()
    const other = answer()
    await store.save("alpha", 7, [user("one")], old)
    await store.save("beta", 7, [user("one")], other)
    time.at += 3 * DAY
    const recent = answer()
    await store.save("alpha", 7, [user("two")], recent)
    // Eight days after the first two, and past the sweep interval: the next write from alpha sweeps alpha.
    time.at += 5 * DAY
    const latest = answer()
    await store.save("alpha", 7, [user("three")], latest)
    await store.idle()
    expect(
      recordKeys(storage, "alpha")
        .map((key) => key.split("/").at(-1))
        .sort(),
    ).toEqual([recent.id, latest.id].sort())
    expect(indexKeys(storage, "alpha")).toHaveLength(2)
    // beta never wrote again, so nothing swept it: its record is expired for a reader, and left for its own next sweep.
    expect(recordKeys(storage, "beta")).toHaveLength(1)
    expect(logs.of("responses.swept")[0]!.fields).toMatchObject({ removed: "1", kept: "2" })
  })

  test("the sweep keeps at most maxResponses per app, dropping the oldest", async () => {
    const { store, storage, time } = fixture({ maxResponses: 5 })
    const ids: string[] = []
    for (let i = 0; i < 8; i++) {
      const response = answer()
      ids.push(response.id)
      time.at += 1
      await store.save("alpha", 30, [user(String(i))], response)
    }
    time.at += 11 * MINUTE
    const last = answer()
    ids.push(last.id)
    await store.save("alpha", 30, [user("last")], last)
    await store.idle()
    expect(recordKeys(storage, "alpha")).toHaveLength(5)
    expect(await store.load("alpha", ids[0]!, 30)).toBeUndefined()
    expect(await store.load("alpha", last.id, 30)).toBeDefined()
    expect(indexKeys(storage, "alpha")).toHaveLength(5)
  })

  test("the sweep keeps an app within maxAppBytes", async () => {
    const { store, storage, time } = fixture({ maxAppBytes: 3000 })
    const kept: string[] = []
    for (let i = 0; i < 6; i++) {
      const response = answer(undefined, "x".repeat(900))
      kept.push(response.id)
      time.at += 1
      await store.save("alpha", 30, [user(String(i))], response)
    }
    time.at += 11 * MINUTE
    await store.save("alpha", 30, [user("last")], answer(undefined, "x".repeat(900)))
    await store.idle()
    const left = recordKeys(storage, "alpha").length
    expect(left).toBeGreaterThan(0)
    expect(left).toBeLessThan(7)
    expect(await store.load("alpha", kept[0]!, 30)).toBeUndefined()
  })

  test("a sweep starts after 50 writes without waiting for the interval, and not before", async () => {
    const { store, storage, state } = fixture({ maxResponses: 10 })
    for (let i = 0; i < 50; i++) await store.save("alpha", 30, [user(String(i))], answer())
    await store.idle()
    // The first write started a sweep (nothing had run before), and the 49 after it are only counted.
    expect(state.apps.get("alpha")!.writes).toBe(49)
    expect(recordKeys(storage, "alpha").length).toBe(50)
    await store.save("alpha", 30, [user("fifty")], answer())
    await store.idle()
    expect(recordKeys(storage, "alpha")).toHaveLength(10)
  })

  test("a sweep that fails is logged, never thrown into the request", async () => {
    const storage = new (class extends FakeStorage {
      override async scan(): Promise<{ keys: ReadonlyArray<string> }> {
        throw new Error("scan failed")
      }
    })()
    const store = createResponseStore({ storage, state: createResponseState() })
    await store.save("alpha", 30, [user("one")], answer())
    await store.idle()
    expect(logs.of("responses.sweep_failed")).toHaveLength(1)
  })
})

describe("restart", () => {
  test("a new store and a new state over the same storage read what the first one wrote, and sweep it", async () => {
    const { storage, time } = fixture()
    const before = createResponseStore({ storage, state: createResponseState(), now: () => time.at })
    const response = answer()
    await before.save("alpha", 7, [user("one")], response)
    const after = createResponseStore({ storage, state: createResponseState(), now: () => time.at })
    expect((await after.load("alpha", response.id, 7))?.response).toEqual(response)
    time.at += 8 * DAY
    await after.save("alpha", 7, [user("two")], answer())
    await after.idle()
    expect(recordKeys(storage, "alpha")).toHaveLength(1)
  })
})

describe("retentionDaysFor", () => {
  test("is the app's history.maxAgeDays, else the global one, else 30; 0 is 30, never forever", () => {
    const options = testOptions({ keys: { a: "ka", b: "kb", c: "kc" }, history: { maxAgeDays: 7 }, apps: { b: { history: { maxAgeDays: 90 } } } })
    expect(retentionDaysFor(options, "a")).toBe(7)
    expect(retentionDaysFor(options, "b")).toBe(90)
    expect(retentionDaysFor(testOptions({ keys: { a: "ka" } }), "a")).toBe(30)
    expect(retentionDaysFor(testOptions({ keys: { a: "ka" }, history: { maxAgeDays: 0 } }), "a")).toBe(30)
  })
})
