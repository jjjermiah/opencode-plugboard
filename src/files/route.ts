/**
 * The Files API of OpenAI and Anthropic (since next): `POST /v1/files`, `GET /v1/files`, `GET /v1/files/{id}`,
 * `GET /v1/files/{id}/content` and `DELETE /v1/files/{id}`, one path set for both. A request is Anthropic-style when it sends
 * `anthropic-version` or `anthropic-beta` (the Anthropic SDKs always do), as `GET /v1/models` does; every other request gets
 * OpenAI's objects and error body. `src/openai/route.ts` has already checked origin, authenticated and checked the `files`
 * endpoint; every lookup here is under the caller's own app, so another app's id is the same 404 as an unknown one (I33).
 *
 * Also the two steps the model routes share: `loadFiles` reads the files a request names, and `inlineFiles` (`./refs.ts`)
 * replaces each reference by the inline form of that file before the decoder runs.
 */
import type { IncomingMessage, ServerResponse } from "node:http"
import { BODY_LIMIT_DEFAULTS, bodyLimits } from "../config.js"
import { isPlugError, type PlugError } from "../contract.js"
import { BodyError, RequestAborted, bodyPlugError, readBody, sendError, sendJson, type RequestScope } from "../http.js"
import { encodeError as encodeAnthropicError, messagesStatus } from "../anthropic/response.js"
import { encodeError as encodeOpenAiError } from "../openai/response.js"
import type { RouteHost } from "../openai/route.js"
import { retentionDaysFor } from "../responses/state.js"
import { MAX_TOTAL_IMAGE_BYTES } from "../session/media.js"
import { detectFile, kindOf } from "./content.js"
import { parseFormUpload } from "./multipart.js"
import { MAX_REFS, fileRefs, inlineFiles, type FileApi, type InlineFile } from "./refs.js"
import { MAX_FILE_BYTES, type FileRecord } from "./state.js"
import { attachment, encodeAnthropicFile, encodeOpenAiFile, intQuery, pageItems } from "./wire.js"

export type FilesOp = "create" | "list" | "get" | "content" | "delete"

/** A Files route as the log and metrics name it (never carrying an id). */
export interface FilesRoute {
  readonly op: FilesOp
  readonly route: "POST /v1/files" | "GET /v1/files" | "GET /v1/files/{id}" | "GET /v1/files/{id}/content" | "DELETE /v1/files/{id}"
  readonly id?: string
}

const FILES_PATH = /^\/v1\/files(?:\/([^/]+)(\/content)?)?$/

/** Every path this front-end owns, whatever the method (the route credentials read `x-api-key` there too). */
export const isFilesPath = (path: string) => FILES_PATH.test(path)

export function matchFilesRoute(method: string | undefined, path: string): FilesRoute | undefined {
  const match = FILES_PATH.exec(path)
  if (!match) return undefined
  if (match[1] === undefined) return method === "POST" ? { op: "create", route: "POST /v1/files" } : method === "GET" ? { op: "list", route: "GET /v1/files" } : undefined
  let id = match[1]
  try {
    id = decodeURIComponent(id)
  } catch {}
  if (match[2] !== undefined) return method === "GET" ? { op: "content", route: "GET /v1/files/{id}/content", id } : undefined
  if (method === "GET") return { op: "get", route: "GET /v1/files/{id}", id }
  if (method === "DELETE") return { op: "delete", route: "DELETE /v1/files/{id}", id }
  return undefined
}

/** The purposes an OpenAI upload may name. None changes how a file is used: every stored file can be named in any request. */
export const PURPOSES = ["user_data", "assistants", "vision", "evals"] as const

const bad = (message: string, code: string, param?: string): PlugError => ({ status: 400, kind: "invalid_request", code, ...(param === undefined ? {} : { param }), message })

/** The largest file this app may upload: its body cap, and never more than `MAX_FILE_BYTES`. */
export const fileCap = (host: RouteHost, app: string): number => Math.min(bodyLimits(host.options, app, host.keys?.appNames()).maxBodyBytes ?? BODY_LIMIT_DEFAULTS.maxBodyBytes, MAX_FILE_BYTES)

/** Checks a file's size and bytes, then keeps it under the app. */
export async function storeUpload(host: RouteHost, app: string, upload: { bytes: Uint8Array; declaredType: string | undefined; filename: string; purpose: string }): Promise<FileRecord | PlugError> {
  const cap = fileCap(host, app)
  if (upload.bytes.length > cap) return { status: 413, kind: "invalid_request", code: "file_too_large", param: "file", message: `The file is larger than this app's limit of ${cap} bytes` }
  const detected = detectFile(upload.bytes, upload.declaredType, upload.filename)
  if ("problem" in detected) return bad(detected.problem, "invalid_file", "file")
  return host.files.save(app, retentionDaysFor(host.options, app), { filename: upload.filename, mime: detected.mime, purpose: upload.purpose, bytes: upload.bytes })
}

