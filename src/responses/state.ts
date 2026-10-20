/**
 * Stored Responses (since 0.51.0): the answers `POST /v1/responses` keeps with `store` on (the default), so
 * `previous_response_id`, `GET /v1/responses/{id}`, `DELETE /v1/responses/{id}` and
 * `GET /v1/responses/{id}/input_items` work as they do on OpenAI.
 *
 * A stored response is one record in the plugin's host storage (`ctx.storage`, the table usage, runtime keys and the
 * history index share), so it survives a restart:
 *
 *   `responses/<app>/id/<id>`                       JSON { v, createdAt, bytes, input, response }
 *   `responses/<app>/at/<created ms>-<bytes>-<id>`  an index entry (empty value), in creation order
 *
 * `input` is every input item the model saw, as the request resolved it (the earlier response's input and output
 * first when `previous_response_id` named one, `item_reference`s replaced by the item they name), each with an `id`.
 * `response` is the response object the caller got. The `app` is part of every key: an app can only compute keys
 * under its own prefix, so another app's id is a miss, the same as an unknown id (I32). Ids are
 * `resp_` plus 32 hex chars from `crypto.randomUUID` (122 random bits, `newId` in src/responses/response.ts), so they cannot be guessed. An id or a body
 * is never logged.
 *
 * Retention is the app's history retention (`sessions.maxAgeDays`, per app or global, 30 days when unset or 0:
 * stored responses hold whole conversations, so they are never kept forever). Size is bounded per app: at most
 * `MAX_RESPONSES` records and `MAX_APP_BYTES` bytes, and a record over `MAX_RECORD_BYTES` is not kept. A record
 * past its age is a miss on read, and a sweep (from request handling, never setup, I3) deletes expired and
 * surplus records, oldest first.
 */
import { appHistoryLimits, type PlugboardOptions } from "../config.js"
import { errorMessage, logError, logWarn, log, outsideRequest } from "../log.js"
import { limitsFor } from "../session/prune.js"
import type { StoragePort } from "../session/host.js"

type Item = Record<string, unknown>

/** A stored response, as read back. */
export interface StoredResponse {
  readonly createdAt: number
  readonly input: ReadonlyArray<Item>
  readonly response: Readonly<Record<string, unknown>>
}

export interface ResponseStore {
  /** Keeps a completed answer. Never throws: a failure (storage, size) is logged and the answer is still given. Resolves once it is readable. */
  save(app: string, retentionDays: number, input: ReadonlyArray<Item>, response: object): Promise<void>
  /** The app's stored response, or undefined when unknown, deleted, expired, or another app's. Throws only when storage cannot be read. */
  load(app: string, id: string, retentionDays: number): Promise<StoredResponse | undefined>
  /** Deletes the app's stored response; false when there was none. */
  remove(app: string, id: string): Promise<boolean>
  /** Resolves when background sweeps started by `save` have finished (tests). */
  idle(): Promise<void>
}

export interface ResponseStoreState {
  /** Per app: when the last sweep started (epoch ms) and the writes since. */
  readonly apps: Map<string, { lastSweep: number; writes: number }>
}

export const createResponseState = (): ResponseStoreState => ({ apps: new Map() })

const SLOT = Symbol.for("opencode-plugboard.responses-state/1")
const holder = globalThis as unknown as Record<symbol, ResponseStoreState | undefined>
/** The process-wide sweep bookkeeping, on `globalThis` under its own versioned key (I6); it does not change the runtime's shape. */
export const processResponseState = (): ResponseStoreState => (holder[SLOT] ??= createResponseState())

export const MAX_RESPONSES = 1000
export const MAX_APP_BYTES = 128 * 1024 * 1024
export const MAX_RECORD_BYTES = 8 * 1024 * 1024
export const DEFAULT_RETENTION_DAYS = 30
const DAY_MS = 86_400_000
/** A sweep runs at most this often per app, or after this many writes, whichever comes first. */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000
const SWEEP_WRITES = 50
const SCAN_PAGE = 200
const SCAN_MAX = 20_000
const SWEEP_MAX_DELETIONS = 200
const ID_PATTERN = /^resp_[0-9a-f]{32}$/
const AT_PATTERN = /^(\d{15})-(\d+)-(resp_[0-9a-f]{32})$/

