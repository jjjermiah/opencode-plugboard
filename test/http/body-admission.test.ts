/**
 * The body budget per app and the body deadlines (src/http.ts `readJsonBody`, src/config.ts `bodyLimits`): one app's share of the
 * budget, the idle timer that restarts on data, the total ceiling, and the release of a share on every exit.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { request as httpRequest, type ClientRequest, type IncomingMessage, type ServerResponse } from "node:http"
import { bodyLimits, parseOptions, type BodyLimits } from "../../src/config.js"
import { BodyError, bodyPlugError, readJsonBody, sendError, sendJson } from "../../src/http.js"
import { listen, type Loopback } from "../support/loopback.js"

let server: Loopback | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

/** Answers each request as a route does: 200 when read, the refusal's status and Retry-After otherwise. */
async function serve(limits: BodyLimits, appOf?: (request: IncomingMessage) => string | undefined, own = false): Promise<Loopback> {
  server = await listen((request: IncomingMessage, response: ServerResponse) => {
    const controller = new AbortController()
    // With `own`, a client that leaves aborts the read, as a route's request scope does.
    if (own) request.on("close", () => controller.abort(new Error("client left")))
    void readJsonBody(request, controller.signal, { ...limits, app: appOf?.(request) }).then(
      () => sendJson(response, 200, { ok: true }),
      (error: unknown) => {
        if (!(error instanceof BodyError)) return
        sendError(response, bodyPlugError(error), { error: error.message }, { close: true })
      },
    )
  })
  return server
}

/** A raw POST whose body the test writes in pieces. Late client errors (after a hang-up) are ignored. */
function openPost(port: number, headers: Record<string, string | number>): ClientRequest {
  const client = httpRequest({ host: "127.0.0.1", port, method: "POST", path: "/", headers, agent: false })
  client.on("error", () => {})
  return client
}

const replyOf = (client: ClientRequest) => new Promise<IncomingMessage>((resolve) => client.once("response", resolve))
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const byHeader = (request: IncomingMessage) => (request.headers["x-app"] === undefined ? undefined : String(request.headers["x-app"]))
/** A JSON body of exactly `bytes` bytes. */
const bodyOf = (bytes: number) => JSON.stringify({ text: "a".repeat(bytes - 11) })

describe("the body idle timer and total ceiling", () => {
  test("the idle timer restarts with every chunk: a body that keeps arriving is read even when it takes longer than the timer", async () => {
    const { port } = await serve({ maxBytesInFlight: 10_000, readTimeoutMs: 60, readCeilingMs: 5_000 })
    const payload = bodyOf(100)
    const client = openPost(port, { "content-type": "application/json", "content-length": payload.length })
    const reply = replyOf(client)
    for (let at = 0; at < payload.length; at += 10) {
      client.write(payload.slice(at, at + 10))
      await wait(30)
    }
    expect((await reply).statusCode).toBe(200)
  })

  test("a body that is not complete within the total ceiling is a 408, even while it keeps arriving", async () => {
    const { port } = await serve({ maxBytesInFlight: 10_000, readTimeoutMs: 1_000, readCeilingMs: 80 })
    const payload = bodyOf(100)
    const client = openPost(port, { "content-type": "application/json", "content-length": payload.length })
    const reply = replyOf(client)
    for (let at = 0; at < payload.length; at += 5) {
      client.write(payload.slice(at, at + 5))
      await wait(20)
    }
    const answer = await reply
    expect(answer.statusCode).toBe(408)
    const text = await new Promise<string>((resolve) => {
      let out = ""
      answer.on("data", (chunk) => (out += chunk))
      answer.on("end", () => resolve(out))
    })
    expect(JSON.parse(text)).toEqual({ error: "Request body was not complete within 80 ms (option limits.bodyReadMaxMs)" })
  })
})