const header = (request: IncomingMessage, name: string): string | undefined => {
  const value = request.headers[name]
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined
}

/** True for a request the Anthropic SDKs made. */
export const anthropicStyle = (request: IncomingMessage): boolean => header(request, "anthropic-version") !== undefined || header(request, "anthropic-beta") !== undefined

export interface FilesCall {
  readonly app: string
  readonly match: FilesRoute
  readonly request: IncomingMessage
  readonly url: URL
  readonly response: ServerResponse
  readonly scope: RequestScope
}

const LIST_ORDERS = ["asc", "desc"]

export async function serveFiles(host: RouteHost, { app, match, request, url, response, scope }: FilesCall): Promise<void> {
  const anthropic = anthropicStyle(request)
  const fail = (error: PlugError, close = false) =>
    sendError(response, anthropic ? { ...error, status: messagesStatus(error) } : error, anthropic ? encodeAnthropicError(error) : encodeOpenAiError(error), { close })
  const days = retentionDaysFor(host.options, app)
  const encode = (record: FileRecord): object => (anthropic ? encodeAnthropicFile(record, days) : encodeOpenAiFile(record, days))
  const missing = (id: string) =>
    fail({ status: 404, kind: anthropic ? "not_found" : "invalid_request", message: anthropic ? `File not found: ${id.slice(0, 80)}` : `No such File object: ${id.slice(0, 80)}` })

  async function run(): Promise<void> {
    if (match.op === "create") return create()
    if (match.op === "list") return list()
    const id = match.id!
    if (match.op === "delete") {
      if (!(await scope.race(host.files.remove(app, id)))) return missing(id)
      return sendJson(response, 200, anthropic ? { id, type: "file_deleted" } : { id, object: "file", deleted: true })
    }
    if (match.op === "content") {
      const stored = await scope.race(host.files.read(app, id, days))
      if (stored === undefined) return missing(id)
      const bytes = Buffer.from(stored.base64, "base64")
      // The stored type, as an attachment: a browser never renders an uploaded HTML or SVG, and never sniffs it into something else.
      response.writeHead(200, {
        "content-type": stored.record.mime.startsWith("text/") || stored.record.mime === "application/json" ? `${stored.record.mime}; charset=utf-8` : stored.record.mime,
        "content-length": bytes.length,
        "content-disposition": attachment(stored.record.filename),
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cache-control": "private, no-store",
      })
      response.end(bytes)
      return
    }
    const record = await scope.race(host.files.head(app, id, days))
    if (record === undefined) return missing(id)
    return sendJson(response, 200, encode(record))
  }

  async function create(): Promise<void> {
    // Read whole under the body admission (I28): the app's body cap, its share of the in-flight budget and the read timeouts.
    const body = await readBody(request, scope.signal, bodyLimits(host.options, app, host.keys?.appNames()))
    const form = await scope.race(parseFormUpload(request.headers["content-type"], body))
    if (isPlugError(form)) return fail(form)
    let purpose = "user_data"
    if (!anthropic) {
      const given = form.fields.get("purpose")
      if (given === undefined || given.length === 0) return fail(bad("Missing required parameter: 'purpose'.", "missing_required_parameter", "purpose"))
      if (!(PURPOSES as readonly string[]).includes(given))
        return fail(bad(`Invalid value: '${given.slice(0, 40)}'. Supported values are: ${PURPOSES.map((p) => `'${p}'`).join(", ")}.`, "invalid_value", "purpose"))
      purpose = given
    }
    const stored = await scope.race(storeUpload(host, app, { bytes: form.bytes, declaredType: form.declaredType, filename: form.filename, purpose }))
    if (isPlugError(stored)) return fail(stored)
    sendJson(response, 200, encode(stored))
  }

  async function list(): Promise<void> {
    const ids = (await scope.race(host.files.ids(app, days))).map((id) => ({ id }))
    const load = async (items: ReadonlyArray<{ id: string }>) => {
      const records = await scope.race(Promise.all(items.map((item) => host.files.head(app, item.id, days))))
      return records.filter((record): record is FileRecord => record !== undefined)
    }
    const params = url.searchParams

    if (anthropic) {
      // Anthropic lists newest first. `page` is the cursor a list returned in `next_page`; `after_id` and `before_id` are the older spelling.
      const newest = [...ids].reverse()
      const requested = params.getAll("ids")
      if (requested.length > 0) {
        if (new Set(requested).size > 100) return fail(bad("ids takes at most 100 entries", "invalid_ids", "ids"))
        const wanted = new Set(requested)
        const records = await load(newest.filter((item) => wanted.has(item.id)))
        return sendJson(response, 200, { data: records.map(encode), first_id: records[0]?.id ?? null, last_id: records.at(-1)?.id ?? null, has_more: false, next_page: null })
      }
      const limit = intQuery(params, "limit", { min: 1, max: 1000, fallback: 20 })
      if (isPlugError(limit)) return fail(limit)
      const page = params.get("page")
      const after = page !== null ? (page.startsWith("page_") ? page.slice(5) : page) : (params.get("after_id") ?? undefined)
      const before = params.get("before_id") ?? undefined
      if (after !== undefined && before !== undefined) return fail(bad("after_id and before_id cannot both be set", "invalid_cursor", "before_id"))
      const paged = pageItems(newest, limit, { after, before })
      if (!paged)
        return fail(
          bad(
            `${page !== null ? "page" : before !== undefined ? "before_id" : "after_id"} is not a listed file`,
            "invalid_cursor",
            page !== null ? "page" : before !== undefined ? "before_id" : "after_id",
          ),
        )
      const records = await load(paged.page)
      return sendJson(response, 200, {
        data: records.map(encode),
        first_id: records[0]?.id ?? null,
        last_id: records.at(-1)?.id ?? null,
        has_more: paged.hasMore,
        next_page: paged.hasMore && paged.page.length > 0 ? `page_${paged.page.at(-1)!.id}` : null,
      })
    }

    // OpenAI: purpose filter, limit 1 to 10000 (default 10000), after, order (default desc, by creation time).
    const limit = intQuery(params, "limit", { min: 1, max: 10_000, fallback: 10_000 })
    if (isPlugError(limit)) return fail(limit)
    const order = params.get("order") ?? "desc"
    if (!LIST_ORDERS.includes(order)) return fail(bad(`Invalid value: '${order.slice(0, 20)}'. Supported values are: 'asc' and 'desc'.`, "invalid_value", "order"))
    const purpose = params.get("purpose")
    const ordered = order === "asc" ? ids : [...ids].reverse()
    const after = params.get("after")
    const start = after === null ? 0 : ordered.findIndex((item) => item.id === after) + 1
    if (after !== null && start === 0) return fail(bad("Invalid 'after': no file has this id.", "invalid_cursor", "after"))
    // Metadata is read in small batches from the cursor, until the page and one more are found.
    const data: FileRecord[] = []
    let more = false
    for (let at = start; at < ordered.length && !more; at += 25) {
      for (const record of await load(ordered.slice(at, at + 25))) {
        if (purpose !== null && record.purpose !== purpose) continue
        if (data.length < limit) data.push(record)
        else more = true
      }
    }
    sendJson(response, 200, { object: "list", data: data.map(encode), first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null, has_more: more })
  }

  try {
    await run()
  } catch (caught) {
    // Answer in this route's error shape, then rethrow: the shared handler logs the outcome and finds the response already sent.
    if (!response.headersSent) {
      if (caught instanceof BodyError) fail(bodyPlugError(caught), caught.status !== 400)
      else if (caught instanceof RequestAborted) {
        if (caught.kind === "timeout") fail(scope.timeoutError, true)
      } else fail({ status: 500, kind: "server", message: "Internal server error" })
    }
    throw caught
  }
}

