/**
 * Upload bodies (since next). The body is read whole under the request body admission (`readBody` in `src/http.ts`, I28), so
 * parsing it never reads more than the app's body cap. `multipart/form-data` (OpenAI and Anthropic) is parsed by the runtime's
 * own `Response.formData()`; `multipart/related` (Gemini's `uploadType=multipart`: a JSON part, then the media part) has no
 * runtime parser, so a small splitter reads it.
 */
import type { PlugError } from "../contract.js"

export interface FormUpload {
  readonly filename: string
  /** The Content-Type of the file part as the caller declared it; never trusted (`detectFile`). */
  readonly declaredType: string | undefined
  readonly bytes: Uint8Array
  /** The text fields of the form (`purpose`, ...). */
  readonly fields: ReadonlyMap<string, string>
}

const bad = (message: string, code = "invalid_file_upload"): PlugError => ({ status: 400, kind: "invalid_request", code, message })

/** The final path component of a caller's file name, without control characters, at most 255 characters; `unnamed` when nothing is left. */
export function cleanFilename(raw: string | undefined): string {
  const last = (raw ?? "").split(/[\\/]/).pop() ?? ""
  // eslint-disable-next-line no-control-regex
  const name = last.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255)
  return name.length > 0 ? name : "unnamed"
}

/** The `file` part (and the text fields) of a `multipart/form-data` body. */
export async function parseFormUpload(contentType: string | undefined, body: Uint8Array): Promise<FormUpload | PlugError> {
  if (contentType === undefined || !/^multipart\/form-data\s*;/i.test(contentType))
    return { status: 400, kind: "invalid_request", code: "unsupported_media_type", message: "Content-Type must be multipart/form-data with a file part" }
  const form = await new Response(body, { headers: { "content-type": contentType } }).formData().catch(() => undefined)
  if (form === undefined) return bad("The multipart body could not be read")
  const fields = new Map<string, string>()
  let file: File | undefined
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") {
      if (!fields.has(name)) fields.set(name, value)
    } else if (name === "file" && file === undefined) file = value
  }
  if (file === undefined) return bad("A file part named `file` is required")
  return { filename: cleanFilename(file.name), declaredType: file.type || undefined, bytes: new Uint8Array(await file.arrayBuffer()), fields }
}

export interface RelatedUpload {
  /** The first part, parsed as JSON (Gemini's file metadata), or `{}` when it is empty. */
  readonly metadata: unknown
  readonly declaredType: string | undefined
  readonly bytes: Uint8Array
}

const CRLF = Buffer.from("\r\n")
const HEADER_END = Buffer.from("\r\n\r\n")

/** The two parts of a `multipart/related` body: JSON metadata, then the file bytes. */
export function parseRelated(contentType: string | undefined, body: Buffer): RelatedUpload | PlugError {
  const boundary = contentType === undefined ? undefined : /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)?.slice(1).find((value) => value !== undefined)
  if (boundary === undefined || !/^multipart\/related/i.test(contentType ?? "")) return bad("Content-Type must be multipart/related with a boundary", "unsupported_media_type")
  const delimiter = Buffer.from(`--${boundary}`)
  const parts: Array<{ headers: string; content: Buffer }> = []
  let at = body.indexOf(delimiter)
  while (at >= 0) {
    let start = at + delimiter.length
    // `--` after a delimiter closes the body.
    if (body.subarray(start, start + 2).toString("latin1") === "--") break
    if (body.subarray(start, start + 2).equals(CRLF)) start += 2
    const next = body.indexOf(Buffer.concat([CRLF, delimiter]), start)
    if (next < 0) return bad("The multipart body is not terminated", "invalid_file_upload")
    const part = body.subarray(start, next)
    const split = part.indexOf(HEADER_END)
    // A part with no headers starts right at its content.
    parts.push(split < 0 ? { headers: "", content: part.subarray(part.subarray(0, 2).equals(CRLF) ? 2 : 0) } : { headers: part.subarray(0, split).toString("latin1"), content: part.subarray(split + 4) })
    at = next + 2
  }
  if (parts.length !== 2) return bad("A multipart/related upload has two parts: the file metadata (JSON), then the file")
  const [meta, media] = parts as [(typeof parts)[number], (typeof parts)[number]]
  let metadata: unknown = {}
  try {
    if (meta.content.length > 0) metadata = JSON.parse(meta.content.toString("utf8"))
  } catch {
    return bad("The first part of the upload is not valid JSON")
  }
  const type = /^content-type:\s*([^\r\n]+)/im.exec(media.headers)?.[1]?.trim()
  return { metadata, declaredType: type, bytes: new Uint8Array(media.content) }
}
