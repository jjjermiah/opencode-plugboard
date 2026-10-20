/**
 * Uploaded files (since next): what `POST /v1/files` (OpenAI and Anthropic shapes) and Gemini's `upload/v1beta/files` keep, so a
 * request can name them by `file_id` or `fileUri`. The store is modeled on stored Responses (`src/responses/state.ts`, I32).
 *
 * A file is three records in the plugin's host storage (`ctx.storage`, the table usage, runtime keys and stored responses share),
 * so files survive a restart:
 *
 *   `files/<app>/id/<id>`                       JSON { v, createdAt, bytes, filename, mime, purpose }
 *   `files/<app>/data/<id>`                     the bytes, base64 (the form the model input needs)
 *   `files/<app>/at/<created ms>-<bytes>-<id>`  an index entry (empty value), in creation order
 *
 * The `app` is part of every key and an app name never contains `/`, so an app can only compute keys under its own prefix:
 * another app's id is a miss, the same as an unknown, deleted or expired one (I33). Ids are `file-` plus 32 hex chars from
 * `crypto.randomUUID` (122 random bits). An id, a name or a body is never logged.
 *
 * Retention is the app's history retention (`sessions.maxAgeDays`, 30 days when unset or 0, `retentionDaysFor`). An app holds at
 * most `MAX_FILES` files and `MAX_APP_BYTES` bytes: an upload past either is refused (never silently evicting a file the caller
 * may still use). A file past its age is a miss on read, and a sweep (from request handling, never setup, I3) deletes expired files.
 */
import type { PlugError } from "../contract.js"
import { errorMessage, logError, log, outsideRequest } from "../log.js"
import type { StoragePort } from "../session/host.js"

export interface FileRecord {
  readonly id: string
  readonly filename: string
  readonly mime: string
  readonly bytes: number
  /** Epoch ms. */
  readonly createdAt: number
  readonly purpose: string
}

export interface StoredFile {
  readonly record: FileRecord
  /** The bytes as stored, base64: the form a request inlines. */
  readonly base64: string
}

export interface NewFile {
  readonly filename: string
  readonly mime: string
  readonly purpose: string
  readonly bytes: Uint8Array
}

export interface FileStore {
  /**
   * Keeps a file under the app. A `PlugError` when the app's file count or bytes are used up, or (a 429) when too many saves of the app are
   * already waiting; throws only when storage cannot be written. Saves of one app run one at a time. A save that is still waiting leaves the
   * queue, and releases its bytes, when `signal` aborts (the call then rejects with the abort reason); one that has started always runs to
   * its end, because its write can still complete.
   */
  save(app: string, retentionDays: number, file: NewFile, signal?: AbortSignal): Promise<FileRecord | PlugError>
  /** The app's file metadata, or undefined when unknown, deleted, expired, or another app's. Throws only when storage cannot be read. */
  head(app: string, id: string, retentionDays: number): Promise<FileRecord | undefined>
  /** The metadata and the bytes, or undefined as `head`. */
  read(app: string, id: string, retentionDays: number): Promise<StoredFile | undefined>
  /** The ids of the app's live files, oldest first. */
  ids(app: string, retentionDays: number): Promise<string[]>
  /** Deletes the app's file; false when there was none. */
  remove(app: string, id: string): Promise<boolean>
  /** Resolves when background sweeps started by `save` have finished (tests). */
  idle(): Promise<void>
}

/** A save that is waiting its turn: it starts when the save before it ends, or leaves with `signal` (see `FileStore.save`). */
interface SaveWaiter {
  start(): void
}

/** The saves of one app: at most one runs, the rest wait in order. `heldBytes` is the running save's bytes and the waiting ones'. */
interface SaveQueue {
  running: boolean
  heldBytes: number
  readonly waiting: SaveWaiter[]
}

