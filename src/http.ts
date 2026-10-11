/**
 * HTTP ingress and transport helpers: body reading, header checks, JSON and SSE responses,
 * disconnect abort and the request deadline. Protocol-neutral: callers pass in already-encoded
 * payloads, and checks return a `PlugError` for the caller to encode.
 */

import type { IncomingMessage, ServerResponse } from "node:http"
import { isLoopbackHost } from "./config.js"
import type { PlugError, PlugEvent, PlugboardOptions } from "./contract.js"

const MAX_BODY_BYTES = 32 * 1024 * 1024

/** A request body that cannot be accepted: too large, or not JSON. `status` is the HTTP status to answer with. */
export class BodyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Reads the body as JSON (an empty body is `{}`). Rejects with `BodyError` (413, 400) or the stream's error. */
export function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new BodyError(413, "Request body too large"))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on("error", reject)
    request.on("end", () => {
      try {
        resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch {
        reject(new BodyError(400, "Request body is not valid JSON"))
      }
    })
  })
}

export const sendJson = (response: ServerResponse, status: number, payload: unknown) => {
  if (response.headersSent) return
  const body = JSON.stringify(payload)
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) })
  response.end(body)
}

/**
 * SSE response writer. Headers go out with the first chunk, so nothing is committed until there
 * is something to send; chunks after the client is gone are dropped.
 */
export function sseWriter(response: ServerResponse) {
  let started = false
  return {
    get started() {
      return started
    },
    write(chunk: string) {
      if (response.destroyed) return
      if (!started) {
        started = true
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        })
      }
      response.write(chunk)
    },
  }
}

/** Client disconnect (also mid-SSE) aborts the returned controller, which interrupts the model call. */
export function abortOnDisconnect(response: ServerResponse): AbortController {
  const controller = new AbortController()
  response.on("close", () => {
    if (!response.writableFinished) controller.abort()
  })
  return controller
}

/**
 * Bound the event stream by the request timeout. On timeout the caller is aborted
 * (so the session is interrupted) and a 504 error event ends the stream.
 */
export async function* withTimeout(
  events: AsyncIterable<PlugEvent>,
  timeoutMs: number,
  controller: AbortController,
): AsyncGenerator<PlugEvent> {
  const iterator = events[Symbol.asyncIterator]()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs)
  })
  try {
    while (true) {
      const next = await Promise.race([iterator.next(), timeout])
      if (next === "timeout") {
        controller.abort()
        yield {
          type: "error",
          error: { status: 504, type: "timeout_error", code: "timeout", message: `Request timed out after ${timeoutMs} ms (option requestTimeoutMs)` },
        }
        return
      }
      if (next.done) return
      yield next.value
    }
  } finally {
    clearTimeout(timer)
    // Not awaited: when the timeout won, `next()` is still pending until the abort propagates.
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
    return { status: 403, type: "permission_error", code: "invalid_host", message: "Host header not allowed" }
  if (Object.keys(options.keys).length === 0 && request.headers.origin !== undefined)
    return {
      status: 403,
      type: "permission_error",
      code: "cross_origin_forbidden",
      message: "Cross-origin requests are not allowed on a keyless endpoint; configure `keys`",
    }
}

export function checkJsonContentType(request: IncomingMessage): PlugError | undefined {
  const contentType = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase()
  if (contentType !== "application/json")
    return {
      status: 415,
      type: "invalid_request_error",
      code: "unsupported_media_type",
      message: "Content-Type must be application/json",
    }
}
