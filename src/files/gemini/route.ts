/**
 * Gemini's Files API (since next): `POST /upload/v1beta/files`, `GET /v1beta/files`, `GET /v1beta/files/{name}` and
 * `DELETE /v1beta/files/{name}`. Errors use Google's body. The same stored files as the other Files APIs: `files/<hex>` names
 * the file whose id is `file-<hex>`.
 *
 * Upload protocols. Both Gemini SDKs (`@google/genai`, `google-genai`) upload with the resumable protocol, so that is served:
 * a `start` request (JSON metadata, `X-Goog-Upload-Header-*` headers) answers an `X-Goog-Upload-URL`; the bytes then go to that
 * URL as `upload` chunks, the last one with `finalize`, whose answer carries the file and `X-Goog-Upload-Status: final`. An
 * unfinished upload is held in memory (`SESSIONS`, at most 4 per app, 10 minutes, never more than the app's file cap), under
 * an unguessable id that belongs to one app. `uploadType=multipart` (`multipart/related`, metadata then bytes) is served too.
 * `uploadType=media` is a 400.
 */
import type { IncomingMessage, ServerResponse } from "node:http"
import { clientOrigin, origin } from "../../discovery.js"
import { isPlugError, type PlugError } from "../../contract.js"
import { bodyLimits } from "../../config.js"
import { forwardedOrigin } from "../../forwarded.js"
import { BodyError, RequestAborted, bodyPlugError, readBody, readJsonBody, sendError, sendJson, type RequestScope } from "../../http.js"
import { encodeGeminiError } from "../../gemini/response.js"
import type { RouteHost } from "../../openai/route.js"
import { retentionDaysFor } from "../../responses/state.js"
import { cleanFilename, parseRelated } from "../multipart.js"
import { geminiFileId } from "../refs.js"
import type { FileRecord } from "../state.js"
import { encodeGeminiFile, intQuery, pageItems } from "../wire.js"
import { fileCap, storeUpload } from "../route.js"

export type GeminiFilesOp = "upload" | "list" | "get" | "delete"

export interface GeminiFilesRoute {
  readonly op: GeminiFilesOp
  readonly route: "POST /upload/v1beta/files" | "GET /v1beta/files" | "GET /v1beta/files/{name}" | "DELETE /v1beta/files/{name}"
  /** The name as the caller wrote it after `/v1beta/files/`. */
  readonly name?: string
}

const NAME_PATH = /^\/v1beta\/files\/([^/]+)$/

export function matchGeminiFilesRoute(method: string | undefined, path: string): GeminiFilesRoute | undefined {
  if (path === "/upload/v1beta/files") return method === "POST" ? { op: "upload", route: "POST /upload/v1beta/files" } : undefined
  if (path === "/v1beta/files") return method === "GET" ? { op: "list", route: "GET /v1beta/files" } : undefined
  const match = NAME_PATH.exec(path)
  if (!match) return undefined
  let name = match[1]!
  try {
    name = decodeURIComponent(name)
  } catch {}
  if (method === "GET") return { op: "get", route: "GET /v1beta/files/{name}", name }
  if (method === "DELETE") return { op: "delete", route: "DELETE /v1beta/files/{name}", name }
  return undefined
}

// ---- resumable uploads, held in memory until finalized

/**
 * The key a request carries, for the uploads it starts and the chunks it sends. `digest` is the digest of the credential that came with the
 * request when it is a key that is live now (undefined for a keyless server); `alive` says whether a digest is still a live key. An upload
 * stays good only while the key that started it does: a key revoked or rotated out ends its uploads.
 */
export interface UploadCredential {
  readonly digest: Buffer | undefined
  alive(digest: Buffer): boolean
}

interface UploadSession {
  readonly app: string
  /** The digest of the key that started the upload; absent on a keyless server. Never the key itself. */
  readonly keyDigest?: Buffer
  readonly filename: string
  readonly declaredType: string | undefined
  readonly startedAt: number
  readonly chunks: Buffer[]
  received: number
}

