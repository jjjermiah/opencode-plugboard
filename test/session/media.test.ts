/**
 * Image preparation (src/session/media.ts) and the #84 SSRF guard on `remoteImages`. The address
 * checks run before any connection, so blocked literals are tested without network; the allow
 * path and the fetch rules use a loopback image server, which only an allowlist may reach.
 * Public addresses are not fetched here (no network in this suite).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { lookup } from "node:dns/promises"
import type { ServerResponse } from "node:http"
import ipaddr from "ipaddr.js"
import type { PlugRequest } from "../../src/contract.js"
import { ImageError, isPublicAddress, parseAllowEntry, prepareImages, type RemoteImages } from "../../src/session/media.js"
import { plugRequest, until } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { listen, type Loopback } from "../support/loopback.js"

const logs = captureLogs()
/** `localhost` in resolver order, as plugboard sees it (`verbatim`). Differs between machines. */
const LOCALHOST = (await lookup("localhost", { all: true, verbatim: true })).map((entry) => entry.address)
const PNG = Buffer.from("89504e470d0a1a0a", "hex")
let server: Loopback
let hits = 0
/** Requests per path: a test counts its own fetches here, so a request from another test does not count (#434). */
const served = new Map<string, number>()
/** Responses a `/hang` fetch leaves open; a test destroys them when it is done. */
const hung: ServerResponse[] = []
const routes: Record<string, (response: ServerResponse) => void> = {
  "/ok.png": (response) => {
    response.writeHead(200, { "content-type": "image/png" })
    response.end(PNG)
  },
  "/max-items.png": (response) => routes["/ok.png"]!(response),
  "/redirect": (response) => {
    response.writeHead(302, { location: "/ok.png" })
    response.end()
  },
  "/text": (response) => {
    response.writeHead(200, { "content-type": "text/html" })
    response.end("<html>")
  },
  "/missing": (response) => {
    response.writeHead(404)
    response.end()
  },
  "/to-private": (response) => {
    response.writeHead(302, { location: "http://10.0.0.1/a.png" })
    response.end()
  },
  "/hang": (response) => {
    hung.push(response)
  },
  "/huge": (response) => {
    response.writeHead(200, { "content-type": "image/png", "content-length": String(21 * 1024 * 1024) })
    response.end()
  },
  "/streamed-huge": (response) => {
    response.writeHead(200, { "content-type": "image/png", "transfer-encoding": "chunked" })
    response.write(Buffer.alloc(600, 0x41))
    response.end(Buffer.alloc(600, 0x42))
  },
}
beforeAll(async () => {
  server = await listen((request, response) => {
    hits++
    served.set(request.url ?? "", (served.get(request.url ?? "") ?? 0) + 1)
    ;(routes[request.url ?? ""] ?? routes["/missing"]!)(response)
  })
})
afterAll(() => server.close())

const withImages = (...urls: string[]): PlugRequest => plugRequest({ messages: [{ role: "user", content: urls.map((url) => ({ type: "media" as const, url })) }] })

async function fetchImage(url: string, remoteImages: RemoteImages = true): Promise<string | ImageError> {
  try {
    const [file] = await prepareImages(withImages(url), new AbortController().signal, remoteImages)
    return file!.uri
  } catch (error) {
    if (error instanceof ImageError) return error
    throw error
  }
}

const code = (result: string | ImageError) => (result instanceof ImageError ? result.code : "fetched")