export interface FileStoreState {
  /**
   * Per app: when the last sweep started (epoch ms), the writes since, the creation time of the newest file (kept strictly increasing, so the
   * index order is the upload order), and its save queue (`save` runs one at a time per app, so its checks are atomic).
   */
  readonly apps: Map<string, { lastSweep: number; writes: number; lastAt: number; queue: SaveQueue }>
}

export const createFileState = (): FileStoreState => ({ apps: new Map() })

const SLOT = Symbol.for("opencode-plugboard.files-state/1")
const holder = globalThis as unknown as Record<symbol, FileStoreState | undefined>
/** The process-wide sweep bookkeeping, on `globalThis` under its own versioned key (I6); it does not change the runtime's shape. */
export const processFileState = (): FileStoreState => (holder[SLOT] ??= createFileState())

export const MAX_FILES = 1000
export const MAX_APP_BYTES = 1024 * 1024 * 1024
/** The largest file, whatever the app's body cap: the body cap (32 MiB by default) decides below this. */
export const MAX_FILE_BYTES = 32 * 1024 * 1024
/** Saves of one app that may wait behind the running one; a save past it is refused at once (429). */
export const MAX_SAVE_WAITERS = 8
/** The bytes of one app's running and waiting saves together, while one runs (an idle app always takes a save). */
export const MAX_SAVE_BYTES = 64 * 1024 * 1024
const DAY_MS = 86_400_000
const SWEEP_INTERVAL_MS = 10 * 60 * 1000
const SWEEP_WRITES = 20
const SCAN_PAGE = 200
const SCAN_MAX = 20_000
const SWEEP_MAX_DELETIONS = 200
export const ID_PATTERN = /^file-[0-9a-f]{32}$/
const AT_PATTERN = /^(\d{15})-(\d+)-(file-[0-9a-f]{32})$/

export const newFileId = (): string => `file-${crypto.randomUUID().replaceAll("-", "")}`

// The app is the first path segment of every key, and an app name never contains `/` (`isAppName`): the only guard of I33.
const idKey = (app: string, id: string) => `files/${app}/id/${id}`
const dataKey = (app: string, id: string) => `files/${app}/data/${id}`
const atKey = (app: string, at: number, bytes: number, id: string) => `files/${app}/at/${String(at).padStart(15, "0")}-${bytes}-${id}`
const atPrefix = (app: string) => `files/${app}/at/`

export interface FileStoreLimits {
  readonly maxFiles: number
  readonly maxAppBytes: number
  readonly maxSaveWaiters: number
  readonly maxSaveBytes: number
}

export interface FileStoreDeps {
  readonly storage: StoragePort
  readonly state?: FileStoreState
  /** Epoch ms; tests inject a clock. */
  readonly now?: () => number
  /** The size bounds; tests lower them. */
  readonly limits?: Partial<FileStoreLimits>
}

interface IndexEntry {
  readonly at: number
  readonly bytes: number
  readonly id: string
}

