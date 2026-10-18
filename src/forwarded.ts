/**
 * Reverse-proxy headers (option `listen.trustProxy`, #266). `X-Forwarded-For`, `X-Forwarded-Host` and
 * `X-Forwarded-Proto` are read only when the immediate peer's address is on the list; from any other peer they
 * are ignored. They feed the request log (`client`), the Host check on a keyed endpoint (`checkHost` in
 * `src/http.ts`) and the base URL of the discovery page. They never feed authentication: a key is still a key.
 */

import type { IncomingMessage } from "node:http"
import { isIP } from "node:net"
import ipaddr from "ipaddr.js"

/** `listen.trustProxy: true`: the loopback addresses only. */
const LOOPBACK_PROXIES: ReadonlyArray<string> = ["127.0.0.0/8", "::1/128"]
/** A forwarded host: a DNS name or an IPv6 literal, with an optional port. */
const HOST_SHAPE = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:\d{1,5})?$/i

type Ip = ipaddr.IPv4 | ipaddr.IPv6

const TRUST_PROXY_ERROR = "plugboard option `listen.trustProxy` must be `true`, `false`, or a list of IP addresses and CIDR ranges such as `127.0.0.1` or `10.0.0.0/8`"

/** An address or a CIDR range as `[address, prefix length]`, or undefined when it is neither. */
function parseEntry(entry: string): [Ip, number] | undefined {
  const [address = "", length, extra] = entry.split("/")
  if (isIP(address) === 0 || extra !== undefined) return undefined
  const ip = ipaddr.parse(address)
  const max = ip.kind() === "ipv4" ? 32 : 128
  if (length === undefined) return [ip, max]
  if (!/^\d{1,3}$/.test(length) || Number(length) > max) return undefined
  return [ip, Number(length)]
}

/**
 * Option `listen.trustProxy` after validation (#266). `undefined` is off: absent, `false`, or an empty list. `true`
 * is the loopback addresses. A list keeps its entries as written (IP addresses or CIDR ranges).
 */
export function parseTrustProxy(raw: unknown): ReadonlyArray<string> | undefined {
  if (raw === undefined || raw === false) return undefined
  if (raw === true) return LOOPBACK_PROXIES
  if (!Array.isArray(raw)) throw new Error(TRUST_PROXY_ERROR)
  for (const entry of raw) if (typeof entry !== "string" || parseEntry(entry) === undefined) throw new Error(`${TRUST_PROXY_ERROR}; \`${String(entry)}\` is neither`)
  return raw.length === 0 ? undefined : (raw as string[])
}

/** Is `address` on the trusted list? An IPv4-mapped IPv6 address counts as its IPv4 address. */
function isTrusted(address: string, trusted: ReadonlyArray<string>): boolean {
  let ip: Ip
  try {
    ip = ipaddr.process(address)
  } catch {
    return false
  }
  return trusted.some((entry) => {
    const range = parseEntry(entry)
    return range !== undefined && ip.kind() === range[0].kind() && ip.match(range[0], range[1])
  })
}

/** The immediate peer (the socket's address) is a trusted proxy. */
function trustedPeer(request: IncomingMessage, trusted: ReadonlyArray<string> | undefined): boolean {
  const peer = request.socket.remoteAddress
  return trusted !== undefined && peer !== undefined && isTrusted(peer, trusted)
}

/** A header's comma-separated values, trimmed; a repeated header is joined. */
function listOf(value: string | string[] | undefined): string[] {
  return (Array.isArray(value) ? value.join(",") : (value ?? ""))
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "")
}

/**
 * The client address for the request log (#266). From a trusted peer it is the rightmost `X-Forwarded-For` address that
 * is not a trusted proxy: each proxy appends the address it received from, so the leftmost value is whatever the
 * client chose to send. From any other peer it is the socket's address, whatever the header says.
 */
export function clientAddress(request: IncomingMessage, trusted: ReadonlyArray<string> | undefined): string | undefined {
  const peer = request.socket.remoteAddress
  if (trusted === undefined || !trustedPeer(request, trusted)) return peer
  const chain = listOf(request.headers["x-forwarded-for"]).filter((item) => isIP(item) !== 0)
  for (let i = chain.length - 1; i >= 0; i--) if (!isTrusted(chain[i]!, trusted)) return chain[i]
  return chain[0] ?? peer
}

/** The forwarded `Host` (the last `X-Forwarded-Host` value, well-formed) from a trusted peer; undefined otherwise. */
export function forwardedHost(request: IncomingMessage, trusted: ReadonlyArray<string> | undefined): string | undefined {
  if (trusted === undefined || !trustedPeer(request, trusted)) return undefined
  const host = listOf(request.headers["x-forwarded-host"]).at(-1)
  return host !== undefined && HOST_SHAPE.test(host) ? host : undefined
}

/** The public origin a trusted proxy names: `X-Forwarded-Proto` (`http` or `https`) and the forwarded host. */
export function forwardedOrigin(request: IncomingMessage, trusted: ReadonlyArray<string> | undefined): string | undefined {
  const host = forwardedHost(request, trusted)
  const proto = listOf(request.headers["x-forwarded-proto"]).at(-1)?.toLowerCase()
  return host !== undefined && (proto === "http" || proto === "https") ? `${proto}://${host}` : undefined
}
