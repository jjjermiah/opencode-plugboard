/**
 * The file store (src/files/state.ts): per-app records on the host storage, the isolation of I33, retention, the per-app
 * bounds and the sweep.
 */
import { describe, expect, test } from "bun:test"
import { isPlugError } from "../../src/contract.js"
import { createFileState, createFileStore, ID_PATTERN } from "../../src/files/state.js"
import { captureLogs } from "../support/logs.js"
import { FakeStorage, clock } from "../support/usage.js"

const logs = captureLogs()
const DAY = 86_400_000
const file = (name: string, text = name) => ({ filename: name, mime: "text/plain", purpose: "user_data", bytes: Buffer.from(text) })

function fixture(limits: Parameters<typeof createFileStore>[0]["limits"] = {}) {
  const storage = new FakeStorage()
  const time = clock("2026-10-17T00:00:00Z")
  const store = createFileStore({ storage, state: createFileState(), now: () => time.at, limits })
  return { storage, time, store }
}

const saved = async (store: ReturnType<typeof createFileStore>, app: string, name = "a.txt", text?: string) => {
  const record = await store.save(app, 30, file(name, text))
  if (isPlugError(record)) throw new Error(record.message)
  return record
}

describe("save and read", () => {
  test("a file is kept under the app with its bytes as base64, and read back whole", async () => {
    const { store, storage } = fixture()
    const record = await saved(store, "alpha", "a.txt", "hello")
    expect(record).toMatchObject({ filename: "a.txt", mime: "text/plain", bytes: 5, purpose: "user_data" })
    expect(record.id).toMatch(ID_PATTERN)
    const read = await store.read("alpha", record.id, 30)
    expect(read!.record).toEqual(record)
    expect(Buffer.from(read!.base64, "base64").toString()).toBe("hello")
    expect([...storage.values.keys()].every((key) => key.startsWith("files/alpha/"))).toBe(true)
    expect(await store.ids("alpha", 30)).toEqual([record.id])
  })

  test("ids come in upload order, even within one millisecond", async () => {
    const { store } = fixture()
    const ids = []
    for (let i = 0; i < 5; i++) ids.push((await saved(store, "alpha", `${i}.txt`)).id)
    expect(await store.ids("alpha", 30)).toEqual(ids)
  })
})

describe("I33 isolation", () => {
  test("another app's id is a miss on read, head, remove and ids; the owner's file survives", async () => {
    const { store } = fixture()
    const mine = await saved(store, "alpha")
    expect(await store.head("beta", mine.id, 30)).toBeUndefined()
    expect(await store.read("beta", mine.id, 30)).toBeUndefined()
    expect(await store.remove("beta", mine.id)).toBe(false)
    expect(await store.ids("beta", 30)).toEqual([])
    expect(await store.head("alpha", mine.id, 30)).toEqual(mine)
  })

  test("a malformed id reads nothing, and builds no key outside the app's prefix", async () => {
    const { store, storage } = fixture()
    await saved(store, "alpha")
    const gets: string[] = []
    const original = storage.get.bind(storage)
    storage.get = async (key) => (gets.push(key), original(key))
    for (const id of ["../../keys/x", "file-", `FILE-${"a".repeat(32)}`, `file-${"g".repeat(32)}`, "", `file-${"a".repeat(33)}`]) {
      expect(await store.head("alpha", id, 30)).toBeUndefined()
      expect(await store.remove("alpha", id)).toBe(false)
    }
    expect(gets).toEqual([])
  })

  test("two apps hold their own files with the same limits each", async () => {
    const { store } = fixture({ maxFiles: 1 })
    await saved(store, "alpha")
    expect(isPlugError(await store.save("alpha", 30, file("b.txt")))).toBe(true)
    expect(isPlugError(await store.save("beta", 30, file("b.txt")))).toBe(false)
  })
})