describe("#84 addresses that are not public are refused before any connection", () => {
  test.each([
    ["loopback", "http://127.0.0.1/a.png"],
    ["loopback, another address", "http://127.255.0.9/a.png"],
    ["loopback in hex (URL-normalized)", "http://0x7f000001/a.png"],
    ["loopback in dotted hex", "http://0x7f.0.0.1/a.png"],
    ["loopback in octal (URL-normalized)", "http://0177.0.0.1/a.png"],
    ["loopback in two-part shorthand", "http://127.1/a.png"],
    ["loopback as one integer", "http://2130706433/a.png"],
    ["this network", "http://0.0.0.0/a.png"],
    ["private 10/8", "http://10.1.2.3/a.png"],
    ["private 10/8 in octal", "http://012.0.0.1/a.png"],
    ["private 10/8 in dotted hex", "http://0x0a.0.0.1/a.png"],
    ["private 172.16/12", "http://172.31.255.255/a.png"],
    ["private 192.168/16", "http://192.168.1.1/a.png"],
    ["CGNAT", "http://100.64.0.1/a.png"],
    ["link-local (cloud metadata)", "http://169.254.169.254/latest/meta-data"],
    ["link-local in octal", "http://0251.0376.0251.0376/a.png"],
    ["documentation", "http://203.0.113.5/a.png"],
    ["benchmarking", "http://198.18.0.1/a.png"],
    ["multicast", "http://224.0.0.1/a.png"],
    ["reserved and broadcast", "http://255.255.255.255/a.png"],
    ["IPv6 loopback", "http://[::1]/a.png"],
    ["IPv6 unspecified", "http://[::]/a.png"],
    ["IPv4-mapped loopback", "http://[::ffff:127.0.0.1]/a.png"],
    ["IPv4-mapped public (never a real answer)", "http://[::ffff:8.8.8.8]/a.png"],
    ["NAT64 of a private address", "http://[64:ff9b::a00:1]/a.png"],
    ["6to4 of loopback", "http://[2002:7f00:1::]/a.png"],
    ["local-use NAT64", "http://[64:ff9b:1::1]/a.png"],
    ["unique local", "http://[fd12:3456::1]/a.png"],
    ["IPv6 link-local", "http://[fe80::1]/a.png"],
    ["site-local", "http://[fec0::1]/a.png"],
    ["IPv6 multicast", "http://[ff02::1]/a.png"],
    ["Teredo", "http://[2001:0:4136:e378::1]/a.png"],
    ["IPv6 documentation", "http://[2001:db8::1]/a.png"],
    ["discard prefix", "http://[100::1]/a.png"],
  ])("%s", async (_name, url) => {
    const before = hits
    expect(code(await fetchImage(url))).toBe("image_fetch_failed")
    expect(hits).toBe(before)
    expect(logs.of("media.remote_refused").at(-1)!.fields.reason).toBe("address_not_allowed")
  })

  test.each([
    ["a public IPv4 address", "8.8.8.8"],
    ["a public IPv6 address", "2606:4700:4700::1111"],
    ["NAT64 of a public address (DNS64 answers)", "64:ff9b::808:808"],
    ["6to4 of a public address", "2002:808:808::"],
  ])("%s is public", (_name, address) => {
    expect(isPublicAddress(address)).toBe(true)
  })

  test.each([
    ["IPv4-compatible loopback", "::7f00:1"],
    ["IPv4-compatible private", "::a00:1"],
    ["NAT64 of a private address", "64:ff9b::a00:1"],
    ["6to4 of a private address", "2002:a00:1::"],
    ["an IPv6 zone does not hide link-local", "fe80::1%eth0"],
    ["not an address", "example.com"],
    ["an odd IPv4 spelling", "0x7f.1"],
  ])("%s is not public", (_name, address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  test("a host name that resolves to loopback is refused too", async () => {
    expect(code(await fetchImage(`http://localhost:${server.port}/ok.png`))).toBe("image_fetch_failed")
  })

  test("every refusal is the same generic error, and the log never names the host or URL", async () => {
    const result = await fetchImage("http://10.0.0.1/secret.png?token=abc")
    expect(result).toEqual(new ImageError("image_fetch_failed", "Could not fetch image"))
    expect(logs.lines.map((line) => line.raw).join("\n")).not.toMatch(/10\.0\.0\.1|secret|token/)
  })
})

describe("#84 remoteImages.allow lets the operator reach named internal hosts", () => {
  test.each([
    ["the exact address", ["127.0.0.1"]],
    ["a CIDR range", ["127.0.0.0/8"]],
  ])("an allowed address (%s) is fetched", async (_name, allow) => {
    expect(await fetchImage(`http://127.0.0.1:${server.port}/ok.png`, { allow })).toBe(`data:image/png;base64,${PNG.toString("base64")}`)
  })

  /** An image server on one of `localhost`'s addresses, for the duration of `fn`. */
  async function onLocalhost(address: string, fn: (port: number) => Promise<void>) {
    const local = await listen((_request, response) => routes["/ok.png"]!(response), address)
    try {
      await fn(local.port)
    } finally {
      await local.close()
    }
  }

  test("an allowed host name is fetched, at the first address it resolved to", async () => {
    await onLocalhost(LOCALHOST[0]!, async (port) => {
      expect(code(await fetchImage(`http://localhost:${port}/ok.png`, { allow: ["localhost"] }))).toBe("fetched")
    })
  })

  // #134: where `localhost` resolves to [::1, 127.0.0.1], an image host that answers on one of
  // them only is fetched, as curl or fetch would, by falling back to the next checked address.
  ;(LOCALHOST.length > 1 ? test : test.skip)("#134 an allowed name whose first address refuses the connection falls back to the next checked address", async () => {
    await onLocalhost(LOCALHOST.at(-1)!, async (port) => {
      expect(code(await fetchImage(`http://localhost:${port}/ok.png`, { allow: ["localhost"] }))).toBe("fetched")
    })
  })

  test("an allowlist for another range does not help", async () => {
    expect(code(await fetchImage(`http://127.0.0.1:${server.port}/ok.png`, { allow: ["10.0.0.0/8", "*.internal"] }))).toBe("image_fetch_failed")
  })

  test.each([
    ["a host", "images.internal", { kind: "host", name: "images.internal" }],
    ["a wildcard", "*.Internal", { kind: "host", name: "*.internal" }],
    ["an address", "10.1.2.3", { kind: "net", address: ipaddr.parse("10.1.2.3"), bits: 32 }],
    ["an IPv6 range", "fd00::/8", { kind: "net", address: ipaddr.parse("fd00::"), bits: 8 }],
  ])("parseAllowEntry accepts %s", (_name, entry, parsed) => {
    expect(parseAllowEntry(entry)).toEqual(parsed as never)
  })

  test.each(["", "http://x", "10.0.0.0/33", "a/b", "*", "under_score.example", "1.2.3.4/8/9"])("parseAllowEntry refuses %p", (entry) => {
    expect(parseAllowEntry(entry)).toBeUndefined()
  })
})

describe("fetch rules on an allowed host", () => {
  const allow = { allow: ["127.0.0.1"] }
  const url = (path: string) => `http://127.0.0.1:${server.port}${path}`

  test.each([
    ["a redirect is never followed", "/redirect", "image_fetch_failed"],
    ["a 404 is the generic failure", "/missing", "image_fetch_failed"],
    ["a non-image content type", "/text", "invalid_image"],
    ["a declared size over 20 MB", "/huge", "image_too_large"],
  ])("%s", async (_name, path, expected) => {
    expect(code(await fetchImage(url(path), allow))).toBe(expected)
  })
})

describe("#259 remoteImages limits tighten the fetch", () => {
  const allow = ["127.0.0.1"]
  const url = (path: string) => `http://127.0.0.1:${server.port}${path}`

  test('schemes ["https"] refuses an http URL before any connection', async () => {
    const before = hits
    expect(code(await fetchImage(url("/ok.png"), { allow, schemes: ["https"] }))).toBe("image_fetch_failed")
    expect(hits).toBe(before)
  })

  test("maxBytes below the image size is image_too_large; at the size it is fetched", async () => {
    expect(code(await fetchImage(url("/ok.png"), { allow, maxBytes: PNG.length - 1 }))).toBe("image_too_large")
    expect(code(await fetchImage(url("/streamed-huge"), { allow, maxBytes: 1024 }))).toBe("image_too_large")
    expect(code(await fetchImage(url("/ok.png"), { allow, maxBytes: PNG.length }))).toBe("fetched")
  })

  test("maxRedirects 0 refuses a redirect; 1 follows it, and the target is checked again", async () => {
    expect(code(await fetchImage(url("/redirect"), { allow, maxRedirects: 0 }))).toBe("image_fetch_failed")
    expect(code(await fetchImage(url("/redirect"), { allow, maxRedirects: 1 }))).toBe("fetched")
  })

  test("a redirect to a non-public address is refused even with redirects allowed (I17)", async () => {
    expect(code(await fetchImage(url("/to-private"), { allow, maxRedirects: 1 }))).toBe("image_fetch_failed")
    expect(logs.of("media.remote_refused").at(-1)!.fields.reason).toBe("address_not_allowed")
  })

  test("timeoutMs bounds one fetch: an answer that never comes is a generic failure", async () => {
    expect(code(await fetchImage(url("/hang"), { allow, timeoutMs: 1 }))).toBe("image_fetch_failed")
    for (const response of hung.splice(0)) response.destroy()
  })

  test("maxItems: a second remote URL is refused before its fetch; data URLs are not counted", async () => {
    const count = () => served.get("/max-items.png") ?? 0
    const before = count()
    // The hang test's request can reach the server after that test ended (#434): one arrives inside this window.
    const seen = hung.length
    const late = server.raw({ path: "/hang" })
    await until(() => hung.length > seen, 1_000, "the late /hang request")
    for (const response of hung.splice(0)) response.destroy()
    late.destroy()
    const error = await prepareImages(withImages(url("/max-items.png"), url("/max-items.png")), new AbortController().signal, { allow, maxItems: 1 }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ImageError)
    expect((error as ImageError).code).toBe("too_many_remote_images")
    expect(count()).toBe(before + 1)
    const files = await prepareImages(withImages("data:a", url("/max-items.png"), "data:b"), new AbortController().signal, { allow, maxItems: 1 })
    expect(files).toHaveLength(3)
  })
})

describe("image preparation without the network", () => {
  test("remote URLs are refused while remoteImages is off", async () => {
    expect(code(await fetchImage("https://example.com/a.png", false))).toBe("remote_images_disabled")
  })

  test("only data: and http(s) URLs are accepted", async () => {
    expect(code(await fetchImage("file:///etc/passwd"))).toBe("unsupported_image_url")
  })

  test("data URLs pass through, numbered in message order", async () => {
    expect(await prepareImages(withImages("data:a", "data:b"), new AbortController().signal, false)).toEqual([
      { uri: "data:a", name: "image-1" },
      { uri: "data:b", name: "image-2" },
    ])
  })

  test("#39 all images of one request may hold at most 50 MB", async () => {
    const big = `data:image/png;base64,${"A".repeat(30 * 1024 * 1024)}`
    await expect(prepareImages(withImages(big, big), new AbortController().signal, false)).rejects.toEqual(new ImageError("images_too_large", "The request's images are larger than 50 MB in total"))
  })

  test("an aborted request stops before the next image", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(prepareImages(withImages("data:a"), controller.signal, false)).rejects.toBeDefined()
  })
})
