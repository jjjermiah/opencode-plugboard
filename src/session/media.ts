/**
 * Bounded attachment preparation: request images become prompt files.
 *
 * Prompt files must be inline `data:` URLs. http(s) images are fetched once, only when the
 * `remoteImages` option is on, with no redirects, a 20 s timeout and a 20 MB cap. All images of
 * one request together may hold at most 50 MB (`images_too_large`), data URLs and fetched ones alike.
 *
 * A remote fetch is a request the server makes on a caller's behalf, so it must not reach the
 * server's own network (#84): the host is resolved first, every address it resolves to must be a
 * public one (loopback, private, link-local, CGNAT, ULA, multicast, reserved and mapped or
 * translated forms of those are refused) unless the operator's `remoteImages.allow` list names the
 * host or the address, and the request then connects to the address that was checked, not to the
 * name, so a second DNS answer cannot redirect it (DNS rebinding). The caller sees one generic
 * error for every fetch failure, whatever the cause.
 */

import { lookup } from "node:dns/promises"
import { request as httpRequest, type IncomingMessage } from "node:http"
import { request as httpsRequest } from "node:https"
import { isIP } from "node:net"
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

/** The `remoteImages` option as the session caller receives it: off, on (public addresses only), or on with an allowlist. */
export type RemoteImages = boolean | { readonly allow: ReadonlyArray<string> }

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

interface Ip {
  readonly family: 4 | 6
  readonly bytes: ReadonlyArray<number>
}

/** Dotted IPv4 or any IPv6 text form (compressed, with an embedded IPv4 tail, with a zone) to bytes. */
function parseIp(text: string): Ip | undefined {
  const family = isIP(text)
  if (family === 4) return { family, bytes: text.split(".").map(Number) }
  if (family !== 6) return undefined
  let head = text.split("%")[0]!
  const dot = head.lastIndexOf(".")
  if (dot !== -1) {
    const colon = head.lastIndexOf(":")
    const v4 = head.slice(colon + 1).split(".").map(Number)
    head = `${head.slice(0, colon + 1)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`
  }
  const [left = "", right = ""] = head.split("::")
  const first = left === "" ? [] : left.split(":")
  const last = head.includes("::") ? (right === "" ? [] : right.split(":")) : []
  const groups = head.includes("::") ? [...first, ...Array<string>(8 - first.length - last.length).fill("0"), ...last] : head.split(":")
  const bytes: number[] = []
  for (const group of groups) {
    const value = Number.parseInt(group, 16)
    bytes.push(value >> 8, value & 0xff)
  }
  return { family, bytes }
}

interface Cidr {
  readonly ip: Ip
  readonly bits: number
}

function inCidr(ip: Ip, cidr: Cidr): boolean {
  if (ip.family !== cidr.ip.family) return false
  let left = cidr.bits
  for (let i = 0; left > 0; i++, left -= 8) {
    const mask = left >= 8 ? 0xff : (0xff << (8 - left)) & 0xff
    if ((ip.bytes[i]! & mask) !== (cidr.ip.bytes[i]! & mask)) return false
  }
  return true
}

function parseCidr(text: string): Cidr | undefined {
  const [address = "", length, extra] = text.split("/")
  const ip = parseIp(address)
  if (!ip || extra !== undefined) return undefined
  const max = ip.family === 4 ? 32 : 128
  if (length === undefined) return { ip, bits: max }
  const bits = Number(length)
  return /^\d{1,3}$/.test(length) && bits <= max ? { ip, bits } : undefined
}

const cidrs = (list: string[]): Cidr[] => list.map((entry) => parseCidr(entry)!)

/** IPv4 that is not a public unicast address. */
const BLOCKED_V4 = cidrs([
  "0.0.0.0/8", // "this network"
  "10.0.0.0/8",
  "100.64.0.0/10", // CGNAT
  "127.0.0.0/8", // loopback
  "169.254.0.0/16", // link-local, cloud metadata
  "172.16.0.0/12",
  "192.0.0.0/24", // IETF protocol assignments
  "192.0.2.0/24", // documentation
  "192.168.0.0/16",
  "198.18.0.0/15", // benchmarking
  "198.51.100.0/24", // documentation
  "203.0.113.0/24", // documentation
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reserved, broadcast
])

/**
 * IPv6 that is not a public unicast address. NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`) are
 * not listed: they embed an IPv4 address, which `isPublic` checks as IPv4 (a DNS64 network answers
 * with NAT64 addresses for ordinary public hosts).
 */
