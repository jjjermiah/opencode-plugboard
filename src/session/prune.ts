/**
 * History pruning: an index of plugboard's own request sessions and the sweep that deletes the
 * old ones.
 *
 * The plugin session API has no `list`, so plugboard cannot ask the host which sessions it owns.
 * It keeps an index in the plugin's own host storage (`ctx.storage`, a key-value table in the
 * host database, shared by every Location): one key per request session,
 *
 *   history/<app>/<created, 15 digits of epoch ms>/<sessionID>
 *
 * Everything the sweep needs is in the key, so a scan returns an app's sessions oldest first.
 * Sessions created before this index existed are not in it and are never pruned.
 *
 * Both functions run from request handling only (the runtime calls them), never from plugin
 * setup or a finalizer. A sweep does bounded work: it reads at most `maxScan` index entries per
 * app, makes at most `maxDeletes` host deletions and stops at its deadline; what is left waits for
 * the next sweep. A session whose request guard is still in the session store (the host
 * execution has not ended) is never deleted.
 */

import type { HistoryPort } from "./host.js"
import type { SessionStore } from "./state.js"

/** Pruning limits. A field that is unset is not applied; with none set nothing is ever deleted. */
export interface HistoryLimits {
  /** Keep at most this many sessions per app (the newest). */
  readonly maxSessions?: number
  /** Delete sessions older than this many days. */
  readonly maxAgeDays?: number
}

/**
 * The limits one app is pruned by (#265): its own field when set (`apps.<name>.history`), else the global one, field by field.
 * An app with no limit in either place gets `{}`, which keeps its sessions forever.
 */
export function limitsFor(global: HistoryLimits, apps: Readonly<Record<string, HistoryLimits>> | undefined, app: string): HistoryLimits {
  const own = apps !== undefined && Object.hasOwn(apps, app) ? apps[app] : undefined
  const maxSessions = own?.maxSessions ?? global.maxSessions
  const maxAgeDays = own?.maxAgeDays ?? global.maxAgeDays
  return { ...(maxSessions === undefined ? {} : { maxSessions }), ...(maxAgeDays === undefined ? {} : { maxAgeDays }) }
}

export interface SweepResult {
  readonly apps: number
  /** Index entries read. */
  readonly scanned: number
  readonly removed: number
  /** Already gone from the host (deleted by hand); only the index entry was dropped. */
  readonly missing: number
  /** Host deletions or index updates that failed; retried by the next sweep. */
  readonly failed: number
  /** Over a limit but skipped because the request guard is still active. */
  readonly active: number
  /** Work was left (budget, deadline or scan cap reached): run the next sweep soon. */
  readonly more: boolean
}

export interface SweepInput {
  readonly port: HistoryPort
  /** The global limits; `apps` overrides them per app (see `limitsFor`). */
  readonly limits: HistoryLimits
  /** Each app's own limits (`apps.<name>.history`, #265), keyed by app name. */
  readonly apps?: Readonly<Record<string, HistoryLimits>>
  readonly sessions: SessionStore
  readonly now: number
  /** Aborts the sweep between host calls. */
  readonly signal: AbortSignal
  /** Most host deletions per sweep. */
  readonly maxDeletes?: number
  /** Most index entries read per app per sweep. */
  readonly maxScan?: number
}

const PREFIX = "history/"
const AT_WIDTH = 15
const DAY_MS = 86_400_000
const PAGE = 500
const MAX_DELETES = 200
const MAX_SCAN = 20_000

export const indexKey = (app: string, createdAt: number, sessionID: string): string =>
  `${PREFIX}${app}/${String(Math.max(0, Math.floor(createdAt))).padStart(AT_WIDTH, "0")}/${sessionID}`

/** Index one new request session. The value repeats the ID; the key carries app and time. */
export const recordSession = (port: HistoryPort, app: string, sessionID: string, createdAt: number): Promise<void> =>
  port.put(indexKey(app, createdAt, sessionID), sessionID)

interface Entry {
  readonly key: string
  readonly sessionID: string
  readonly createdAt: number
}