describe("retention", () => {
  test("a file past the app's retention is a miss, gone from storage, and out of ids", async () => {
    const { store, storage, time } = fixture()
    const record = await saved(store, "alpha")
    time.at += 29 * DAY
    expect(await store.head("alpha", record.id, 30)).toEqual(record)
    time.at += 2 * DAY
    expect(await store.ids("alpha", 30)).toEqual([])
    expect(await store.head("alpha", record.id, 30)).toBeUndefined()
    expect(await store.read("alpha", record.id, 30)).toBeUndefined()
    expect([...storage.values.keys()]).toEqual([])
  })

  test("the retention is the caller's: a file kept 30 days is expired for a shorter one", async () => {
    const { store, time } = fixture()
    const record = await saved(store, "alpha")
    time.at += 3 * DAY
    expect(await store.head("alpha", record.id, 2)).toBeUndefined()
  })

  test("a sweep deletes expired files and keeps the rest, in bounded work", async () => {
    const { store, storage, time } = fixture()
    for (let i = 0; i < 3; i++) await saved(store, "alpha", `old${i}.txt`)
    time.at += 31 * DAY
    const fresh = await saved(store, "alpha", "fresh.txt")
    await store.idle()
    expect([...storage.values.keys()].filter((key) => key.startsWith("files/alpha/id/"))).toEqual([`files/alpha/id/${fresh.id}`])
    expect(logs.of("files.swept")[0]!.fields).toMatchObject({ removed: "3", failed: "0" })
  })
})

describe("bounds", () => {
  test("past the file count or the byte budget an upload is refused with a code, and nothing is evicted", async () => {
    const { store } = fixture({ maxFiles: 2, maxAppBytes: 10 })
    const a = await saved(store, "alpha", "a.txt", "1234")
    await saved(store, "alpha", "b.txt", "5678")
    const count = await store.save("alpha", 30, file("c.txt", "9"))
    expect(count).toMatchObject({ status: 400, code: "file_limit_exceeded" })
    const { store: other } = fixture({ maxFiles: 10, maxAppBytes: 10 })
    await saved(other, "alpha", "a.txt", "123456")
    expect(await other.save("alpha", 30, file("b.txt", "12345"))).toMatchObject({ code: "file_storage_full" })
    expect(await store.head("alpha", a.id, 30)).toEqual(a)
  })

  test("expired files do not count against the bounds", async () => {
    const { store, time } = fixture({ maxFiles: 1 })
    await saved(store, "alpha")
    time.at += 31 * DAY
    expect(isPlugError(await store.save("alpha", 30, file("b.txt")))).toBe(false)
  })
})

describe("storage failures", () => {
  test("a failed write throws, is logged by operation with no id, and leaves no listed file", async () => {
    const { store, storage } = fixture()
    storage.failPuts = true
    await expect(store.save("alpha", 30, file("a.txt"))).rejects.toThrow("file storage unavailable")
    expect(logs.of("files.store_failed")[0]!.fields).toMatchObject({ op: "save" })
    expect(JSON.stringify(logs.of("files.store_failed"))).not.toMatch(/file-[0-9a-f]{32}/)
    expect(await store.ids("alpha", 30)).toEqual([])
  })

  test("a record that cannot be parsed is a miss", async () => {
    const { store, storage } = fixture()
    const record = await saved(store, "alpha")
    storage.values.set(`files/alpha/id/${record.id}`, "{not json")
    expect(await store.head("alpha", record.id, 30)).toBeUndefined()
    storage.values.set(`files/alpha/id/${record.id}`, JSON.stringify({ v: 2 }))
    expect(await store.head("alpha", record.id, 30)).toBeUndefined()
  })

  test("a file whose bytes are gone is a miss on read", async () => {
    const { store, storage } = fixture()
    const record = await saved(store, "alpha")
    storage.values.delete(`files/alpha/data/${record.id}`)
    expect(await store.read("alpha", record.id, 30)).toBeUndefined()
  })

  test("remove deletes the file, its bytes and its index entry", async () => {
    const { store, storage } = fixture()
    const record = await saved(store, "alpha")
    expect(await store.remove("alpha", record.id)).toBe(true)
    expect([...storage.values.keys()]).toEqual([])
    expect(await store.remove("alpha", record.id)).toBe(false)
  })
})
