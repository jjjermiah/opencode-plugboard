/**
 * The transport primitives in src/http.ts, on a real loopback socket: the request scope (deadline,
 * disconnect, the slow-reader cut), body reading and the SSE writer (commit rules, keepalive,
 * backpressure). Timers are injected (`sseWriter`'s keepalive interval, `beginRequest`'s grace),
 * so every wait here is a few milliseconds.
 */
import { afterEach, describe, expect, test } from "bun:test"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { PlugEvent } from "../../src/contract.js"
import { BodyError, RequestAborted, beginRequest, boundEvents, readJsonBody, sendJson, sseWriter, type RequestScope } from "../../src/http.js"
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
    let state = "pending"
    const scope = new AbortController()
    const blocked = gate()
    const { open } = await serve(async (_request, response) => {
      const sse = sseWriter(response, scope.signal)
      const chunk = `data: ${"x".repeat(1024 * 1024)}\n\n`
      for (let i = 0; i < 64; i++) sse.write(chunk)
      blocked.open()
      await sse.drained()
      state = "drained"
    })
    const stream = await open()
    stream.pause()
    await blocked.promise
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(state).toBe("pending")
    scope.abort()
    await until(() => state === "drained")
    stream.destroy()
  })
})
