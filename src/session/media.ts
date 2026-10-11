/**
 * Bounded attachment preparation: request images become prompt files.
 *
 * Prompt files must be inline `data:` URLs. http(s) images are fetched once, only when the
 * `remoteImages` option is on, with no redirects, a 20 s timeout and a 20 MB cap.
 */

import type { PlugRequest } from "../contract.js"

const MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024

/** A caller image that cannot be used; `code` becomes the error code of the 400 response. */
export class ImageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function toDataUrl(url: string, signal: AbortSignal, remoteImages: boolean): Promise<string> {
  if (url.startsWith("data:")) return url
  if (!/^https?:\/\//i.test(url)) throw new ImageError("unsupported_image_url", "Unsupported image URL scheme; use a data: URL or an http(s) URL")
  if (!remoteImages)
    throw new ImageError("remote_images_disabled", "Remote image URLs are disabled; send a data: URL or set the plugboard `remoteImages` option")
  // Messages never carry the URL or the fetch error text: both can hold credentials in the query string.
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) }).catch((error: unknown) => {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "network error"
    throw new ImageError("image_fetch_failed", `Could not fetch image (${reason})`)
  })
  if (!response.ok) throw new ImageError("image_fetch_failed", `Could not fetch image (HTTP ${response.status})`)
  const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? ""
  if (!mediaType.startsWith("image/")) throw new ImageError("invalid_image", `URL did not return an image (content-type: ${mediaType || "none"})`)
  const declared = Number(response.headers.get("content-length"))
  const tooLarge = () => new ImageError("image_too_large", "Image is larger than 20 MB")
  if (Number.isFinite(declared) && declared > MAX_REMOTE_IMAGE_BYTES) throw tooLarge()
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body?.getReader()
  if (!reader) throw new ImageError("invalid_image", "Image response had no body")
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_REMOTE_IMAGE_BYTES) {
      void reader.cancel().catch(() => {})
      throw tooLarge()
    }
    chunks.push(value)
  }
  return `data:${mediaType};base64,${Buffer.concat(chunks).toString("base64")}`
}

/** Prompt files for every image in the request, in message order, named `image-1`, `image-2`, ... Throws `ImageError`. */
export async function prepareImages(
  request: PlugRequest,
  signal: AbortSignal,
  remoteImages: boolean,
): Promise<Array<{ uri: string; name: string }>> {
  const images: Array<{ uri: string; name: string }> = []
  for (const message of request.messages)
    for (const part of message.content)
      if (part.type === "media") images.push({ uri: await toDataUrl(part.url, signal, remoteImages), name: `image-${images.length + 1}` })
  return images
}