const SESSIONS_SLOT = Symbol.for("opencode-plugboard.upload-sessions/1")
const holder = globalThis as unknown as Record<symbol, Map<string, UploadSession> | undefined>
/** Unfinished resumable uploads, process-wide on `globalThis` under a versioned key (I6) so any generation can take the next chunk. */
const sessions = (): Map<string, UploadSession> => (holder[SESSIONS_SLOT] ??= new Map())
const MAX_SESSIONS_PER_APP = 4
const SESSION_TTL_MS = 10 * 60 * 1000
const SESSION_ID = /^[0-9a-f]{32}$/
const CHUNK_GRANULARITY = 8 * 1024 * 1024
/** How often the unfinished uploads past their 10 minutes are dropped when nothing else touches them. */
const SWEEP_EVERY_MS = 60 * 1000

/** Whether an upload is still good: inside its 10 minutes, and its key (when it had one) is still live. */
const usable = (session: UploadSession, alive: (digest: Buffer) => boolean): boolean =>
  session.startedAt >= Date.now() - SESSION_TTL_MS && (session.keyDigest === undefined || alive(session.keyDigest))

/**
 * The app that started the live resumable upload `id` names, or undefined for an unknown, malformed, expired id or one whose key is gone.
 * The upload url is a capability, as Google's is: google-genai (Python) sends its chunks without a key, so the unguessable id (122
 * random bits, one app, 10 minutes, the key that started it still live) stands for the key of the request that started it.
 * `src/openai/route.ts` uses this only for a chunk request that carries no key at all.
 */
export function uploadSessionApp(id: string | null, alive: (digest: Buffer) => boolean): string | undefined {
  const session = id !== null && SESSION_ID.test(id) ? sessions().get(id) : undefined
  if (session === undefined) return undefined
  if (usable(session, alive)) return session.app
  sessions().delete(id!)
  return undefined
}

/** Drops every upload that has outlived its 10 minutes. */
function sweepSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS
  for (const [id, session] of sessions()) if (session.startedAt < cutoff) sessions().delete(id)
}

const SWEEP_SLOT = Symbol.for("opencode-plugboard.upload-sweep/1")

/** One timer for the process (shared by every generation) drops expired uploads while any are held, and stops when there are none. */
function armSweep(): void {
  const slot = globalThis as unknown as Record<symbol, ReturnType<typeof setInterval> | undefined>
  if (slot[SWEEP_SLOT] !== undefined) return
  const timer = setInterval(() => {
    sweepSessions()
    if (sessions().size === 0) {
      clearInterval(timer)
      slot[SWEEP_SLOT] = undefined
    }
  }, SWEEP_EVERY_MS)
  timer.unref?.()
  slot[SWEEP_SLOT] = timer
}

const header = (request: IncomingMessage, name: string): string | undefined => {
  const value = request.headers[name]
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined
}

const bad = (message: string, code: string, param?: string): PlugError => ({ status: 400, kind: "invalid_request", code, ...(param === undefined ? {} : { param }), message })

export interface GeminiFilesCall {
  readonly app: string
  readonly match: GeminiFilesRoute
  readonly request: IncomingMessage
  readonly url: URL
  readonly response: ServerResponse
  readonly scope: RequestScope
  readonly credential: UploadCredential
}