/** Days the app's stored responses are kept: its effective `sessions.maxAgeDays`, else 30 (`0` and unset both mean 30). */
export function retentionDaysFor(options: Pick<PlugboardOptions, "apps" | "sessions">, app: string): number {
  const days = limitsFor(options.sessions, appHistoryLimits(options), app).maxAgeDays
  return days === undefined || days <= 0 ? DEFAULT_RETENTION_DAYS : days
}

// The app is the first path segment of every key, and an app name never contains `/` (`isAppName`): the only guard of I32.
const idKey = (app: string, id: string) => `responses/${app}/id/${id}`
const atKey = (app: string, at: number, bytes: number, id: string) => `responses/${app}/at/${String(at).padStart(15, "0")}-${bytes}-${id}`
const atPrefix = (app: string) => `responses/${app}/at/`

/**
 * An input item in OpenAI's full shape (#546): a message has `type: "message"` and a list of content parts. A caller may leave the type
 * out (`{ role, content }`) or send a string as content; every other item is returned as it is.
 */
export function fullItem(item: Item): Item {
  if (typeof item.role !== "string" || (item.type !== undefined && item.type !== "message")) return item
  const part = item.role === "assistant" ? "output_text" : "input_text"
  return { type: "message", ...item, ...(typeof item.content === "string" ? { content: [{ type: part, text: item.content }] } : {}) }
}

/** An item with an `id`: the caller's when it sent one not seen yet, else a new one named for its type. */
function withIds(items: ReadonlyArray<Item>): Item[] {
  const seen = new Set<string>()
  const prefixes: Record<string, string> = { message: "msg", function_call: "fc", function_call_output: "fco", reasoning: "rs" }
  return items.map((given) => {
    const item = fullItem(given)
    const type = typeof item.type === "string" ? item.type : item.role !== undefined ? "message" : "item"
    let id = typeof item.id === "string" && item.id.length > 0 && !seen.has(item.id) ? item.id : undefined
    id ??= `${prefixes[type] ?? "item"}_${crypto.randomUUID().replaceAll("-", "")}`
    seen.add(id)
    return item.id === id ? item : { ...item, id }
  })
}

export interface ResponseStoreLimits {
  readonly maxResponses: number
  readonly maxAppBytes: number
  readonly maxRecordBytes: number
}

export interface ResponseStoreDeps {
  readonly storage: StoragePort
  readonly state?: ResponseStoreState
  /** Epoch ms; tests inject a clock. */
  readonly now?: () => number
  /** The size bounds; tests lower them. */
  readonly limits?: Partial<ResponseStoreLimits>
}

