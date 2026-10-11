/**
 * HTTP ingress and transport helpers: request scope (disconnect abort and the one end-to-end
 * deadline), body reading, header checks, JSON and SSE responses. Protocol-neutral: callers pass
 * in already-encoded payloads, and checks return a `PlugError` for the caller to encode.
 */

import type { IncomingMessage, ServerResponse } from "node:http"
import { isLoopbackHost, type PlugboardOptions } from "./config.js"
import type { PlugError, PlugEvent } from "./contract.js"

const MAX_BODY_BYTES = 32 * 1024 * 1024
/** Largest delay `setTimeout` accepts; anything larger fires at once. */
const MAX_TIMER_MS = 2 ** 31 - 1
/** After answering a request whose body was not fully read, keep discarding it this long before cutting the socket. */
const LINGER_MS = 5_000

/** A request body that cannot be accepted: too large, or not JSON. `status` is the HTTP status to answer with. */
export class BodyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Why a request's work was abandoned: the client went away, or the deadline passed. It is the abort reason of `RequestScope.signal`. */
export class RequestAborted extends Error {
  constructor(readonly kind: "disconnected" | "timeout") {
    super(kind === "timeout" ? "Request deadline exceeded" : "Client disconnected")
  }
}

/** Cancellation for one HTTP request: aborts on client disconnect and at the single end-to-end deadline. */
export interface RequestScope {
  readonly signal: AbortSignal
  readonly timedOut: boolean
  /** The `PlugError` to answer a timeout with. */
  readonly timeoutError: PlugError
  /** Settles like `promise`, or rejects with the abort reason (`RequestAborted`) as soon as the scope aborts. `promise` is always observed. */
  race<T>(promise: Promise<T>): Promise<T>
  /** Clears the deadline timer; call once the request is finished. */
  dispose(): void
}

/**
 * Establishes cancellation and the deadline. Call before the first `await` of a request: a socket
 * that is already gone aborts immediately, so abandoned work never starts.
 */
export function beginRequest(request: IncomingMessage, response: ServerResponse, timeoutMs: number): RequestScope {
  const controller = new AbortController()
  const abort = (kind: RequestAborted["kind"]) => {
    if (!controller.signal.aborted) controller.abort(new RequestAborted(kind))
  }
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => abort("timeout"), Math.min(Math.max(timeoutMs, 1), MAX_TIMER_MS))
  timer.unref?.()
  const dispose = () => {
    clearTimeout(timer)
    timer = undefined
  }
  response.on("close", () => {
    if (!response.writableFinished) abort("disconnected")
    dispose()
  })
  request.on("error", () => abort("disconnected"))
  if (response.destroyed || request.destroyed || request.socket?.destroyed) abort("disconnected")

  const { signal } = controller
  const timedOut = () => signal.reason instanceof RequestAborted && signal.reason.kind === "timeout"
  return {
    signal,
    get timedOut() {
      return timedOut()
    },
    timeoutError: {
      status: 504,
      kind: "timeout",
      code: "timeout",
      message: `Request timed out after ${timeoutMs} ms (option requestTimeoutMs)`,
    },
    race<T>(promise: Promise<T>): Promise<T> {
      promise.catch(() => {})
      if (signal.aborted) return Promise.reject(signal.reason)
      return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(signal.reason)
        signal.addEventListener("abort", onAbort, { once: true })
        promise.then(
          (value) => {
            signal.removeEventListener("abort", onAbort)
            resolve(value)
          },
          (error) => {
            signal.removeEventListener("abort", onAbort)
            reject(error)
          },
        )
      })
    },
    dispose,
  }
}

/**
 * Reads the body as JSON (an empty body is `{}`). Rejects with `BodyError` (413, 400), the abort
 * reason of `signal` or the stream's error. On rejection the rest of the body is discarded, not
 * buffered, so the response can still be delivered (see `finishRequest`).
 */
