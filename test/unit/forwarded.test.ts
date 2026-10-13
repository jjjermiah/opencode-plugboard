/**
 * #266 `listen.trustProxy` and the forwarded headers (src/forwarded.ts): the option's forms, the client address
 * for the log, and the forwarded host and origin. Read only from a trusted peer, never from an untrusted one.
 */
import { describe, expect, test } from "bun:test"
import type { IncomingMessage } from "node:http"
import { clientAddress, forwardedHost, forwardedOrigin, parseTrustProxy } from "../../src/forwarded.js"

/** A request as the header readers see it: the peer's socket address and the headers. */
const req = (peer: string | undefined, headers: Record<string, string | string[]> = {}) => ({ socket: { remoteAddress: peer }, headers }) as unknown as IncomingMessage

const TRUSTED = ["127.0.0.1", "10.0.0.0/8"]

describe("#266 listen.trustProxy option", () => {
  test("absent, false and an empty list are off; true is the loopback addresses", () => {
    expect(parseTrustProxy(undefined)).toBeUndefined()
    expect(parseTrustProxy(false)).toBeUndefined()
    expect(parseTrustProxy([])).toBeUndefined()
    expect(parseTrustProxy(true)).toEqual(["127.0.0.0/8", "::1/128"])
  })

  test("a list of addresses and CIDR ranges is kept as written", () => {
    expect(parseTrustProxy(["127.0.0.1", "10.0.0.0/8", "fd00::/8"])).toEqual(["127.0.0.1", "10.0.0.0/8", "fd00::/8"])
  })

  test.each([
    ["a host name", ["proxy.internal"], /`proxy\.internal` is neither/],
    ["a prefix past the family's width", ["10.0.0.0/33"], /`10\.0\.0\.0\/33` is neither/],
    ["a non-list, non-boolean", "127.0.0.1", /must be `true`, `false`, or a list/],
  ])("%s is refused at load and names the option", (_name, raw, message) => {
    expect(() => parseTrustProxy(raw)).toThrow(message)
  })
})

describe("#266 the client address for the log", () => {
  test("an untrusted peer's forwarded header is ignored: the socket address is the client", () => {
    expect(clientAddress(req("203.0.113.9", { "x-forwarded-for": "198.51.100.1" }), TRUSTED)).toBe("203.0.113.9")
    expect(clientAddress(req("203.0.113.9", { "x-forwarded-for": "198.51.100.1" }), undefined)).toBe("203.0.113.9")
  })

  test("a trusted peer: the rightmost address that is not a trusted proxy is the client", () => {
    expect(clientAddress(req("127.0.0.1", { "x-forwarded-for": "203.0.113.7" }), TRUSTED)).toBe("203.0.113.7")
    // Two hops: 10.0.0.5 is a trusted proxy, so the address before it is the client.
    expect(clientAddress(req("127.0.0.1", { "x-forwarded-for": "203.0.113.7, 10.0.0.5" }), TRUSTED)).toBe("203.0.113.7")
  })

  test("a client's spoofed leftmost value does not win over the address the trusted proxy recorded", () => {
    expect(clientAddress(req("127.0.0.1", { "x-forwarded-for": "1.2.3.4, 203.0.113.7" }), TRUSTED)).toBe("203.0.113.7")
  })

  test("a trusted peer with no forwarded address is the peer itself; an IPv4-mapped peer counts as IPv4", () => {
    expect(clientAddress(req("127.0.0.1"), TRUSTED)).toBe("127.0.0.1")
    expect(clientAddress(req("::ffff:127.0.0.1", { "x-forwarded-for": "203.0.113.7" }), TRUSTED)).toBe("203.0.113.7")
  })

  test("the peer address comes from the socket, never from a header", () => {
    expect(clientAddress(req("127.0.0.1", { "x-real-ip": "198.51.100.2" }), TRUSTED)).toBe("127.0.0.1")
  })
})

describe("#266 the forwarded host and origin", () => {
  test("only a trusted peer's X-Forwarded-Host is read, and only a well-formed one", () => {
    expect(forwardedHost(req("203.0.113.9", { "x-forwarded-host": "chat.example.net" }), TRUSTED)).toBeUndefined()
    expect(forwardedHost(req("127.0.0.1", { "x-forwarded-host": "chat.example.net:443" }), TRUSTED)).toBe("chat.example.net:443")
    expect(forwardedHost(req("127.0.0.1", { "x-forwarded-host": "bad host/path" }), TRUSTED)).toBeUndefined()
  })

  test("the origin is the proto the proxy names, http or https, with the forwarded host", () => {
    expect(forwardedOrigin(req("127.0.0.1", { "x-forwarded-host": "chat.example.net", "x-forwarded-proto": "https" }), TRUSTED)).toBe("https://chat.example.net")
    expect(forwardedOrigin(req("127.0.0.1", { "x-forwarded-host": "chat.example.net", "x-forwarded-proto": "ftp" }), TRUSTED)).toBeUndefined()
    expect(forwardedOrigin(req("203.0.113.9", { "x-forwarded-host": "chat.example.net", "x-forwarded-proto": "https" }), TRUSTED)).toBeUndefined()
  })
})