export function createResponseStore(deps: ResponseStoreDeps): ResponseStore {
  const { storage } = deps
  const state = deps.state ?? processResponseState()
  const now = deps.now ?? Date.now
  const { maxResponses, maxAppBytes, maxRecordBytes } = { maxResponses: MAX_RESPONSES, maxAppBytes: MAX_APP_BYTES, maxRecordBytes: MAX_RECORD_BYTES, ...deps.limits }
  const pending = new Set<Promise<void>>()

  /** Deletes the record, then its index entry: a failure between them leaves an index entry the next sweep retries. */
  async function drop(app: string, id: string, at: number, bytes: number): Promise<void> {
    await storage.drop(idKey(app, id))
    await storage.drop(atKey(app, at, bytes, id))
  }

  async function sweep(app: string, retentionDays: number): Promise<void> {
    const entries: Array<{ key: string; at: number; bytes: number; id: string }> = []
    let after: string | undefined
    while (entries.length < SCAN_MAX) {
      const page = await storage.scan({ prefix: atPrefix(app), ...(after === undefined ? {} : { after }), limit: SCAN_PAGE })
      for (const key of page.keys) {
        const match = AT_PATTERN.exec(key.slice(atPrefix(app).length))
        if (match) entries.push({ key, at: Number(match[1]), bytes: Number(match[2]), id: match[3]! })
        // An entry that is not ours to read is left alone; it cannot be a record of this app's.
      }
      if (page.next === undefined) break
      after = page.next
    }
    const cutoff = now() - retentionDays * DAY_MS
    let count = entries.length
    let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0)
    let removed = 0
    let failed = 0
    for (const entry of entries) {
      if (removed + failed >= SWEEP_MAX_DELETIONS) break
      if (entry.at >= cutoff && count <= maxResponses && bytes <= maxAppBytes) break
      try {
        await drop(app, entry.id, entry.at, entry.bytes)
        removed++
        count--
        bytes -= entry.bytes
      } catch {
        failed++
      }
    }
    if (removed + failed > 0) log("responses.swept", { removed, failed, kept: count })
  }

  /** One sweep per app at a time, off the request (`outsideRequest`): the answer never waits for it. */
  function maybeSweep(app: string, retentionDays: number): void {
    const entry = state.apps.get(app) ?? { lastSweep: 0, writes: 0 }
    state.apps.set(app, entry)
    entry.writes++
    if (entry.writes < SWEEP_WRITES && now() - entry.lastSweep < SWEEP_INTERVAL_MS) return
    entry.writes = 0
    entry.lastSweep = now()
    const run = outsideRequest(() => sweep(app, retentionDays)).catch((error) => logError("responses.sweep_failed", { error: errorMessage(error) }))
    pending.add(run)
    void run.finally(() => pending.delete(run))
  }

  return {
    async save(app, retentionDays, input, response) {
      const id = (response as { id?: unknown }).id
      if (typeof id !== "string" || !ID_PATTERN.test(id)) return
      const createdAt = now()
      const json = JSON.stringify({ v: 1, createdAt, bytes: 0, input: withIds(input), response })
      // `bytes` is the size of the stored JSON; the record carries it so a read can drop the index entry. It leads the record, so the first `"bytes":0,` is its own.
      const bytes = Buffer.byteLength(json)
      if (bytes > maxRecordBytes) return void logWarn("responses.store_skipped", { reason: "too_large", bytes })
      try {
        await storage.put(idKey(app, id), json.replace('"bytes":0,', `"bytes":${bytes},`))
        await storage.put(atKey(app, createdAt, bytes, id), "")
      } catch (error) {
        return void logError("responses.store_failed", { op: "save", error: errorMessage(error).replaceAll(id, "<id>") })
      }
      maybeSweep(app, retentionDays)
    },

    async load(app, id, retentionDays) {
      if (!ID_PATTERN.test(id)) return undefined
      let raw: string | undefined
      try {
        raw = await storage.get(idKey(app, id))
      } catch {
        logError("responses.store_failed", { op: "load" })
        throw new Error("response storage unavailable")
      }
      if (raw === undefined) return undefined
      let value: { v?: unknown; createdAt?: unknown; bytes?: unknown; input?: unknown; response?: unknown }
      try {
        value = JSON.parse(raw) as typeof value
      } catch {
        value = {}
      }
      if (value.v !== 1 || typeof value.createdAt !== "number" || typeof value.bytes !== "number" || !Array.isArray(value.input) || typeof value.response !== "object" || value.response === null) {
        logWarn("responses.unreadable", {})
        return undefined
      }
      if (value.createdAt + retentionDays * DAY_MS < now()) {
        // Expired: a miss now, and gone from storage. A failed delete is the sweep's to retry.
        await drop(app, id, value.createdAt, value.bytes).catch(() => {})
        return undefined
      }
      return { createdAt: value.createdAt, input: value.input as Item[], response: value.response as Record<string, unknown> }
    },

    async remove(app, id) {
      if (!ID_PATTERN.test(id)) return false
      try {
        const raw = await storage.get(idKey(app, id))
        if (raw === undefined) return false
        let at = 0
        let bytes = 0
        try {
          const value = JSON.parse(raw) as { createdAt?: unknown; bytes?: unknown }
          if (typeof value.createdAt === "number" && typeof value.bytes === "number") ({ createdAt: at, bytes } = value as { createdAt: number; bytes: number })
        } catch {}
        await drop(app, id, at, bytes)
        return true
      } catch {
        logError("responses.store_failed", { op: "remove" })
        throw new Error("response storage unavailable")
      }
    },

    idle: async () => void (await Promise.all([...pending])),
  }
}
