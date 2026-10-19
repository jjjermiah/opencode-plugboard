/**
 * What an uploaded file is, decided from its bytes and never from what the caller declared (since next).
 *
 * Plugboard keeps only what it can send to a model exactly as the inline forms do today (`src/image.ts`):
 * a PNG, JPEG, GIF or WebP image, a PDF (both told by their first bytes), and text. Text has no signature, so it is
 * accepted only when the caller also declared a text type (`text/*`, `application/json`) or named it with a text
 * extension, and the bytes are valid UTF-8 with no NUL (JSON must parse). Anything else is refused at upload with a
 * message that names the accepted kinds, so a file never fails later in a request.
 *
 * Pure: no node imports beyond the `Buffer` global.
 */

/** Text and JSON files reach the model as text, so they are held to a smaller size than an image or a PDF. */
export const MAX_TEXT_BYTES = 4 * 1024 * 1024

export const ACCEPTED = "PNG, JPEG, GIF and WebP images, PDF files, and text files (text/* or JSON, as UTF-8)"

export type FileKind = "image" | "pdf" | "text"

export const kindOf = (mime: string): FileKind => (mime.startsWith("image/") ? "image" : mime === "application/pdf" ? "pdf" : "text")

const latin1 = (head: Uint8Array, from: number, to: number) => Buffer.from(head.subarray(from, to)).toString("latin1")

/** The image type the first bytes show, or undefined. */
function imageMime(head: Uint8Array): string | undefined {
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png"
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg"
  if (latin1(head, 0, 4) === "GIF8") return "image/gif"
  if (latin1(head, 0, 4) === "RIFF" && latin1(head, 8, 12) === "WEBP") return "image/webp"
  return undefined
}

const TEXT_EXTENSIONS: Readonly<Record<string, string>> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  xml: "text/xml",
  html: "text/html",
  htm: "text/html",
  yaml: "text/yaml",
  yml: "text/yaml",
  log: "text/plain",
}

const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/

/** The declared type without parameters, lowercased; undefined when it is empty or malformed. */
export function baseType(declared: string | undefined): string | undefined {
  const base = declared?.split(";")[0]?.trim().toLowerCase()
  return base !== undefined && MIME.test(base) ? base : undefined
}

export type Detected = { readonly mime: string } | { readonly problem: string }

/** The stored type of `bytes`, or why it is refused. `declared` and `filename` only decide whether text is acceptable. */
export function detectFile(bytes: Uint8Array, declared: string | undefined, filename: string | undefined): Detected {
  if (bytes.length === 0) return { problem: "The file is empty" }
  const image = imageMime(bytes)
  if (image !== undefined) return { mime: image }
  if (latin1(bytes, 0, 4) === "%PDF") return { mime: "application/pdf" }

  const type = baseType(declared)
  const extension = filename?.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase() : undefined
  const named = extension === undefined ? undefined : TEXT_EXTENSIONS[extension]
  const unspecified = type === undefined || type === "application/octet-stream" || type === "binary/octet-stream"
  // A declared image or PDF type that the bytes do not show is refused, not stored as text.
  const textual = type !== undefined && (type.startsWith("text/") || type === "application/json") ? type : unspecified ? named : undefined
  if (textual === undefined) return { problem: `Unsupported file type: accepted files are ${ACCEPTED}` }
  if (bytes.length > MAX_TEXT_BYTES) return { problem: `Text files are limited to ${MAX_TEXT_BYTES / (1024 * 1024)} MiB because they are sent to the model as text` }
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return { problem: "The file is not valid UTF-8 text" }
  }
  if (text.includes("\u0000")) return { problem: "The file is not text: it contains NUL bytes" }
  if (textual === "application/json") {
    try {
      JSON.parse(text)
    } catch {
      return { problem: "The file is not valid JSON" }
    }
  }
  return { mime: textual }
}
