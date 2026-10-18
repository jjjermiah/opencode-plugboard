/**
 * The file objects and list pages of the three Files APIs (since next). Pure: records in, wire objects out.
 *
 * One stored file has three faces. OpenAI: `{id, object:"file", bytes, created_at, expires_at, filename, purpose, status}`.
 * Anthropic: `{id, type:"file", filename, mime_type, size_bytes, created_at, downloadable, expires_at}`. Gemini:
 * `{name:"files/<hex>", displayName, mimeType, sizeBytes, createTime, updateTime, expirationTime, uri, state, source}`.
 * The id is the same in all three (`file-<32 hex>`; Gemini names the part after `file-`), so a file uploaded through one API
 * can be named by another's request.
 */
import type { PlugError } from "../contract.js"
import type { FileRecord } from "./state.js"

const DAY_MS = 86_400_000
const seconds = (ms: number) => Math.floor(ms / 1000)
const iso = (ms: number) => new Date(ms).toISOString()
const expires = (record: FileRecord, days: number) => record.createdAt + days * DAY_MS

export const encodeOpenAiFile = (record: FileRecord, days: number): object => ({
  id: record.id,
  object: "file",
  bytes: record.bytes,
  created_at: seconds(record.createdAt),
  expires_at: seconds(expires(record, days)),
  filename: record.filename,
  purpose: record.purpose,
  status: "processed",
  status_details: null,
})

export const encodeAnthropicFile = (record: FileRecord, days: number): object => ({
  id: record.id,
  type: "file",
  filename: record.filename,
  mime_type: record.mime,
  size_bytes: record.bytes,
  created_at: iso(record.createdAt),
  downloadable: true,
  expires_at: iso(expires(record, days)),
})

/** Gemini's name of a file: `files/` plus the 32 hex chars of the id. */
export const geminiName = (id: string): string => `files/${id.slice("file-".length)}`

export const encodeGeminiFile = (record: FileRecord, days: number, origin: string): object => ({
  name: geminiName(record.id),
  displayName: record.filename,
  mimeType: record.mime,
  sizeBytes: String(record.bytes),
  createTime: iso(record.createdAt),
  updateTime: iso(record.createdAt),
  expirationTime: iso(expires(record, days)),
  uri: `${origin}/v1beta/${geminiName(record.id)}`,
  state: "ACTIVE",
  source: "UPLOADED",
})

/** `Content-Disposition: attachment`, with the name as a quoted ASCII fallback and the exact name as `filename*`. */
export function attachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\%;]/g, "_")
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`
}

const bad = (message: string, param: string, code: string): PlugError => ({ status: 400, kind: "invalid_request", code, param, message })

/** An integer query value in `[min, max]`, or the default when absent. */
export function intQuery(params: URLSearchParams, name: string, bounds: { min: number; max: number; fallback: number }, label = name): number | PlugError {
  const raw = params.get(name)
  if (raw === null) return bounds.fallback
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  if (!(value >= bounds.min && value <= bounds.max)) return bad(`${label} must be a whole number from ${bounds.min} to ${bounds.max}`, name, "invalid_limit")
  return value
}

/**
 * One page of `items` (already in listing order). `after` starts after that item, `before` ends before it; `hasMore` says
 * whether more follow the page in the direction of paging. An unknown cursor is `undefined`.
 */
export function pageItems<T extends { readonly id: string }>(items: ReadonlyArray<T>, limit: number, cursor: { after?: string; before?: string }): { page: T[]; hasMore: boolean } | undefined {
  if (cursor.before !== undefined) {
    const end = items.findIndex((item) => item.id === cursor.before)
    if (end < 0) return undefined
    const start = Math.max(0, end - limit)
    return { page: items.slice(start, end), hasMore: start > 0 }
  }
  const start = cursor.after === undefined ? 0 : items.findIndex((item) => item.id === cursor.after) + 1
  if (cursor.after !== undefined && start === 0) return undefined
  return { page: items.slice(start, start + limit), hasMore: start + limit < items.length }
}