describe("the per-app share of the body budget", () => {
  test("a chunked body without Content-Length is charged as it arrives against its app's share: the chunk that goes over is a 503", async () => {
    const { port } = await serve({ maxBytesInFlight: 1_000, readTimeoutMs: 1_000, appShare: 300 }, byHeader)
    const client = openPost(port, { "content-type": "application/json", "transfer-encoding": "chunked", "x-app": "a" })
    const reply = replyOf(client)
    client.write("x".repeat(200))
    await wait(20)
    client.write("x".repeat(200)) // 400 bytes of this app's body: over its 300 byte share
    const answer = await reply
    expect(answer.statusCode).toBe(503)
    answer.resume()
    client.destroy()
  })

  test("a body larger than its app's share is refused at once, and another app's body of the same size is read", async () => {
    const { send } = await serve({ maxBytesInFlight: 1_000, readTimeoutMs: 1_000, appShare: 300 }, byHeader)
    const big = bodyOf(400)
    const refused = await send({ method: "POST", body: big, headers: { "content-length": 400, "x-app": "a" } })
    expect(refused.status).toBe(503)
    expect(refused.headers["retry-after"]).toBe("1")
    const other = await send({ method: "POST", body: bodyOf(250), headers: { "content-length": 250, "x-app": "b" } })
    expect(other.status).toBe(200)
  })

  test("a 413 holds no share: the next body of the same app is read in full", async () => {
    const { send } = await serve({ maxBytesInFlight: 1_000, readTimeoutMs: 1_000, maxBodyBytes: 100, appShare: 100 }, byHeader)
    expect((await send({ method: "POST", body: bodyOf(150), headers: { "content-length": 150, "x-app": "a" } })).status).toBe(413)
    expect((await send({ method: "POST", body: bodyOf(90), headers: { "content-length": 90, "x-app": "a" } })).status).toBe(200)
  })

  test("a client that leaves mid-upload releases its share at once, so the next body of the app is read", async () => {
    const { port, send } = await serve({ maxBytesInFlight: 1_000, readTimeoutMs: 10_000, appShare: 300 }, byHeader, true)
    const stalled = openPost(port, { "content-type": "application/json", "content-length": 300, "x-app": "a" })
    stalled.on("response", () => {})
    stalled.write("{")
    await wait(30)
    expect((await send({ method: "POST", body: bodyOf(100), headers: { "content-length": 100, "x-app": "a" } })).status).toBe(503)
    stalled.destroy()
    await wait(30)
    expect((await send({ method: "POST", body: bodyOf(300), headers: { "content-length": 300, "x-app": "a" } })).status).toBe(200)
  })

  test("the budget applies to the whole process: bodies of every app together stay within maxBytesInFlight", async () => {
    const { port, send } = await serve({ maxBytesInFlight: 500, readTimeoutMs: 10_000, appShare: 300 }, byHeader)
    const a = openPost(port, { "content-type": "application/json", "content-length": 300, "x-app": "a" })
    a.write("{")
    await wait(20)
    // App b's 250 bytes would make 550 over the budget of 500, even though b has its own share.
    expect((await send({ method: "POST", body: bodyOf(250), headers: { "content-length": 250, "x-app": "b" } })).status).toBe(503)
    a.destroy()
  })
})

describe("the config split of the body budget", () => {
  const keys = { a: "a".repeat(40), b: "b".repeat(40) }

  test("with two app keys each app's share is the budget split evenly", () => {
    const options = parseOptions({ keys, limits: { maxBodyBytesInFlight: 100, maxBodyBytes: 40 } })
    expect(bodyLimits(options, "a")).toMatchObject({ maxBytesInFlight: 100, appShare: 50, app: "a" })
  })

  test("one key or none has no split: the app has the whole budget", () => {
    const options = parseOptions({ keys: { a: "a".repeat(40) }, limits: { maxBodyBytesInFlight: 100, maxBodyBytes: 90 } })
    expect(bodyLimits(options, "a").appShare).toBeUndefined()
  })

  test("a split that would leave an app less than the largest body is refused at load, with the figure to raise it to", () => {
    expect(() => parseOptions({ keys, limits: { maxBodyBytesInFlight: 100, maxBodyBytes: 60 } })).toThrow(
      "is split across 2 app keys, so each app gets 50 bytes, less than `limits.maxBodyBytes` (60): raise it to at least 120",
    )
  })
})
