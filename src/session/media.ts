/**
 * Bounded attachment preparation: request images become prompt files.
 *
 * Prompt files must be inline `data:` URLs. http(s) images are fetched once, only when the
 * `remoteImages` option is on, with no redirects, a 20 s timeout and a 20 MB cap. All images of
 * one request together may hold at most 50 MB (`images_too_large`), data URLs and fetched ones alike.
 */

import type { PlugRequest } from "../contract.js"

const MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024
/** Aggregate size of the prepared data URLs of one request. */
const MAX_TOTAL_IMAGE_BYTES = 50 * 1024 * 1024
const TOO_MANY = () => new ImageError("images_too_large", "The request's images are larger than 50 MB in total")

/** What one request's images may still use, in data URL characters (== bytes held). */
interface Budget {
  remaining: number
}

/** A caller image that cannot be used; `code` becomes the error code of the 400 response. */
export class ImageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function toDataUrl(url: string, signal: AbortSignal, remoteImages: boolean, budget: Budget): Promise<string> {
  if (url.startsWith("data:")) {
    if (url.length > budget.remaining) throw TOO_MANY()
    return url
  }
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
  // The data URL is 4/3 of the raw size plus a short prefix: stop reading once it cannot fit the budget.
  const budgetRaw = Math.floor((budget.remaining * 3) / 4)
  const limit = Math.min(MAX_REMOTE_IMAGE_BYTES, budgetRaw)
  const tooLarge = () => (limit < MAX_REMOTE_IMAGE_BYTES ? TOO_MANY() : new ImageError("image_too_large", "Image is larger than 20 MB"))
  if (Number.isFinite(declared) && declared > limit) throw tooLarge()
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body?.getReader()
  if (!reader) throw new ImageError("invalid_image", "Image response had no body")
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      void reader.cancel().catch(() => {})
      throw tooLarge()
    }
    chunks.push(value)
  }
  const dataUrl = `data:${mediaType};base64,${Buffer.concat(chunks).toString("base64")}`
  if (dataUrl.length > budget.remaining) throw TOO_MANY()
  return dataUrl
}

/** Prompt files for every image in the request, in message order, named `image-1`, `image-2`, ... Throws `ImageError`. */
export async function prepareImages(
  request: PlugRequest,
  signal: AbortSignal,
  remoteImages: boolean,
): Promise<Array<{ uri: string; name: string }>> {
  const images: Array<{ uri: string; name: string }> = []
  const budget: Budget = { remaining: MAX_TOTAL_IMAGE_BYTES }
  for (const message of request.messages)
    for (const part of message.content)
      if (part.type === "media") {
        signal.throwIfAborted()
        const uri = await toDataUrl(part.url, signal, remoteImages, budget)
        budget.remaining -= uri.length
        images.push({ uri, name: `image-${images.length + 1}` })
      }
  return images
}