const BLOCKED_V6 = cidrs([
  "::/96", // unspecified, loopback, deprecated IPv4-compatible
  "::ffff:0:0/96", // IPv4-mapped: never a real answer for a public host
  "64:ff9b:1::/48", // local-use NAT64
  "100::/64", // discard
  "2001::/32", // Teredo
  "2001:db8::/32", // documentation
  "fc00::/7", // unique local
  "fe80::/10", // link-local
  "fec0::/10", // site-local (deprecated)
  "ff00::/8", // multicast
])

/** The IPv4 address embedded in a NAT64 or 6to4 address (or a mapped one), if it is one. */
function embeddedV4(ip: Ip): Ip | undefined {
  if (ip.family !== 6) return undefined
  const b = ip.bytes
  const mapped = b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff
  const nat64 = b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)
  if (mapped || nat64) return { family: 4, bytes: b.slice(12, 16) }
  if (b[0] === 0x20 && b[1] === 0x02) return { family: 4, bytes: b.slice(2, 6) }
  return undefined
}

function isPublic(ip: Ip): boolean {
  const inner = embeddedV4(ip)
  if (inner && !isPublic(inner)) return false
  return !(ip.family === 4 ? BLOCKED_V4 : BLOCKED_V6).some((cidr) => inCidr(ip, cidr))
}

// ---- allowlist

/** One `remoteImages.allow` entry: a host name (`images.internal`, or `*.internal` for subdomains), an IP address, or a CIDR range. */
type AllowEntry = { readonly kind: "host"; readonly name: string } | { readonly kind: "net"; readonly cidr: Cidr }

const HOSTNAME = /^(?:\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/

/** Undefined when `entry` is none of the three forms. */
export function parseAllowEntry(entry: string): AllowEntry | undefined {
  const text = entry.trim().toLowerCase()
  const cidr = parseCidr(text)
  if (cidr) return { kind: "net", cidr }
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
 * Resolve the URL's host and decide which address to connect to. Every address the name resolves
 * to has to be allowed (a name that answers with one public and one private address is refused),
 * so the pinned one cannot be a surprise. Throws the generic fetch error when anything is refused.
 */
async function pickAddress(url: URL, allow: ReadonlyArray<AllowEntry>, signal: AbortSignal): Promise<string> {
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  const literal = parseIp(host)
  const addresses = literal ? [host] : await resolveAddresses(host, signal)
  const nameAllowed = allow.some((entry) => entry.kind === "host" && hostMatches(entry, host))
  const permitted = (address: string): boolean => {
    const ip = parseIp(address)
    if (!ip) return false
    return nameAllowed || isPublic(ip) || allow.some((entry) => entry.kind === "net" && inCidr(ip, entry.cidr))
  }
  if (addresses.length === 0 || !addresses.every(permitted)) {
    // The log says which kind of refusal, never the host or the URL.
    log("media.remote_refused", { reason: addresses.length === 0 ? "no_address" : "address_not_allowed" })
    throw FETCH_FAILED()
  }
  return addresses[0]!
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

// ---- preparation

async function toDataUrl(url: string, signal: AbortSignal, remoteImages: RemoteImages, budget: Budget): Promise<string> {
  if (url.startsWith("data:")) {
    if (url.length > budget.remaining) throw TOO_MANY()
    return url
  }
  if (!/^https?:\/\//i.test(url)) throw new ImageError("unsupported_image_url", "Unsupported image URL scheme; use a data: URL or an http(s) URL")
  if (remoteImages === false)
    throw new ImageError("remote_images_disabled", "Remote image URLs are disabled; send a data: URL or set the plugboard `remoteImages` option")

  // Messages never carry the URL, the status, the content type or the fetch error text: they can hold
  // credentials in the query string or describe the server's network to the caller.
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
  let target: URL
  try {
    target = new URL(url)
  } catch {
    throw FETCH_FAILED()
  }
  const allow = typeof remoteImages === "object" ? remoteImages.allow.flatMap((entry) => parseAllowEntry(entry) ?? []) : []
  const address = await pickAddress(target, allow, bounded).catch((error: unknown) => {
    throw error instanceof ImageError ? error : FETCH_FAILED()
  })
  const response = await get(target, address, bounded).catch(() => {
    throw FETCH_FAILED()
  })
  // A redirect is never followed (it could point inside); anything but a plain success is a failed fetch.
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
  const limit = Math.min(MAX_REMOTE_IMAGE_BYTES, budgetRaw)
  const tooLarge = () => (limit < MAX_REMOTE_IMAGE_BYTES ? TOO_MANY() : new ImageError("image_too_large", "Image is larger than 20 MB"))
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
