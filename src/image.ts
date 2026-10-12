/**
 * The check every image part of a request gets in its decoder (#286), so a caller's bad image is a 400
 * before any session, preparation or budget work. Only `data:` URLs are checked here: a `data:` image must
 * carry an `image/*` media type, well-formed base64, and bytes that start with a PNG, JPEG, GIF or WebP
 * signature (the formats the providers take). Any other URL is not checked here; remote images are checked
 * when they are fetched (src/session/media.ts).
 *
 * Pure: no node imports. `Buffer` is the global, and only the first 12 decoded bytes are read.
 */

const DATA_URL = /^data:([^,]*);base64,(.*)$/s
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/** The image signatures plugboard accepts, checked on the first bytes of the decoded data. */
const SIGNATURES: ReadonlyArray<(head: Buffer) => boolean> = [
  (head) => head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47,
  (head) => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
  (head) => head.subarray(0, 4).toString("latin1") === "GIF8",
  (head) => head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP",
]

/** The message for a `data:` image URL that cannot be sent to a provider, or undefined when it can (or is not a data URL). */
export function imageProblem(url: string): string | undefined {
  if (!url.startsWith("data:")) return undefined
  const match = DATA_URL.exec(url)
  if (!match) return "Image data URL must be base64 encoded, for example data:image/png;base64,..."
  const mediaType = match[1]!.split(";")[0]!.trim().toLowerCase()
  if (!mediaType.startsWith("image/")) return "Image data URL must have an image/* media type"
  const data = match[2]!
  if (data.length === 0) return "Image data URL has no data"
  if (!BASE64.test(data) || data.length % 4 === 1) return "Image data URL is not valid base64"
  // 16 base64 characters decode to the 12 bytes the signatures need.
  const head = Buffer.from(data.slice(0, 16), "base64")
  return SIGNATURES.some((matches) => matches(head)) ? undefined : "Image data URL is not a PNG, JPEG, GIF or WebP image"
}