/** What a file adds to the request once inlined: text as itself, an image or a PDF as its base64 data URL (the size the media limit counts). */
const inlineSize = (record: FileRecord): number => (kindOf(record.mime) === "text" ? record.bytes : Math.ceil(record.bytes / 3) * 4)

/**
 * The files a request names, read under the caller's own app and keyed by id. An id the app does not hold is simply absent
 * (the same for unknown, deleted, expired or another app's, I33); `inlineFiles` turns that into the 404. More than `MAX_REFS`
 * distinct files in one request is a 400.
 */
export async function loadFiles(host: RouteHost, app: string, ids: ReadonlyArray<string>, scope: RequestScope): Promise<Map<string, InlineFile> | PlugError> {
  const files = new Map<string, InlineFile>()
  if (ids.length === 0) return files
  if (ids.length > MAX_REFS) return bad(`A request may name at most ${MAX_REFS} files; this one names ${ids.length}`, "too_many_files")
  const days = retentionDaysFor(host.options, app)
  // The request's files together are held to the limit the media step puts on its images, and that is checked on their sizes (metadata
  // only) before any file's bytes are read: a few bytes of request naming many large files never makes the server read them all.
  let total = 0
  for (const record of await scope.race(Promise.all(ids.map((id) => host.files.head(app, id, days))))) if (record !== undefined) total += inlineSize(record)
  if (total > MAX_TOTAL_IMAGE_BYTES) return bad("The request's files are larger than 50 MB in total", "files_too_large")
  for (const stored of await scope.race(Promise.all(ids.map((id) => host.files.read(app, id, days)))))
    if (stored !== undefined) files.set(stored.record.id, { mime: stored.record.mime, base64: stored.base64 })
  return files
}

/** The request body with every file it names inlined, or the 404 or 400 to answer with. A body that names no file is returned as it came. */
export async function inlineRequestFiles(host: RouteHost, app: string, api: FileApi, body: unknown, scope: RequestScope): Promise<unknown> {
  const ids = fileRefs(api, body)
  if (ids.length === 0) return body
  const files = await loadFiles(host, app, ids, scope)
  return isPlugError(files) ? files : inlineFiles(api, body, files)
}
