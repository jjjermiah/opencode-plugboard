/**
 * Bounded attachment preparation: request images become prompt files.
 *
 * Prompt files must be inline `data:` URLs. http(s) images are fetched once, only when the
 * `remoteImages` option is on. By default: no redirects, a 20 s timeout and a 20 MB cap; the object
 * form of the option tightens each of them (#259, see `RemoteImages`). All images of
 * one request together may hold at most 50 MB (`images_too_large`), data URLs and fetched ones alike.
 *
 * A remote fetch is a request the server makes on a caller's behalf, so it must not reach the
 * server's own network (#84): the host is resolved first, every address it resolves to must be a
 * public one (loopback, private, link-local, CGNAT, ULA, multicast, reserved and mapped or
 * translated forms of those are refused) unless the operator's `remoteImages.allow` list names the
 * host or the address, and the request then connects to the addresses that were checked (tried in
 * order until one accepts), not to the name, so a second DNS answer cannot redirect it (DNS
 * rebinding). Addresses are classified by ipaddr.js. The caller sees one generic error for every
 * fetch failure, whatever the cause.
 */

import { lookup } from "node:dns/promises"
import { request as httpRequest, type IncomingMessage } from "node:http"
import { request as httpsRequest } from "node:https"
import { isIP } from "node:net"
import ipaddr from "ipaddr.js"
import type { PlugRequest } from "../contract.js"
import { log } from "../log.js"

const MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024
/** Aggregate size of the prepared data URLs of one request. */
const MAX_TOTAL_IMAGE_BYTES = 50 * 1024 * 1024
const FETCH_TIMEOUT_MS = 20_000
const TOO_MANY = () => new ImageError("images_too_large", "The request's images are larger than 50 MB in total")
/** The one message for every failed fetch (blocked address, DNS, refused, timeout, bad status): no oracle for the server's network. */
const FETCH_FAILED = () => new ImageError("image_fetch_failed", "Could not fetch image")

/** What one request's images may still use, in data URL characters (== bytes held). */
interface Budget {
  remaining: number
}

/**
 * The `remoteImages` option as the session caller receives it. `false` is off. `true` is on with the defaults: public
 * addresses only, no redirects, 20 MB per image, 20 s. The object form is on too, and each field tightens the fetch
 * (#259): `allow` names hosts, addresses or CIDR ranges that may be fetched when they are not public; `schemes` lists the
 * URL schemes (`http`, `https`); `maxBytes` caps one image; `maxItems` caps the remote URLs of one request; `maxRedirects`
 * follows that many redirects, each target checked like the first URL; `timeoutMs` bounds one fetch.
 */
export type RemoteImages = boolean | RemoteImageOptions

