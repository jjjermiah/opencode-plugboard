/**
 * The transport primitives in src/http.ts, on a real loopback socket: the request scope (deadline,
 * disconnect, the slow-reader cut), body reading and the SSE writer (commit rules, keepalive,
 * backpressure). Timers are injected (`sseWriter`'s keepalive interval, `beginRequest`'s grace),
 * so every wait here is a few milliseconds.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { request as httpRequest, type ClientRequest, type IncomingMessage, type ServerResponse } from "node:http"
import type { BodyLimits } from "../../src/config.js"
import type { PlugEvent } from "../../src/contract.js"
import { BodyError, RequestAborted, beginRequest, boundEvents, bodyPlugError, readJsonBody, sendError, sendJson, sseWriter, type RequestScope } from "../../src/http.js"
import { collect, ev, gate, until } from "../support/fixtures.js"
import { listen, parseSse, type Loopback } from "../support/loopback.js"

type Handler = (request: IncomingMessage, response: ServerResponse) => unknown

let server: Loopback | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

async function serve(handler: Handler): Promise<Loopback> {
  server = await listen((request, response) => void handler(request, response))
  return server
}

async function* script(...steps: Array<PlugEvent | Promise<unknown>>): AsyncGenerator<PlugEvent> {
  for (const step of steps) {
    if (step instanceof Promise) await step
    else yield step
  }
}

describe("beginRequest: one deadline and disconnect abort per request", () => {
  test("the deadline aborts the scope with a timeout reason and a 504 error to answer with", async () => {
    let scope: RequestScope | undefined
    const { send } = await serve(async (request, response) => {
      scope = beginRequest(request, response, 5)
      await new Promise((resolve) => scope!.signal.addEventListener("abort", resolve))
      sendJson(response, 200, {})
      scope.dispose()
    })
    await send()
    expect(scope!.timedOut).toBe(true)
    expect(scope!.signal.reason).toBeInstanceOf(RequestAborted)
    expect((scope!.signal.reason as RequestAborted).kind).toBe("timeout")
    expect(scope!.timeoutError).toEqual({ status: 504, kind: "timeout", code: "timeout", message: "Request timed out after 5 ms (option requestTimeoutMs)" })
  })

  test("a client that hangs up aborts the scope as disconnected", async () => {
    let scope: RequestScope | undefined
    const reached = gate()
    const { open } = await serve((request, response) => {
      scope = beginRequest(request, response, 60_000)
      response.writeHead(200).flushHeaders()
      reached.open()
    })
    const stream = await open()
    await reached.promise
    stream.destroy()
    await until(() => scope!.signal.aborted, 1_000, "the disconnect abort")
    expect((scope!.signal.reason as RequestAborted).kind).toBe("disconnected")
    expect(scope!.timedOut).toBe(false)
  })

  test("a response that finished normally does not abort the scope", async () => {
    let scope: RequestScope | undefined
    const { send } = await serve((request, response) => {
      scope = beginRequest(request, response, 60_000)
      sendJson(response, 200, { ok: true })
    })
    expect((await send()).status).toBe(200)
    await until(() => scope !== undefined)
    expect(scope!.signal.aborted).toBe(false)
  })

  test("#32 after the deadline, a response that cannot flush is cut once the grace passes", async () => {
    const { open } = await serve((request, response) => {
      beginRequest(request, response, 5, 5)
      // Committed but never ended: like a stream to a client that stopped reading.
      response.writeHead(200).flushHeaders()
    })
    const stream = await open()
    await stream.ended
    expect(stream.status).toBe(200)
  })

  test("race settles like the promise, or rejects with the abort reason", async () => {
    const results: unknown[] = []
    const { send } = await serve(async (request, response) => {
      const scope = beginRequest(request, response, 5)
      results.push(await scope.race(Promise.resolve("value")))
      results.push(await scope.race(new Promise(() => {})).catch((error: unknown) => error))
      sendJson(response, 200, {})
    })
    await send()
    expect(results[0]).toBe("value")
    expect(results[1]).toBeInstanceOf(RequestAborted)
  })
})

describe("boundEvents: the event stream ends with the scope", () => {
  test("a timeout ends the stream with the 504 error event", async () => {
    let seen: PlugEvent[] = []
    const { send } = await serve(async (request, response) => {
      const scope = beginRequest(request, response, 5)
      seen = await collect(boundEvents(script(ev.text("a"), new Promise(() => {})), scope))
      sendJson(response, 200, {})
    })
    await send()
    expect(seen).toEqual([ev.text("a"), { type: "error", error: { status: 504, kind: "timeout", code: "timeout", message: "Request timed out after 5 ms (option requestTimeoutMs)" } }])
  })

  test("a disconnect ends the stream without an event and returns the source iterator", async () => {
    let seen: PlugEvent[] | undefined
    let returned = false
    const reached = gate()
    const source: AsyncIterable<PlugEvent> = {
      [Symbol.asyncIterator]: () => ({
        next: () => (reached.open(), new Promise(() => {})),
        return: async () => ((returned = true), { done: true, value: undefined }),
      }),
    }
    const { open } = await serve(async (request, response) => {
      const scope = beginRequest(request, response, 60_000)
      response.writeHead(200).flushHeaders()
      seen = await collect(boundEvents(source, scope))
    })
    const stream = await open()
    await reached.promise
    stream.destroy()
    await until(() => seen !== undefined, 1_000, "the bounded stream to end")
    expect(seen).toEqual([])
    expect(returned).toBe(true)
  })
})

describe("readJsonBody", () => {
  async function read(body: string | Buffer | undefined, headers: Record<string, string | number> = {}) {
    let result: unknown
    const { send } = await serve(async (request, response) => {
      result = await readJsonBody(request, new AbortController().signal).catch((error: unknown) => error)
      sendJson(response, 200, {})
    })
    await send({ method: "POST", body, headers })
    return result
  }

  test("an empty body is {}", async () => {
    expect(await read(undefined)).toEqual({})
  })

  test("a JSON body is parsed", async () => {
    expect(await read('{"a":[1]}')).toEqual({ a: [1] })
  })

  test("invalid JSON is a 400 BodyError", async () => {
    expect(await read("{nope")).toEqual(new BodyError(400, "Request body is not valid JSON"))
  })

  test("a declared Content-Length over 32 MiB is a 413 before reading", async () => {
    const result = await read("{}", { "content-length": 32 * 1024 * 1024 + 1 }).catch(() => undefined)
    // The client lied about the length; the server answered 413 without waiting for the bytes.
    expect(result).toEqual(new BodyError(413, "Request body too large"))
  })

  test("a chunked body that grows past 32 MiB is a 413", async () => {
    const big = Buffer.alloc(32 * 1024 * 1024 + 1, 0x20)
    expect(await read(big, { "transfer-encoding": "chunked" })).toEqual(new BodyError(413, "Request body too large"))
  })
})

describe("#156 readJsonBody: a process-wide budget and a read timeout, both before buffering", () => {
  const small: BodyLimits = { maxBytesInFlight: 1_000, readTimeoutMs: 5_000 }

  /** Reads with `limits` and answers the way a route does: 200 when read, the refusal's status and Retry-After otherwise. */
  function answerWith(limits: BodyLimits, probe?: (request: IncomingMessage) => void): Handler {
    return (request, response) => {
      const read = readJsonBody(request, new AbortController().signal, limits)
      probe?.(request)
      void read.then(
        () => sendJson(response, 200, { ok: true }),
        (error: unknown) => {
          if (!(error instanceof BodyError)) throw error
          sendError(response, bodyPlugError(error), { error: error.message }, { close: true })
        },
      )
    }
  }

  /** A raw POST whose body the test writes in pieces. Late client errors (after a hang-up) are ignored. */
  function openPost(port: number, headers: Record<string, string | number>): ClientRequest {
    const client = httpRequest({ host: "127.0.0.1", port, method: "POST", path: "/", headers, agent: false })
    client.on("error", () => {})
    return client
  }

  const replyOf = (client: ClientRequest) => new Promise<IncomingMessage>((resolve) => client.once("response", resolve))

  async function textOf(reply: IncomingMessage): Promise<string> {
    let text = ""
    for await (const chunk of reply) text += chunk
    return text
  }

  test("#156 a body whose declared length would take the bodies in flight over the budget is a 503 before it is read", async () => {
    const entered = gate()
    const { port, send } = await serve(answerWith(small, () => entered.open()))
    const payload = JSON.stringify({ text: "a".repeat(680) })
    const length = Buffer.byteLength(payload)
    const first = openPost(port, { "content-type": "application/json", "content-length": length })
    const firstReply = replyOf(first)
    first.write(payload.slice(0, 100))
    await entered.promise

    const refused = await send({ method: "POST", body: payload, headers: { "content-length": length } })
    expect(refused.status).toBe(503)
    expect(refused.headers["retry-after"]).toBe("1")
    expect(refused.json()).toEqual({ error: "Too many request bodies are being read; retry shortly" })

    first.end(payload.slice(100))
    const reply = await firstReply
    expect(reply.statusCode).toBe(200)
    reply.resume()
    // The first body's bytes went back to the budget when it was read, so the same request fits now.
    expect((await send({ method: "POST", body: payload, headers: { "content-length": length } })).status).toBe(200)
  })

  test("#156 a body without a Content-Length is charged as it arrives, and a later body is refused while it holds the budget", async () => {
    let got = 0
    const seen = gate()
    const { port, send } = await serve(
      answerWith(small, (request) =>
        request.on("data", (chunk: Buffer) => {
          got += chunk.length
          if (got >= 800) seen.open()
        }),
      ),
    )
    const payload = JSON.stringify({ text: "a".repeat(800) })
    const first = openPost(port, { "content-type": "application/json" })
    const firstReply = replyOf(first)
    first.write(payload)
    await seen.promise

    const later = JSON.stringify({ text: "b".repeat(280) })
    const refused = await send({ method: "POST", body: later, headers: { "content-length": Buffer.byteLength(later) } })
    expect(refused.status).toBe(503)

    first.end()
    const reply = await firstReply
    expect(reply.statusCode).toBe(200)
    reply.resume()
  })

  test("#156 a body that does not arrive within the read timeout is a 408, and its bytes go back to the budget", async () => {
    const tight: BodyLimits = { maxBytesInFlight: 100, readTimeoutMs: 5 }
    const { port, send } = await serve(answerWith(tight))
    const stalled = openPost(port, { "content-type": "application/json", "content-length": 100 })
    const stalledReply = replyOf(stalled)
    stalled.write("{")
    const reply = await stalledReply
    expect(reply.statusCode).toBe(408)
    expect(JSON.parse(await textOf(reply))).toEqual({ error: "Request body was not received within 5 ms (option limits.bodyReadTimeoutMs)" })
    stalled.destroy()

    // The stalled body held all 100 bytes; once it timed out they are free, so a body of 92 bytes fits.
    const payload = JSON.stringify({ text: "a".repeat(80) })
    expect((await send({ method: "POST", body: payload, headers: { "content-length": Buffer.byteLength(payload) } })).status).toBe(200)
  })

  test("#156 a refusal maps to its wire status, kind, code and Retry-After", () => {
    expect(bodyPlugError(new BodyError(503, "busy", "server_busy", 1))).toEqual({ status: 503, kind: "server", message: "busy", code: "server_busy", retryAfterSeconds: 1 })
    expect(bodyPlugError(new BodyError(408, "slow", "body_read_timeout"))).toEqual({ status: 408, kind: "timeout", message: "slow", code: "body_read_timeout" })
    expect(bodyPlugError(new BodyError(413, "big"))).toEqual({ status: 413, kind: "invalid_request", message: "big" })
  })
})

