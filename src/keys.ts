/**
 * Runtime app keys (#55): keys created through `/plugboard/admin/keys` (src/admin/route.ts), kept beside
 * the keys of the config.
 *
 * Each runtime key is one record in the plugin's host storage (`ctx.storage`, the table the history
 * index and usage use) under `keys/<id>`, as JSON `{ app, digest, createdAt }`. The digest is the
 * SHA-256 of the key, so the key value is never stored: it is returned once, by the create call.
 * The id is the first 8 hex chars of that digest, the name `DELETE` takes; it is safe to show.
 *
 * The records are read lazily, from request handling, by the first request that authenticates (never
 * from plugin setup, I3), and cached on the process runtime (`KeyState`), so the cache outlives a
 * plugin generation. A failed read leaves the cache unloaded: runtime keys then fail closed (401) and
 * the next request reads again. Create and revoke write storage first and the cache second, so a
 * revoked key stops authenticating on the next request.
 */

import { createHash, randomBytes } from "node:crypto"
import { APP_NAME_PATTERN } from "./config.js"
import { errorMessage, logError } from "./log.js"
import type { StoragePort } from "./session/host.js"

const PREFIX = "keys/"
const SCAN_PAGE = 200
/** A collision of two 32-bit ids is rare; a fresh key is drawn instead of sharing an id. */
const ID_ATTEMPTS = 5

export interface RuntimeKey {
  readonly id: string
  readonly app: string
  readonly digest: Buffer
  readonly createdAt: string
}

/** The live cache of runtime keys on the process runtime (src/runtime.ts). */
export interface KeyState {
  loaded: boolean
  readonly keys: Map<string, RuntimeKey>
}

export const createKeyState = (): KeyState => ({ loaded: false, keys: new Map() })

/** SHA-256 of a key: what is stored and compared. */
export const keyDigest = (key: string): Buffer => createHash("sha256").update(key).digest()

/** The id of a key: the first 8 hex chars of its digest. */
export const keyIdOf = (digest: Buffer): string => digest.subarray(0, 4).toString("hex")

export interface KeyListing {
  readonly id: string
  readonly app: string
  readonly source: "config" | "runtime"
  readonly createdAt?: string
}

export interface CreatedKey {
  readonly id: string
  readonly app: string
  /** The key value. Returned by `create` only; it is never stored or listed. */
  readonly key: string
  readonly createdAt: string
}

export interface KeyStore {
  /** The digests of the loaded runtime keys, as `[app, digest]`. Reads storage once; a failed read answers with what is loaded. */
  digests(): Promise<ReadonlyArray<readonly [string, Buffer]>>
  /** The apps the loaded runtime keys belong to, each once. Synchronous: call after `digests()` (every authenticated request does). */
  appNames(): ReadonlyArray<string>
  /** Config keys and runtime keys, without key values. */
  list(config: Readonly<Record<string, string>>): Promise<ReadonlyArray<KeyListing>>
  /** A new random key for `app`. The caller checks the app name and that the config has no key for it. */
  create(app: string, config: Readonly<Record<string, string>>): Promise<CreatedKey>
  /** `config` when the id names a config key (not revocable here), `not_found` when no runtime key has it. */
  revoke(id: string, config: Readonly<Record<string, string>>): Promise<"revoked" | "config" | "not_found">
}

export interface KeyStoreDeps {
  readonly state: KeyState
  readonly storage: StoragePort
  /** Epoch ms; tests inject a clock. */
  readonly now?: () => number
}

const configIds = (config: Readonly<Record<string, string>>): Set<string> => new Set(Object.values(config).map((key) => keyIdOf(keyDigest(key))))

/** A stored record, or undefined when the value is not one (logged; the key then never authenticates). */
function parseRecord(id: string, raw: string | undefined): RuntimeKey | undefined {
  try {
    const value = JSON.parse(raw ?? "") as { app?: unknown; digest?: unknown; createdAt?: unknown }
    const digest = typeof value.digest === "string" && /^[0-9a-f]{64}$/.test(value.digest) ? Buffer.from(value.digest, "hex") : undefined
    if (typeof value.app !== "string" || !APP_NAME_PATTERN.test(value.app) || digest === undefined || typeof value.createdAt !== "string") throw new Error("shape")
    if (keyIdOf(digest) !== id) throw new Error("id")
    return { id, app: value.app, digest, createdAt: value.createdAt }
  } catch {
    logError("keys.unreadable", { id })
    return undefined
  }
}

export function createKeyStore(deps: KeyStoreDeps): KeyStore {
  const { state, storage } = deps
  const now = deps.now ?? Date.now
  let loading: Promise<void> | undefined

  /** Reads every stored key once. Concurrent callers share one read. */
  const ensure = (): Promise<void> => {
    if (state.loaded) return Promise.resolve()
    loading ??= (async () => {
      const found = new Map<string, RuntimeKey>()
      let after: string | undefined
      for (;;) {
        const page = await storage.scan({ prefix: PREFIX, ...(after === undefined ? {} : { after }), limit: SCAN_PAGE })
        for (const key of page.keys) {
          const record = parseRecord(key.slice(PREFIX.length), await storage.get(key))
          if (record) found.set(record.id, record)
        }
        if (page.next === undefined) break
        after = page.next
      }
      state.keys.clear()
      for (const [id, record] of found) state.keys.set(id, record)
      state.loaded = true
    })().finally(() => {
      loading = undefined
    })
    return loading
  }

  return {
    async digests() {
      try {
        await ensure()
      } catch (error) {
        logError("keys.load_failed", { error: errorMessage(error) })
      }
      return [...state.keys.values()].map((record) => [record.app, record.digest] as const)
    },

    appNames() {
      return [...new Set([...state.keys.values()].map((record) => record.app))]
    },

    async list(config) {
      await ensure()
      const runtime = [...state.keys.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
      return [
        ...Object.entries(config).map(([app, key]) => ({ id: keyIdOf(keyDigest(key)), app, source: "config" as const })),
        ...runtime.map((record) => ({ id: record.id, app: record.app, source: "runtime" as const, createdAt: record.createdAt })),
      ]
    },

    async create(app, config) {
      await ensure()
      const taken = configIds(config)
      for (let attempt = 0; attempt < ID_ATTEMPTS; attempt++) {
        const key = randomBytes(32).toString("base64url")
        const digest = keyDigest(key)
        const id = keyIdOf(digest)
        if (taken.has(id) || state.keys.has(id)) continue
        const createdAt = new Date(now()).toISOString()
        // Storage first: a failed write creates no key, and the value is never returned for a key that does not exist.
        await storage.put(PREFIX + id, JSON.stringify({ app, digest: digest.toString("hex"), createdAt }))
        state.keys.set(id, { id, app, digest, createdAt })
        return { id, app, key, createdAt }
      }
      throw new Error("could not draw an unused key id")
    },

    async revoke(id, config) {
      await ensure()
      if (configIds(config).has(id)) return "config"
      if (!state.keys.has(id)) return "not_found"
      // Storage first: if the delete fails the key keeps working and the caller can retry.
      await storage.drop(PREFIX + id)
      state.keys.delete(id)
      return "revoked"
    },
  }
}