export interface RemoteImageOptions {
  readonly allow?: ReadonlyArray<string>
  readonly schemes?: ReadonlyArray<string>
  readonly maxBytes?: number
  readonly maxItems?: number
  readonly maxRedirects?: number
  readonly timeoutMs?: number
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

// ---- addresses

type Ip = ipaddr.IPv4 | ipaddr.IPv6

/** Strict dotted IPv4 or any IPv6 text form (compressed, with an embedded IPv4 tail, with a zone). Odd IPv4 spellings (`0x7f.1`) never get here: a URL host is normalized by `new URL` first. */
function parseIp(text: string): Ip | undefined {
  if (isIP(text) === 0) return undefined
  try {
    return ipaddr.parse(text)
  } catch {
    return undefined
  }
}

/** `address/bits` match; false for another family (ipaddr.js throws on one). */
const inNet = (ip: Ip, net: Ip, bits: number): boolean => ip.kind() === net.kind() && ip.match(net, bits)

const NAT64 = ipaddr.IPv6.parseCIDR("64:ff9b::/96")
/** `::/96`: unspecified, loopback and the deprecated IPv4-compatible form (`::7f00:1`), which ipaddr.js calls unicast. */
const IPV4_COMPATIBLE = ipaddr.IPv6.parseCIDR("::/96")

const v4From = (high: number, low: number) => new ipaddr.IPv4([high >> 8, high & 0xff, low >> 8, low & 0xff])

/**
 * A public unicast address. ipaddr.js names the special ranges (loopback, private, link-local, CGNAT,
 * multicast, reserved and documentation, ULA, Teredo, local-use NAT64, IPv4-mapped, ...); only
 * `unicast` passes. NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`) embed an IPv4 address, which is
 * checked as IPv4 instead of being refused outright (a DNS64 network answers with NAT64 addresses
 * for ordinary public hosts). An IPv4-mapped address is never a real answer for a public host.
 */
export function isPublicAddress(text: string): boolean {
  const ip = parseIp(text)
  return ip !== undefined && isPublic(ip)
}

function isPublic(ip: Ip): boolean {
  if (ip instanceof ipaddr.IPv4) return ip.range() === "unicast"
  const range = ip.range()
  const inner = range === "6to4" ? v4From(ip.parts[1]!, ip.parts[2]!) : ip.match(NAT64) ? v4From(ip.parts[6]!, ip.parts[7]!) : undefined
  if (inner) return isPublic(inner)
  return range === "unicast" && !ip.match(IPV4_COMPATIBLE)
}

// ---- allowlist

/** One `remoteImages.allow` entry: a host name (`images.internal`, or `*.internal` for subdomains), an IP address, or a CIDR range. */
type AllowEntry = { readonly kind: "host"; readonly name: string } | { readonly kind: "net"; readonly address: Ip; readonly bits: number }

const HOSTNAME = /^(?:\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/

/** Undefined when `entry` is none of the three forms. */
export function parseAllowEntry(entry: string): AllowEntry | undefined {
  const text = entry.trim().toLowerCase()
  const [address = "", length, extra] = text.split("/")
  const ip = parseIp(address)
  if (ip && extra === undefined) {
    const max = ip instanceof ipaddr.IPv4 ? 32 : 128
    if (length === undefined) return { kind: "net", address: ip, bits: max }
    if (/^\d{1,3}$/.test(length) && Number(length) <= max) return { kind: "net", address: ip, bits: Number(length) }
  }
  return HOSTNAME.test(text) && !text.includes("/") ? { kind: "host", name: text } : undefined
}

const hostMatches = (entry: { readonly name: string }, host: string): boolean =>
  entry.name.startsWith("*.") ? host.endsWith(entry.name.slice(1)) : host === entry.name

/** All addresses of `host`, in resolver order; rejects when `signal` aborts (the lookup itself cannot be cancelled). */
function resolveAddresses(host: string, signal: AbortSignal): Promise<string[]> {
  return new Promise((done, fail) => {
    const onAbort = () => fail(signal.reason)
    if (signal.aborted) return onAbort()
    signal.addEventListener("abort", onAbort, { once: true })
    lookup(host, { all: true, verbatim: true }).then(
      (found) => (signal.removeEventListener("abort", onAbort), done(found.map((entry) => entry.address))),
      (error) => (signal.removeEventListener("abort", onAbort), fail(error)),
    )
  })
}

/**
 * Resolve the URL's host and return the addresses to connect to, in resolver order. Every address
 * the name resolves to has to be allowed (a name that answers with one public and one private
 * address is refused), so a pinned one cannot be a surprise. Throws the generic fetch error when
 * anything is refused.
 */
async function checkedAddresses(url: URL, allow: ReadonlyArray<AllowEntry>, signal: AbortSignal): Promise<string[]> {
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  const literal = parseIp(host)
  const addresses = literal ? [host] : await resolveAddresses(host, signal)
  const nameAllowed = allow.some((entry) => entry.kind === "host" && hostMatches(entry, host))
  const permitted = (address: string): boolean => {
    const ip = parseIp(address)
    if (!ip) return false
    return nameAllowed || isPublic(ip) || allow.some((entry) => entry.kind === "net" && inNet(ip, entry.address, entry.bits))
  }
  if (addresses.length === 0 || !addresses.every(permitted)) {
    // The log says which kind of refusal, never the host or the URL.
    log("media.remote_refused", { reason: addresses.length === 0 ? "no_address" : "address_not_allowed" })
    throw FETCH_FAILED()
  }
  return addresses
}

/** GET `url` over a connection to `address` (already checked), keeping the URL's host for `Host` and TLS. No redirects are followed by the caller. */
function get(url: URL, address: string, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const secure = url.protocol === "https:"
    const name = url.hostname.replace(/^\[|\]$/g, "")
    const request = (secure ? httpsRequest : httpRequest)(
      {
        host: address,
        port: url.port === "" ? (secure ? 443 : 80) : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        agent: false,
        headers: { host: url.host, accept: "image/*", "user-agent": "opencode-plugboard" },
        // Certificate checks use the URL's host name, not the pinned address.
        ...(secure && isIP(name) === 0 ? { servername: name } : {}),
      },
      resolve,
    )
    request.on("error", reject)
    const abort = () => request.destroy(new Error("aborted"))
    request.on("close", () => signal.removeEventListener("abort", abort))
    if (signal.aborted) return abort()
    signal.addEventListener("abort", abort, { once: true })
    request.end()
  })
}

/** The first connection that succeeds, trying each checked address in order (#134); only a connection failure moves on, never a response. */
async function getFirst(url: URL, addresses: ReadonlyArray<string>, signal: AbortSignal): Promise<IncomingMessage> {
  for (const address of addresses) {
    try {
      return await get(url, address, signal)
    } catch {
      if (signal.aborted) break
    }
  }
  throw FETCH_FAILED()
}

// ---- preparation