export async function serveGeminiFiles(host: RouteHost, { app, match, request, url, response, scope, credential }: GeminiFilesCall): Promise<void> {
  const fail = (error: PlugError, close = false) => sendError(response, error, encodeGeminiError(error), { close })
  const days = retentionDaysFor(host.options, app)
  // The address the caller reached: a trusted proxy's public origin, else the request's Host on a wildcard bind (a client cannot call `0.0.0.0`), else the listen address.
  const client = clientOrigin(host.options.listen, forwardedOrigin(request, host.options.listen.trustProxy), request.headers.host)
  const base = client.placeholder ? origin(host.options.listen) : client.origin
  const encode = (record: FileRecord): object => encodeGeminiFile(record, days, base)
  const notFound = (name: string) => fail({ status: 404, kind: "not_found", message: `File ${name.slice(0, 80)} was not found` })

  const finish = async (upload: { bytes: Uint8Array; declaredType: string | undefined; filename: string }) => {
    const stored = await scope.race(storeUpload(host, app, { ...upload, purpose: "user_data" }, scope.signal))
    return stored
  }

  async function resumable(): Promise<void> {
    // Any request to this route drops the uploads that have expired, so held bytes do not wait for the next upload to start.
    sweepSessions()
    const command = (header(request, "x-goog-upload-command") ?? "").toLowerCase()
    const uploadId = url.searchParams.get("upload_id")
    if (uploadId === null) {
      if (command !== "start") return fail(bad("Resumable upload: send X-Goog-Upload-Command: start first, or use uploadType=multipart", "invalid_upload_command", "X-Goog-Upload-Command"))
      const meta = await readJsonBody(request, scope.signal, bodyLimits(host.options, app, host.keys?.appNames()))
      const file = typeof meta === "object" && meta !== null && typeof (meta as { file?: unknown }).file === "object" ? ((meta as { file: Record<string, unknown> }).file ?? {}) : {}
      const size = Number(header(request, "x-goog-upload-header-content-length"))
      const cap = fileCap(host, app)
      if (Number.isFinite(size) && size > cap) return fail({ status: 413, kind: "invalid_request", code: "file_too_large", message: `The file is larger than this app's limit of ${cap} bytes` })
      sweepSessions()
      const mine = [...sessions().values()].filter((session) => session.app === app).length
      if (mine >= MAX_SESSIONS_PER_APP)
        return fail({ status: 429, kind: "rate_limit", code: "too_many_uploads", message: "Too many unfinished uploads; finish or wait for them to expire", retryAfterSeconds: 30 })
      const id = crypto.randomUUID().replaceAll("-", "")
      // Google's JSON is camelCase, and the Python SDK sends snake_case (`display_name`).
      const named = file.displayName ?? file.display_name
      const displayName = typeof named === "string" ? named : (header(request, "x-goog-upload-file-name") ?? undefined)
      sessions().set(id, {
        app,
        ...(credential.digest === undefined ? {} : { keyDigest: credential.digest }),
        filename: cleanFilename(displayName),
        declaredType: header(request, "x-goog-upload-header-content-type") ?? (typeof (file.mimeType ?? file.mime_type) === "string" ? ((file.mimeType ?? file.mime_type) as string) : undefined),
        startedAt: Date.now(),
        chunks: [],
        received: 0,
      })
      armSweep()
      response.setHeader("x-goog-upload-status", "active")
      response.setHeader("x-goog-upload-url", `${base}/upload/v1beta/files?upload_id=${id}&upload_protocol=resumable`)
      response.setHeader("x-goog-upload-chunk-granularity", String(CHUNK_GRANULARITY))
      return sendJson(response, 200, {})
    }

    // Another app's upload id is the same miss as an unknown or expired one (I33).
    const session = SESSION_ID.test(uploadId) ? sessions().get(uploadId) : undefined
    if (session === undefined || session.app !== app || !usable(session, credential.alive)) {
      if (session !== undefined && session.app === app) sessions().delete(uploadId)
      return fail({ status: 404, kind: "not_found", message: "The upload was not found or has expired; start it again" })
    }
    const commands = command.split(",").map((part) => part.trim())
    if (commands.includes("cancel")) {
      sessions().delete(uploadId)
      response.setHeader("x-goog-upload-status", "cancelled")
      return sendJson(response, 200, {})
    }
    if (commands.includes("query")) {
      response.setHeader("x-goog-upload-status", "active")
      response.setHeader("x-goog-upload-size-received", String(session.received))
      return sendJson(response, 200, {})
    }
    if (!commands.includes("upload") && !commands.includes("finalize"))
      return fail(bad("X-Goog-Upload-Command must be upload, finalize, query or cancel", "invalid_upload_command", "X-Goog-Upload-Command"))

    const cap = fileCap(host, app)
    const chunk = await readBody(request, scope.signal, bodyLimits(host.options, app, host.keys?.appNames()))
    // The chunk goes where the last one ended; anything else is a client that lost track.
    const offset = Number(header(request, "x-goog-upload-offset") ?? session.received)
    if (offset !== session.received)
      return fail(bad(`X-Goog-Upload-Offset ${header(request, "x-goog-upload-offset")} does not match the ${session.received} bytes received`, "invalid_upload_offset", "X-Goog-Upload-Offset"))
    if (session.received + chunk.length > cap) {
      sessions().delete(uploadId)
      return fail({ status: 413, kind: "invalid_request", code: "file_too_large", message: `The file is larger than this app's limit of ${cap} bytes` })
    }
    // A chunk with no bytes adds nothing: the list holds the bytes sent, never a count of requests.
    if (chunk.length > 0) session.chunks.push(chunk)
    session.received += chunk.length
    if (!commands.includes("finalize")) {
      response.setHeader("x-goog-upload-status", "active")
      response.setHeader("x-goog-upload-size-received", String(session.received))
      return sendJson(response, 200, {})
    }
    sessions().delete(uploadId)
    const stored = await finish({ bytes: Buffer.concat(session.chunks), declaredType: session.declaredType, filename: session.filename })
    if (isPlugError(stored)) return fail(stored)
    response.setHeader("x-goog-upload-status", "final")
    return sendJson(response, 200, { file: encode(stored) })
  }

  async function multipart(): Promise<void> {
    const body = await readBody(request, scope.signal, bodyLimits(host.options, app, host.keys?.appNames()))
    const parsed = parseRelated(request.headers["content-type"], body)
    if (isPlugError(parsed)) return fail(parsed)
    const meta = typeof parsed.metadata === "object" && parsed.metadata !== null ? ((parsed.metadata as { file?: unknown }).file ?? parsed.metadata) : {}
    const displayName = typeof meta === "object" && meta !== null ? ((meta as { displayName?: unknown }).displayName ?? (meta as { display_name?: unknown }).display_name) : undefined
    const stored = await finish({ bytes: parsed.bytes, declaredType: parsed.declaredType, filename: cleanFilename(typeof displayName === "string" ? displayName : undefined) })
    if (isPlugError(stored)) return fail(stored)
    return sendJson(response, 200, { file: encode(stored) })
  }

  async function run(): Promise<void> {
    if (match.op === "upload") {
      const protocol = (header(request, "x-goog-upload-protocol") ?? url.searchParams.get("upload_protocol") ?? "").toLowerCase()
      const type = url.searchParams.get("uploadType")
      if (protocol === "resumable" || type === "resumable" || url.searchParams.has("upload_id")) return resumable()
      if (protocol === "multipart" || type === "multipart") return multipart()
      return fail(
        bad("Upload with the resumable protocol (what the Gemini SDKs do) or uploadType=multipart (multipart/related); uploadType=media is not supported", "unsupported_upload_protocol", "uploadType"),
      )
    }
    if (match.op === "list") {
      const size = intQuery(url.searchParams, "pageSize", { min: 1, max: 100, fallback: 10 }, "pageSize")
      if (isPlugError(size)) return fail(size)
      const ids = (await scope.race(host.files.ids(app, days))).map((id) => ({ id }))
      const token = url.searchParams.get("pageToken") ?? undefined
      const paged = pageItems(ids, size, { after: token })
      if (!paged) return fail(bad("pageToken is not valid", "invalid_page_token", "pageToken"))
      const records = (await scope.race(Promise.all(paged.page.map((item) => host.files.head(app, item.id, days))))).filter((record): record is FileRecord => record !== undefined)
      return sendJson(response, 200, { ...(records.length > 0 ? { files: records.map(encode) } : {}), ...(paged.hasMore ? { nextPageToken: paged.page.at(-1)!.id } : {}) })
    }
    const name = match.name!
    const id = geminiFileId(`files/${name}`)
    if (match.op === "delete") {
      if (id === undefined || !(await scope.race(host.files.remove(app, id)))) return notFound(`files/${name}`)
      return sendJson(response, 200, {})
    }
    const record = id === undefined ? undefined : await scope.race(host.files.head(app, id, days))
    if (record === undefined) return notFound(`files/${name}`)
    return sendJson(response, 200, encode(record))
  }

  try {
    await run()
  } catch (caught) {
    if (!response.headersSent) {
      if (caught instanceof BodyError) fail(bodyPlugError(caught), caught.status !== 400)
      else if (caught instanceof RequestAborted) {
        if (caught.kind === "timeout") fail(scope.timeoutError, true)
      } else fail({ status: 500, kind: "server", message: "Internal server error" })
    }
    throw caught
  }
}
