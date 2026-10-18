/**
 * File references in a request body (since next): the one place that knows where each API names an uploaded file.
 *
 *   Chat Completions  `{"type":"file","file":{"file_id"}}`           in `messages[].content[]`
 *   Responses         `{"type":"input_file"|"input_image","file_id"}`  in `input[].content[]`
 *   Anthropic         `{"type":"image"|"document","source":{"type":"file","file_id"}}`  in `messages[].content[]` (and `tool_result` content)
 *   Gemini            `{"fileData":{"fileUri"}}`                      in `contents[].parts[]`; `files/<id>`, or the `uri` an upload returned
 *
 * The route does the I/O. It calls `fileRefs` to learn which ids a body names, loads them under the caller's own app (I33), and
 * calls `inlineFiles`, which returns the body with each reference replaced by the inline form that API already accepts (an image
 * `data:` URL, a PDF `data:` URL or a base64 document, or a text part). The decoders then validate and send the file exactly as they
 * do inline data, so a file reaches the model the same way, and the decoders stay pure (I20).
 *
 * Pure: no node imports beyond the `Buffer` global.
 */
import { isPlugError, type PlugError } from "../contract.js"
import { kindOf, type FileKind } from "./content.js"

type Json = Record<string, unknown>
export type FileApi = "chat" | "responses" | "messages" | "gemini"

/** A stored file as the rewrite needs it: its type and its bytes as base64. */
export interface InlineFile {
  readonly mime: string
  readonly base64: string
}

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)

/** The most distinct files one request may name. */
export const MAX_REFS = 32