async function toDataUrl(url: string, signal: AbortSignal, remoteImages: RemoteImages, budget: Budget): Promise<string> {
  if (url.startsWith("data:")) {
    if (url.length > budget.remaining) throw TOO_MANY()
    return url
  }
  if (!/^https?:\/\//i.test(url)) throw new ImageError("unsupported_image_url", "Unsupported image URL scheme; use a data: URL or an http(s) URL")
  if (remoteImages === false)
    throw new ImageError("remote_images_disabled", "Remote image URLs are disabled; send a data: URL or set the plugboard `remoteImages` option")

  // The object form tightens the defaults (#259); `true` and the absent fields keep today's bounds.
  const options: RemoteImageOptions = typeof remoteImages === "object" ? remoteImages : {}
  const schemes = options.schemes ?? ["http", "https"]
  const maxBytes = options.maxBytes ?? MAX_REMOTE_IMAGE_BYTES
  const maxRedirects = options.maxRedirects ?? 0
  const allow = (options.allow ?? []).flatMap((entry) => parseAllowEntry(entry) ?? [])

  // Messages never carry the URL, the status, the content type or the fetch error text: they can hold
  // credentials in the query string or describe the server's network to the caller.
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS)])
  let target: URL
  try {
    target = new URL(url)
  } catch {
    throw FETCH_FAILED()
  }
  let redirects = 0
  let response: IncomingMessage
  for (;;) {
    // The scheme is checked for the first URL and for every redirect target (#259).
    if (!schemes.includes(target.protocol.slice(0, -1))) throw FETCH_FAILED()
    // Every hop is resolved and checked again (I17), so a redirect cannot reach an address the first URL could not.
    const addresses = await checkedAddresses(target, allow, bounded).catch((error: unknown) => {
      throw error instanceof ImageError ? error : FETCH_FAILED()
    })
    response = await getFirst(target, addresses, bounded)
    const status = response.statusCode ?? 0
    if (status < 300 || status > 399 || redirects >= maxRedirects) break
    const location = response.headers.location
    response.destroy()
    if (location === undefined) throw FETCH_FAILED()
    redirects++
    try {
      target = new URL(location, target)
    } catch {
      throw FETCH_FAILED()
    }
  }
  // Anything but a plain success is a failed fetch (with the default `maxRedirects: 0`, a redirect too).
  if (response.statusCode === undefined || response.statusCode < 200 || response.statusCode > 299) {
    response.destroy()
    throw FETCH_FAILED()
  }
  const mediaType = (response.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? ""
  if (!mediaType.startsWith("image/")) {
    response.destroy()
    throw new ImageError("invalid_image", "URL did not return an image")
  }
  const declared = Number(response.headers["content-length"])
  // The data URL is 4/3 of the raw size plus a short prefix: stop reading once it cannot fit the budget.
  const budgetRaw = Math.floor((budget.remaining * 3) / 4)
  const limit = Math.min(maxBytes, budgetRaw)
  const tooLarge = () =>
    limit < maxBytes
      ? TOO_MANY()
      : new ImageError("image_too_large", maxBytes === MAX_REMOTE_IMAGE_BYTES ? "Image is larger than 20 MB" : "Image is larger than the remoteImages.maxBytes limit")
  if (Number.isFinite(declared) && declared > limit) {
    response.destroy()
    throw tooLarge()
  }
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of response as AsyncIterable<Buffer>) {
      size += chunk.byteLength
      if (size > limit) throw tooLarge()
      chunks.push(chunk)
    }
  } catch (error) {
    response.destroy()
    throw error instanceof ImageError ? error : FETCH_FAILED()
  }
  const dataUrl = `data:${mediaType};base64,${Buffer.concat(chunks).toString("base64")}`
  if (dataUrl.length > budget.remaining) throw TOO_MANY()
  return dataUrl
}

/** Prompt files for every image in the request, in message order, named `image-1`, `image-2`, ... Throws `ImageError`. */
export async function prepareImages(
  request: PlugRequest,
  signal: AbortSignal,
  remoteImages: RemoteImages,
): Promise<Array<{ uri: string; name: string }>> {
  const images: Array<{ uri: string; name: string }> = []
  const budget: Budget = { remaining: MAX_TOTAL_IMAGE_BYTES }
  // `remoteImages.maxItems` caps the http(s) URLs of one request (#259); data URLs are not counted.
  const maxItems = typeof remoteImages === "object" ? remoteImages.maxItems : undefined
  let remote = 0
  for (const message of request.messages)
    for (const part of message.content)
      if (part.type === "media") {
        signal.throwIfAborted()
        if (maxItems !== undefined && !part.url.startsWith("data:") && ++remote > maxItems)
          throw new ImageError("too_many_remote_images", `The request has more remote image URLs than remoteImages.maxItems (${maxItems}) allows`)
        const uri = await toDataUrl(part.url, signal, remoteImages, budget)
        budget.remaining -= uri.length
        images.push({ uri, name: `image-${images.length + 1}` })
      }
  return images
}
