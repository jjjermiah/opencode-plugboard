/**
 * The runtime app key store (#55, src/keys.ts) and the runtime digests authentication checks
 * (src/config.ts `authenticate`). Storage is the in-memory `FakeStorage`, so a second store on the
 * same storage reads what the first wrote, as a restarted server would.
 */
import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"
import { authenticate, parseOptions } from "../../src/config.js"
import { createKeyState, createKeyStore, keyDigest, keyIdOf, type KeyStore } from "../../src/keys.js"
import type { StoragePort } from "../../src/session/host.js"
import { captureLogs } from "../support/logs.js"
import { testOptions } from "../support/fixtures.js"
import { FakeStorage } from "../support/usage.js"

const logs = captureLogs()

const CONFIG = { alpha: "config-alpha-secret" }
const sha = (text: string) => createHash("sha256").update(text).digest("hex")

function store(storage: StoragePort, now = Date.parse("2026-10-12T10:00:00Z")): KeyStore {
  return createKeyStore({ state: createKeyState(), storage, now: () => now })
}

describe("#55 runtime keys: the key store", () => {
  test("#55 the id is the first 8 hex chars of the SHA-256 of the key", () => {
    const digest = keyDigest("some-key")
    expect(keyIdOf(digest)).toBe(sha("some-key").slice(0, 8))
    expect(keyIdOf(digest)).toMatch(/^[0-9a-f]{8}$/)
  })

  test("#55 a created key is returned once and stored only as its digest", async () => {
    const storage = new FakeStorage()
    const created = await store(storage).create("bot", CONFIG)
    expect(created.app).toBe("bot")
    expect(created.id).toBe(sha(created.key).slice(0, 8))
    // The stored record holds the SHA-256 digest; the key value appears nowhere in storage.
    const stored = [...storage.values.values()].join("\n")
    expect(stored).toContain(sha(created.key))
    expect(stored).not.toContain(created.key)
    expect(storage.puts).toEqual([`keys/${created.id}`])
  })

  test("#55 list shows config and runtime keys with their source and never a key value", async () => {
    const keys = store(new FakeStorage())
    const created = await keys.create("bot", CONFIG)
    const listed = await keys.list(CONFIG)
    expect(listed).toEqual([
      { id: keyIdOf(keyDigest(CONFIG.alpha)), app: "alpha", source: "config" },
      { id: created.id, app: "bot", source: "runtime", createdAt: "2026-10-12T10:00:00.000Z" },
    ])
    expect(JSON.stringify(listed)).not.toContain(created.key)
  })

  test("#55 revoke removes a runtime key, and a config key is refused", async () => {
    const storage = new FakeStorage()
    const keys = store(storage)
    const created = await keys.create("bot", CONFIG)
    expect(await keys.revoke(keyIdOf(keyDigest(CONFIG.alpha)), CONFIG)).toBe("config")
    expect(await keys.revoke(created.id, CONFIG)).toBe("revoked")
    expect(await keys.revoke(created.id, CONFIG)).toBe("not_found")
    expect(storage.drops).toEqual([`keys/${created.id}`])
    expect((await keys.digests()).map(([app]) => app)).toEqual([])
  })

  test("#55 runtime keys survive a restart: a fresh store on the same storage loads them", async () => {
    const storage = new FakeStorage()
    const created = await store(storage).create("bot", CONFIG)
    const restarted = store(storage)
    const digests = await restarted.digests()
    expect(digests).toHaveLength(1)
    expect(digests[0]![0]).toBe("bot")
    expect(digests[0]![1].equals(keyDigest(created.key))).toBe(true)
  })

  test("#55 a stored record that is not a key is logged and skipped, not served", async () => {
    const storage = new FakeStorage()
    storage.values.set("keys/deadbeef", JSON.stringify({ app: "bot", digest: "not-hex", createdAt: "x" }))
    expect(await store(storage).digests()).toEqual([])
    expect(logs.of("keys.unreadable")).toHaveLength(1)
  })

  test("#55 a failed read leaves the cache unloaded, so the next request reads again", async () => {
    const storage = new FakeStorage()
    await store(storage).create("bot", CONFIG)
    let failing = true
    const flaky: StoragePort = {
      get: (key) => storage.get(key),
      put: (key, value) => storage.put(key, value),
      drop: (key) => storage.drop(key),
      scan: (input) => (failing ? Promise.reject(new Error("database locked")) : storage.scan(input)),
    }
    const keys = store(flaky)
    // Fails closed while the read fails: no runtime key is served.
    expect(await keys.digests()).toEqual([])
    expect(logs.of("keys.load_failed")).toHaveLength(1)
    failing = false
    expect(await keys.digests()).toHaveLength(1)
  })

  test("#55 a create that cannot be stored returns no key", async () => {
    const storage = new FakeStorage()
    storage.failPuts = true
    await expect(store(storage).create("bot", CONFIG)).rejects.toThrow("storage unavailable")
    expect(await store(storage).list({})).toEqual([])
  })
})

describe("#55 runtime keys: authentication", () => {
  const keyed = parseOptions({ keys: CONFIG })
  const runtimeKey = "runtime-bot-secret"
  const runtime: ReadonlyArray<readonly [string, Buffer]> = [["bot", keyDigest(runtimeKey)]]

  test("#55 a runtime key authenticates as its app, next to the config keys", () => {
    expect(authenticate(keyed, `Bearer ${runtimeKey}`, runtime)).toEqual({ app: "bot" })
    expect(authenticate(keyed, `Bearer ${CONFIG.alpha}`, runtime)).toEqual({ app: "alpha" })
  })

  test("#55 a wrong token is refused on a keyed server, whatever its length", () => {
    for (const wrong of ["x", `${runtimeKey}-extra`, runtimeKey.slice(1)]) expect(authenticate(keyed, `Bearer ${wrong}`, runtime)).toMatchObject({ status: 401 })
    expect(authenticate(keyed, undefined, runtime)).toMatchObject({ status: 401 })
  })

  test("#55 on a keyless server a runtime key names its app but is not required", () => {
    const keyless = testOptions()
    expect(authenticate(keyless, undefined, runtime)).toEqual({ app: "default" })
    expect(authenticate(keyless, `Bearer ${runtimeKey}`, runtime)).toEqual({ app: "bot" })
    expect(authenticate(keyless, "Bearer nope", runtime)).toEqual({ app: "default" })
  })

  test("#55 a revoked runtime key stops authenticating on the next read of the digests", async () => {
    const storage = new FakeStorage()
    const keys = store(storage)
    const created = await keys.create("bot", CONFIG)
    expect(authenticate(keyed, `Bearer ${created.key}`, await keys.digests())).toEqual({ app: "bot" })
    await keys.revoke(created.id, CONFIG)
    expect(authenticate(keyed, `Bearer ${created.key}`, await keys.digests())).toMatchObject({ status: 401 })
  })
})