export function createFileStore(deps: FileStoreDeps): FileStore {
  const { storage } = deps
  const state = deps.state ?? processFileState()
  const now = deps.now ?? Date.now
  const { maxFiles, maxAppBytes, maxSaveWaiters, maxSaveBytes } = { maxFiles: MAX_FILES, maxAppBytes: MAX_APP_BYTES, maxSaveWaiters: MAX_SAVE_WAITERS, maxSaveBytes: MAX_SAVE_BYTES, ...deps.limits }
  const pending = new Set<Promise<void>>()

  /** Every index entry of the app, oldest first. A capped scan undercounts, never overcounts. */
  async function entries(app: string): Promise<IndexEntry[]> {
    const found: IndexEntry[] = []
    let after: string | undefined
    while (found.length < SCAN_MAX) {
      const page = await storage.scan({ prefix: atPrefix(app), ...(after === undefined ? {} : { after }), limit: SCAN_PAGE })
      for (const key of page.keys) {
        const match = AT_PATTERN.exec(key.slice(atPrefix(app).length))
        // An entry that is not ours to read is left alone; it cannot be a file of this app's.
        if (match) found.push({ at: Number(match[1]), bytes: Number(match[2]), id: match[3]! })
      }
      if (page.next === undefined) break
      after = page.next
    }
    return found
  }

  /** Deletes the file so a read misses first, then its bytes and its index entry: a failure in between leaves an entry the next sweep retries. */
  async function drop(app: string, id: string, at: number, bytes: number): Promise<void> {
    await storage.drop(idKey(app, id))
    await storage.drop(dataKey(app, id))
    await storage.drop(atKey(app, at, bytes, id))
  }

  async function sweep(app: string, retentionDays: number): Promise<void> {
    const cutoff = now() - retentionDays * DAY_MS
    let removed = 0
    let failed = 0
    for (const entry of await entries(app)) {
      if (entry.at >= cutoff || removed + failed >= SWEEP_MAX_DELETIONS) break
      try {
        await drop(app, entry.id, entry.at, entry.bytes)
        removed++
      } catch {
        failed++
      }
    }
    if (removed + failed > 0) log("files.swept", { removed, failed })
  }

  function appState(app: string) {
    const entry = state.apps.get(app) ?? { lastSweep: 0, writes: 0, lastAt: 0, queue: { running: false, heldBytes: 0, waiting: [] } }
    // An entry an older generation made (the state is shared across generations, I6) has no queue yet.
    entry.queue ??= { running: false, heldBytes: 0, waiting: [] }
    state.apps.set(app, entry)
    return entry
  }

  /**
   * Runs `run` when every earlier save of the app has ended: the count and byte checks and the writes after them are one step, so uploads in
   * flight together cannot all pass a check only one of them should. The queue is bounded, so a storage call that never settles cannot make
   * it grow: a save past `maxSaveWaiters` waiting, or past `maxSaveBytes` held, is refused at once. A waiting save leaves when `signal`
   * aborts and its bytes go with it. The running save is never released early: it ends when its own write does, and until then it holds the slot.
   */
  function serialized(app: string, bytes: number, signal: AbortSignal | undefined, run: () => Promise<FileRecord | PlugError>): Promise<FileRecord | PlugError> {
    const queue = appState(app).queue
    if (signal?.aborted) return Promise.reject(signal.reason)
    // Waiting saves exist only while one runs, so an idle app takes any save, even one over the byte bound.
    if (queue.running && (queue.waiting.length >= maxSaveWaiters || queue.heldBytes + bytes > maxSaveBytes))
      return Promise.resolve({ status: 429, kind: "rate_limit", code: "file_saves_busy", message: "This app has too many uploads waiting to be saved; try again shortly", retryAfterSeconds: 5 })
    queue.heldBytes += bytes
    return new Promise((resolve, reject) => {
      const release = () => {
        queue.heldBytes -= bytes
        queue.running = false
        queue.waiting.shift()?.start()
      }
      const onAbort = () => {
        const at = queue.waiting.indexOf(waiter)
        if (at < 0) return
        queue.waiting.splice(at, 1)
        queue.heldBytes -= bytes
        reject(signal?.reason)
      }
      const waiter: SaveWaiter = {
        start() {
          signal?.removeEventListener("abort", onAbort)
          queue.running = true
          run().then(resolve, reject).then(release, release)
        },
      }
      if (!queue.running) return waiter.start()
      queue.waiting.push(waiter)
      signal?.addEventListener("abort", onAbort, { once: true })
    })
  }

  /** One sweep per app at a time, off the request (`outsideRequest`): the answer never waits for it. */
  function maybeSweep(app: string, retentionDays: number): void {
    const entry = appState(app)
    entry.writes++
    if (entry.writes < SWEEP_WRITES && now() - entry.lastSweep < SWEEP_INTERVAL_MS) return
    entry.writes = 0
    entry.lastSweep = now()
    const run = outsideRequest(() => sweep(app, retentionDays)).catch((error) => logError("files.sweep_failed", { error: errorMessage(error) }))
    pending.add(run)
    void run.finally(() => pending.delete(run))
  }

  async function readMeta(app: string, id: string, retentionDays: number): Promise<FileRecord | undefined> {
    if (!ID_PATTERN.test(id)) return undefined
    let raw: string | undefined
    try {
      raw = await storage.get(idKey(app, id))
    } catch {
      logError("files.store_failed", { op: "load" })
      throw new Error("file storage unavailable")
    }
    if (raw === undefined) return undefined
    let value: Record<string, unknown>
    try {
      value = JSON.parse(raw) as Record<string, unknown>
    } catch {
      value = {}
    }
    if (
      value.v !== 1 ||
      typeof value.createdAt !== "number" ||
      typeof value.bytes !== "number" ||
      typeof value.filename !== "string" ||
      typeof value.mime !== "string" ||
      typeof value.purpose !== "string"
    )
      return undefined
    if (value.createdAt + retentionDays * DAY_MS < now()) {
      // Expired: a miss now, and gone from storage. A failed delete is the sweep's to retry.
      await drop(app, id, value.createdAt, value.bytes).catch(() => {})
      return undefined
    }
    return { id, filename: value.filename, mime: value.mime, bytes: value.bytes, createdAt: value.createdAt, purpose: value.purpose }
  }

  async function saveOne(app: string, retentionDays: number, file: NewFile): Promise<FileRecord | PlugError> {
    const cutoff = now() - retentionDays * DAY_MS
    let live: IndexEntry[]
    try {
      live = (await entries(app)).filter((entry) => entry.at >= cutoff)
    } catch {
      logError("files.store_failed", { op: "save" })
      throw new Error("file storage unavailable")
    }
    if (live.length >= maxFiles) return { status: 400, kind: "invalid_request", code: "file_limit_exceeded", message: `This app already holds ${maxFiles} files; delete some before uploading more` }
    if (live.reduce((sum, entry) => sum + entry.bytes, 0) + file.bytes.length > maxAppBytes)
      return { status: 400, kind: "invalid_request", code: "file_storage_full", message: "This app's file storage is full; delete some files before uploading more" }
    const id = newFileId()
    // Never the same millisecond as the app's previous upload: the index is ordered by it.
    const createdAt = Math.max(now(), appState(app).lastAt + 1)
    appState(app).lastAt = createdAt
    const bytes = file.bytes.length
    const meta = JSON.stringify({ v: 1, createdAt, bytes, filename: file.filename, mime: file.mime, purpose: file.purpose })
    try {
      await storage.put(dataKey(app, id), Buffer.from(file.bytes).toString("base64"))
      await storage.put(idKey(app, id), meta)
      await storage.put(atKey(app, createdAt, bytes, id), "")
    } catch (error) {
      logError("files.store_failed", { op: "save", error: errorMessage(error).replaceAll(id, "<id>") })
      throw new Error("file storage unavailable")
    }
    maybeSweep(app, retentionDays)
    return { id, filename: file.filename, mime: file.mime, bytes, createdAt, purpose: file.purpose }
  }

  return {
    save: (app, retentionDays, file, signal) => serialized(app, file.bytes.length, signal, () => saveOne(app, retentionDays, file)),

    head: readMeta,

    async read(app, id, retentionDays) {
      const record = await readMeta(app, id, retentionDays)
      if (record === undefined) return undefined
      let data: string | undefined
      try {
        data = await storage.get(dataKey(app, id))
      } catch {
        logError("files.store_failed", { op: "load" })
        throw new Error("file storage unavailable")
      }
      return data === undefined ? undefined : { record, base64: data }
    },

    async ids(app, retentionDays) {
      const cutoff = now() - retentionDays * DAY_MS
      try {
        return (await entries(app)).filter((entry) => entry.at >= cutoff).map((entry) => entry.id)
      } catch {
        logError("files.store_failed", { op: "list" })
        throw new Error("file storage unavailable")
      }
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
        logError("files.store_failed", { op: "remove" })
        throw new Error("file storage unavailable")
      }
    },

    idle: async () => void (await Promise.all([...pending])),
  }
}