export function readJsonBody(request: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const declared = Number(request.headers["content-length"])
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      request.resume()
      return reject(new BodyError(413, "Request body too large"))
    }
    if (signal.aborted) return reject(signal.reason)
    const chunks: Buffer[] = []
    let size = 0
    const cleanup = () => {
      request.off("data", onData)
      request.off("error", onError)
      request.off("end", onEnd)
      signal.removeEventListener("abort", onAbort)
    }
    const stop = (error: unknown) => {
      cleanup()
      chunks.length = 0
      request.resume()
      reject(error)
    }
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) return stop(new BodyError(413, "Request body too large"))
      chunks.push(chunk)
    }
    const onError = (error: Error) => stop(error)
    const onAbort = () => stop(signal.reason)
    const onEnd = () => {
      cleanup()
      try {
        resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch {
        reject(new BodyError(400, "Request body is not valid JSON"))
      }
    }
    request.on("data", onData)
    request.on("error", onError)
    request.on("end", onEnd)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

/**
 * Call when a request is done. If the client is still sending a body that was not read, keep
 * discarding it briefly so the response is not lost to a connection reset, then cut the socket.
 */
export function finishRequest(request: IncomingMessage, response: ServerResponse): void {
  if (request.complete || request.destroyed) return
  request.resume()
  const timer = setTimeout(() => request.destroy(), LINGER_MS)
  timer.unref?.()
  response.once("close", () => clearTimeout(timer))
}

/** `close`: also tell the client to drop the connection (after an unread or abandoned body). */
export const sendJson = (response: ServerResponse, status: number, payload: unknown, options?: { close?: boolean }) => {
  if (response.headersSent || response.destroyed) return
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    ...(options?.close ? { connection: "close" } : {}),
  })
  response.end(body)
}

/**
 * SSE response writer. Headers go out with the first chunk, so nothing is committed until there
 * is something to send; chunks after the client is gone are dropped. `write` is synchronous (the
 * encoder's contract); backpressure is honoured by `paced`, which holds back the next event while
 * the socket buffer is full.
 */
export function sseWriter(response: ServerResponse) {
  let started = false
  let blocked = false
  const waiters: Array<() => void> = []
  const release = () => {
    blocked = false
    for (const resolve of waiters.splice(0)) resolve()
  }
  response.on("drain", release)
  response.on("close", release)
  const drained = (): Promise<void> => {
    if (!blocked || response.destroyed) return Promise.resolve()
    return new Promise((resolve) => waiters.push(resolve))
  }
  return {
    get started() {
      return started
    },
    write(chunk: string) {
      if (response.destroyed || response.writableEnded) return
      if (!started) {
        started = true
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        })
      }
      if (!response.write(chunk)) blocked = true
    },
    /** Resolves when the socket buffer has room again, or the client is gone. */
    drained,
    /** Passes events through, waiting for `drain` before pulling each one, and stops when the client is gone. */
    async *paced(events: AsyncIterable<PlugEvent>): AsyncGenerator<PlugEvent> {
      const iterator = events[Symbol.asyncIterator]()
      try {
        while (true) {
          await drained()
          if (response.destroyed) return
          const next = await iterator.next()
          if (next.done) return
          yield next.value
        }
      } finally {
        void iterator.return?.(undefined)?.catch?.(() => {})
      }
    },
  }
}

/**
 * Bound the event stream by the request scope. On timeout a 504 error event ends the stream; on
 * disconnect the stream just ends. Either way the scope's abort already interrupted the caller.
 */
export async function* boundEvents(events: AsyncIterable<PlugEvent>, scope: RequestScope): AsyncGenerator<PlugEvent> {
  const iterator = events[Symbol.asyncIterator]()
  try {
    while (true) {
      let next: IteratorResult<PlugEvent>
      try {
        next = await scope.race(iterator.next())
      } catch (error) {
        if (!(error instanceof RequestAborted)) throw error
        if (error.kind === "timeout") yield { type: "error", error: scope.timeoutError }
        return
      }
      if (next.done) return
      yield next.value
    }
  } finally {
    // Not awaited: when the scope aborted, `next()` is still pending until the abort propagates.
    void iterator.return?.(undefined)?.catch?.(() => {})
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])

/** Host header check against DNS rebinding: only meaningful when listening on loopback. */
function hostAllowed(options: PlugboardOptions, hostHeader: string | undefined): boolean {
  if (!isLoopbackHost(options.listen.host)) return true
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec((hostHeader ?? "").trim().toLowerCase())
  if (!match || !LOOPBACK_HOSTS.has(match[1]!)) return false
  return (match[2] ?? "80") === String(options.listen.port)
}

/**
 * Browser-reachable loopback endpoints: block DNS rebinding (Host header) and, on a keyless
 * endpoint, cross-site calls (any Origin header).
 */
export function checkOrigin(request: IncomingMessage, options: PlugboardOptions): PlugError | undefined {
  if (!hostAllowed(options, request.headers.host))
    return { status: 403, kind: "permission", code: "invalid_host", message: "Host header not allowed" }
  if (Object.keys(options.keys).length === 0 && request.headers.origin !== undefined)
    return {
      status: 403,
      kind: "permission",
      code: "cross_origin_forbidden",
      message: "Cross-origin requests are not allowed on a keyless endpoint; configure `keys`",
    }
}

export function checkJsonContentType(request: IncomingMessage): PlugError | undefined {
  const contentType = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase()
  if (contentType !== "application/json")
    return {
      status: 415,
      kind: "invalid_request",
      code: "unsupported_media_type",
      message: "Content-Type must be application/json",
    }
}