const GEMINI_NAME = /^files\/(?:file-)?([0-9a-f]{32})$/
const GEMINI_URI = /^https?:\/\/[^/?#]+\/(?:v1beta|v1)\/files\/(?:file-)?([0-9a-f]{32})$/i

/** The plugboard file id a Gemini `fileUri` names (`files/<hex>` or the uri an upload returned), or undefined for any other uri. */
export function geminiFileId(uri: string): string | undefined {
  const hex = GEMINI_NAME.exec(uri)?.[1] ?? GEMINI_URI.exec(uri)?.[1]
  return hex === undefined ? undefined : `file-${hex.toLowerCase()}`
}

/** The id of a reference in `part`, or undefined when the part names no file. `gemini` ids come from `geminiFileId`. */
function refOf(api: FileApi, part: Json): string | undefined {
  switch (api) {
    case "chat":
      return part.type === "file" && isRecord(part.file) && typeof part.file.file_id === "string" ? part.file.file_id : undefined
    case "responses":
      return (part.type === "input_file" || part.type === "input_image") && typeof part.file_id === "string" ? part.file_id : undefined
    case "messages":
      return (part.type === "image" || part.type === "document") && isRecord(part.source) && part.source.type === "file" && typeof part.source.file_id === "string"
        ? part.source.file_id
        : undefined
    case "gemini": {
      const file = part.fileData ?? part.file_data
      const uri = isRecord(file) ? (file.fileUri ?? file.file_uri) : undefined
      return typeof uri === "string" ? geminiFileId(uri) : undefined
    }
  }
}

/** The part arrays of a body, each visited by `visit`; a replaced array is a copy and the body is never mutated. */
function mapParts(api: FileApi, body: unknown, visit: (part: Json) => Json | PlugError | undefined): unknown {
  if (!isRecord(body)) return body
  const list = (items: unknown, key: string): unknown => {
    if (!Array.isArray(items)) return items
    let changed = false
    const out: unknown[] = []
    for (const item of items) {
      if (!isRecord(item)) {
        out.push(item)
        continue
      }
      const next = parts(item[key])
      if (isPlugError(next)) return next
      if (next !== item[key]) {
        changed = true
        out.push({ ...item, [key]: next })
      } else out.push(item)
    }
    return changed ? out : items
  }
  const parts = (content: unknown): unknown => {
    if (!Array.isArray(content)) return content
    let changed = false
    const out: unknown[] = []
    for (const part of content) {
      if (!isRecord(part)) {
        out.push(part)
        continue
      }
      const replaced = visit(part)
      if (replaced !== undefined) {
        if (isPlugError(replaced)) return replaced
        changed = true
        out.push(replaced)
        continue
      }
      // Anthropic: a tool_result's content blocks may be images or documents too.
      const nested = api === "messages" && part.type === "tool_result" ? parts(part.content) : undefined
      if (nested !== undefined && isPlugError(nested)) return nested
      if (nested !== undefined && nested !== part.content) {
        changed = true
        out.push({ ...part, content: nested })
      } else out.push(part)
    }
    return changed ? out : content
  }
  const field = api === "chat" || api === "messages" ? "messages" : api === "responses" ? "input" : "contents"
  const key = api === "gemini" ? "parts" : "content"
  const mapped = list(body[field], key)
  if (mapped === body[field]) return body
  if (isPlugError(mapped)) return mapped
  return { ...body, [field]: mapped }
}

/** The distinct file ids the bodies name, in order. */
export function fileRefs(api: FileApi, ...bodies: ReadonlyArray<unknown>): string[] {
  const ids = new Set<string>()
  for (const body of bodies)
    mapParts(api, api === "responses" && Array.isArray(body) ? { input: body } : body, (part) => {
      const id = refOf(api, part)
      if (id !== undefined) ids.add(id)
      return undefined
    })
  return [...ids]
}

/** Replacement parts made by `inlineFiles`, mapped to the reference they replaced: a stored response keeps the reference, not the bytes. */
const ORIGINALS = new WeakMap<object, Json>()

const dataUrl = (file: InlineFile) => `data:${file.mime};base64,${file.base64}`
const textOf = (file: InlineFile) => Buffer.from(file.base64, "base64").toString("utf8")

const notFound = (id: string, field: string): PlugError => ({ status: 404, kind: "not_found", code: "file_not_found", param: field, message: `File '${id.slice(0, 80)}' not found` })

function replacement(api: FileApi, part: Json, id: string, file: InlineFile, kind: FileKind): Json | PlugError {
  const wrong = (expected: string): PlugError => ({ status: 400, kind: "invalid_request", code: "invalid_file", message: `File '${id.slice(0, 80)}' is a ${file.mime} file, which cannot be used as ${expected}` })
  switch (api) {
    case "chat":
      if (kind === "image") return { type: "image_url", image_url: { url: dataUrl(file) } }
      if (kind === "pdf") return { type: "file", file: { file_data: dataUrl(file), ...(isRecord(part.file) && typeof part.file.filename === "string" ? { filename: part.file.filename } : {}) } }
      return { type: "text", text: textOf(file) }
    case "responses":
      if (part.type === "input_image") return kind === "image" ? { type: "input_image", image_url: dataUrl(file) } : wrong("an input_image")
      if (kind === "text") return { type: "input_text", text: textOf(file) }
      return kind === "pdf" ? { type: "input_file", file_data: dataUrl(file) } : { type: "input_image", image_url: dataUrl(file) }
    case "messages": {
      // The block keeps its other fields (`cache_control`, `title`, `citations`); only the source changes.
      const block = { ...part }
      if (part.type === "image") {
        if (kind !== "image") return wrong("an image block")
        block.source = { type: "base64", media_type: file.mime, data: file.base64 }
      } else if (kind === "pdf") block.source = { type: "base64", media_type: file.mime, data: file.base64 }
      else if (kind === "text") block.source = { type: "text", media_type: "text/plain", data: textOf(file) }
      else return wrong("a document block")
      return block
    }
    case "gemini":
      if (kind === "text") return { text: textOf(file) }
      return { inlineData: { mimeType: file.mime, data: file.base64 } }
  }
}

/**
 * The body with every file reference replaced by the inline form of the file it names. `files` holds each id the route could
 * load under the caller's app; an id missing there is a 404 `file_not_found` (the same for an unknown, deleted, expired or
 * another app's file, I33). A body with no reference is returned as it came, with no copy.
 */
export function inlineFiles<T>(api: FileApi, body: T, files: ReadonlyMap<string, InlineFile>): T | PlugError {
  const result = mapParts(api, body, (part) => {
    const id = refOf(api, part)
    if (id === undefined) return undefined
    const file = files.get(id)
    if (file === undefined) return notFound(id, api === "gemini" ? "fileData.fileUri" : api === "chat" ? "file.file_id" : api === "messages" ? "source.file_id" : "file_id")
    const out = replacement(api, part, id, file, kindOf(file.mime))
    if (!isPlugError(out)) ORIGINALS.set(out, part)
    return out
  })
  return result as T | PlugError
}

/** Responses input items with the parts `inlineFiles` made put back as the references they came from (a stored response keeps `file_id`, not bytes). */
export function restoreFileRefs(items: ReadonlyArray<Json>): Json[] {
  return items.map((item) => {
    if (!Array.isArray(item.content)) return item
    let changed = false
    const content = item.content.map((part: unknown) => {
      const original = typeof part === "object" && part !== null ? ORIGINALS.get(part) : undefined
      if (original !== undefined) changed = true
      return original ?? part
    })
    return changed ? { ...item, content } : item
  })
}