describe("sseWriter: commit rules and keepalive", () => {
  test("nothing is committed by a terminal event alone, so the caller can still answer with a status", async () => {
    const { send } = await serve(async (_request, response) => {
      const sse = sseWriter(response, undefined, 5)
      for await (const _ of sse.paced(script(ev.error()))) void _
      if (!sse.started) sendJson(response, 502, { failed: true })
    })
    expect(await send()).toMatchObject({ status: 502, text: '{"failed":true}' })
  })

  test("the first non-terminal event (reasoning counts) commits 200 SSE headers before any body", async () => {
    const release = gate()
    const { open } = await serve(async (_request, response) => {
      const sse = sseWriter(response, undefined, 60_000)
      for await (const _ of sse.paced(script(ev.reasoning("x"), release.promise))) void _
      response.end()
    })
    const stream = await open()
    expect(stream.status).toBe(200)
    expect(stream.headers).toMatchObject({ "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" })
    expect(stream.received).toBe("")
    release.open()
    await stream.ended
  })

  test("#173 a buffered structured answer still commits on its first text event and keeps the stream alive until it is written", async () => {
    const release = gate()
    const { open } = await serve(async (_request, response) => {
      const sse = sseWriter(response, undefined, 5)
      // The encoder holds the prose back (it is not written); the commit and the keepalive come from the paced events.
      for await (const event of sse.paced(script(ev.text("prose"), release.promise, ev.call("c1", "respond", { a: 1 })))) if (event.type === "tool-call") sse.write("data: answer\n\n")
      response.end()
    })
    const stream = await open()
    expect(stream.status).toBe(200)
    await stream.waitFor((text) => text.split(": keepalive").length > 2)
    expect(stream.received).not.toContain("prose")
    release.open()
    const frames = parseSse(await stream.ended)
    expect(frames.at(-1)).toEqual({ data: "answer" })
  })

  test("an idle committed stream gets a keepalive comment every interval, and none after the events end", async () => {
    const release = gate()
    const { open } = await serve(async (_request, response) => {
      const sse = sseWriter(response, undefined, 5)
      for await (const event of sse.paced(script(ev.reasoning("x"), release.promise, ev.text("done")))) if (event.type === "text-delta") sse.write("data: done\n\n")
      await new Promise((resolve) => setTimeout(resolve, 20))
      response.end()
    })
    const stream = await open()
    await stream.waitFor((text) => text.split(": keepalive").length > 2)
    release.open()
    const frames = parseSse(await stream.ended)
    expect(frames.filter((frame) => frame.comment === "keepalive").length).toBeGreaterThanOrEqual(2)
    expect(frames.at(-1)).toEqual({ data: "done" })
  })

  test("a write after the client is gone is dropped, not thrown", async () => {
    let wrote = false
    const reached = gate()
    const { open } = await serve(async (_request, response) => {
      const sse = sseWriter(response)
      sse.write("data: first\n\n")
      reached.open()
      await new Promise((resolve) => response.on("close", resolve))
      sse.write("data: late\n\n")
      wrote = true
    })
    const stream = await open()
    await reached.promise
    stream.destroy()
    await until(() => wrote)
  })

  test("backpressure: drained() waits while the socket buffer is full and ends when the scope aborts", async () => {
    // A stub response whose buffer stays full: a real paused socket drains at OS-dependent speed
    // (Linux loopback absorbs tens of MB), which made this test pass on macOS and fail in CI.
    const { EventEmitter } = await import("node:events")
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableEnded: false,
      headersSent: false,
      writeHead() { this.headersSent = true; return this },
      flushHeaders() {},
      setHeader() {},
      write: () => false,
      end() {},
    })
    let state = "pending"
    const scope = new AbortController()
    const sse = sseWriter(response as unknown as Parameters<typeof sseWriter>[0], scope.signal)
    sse.write("data: x\n\n")
    const waiting = sse.drained().then(() => { state = "drained" })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(state).toBe("pending")
    scope.abort()
    await waiting
    expect(state).toBe("drained")
    response.emit("close")
  })
})