function parseKey(key: string): Entry | undefined {
  const [, at, ...rest] = key.slice(PREFIX.length).split("/")
  const createdAt = Number(at)
  const sessionID = rest.join("/")
  if (!/^\d+$/.test(at ?? "") || !Number.isFinite(createdAt) || sessionID.length === 0) return undefined
  return { key, sessionID, createdAt }
}

/** App names in the index, found by hopping over each app's keys (one tiny scan per app). */
async function indexedApps(port: HistoryPort, signal: AbortSignal): Promise<string[]> {
  const apps: string[] = []
  let after: string | undefined
  while (!signal.aborted) {
    const page = await port.scan({ prefix: PREFIX, ...(after === undefined ? {} : { after }), limit: 1 })
    const first = page.keys[0]
    if (first === undefined) break
    const app = first.slice(PREFIX.length).split("/")[0] ?? ""
    if (app.length > 0) apps.push(app)
    // `\uffff` sorts after every character of an ID or timestamp, so this skips the rest of the app.
    after = `${PREFIX}${app}/\uffff`
  }
  return apps
}

/** One app's entries, oldest first, at most `maxScan`; `capped` when more remain in the index. */
async function readApp(port: HistoryPort, app: string, maxScan: number, signal: AbortSignal): Promise<{ entries: Entry[]; capped: boolean }> {
  const entries: Entry[] = []
  const prefix = `${PREFIX}${app}/`
  let after: string | undefined
  while (!signal.aborted) {
    const page = await port.scan({ prefix, ...(after === undefined ? {} : { after }), limit: Math.min(PAGE, maxScan - entries.length) })
    for (const key of page.keys) {
      const entry = parseKey(key)
      if (entry) entries.push(entry)
    }
    if (page.next === undefined) return { entries, capped: false }
    if (entries.length >= maxScan) return { entries, capped: true }
    after = page.next
  }
  return { entries, capped: true }
}

/**
 * One pass over the index. Per app, the sessions to delete are a prefix of its oldest-first list:
 * as many as exceed `maxSessions`, or are older than `maxAgeDays`, whichever is more. A session
 * with an active request guard is skipped (it still counts as kept). Entries of sessions the host
 * no longer has are dropped. A scan that hit `maxScan` only undercounts the app, so it can only
 * delete fewer sessions than the limit asks for, never more.
 */
export async function sweepHistory(input: SweepInput): Promise<SweepResult> {
  const { port, sessions, signal } = input
  const maxDeletes = input.maxDeletes ?? MAX_DELETES
  const maxScan = input.maxScan ?? MAX_SCAN
  let scanned = 0
  let removed = 0
  let missing = 0
  let failed = 0
  let active = 0
  let attempts = 0
  let more = false

  const apps = await indexedApps(port, signal)
  for (const app of apps) {
    if (signal.aborted) {
      more = true
      break
    }
    const limits = limitsFor(input.limits, input.apps, app)
    const cutoff = limits.maxAgeDays === undefined ? undefined : input.now - limits.maxAgeDays * DAY_MS
    const { entries, capped } = await readApp(port, app, maxScan, signal)
    scanned += entries.length
    if (capped) more = true
    const excess = limits.maxSessions === undefined ? 0 : Math.max(0, entries.length - limits.maxSessions)
    const expired = cutoff === undefined ? 0 : entries.findIndex((entry) => entry.createdAt >= cutoff)
    const count = Math.max(excess, cutoff === undefined ? 0 : expired === -1 ? entries.length : expired)
    for (const entry of entries.slice(0, count)) {
      if (signal.aborted || attempts >= maxDeletes) {
        more = true
        break
      }
      // Checked right before the host call: a guard that is still registered means the host execution is running.
      if (sessions.lookup(entry.sessionID)) {
        active++
        continue
      }
      attempts++
      try {
        if ((await port.removeSession(entry.sessionID)) === "removed") removed++
        else missing++
        await port.drop(entry.key)
      } catch {
        failed++
      }
    }
  }
  return { apps: apps.length, scanned, removed, missing, failed, active, more }
}
