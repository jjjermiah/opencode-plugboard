/**
 * HTTP ingress and transport helpers: request scope (disconnect abort and the one end-to-end
 * deadline), body reading, header checks, JSON and SSE responses. Protocol-neutral: callers pass
 * in already-encoded payloads, and checks return a `PlugError` for the caller to encode.
 */

import { STATUS_CODES, type IncomingMessage, type ServerResponse } from "node:http"
import { raceAbort } from "./abort.js"
import { BODY_LIMIT_DEFAULTS, type BodyLimits, isLoopbackHost, type PlugboardOptions } from "./config.js"
import type { PlugError, PlugEvent } from "./contract.js"
import { forwardedHost } from "./forwarded.js"

/** Largest delay `setTimeout` accepts; anything larger fires at once. */
const MAX_TIMER_MS = 2 ** 31 - 1
/** After answering a request whose body was not fully read, keep discarding it this long before cutting the socket. */
const LINGER_MS = 5_000
/** After the deadline passes, a response that has not finished flushing (a client that stopped reading) is destroyed after this long. */
const DEADLINE_GRACE_MS = 2_000
/** An SSE stream idle for this long gets a comment line, so a client with a header or idle timeout keeps waiting for a model that is still reasoning. */
const KEEPALIVE_MS = 15_000

/**
 * A request body that cannot be accepted: too large, not JSON, not complete in time (408), or refused
 * because the process has no room for it (503). `status` is the HTTP status to answer with; `code` and
 * `retryAfterSeconds` go to the wire (`bodyPlugError`).
 */
export class BodyError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
  }
}

/** The `PlugError` a refused body answers with: `server_busy` (503) is a server kind, a slow body (408) a timeout. */
export function bodyPlugError(error: BodyError): PlugError {
  const kind: PlugError["kind"] = error.status === 503 ? "server" : error.status === 408 ? "timeout" : "invalid_request"
  return {
    status: error.status,
    kind,
    message: error.message,
    ...(error.code === undefined ? {} : { code: error.code }),
    ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
  }
}

/**
 * Process-wide bytes of request bodies being read, and the bytes each app holds of them. On `globalThis` under a versioned
 * key (I6), so every plugin generation shares one budget. `apps` is added by a later generation: an older one ignores it.
 */
interface BodyBudget {
  inFlight: number
  apps?: Map<string, number>
}
const BODY_BUDGET = Symbol.for("opencode-plugboard.body-budget/1")
const bodyBudget = (): BodyBudget => {
  const slot = globalThis as Record<symbol, BodyBudget | undefined>
  return (slot[BODY_BUDGET] ??= { inFlight: 0 })
}

/**
 * Why a request's work was abandoned: the client went away (`disconnected`), the deadline passed (`timeout`), or the work was
 * cancelled by plugboard itself (`cancelled`: a sibling choice of `n` failed). Only a client that left gets the settle window
 * (`settleMs`, src/session/caller.ts); the other two stop the host at once.
 */
export class RequestAborted extends Error {
  constructor(readonly kind: "disconnected" | "timeout" | "cancelled") {
    super(kind === "timeout" ? "Request deadline exceeded" : kind === "cancelled" ? "Request cancelled" : "Client disconnected")
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
 * that is already gone aborts immediately, so abandoned work never starts. `graceMs` is for tests.
 */
export function beginRequest(
  request: IncomingMessage,
  response: ServerResponse,
  timeoutMs: number,
  graceMs = DEADLINE_GRACE_MS,
  /** The option that set `timeoutMs`, named in the timeout error: `requestTimeoutMs`, or `apps.<name>.requestTimeoutMs` (#257). */
  timeoutOption = "requestTimeoutMs",
): RequestScope {
  const controller = new AbortController()
  const abort = (kind: RequestAborted["kind"]) => {
    if (!controller.signal.aborted) controller.abort(new RequestAborted(kind))
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  const onDeadline = () => {
    abort("timeout")
    // The error response (or the rest of a stream) may never flush to a client that stopped reading: cut the transport.
    // Cleared only once the socket is gone: on some runtimes the response reports finished/closed
    // after `end()` while bytes are still queued for a client that stopped reading, so neither
    // `writableFinished`, `writableLength` nor the response's `close` shows a flush. An idle
    // connection cut here is harmless.
    graceTimer = setTimeout(() => {
      response.destroy()
      request.socket?.destroy()
    }, graceMs)
    graceTimer.unref?.()
  }
  timer = setTimeout(onDeadline, Math.min(Math.max(timeoutMs, 1), MAX_TIMER_MS))
  timer.unref?.()
  const dispose = () => {
    clearTimeout(timer)
    timer = undefined
  }
  response.on("close", () => {
    if (!response.writableFinished) abort("disconnected")
    dispose()
    if (request.socket?.destroyed) clearTimeout(graceTimer)
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
      message: `Request timed out after ${timeoutMs} ms (option ${timeoutOption})`,
    },
    race: (promise) => raceAbort(promise, signal),
    dispose,
  }
}

/**
 * Reads the body as JSON (an empty body is `{}`). Rejects with `BodyError` (413, 400, 408 or 503), the
 * abort reason of `signal` or the stream's error. On rejection the rest of the body is discarded, not
 * buffered, so the response can still be delivered (see `finishRequest`).
 *
 * Bounded before it is buffered (#156, invariant I28). The bytes held by every body being read in the
 * process stay within `limits.maxBytesInFlight`: a declared Content-Length is charged before the first byte
 * is read, a body without one as it arrives, and a body that would go over is refused with 503 `server_busy`
 * (Retry-After 1). A body that stops arriving for `limits.readTimeoutMs`, or is not complete within
 * `limits.readCeilingMs`, is refused with 408, and its bytes go back to the budget.
 */
export function readJsonBody(request: IncomingMessage, signal: AbortSignal, limits: BodyLimits = BODY_LIMIT_DEFAULTS): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const maxBodyBytes = limits.maxBodyBytes ?? BODY_LIMIT_DEFAULTS.maxBodyBytes
    const declared = Math.max(0, Number(request.headers["content-length"]) || 0)
    if (declared > maxBodyBytes) {
      request.resume()
      return reject(new BodyError(413, "Request body too large", "request_body_too_large"))
    }
    if (signal.aborted) return reject(signal.reason)
    const budget = bodyBudget()
    const apps = (budget.apps ??= new Map<string, number>())
    const app = limits.app
    const chunks: Buffer[] = []
    let size = 0
    // Bytes this read holds in the budget. Released on every exit: complete, refused or abandoned.
    let held = 0
    const charge = (bytes: number): boolean => {
      if (budget.inFlight + bytes > limits.maxBytesInFlight) return false
      const mine = app === undefined ? 0 : (apps.get(app) ?? 0)
      if (app !== undefined && limits.appShare !== undefined && mine + bytes > limits.appShare) return false
      budget.inFlight += bytes
      if (app !== undefined) apps.set(app, mine + bytes)
      held += bytes
      return true
    }
    const busy = () => new BodyError(503, "Too many request bodies are being read; retry shortly", "server_busy", 1)
    // The idle timer restarts with every chunk; the ceiling runs once, from the start, whatever arrives.
    let idle: ReturnType<typeof setTimeout> | undefined
    let ceiling: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      clearTimeout(idle)
      clearTimeout(ceiling)
      budget.inFlight -= held
      if (app !== undefined) {
        const left = (apps.get(app) ?? 0) - held
        if (left > 0) apps.set(app, left)
        else apps.delete(app)
      }
      held = 0
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
    const armIdle = () => {
      clearTimeout(idle)
      idle = setTimeout(
        () => stop(new BodyError(408, `Request body stopped arriving for ${limits.readTimeoutMs} ms (option limits.bodyReadTimeoutMs)`, "body_read_timeout")),
        limits.readTimeoutMs,
      )
      idle.unref?.()
    }
    const ceilingMs = limits.readCeilingMs ?? BODY_LIMIT_DEFAULTS.readCeilingMs
    const onData = (chunk: Buffer) => {
      armIdle()
      size += chunk.length
      if (size > maxBodyBytes) return stop(new BodyError(413, "Request body too large", "request_body_too_large"))
      if (size > held && !charge(size - held)) return stop(busy())
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
    // The declared length is charged before the first byte is read, so a refusal costs no buffering.
    if (declared > 0 && !charge(declared)) {
      request.resume()
      return reject(busy())
    }
    armIdle()
    ceiling = setTimeout(
      () => stop(new BodyError(408, `Request body was not complete within ${ceilingMs} ms (option limits.bodyReadMaxMs)`, "body_read_timeout")),
      ceilingMs,
    )
    ceiling.unref?.()
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

/** The request id header (`x-plugboard-request-id`), set on every response before anything else can fail. */
export const REQUEST_ID_HEADER = "x-plugboard-request-id"

/**
 * `Access-Control-Expose-Headers` on an allowed CORS answer (#314): the plugboard response headers a browser script reads,
 * plus `retry-after`. Without it a browser hides every header but the CORS-safelisted ones.
 */
export const CORS_EXPOSED_HEADERS = [
  "x-plugboard-request-id",
  "x-plugboard-session",
  "x-plugboard-session-url",
  "x-plugboard-model",
  "x-plugboard-fallbacks",
  "x-plugboard-usage",
  "x-plugboard-policy",
  "x-plugboard-server-tools",
  "x-plugboard-parallel-tools",
  "x-plugboard-dropped-params",
  "x-plugboard-cache",
  "x-plugboard-affinity",
  "x-plugboard-user-dropped",
  "x-plugboard-structured-fallback",
  "retry-after",
].join(", ")

/**
 * `close`: also tell the client to drop the connection (after an unread or abandoned body).
 * `retryAfterSeconds`: sent as `Retry-After` (a rate-limit refusal, see `PlugError.retryAfterSeconds`).
 */
const sendBody = (response: ServerResponse, status: number, body: string, contentType: string, options?: { close?: boolean; retryAfterSeconds?: number }) => {
  if (response.headersSent || response.destroyed) return
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    ...(options?.close ? { connection: "close" } : {}),
    ...(options?.retryAfterSeconds !== undefined ? { "retry-after": String(options.retryAfterSeconds) } : {}),
  })
  response.end(body)
}

export const sendJson = (response: ServerResponse, status: number, payload: unknown, options?: { close?: boolean; retryAfterSeconds?: number }) =>
  sendBody(response, status, JSON.stringify(payload), "application/json", options)

/**
 * A `PlugError` answered in a front-end's own wire body, before any output. Every route's `fail` goes
 * through here, so a refused call (`PlugError.retryAfterSeconds`) always carries `Retry-After`.
 */
export const sendError = (response: ServerResponse, error: PlugError, body: unknown, options?: { close?: boolean }) =>
  sendJson(response, error.status, body, { ...options, retryAfterSeconds: error.retryAfterSeconds })

/** Where `docs/errors.md` lives: each code on the `/plugboard/` routes has an anchor there. */
export const PROBLEM_DOCS = "https://jjjermiah.github.io/opencode-plugboard/errors"

/**
 * Codes that answer on `/plugboard/` and have an anchor in `docs/errors.md` (`test/http/problem.test.ts` keeps
 * the two in step). Any other code is typed `about:blank`.
 */
export const PROBLEM_CODES: ReadonlySet<string> = new Set([
  "invalid_request_target",
  "invalid_host",
  "cross_origin_forbidden",
  "unsupported_media_type",
  "invalid_api_key",
  "admin_key_required",
  "not_found",
  "method_not_allowed",
  "invalid_date",
  "invalid_range",
  "range_too_long",
  "invalid_app",
  "invalid_user",
  "app_forbidden",
  "key_not_found",
  "config_key",
  "app_has_server_tools",
  "app_has_config_key",
  "body_budget_insufficient",
  "not_ready",
  "body_read_timeout",
  "request_body_too_large",
  "server_busy",
  "timeout",
])

/**
 * An error on the `/plugboard/` routes, as RFC 9457 `application/problem+json`. `code` (or the kind, when
 * the error has none) and `param` are extension members; `requestId` is the response's request id. The
 * `detail` is the error's message, which is plugboard's own text (never a secret or provider text).
 * `instance` is the request target as the client sent it. The one encoder for the namespace.
 */
export const sendProblem = (response: ServerResponse, error: PlugError, instance: string, options?: { close?: boolean }) => {
  const code = error.code ?? error.kind
  const body = {
    type: PROBLEM_CODES.has(code) ? `${PROBLEM_DOCS}#${code.replaceAll("_", "-")}` : "about:blank",
    title: STATUS_CODES[error.status] ?? "Error",
    status: error.status,
    detail: error.message,
    instance,
    code,
    ...(error.param === undefined ? {} : { param: error.param }),
    requestId: String(response.getHeader(REQUEST_ID_HEADER) ?? ""),
  }
  sendBody(response, error.status, JSON.stringify(body), "application/problem+json", { ...options, retryAfterSeconds: error.retryAfterSeconds })
}

/**
 * SSE response writer. Headers go out with the first chunk, so nothing is committed until there
 * is something to send; chunks after the client is gone are dropped. `write` is synchronous (the
 * encoder's contract); backpressure is honoured by `paced`, which holds back the next event while
 * the socket buffer is full. `signal` (the request scope's) ends those waits when it aborts.
 *
 * Keepalive: `paced` commits the response (200 and SSE headers) at the first event that is not a
 * terminal one (reasoning counts), then writes an SSE comment whenever the stream has been idle
 * for `keepaliveMs`, until the events end. A failure before that first event still gets its real
 * HTTP status; after it, the caller must report failures as SSE frames. A tick is skipped while
 * the socket buffer is full, and stops when the client is gone or the scope aborted.
 */
export function sseWriter(response: ServerResponse, signal?: AbortSignal, keepaliveMs = KEEPALIVE_MS) {
  let started = false
  let blocked = false
  let lastWrite = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const waiters: Array<() => void> = []
  const release = () => {
    blocked = false
    for (const resolve of waiters.splice(0)) resolve()
  }
  response.on("drain", release)
  response.on("close", release)
  const commit = () => {
    if (started || response.destroyed || response.writableEnded) return
    started = true
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    })
    // `writeHead` alone queues the headers until the first body write; a keepalive commit has no body yet.
    response.flushHeaders()
  }
  const send = (chunk: string) => {
    if (!response.write(chunk)) blocked = true
    lastWrite = Date.now()
  }
  const stopKeepalive = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const arm = (delay: number) => {
    timer = setTimeout(tick, delay)
    timer.unref?.()
  }
  const tick = () => {
    timer = undefined
    if (response.destroyed || response.writableEnded || signal?.aborted) return
    const idle = Date.now() - lastWrite
    if (idle < keepaliveMs) return arm(keepaliveMs - idle)
    if (!blocked) send(": keepalive\n\n")
    arm(keepaliveMs)
  }
  const beginKeepalive = () => {
    commit()
    if (!started || timer !== undefined) return
    lastWrite = Date.now()
    arm(keepaliveMs)
  }
  response.on("close", stopKeepalive)
  const drained = (): Promise<void> => {
    if (!blocked || response.destroyed || signal?.aborted) return Promise.resolve()
    return new Promise((resolve) => {
      const done = () => {
        signal?.removeEventListener("abort", done)
        const at = waiters.indexOf(done)
        if (at >= 0) waiters.splice(at, 1)
        resolve()
      }
      waiters.push(done)
      signal?.addEventListener("abort", done, { once: true })
    })
  }
  return {
    get started() {
      return started
    },
    write(chunk: string) {
      if (response.destroyed || response.writableEnded) return
      commit()
      send(chunk)
    },
    /** Resolves when the socket buffer has room again, the client is gone, or the request scope aborted. */
    drained,
    /**
     * Passes events through, waiting for `drain` before pulling each one, and stops when the client
     * is gone. A scope abort ends the wait but not the stream: the next pull yields the timeout
     * error (or ends), and the request deadline's grace timer cuts a socket that cannot take it.
     */
    async *paced(events: AsyncIterable<PlugEvent>): AsyncGenerator<PlugEvent> {
      const iterator = events[Symbol.asyncIterator]()
      try {
        while (true) {
          await drained()
          if (response.destroyed) return
          const next = await iterator.next()
          if (next.done) return
          if (next.value.type !== "error" && next.value.type !== "finish") beginKeepalive()
          yield next.value
        }
      } finally {
        stopKeepalive()
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
 * The `Host` header check (I16). On a keyed loopback endpoint behind a trusted proxy (`listen.trustProxy`, #266), the
 * proxy's `X-Forwarded-Host` is checked instead: that is the public name the proxy served. A keyless endpoint never
 * takes it, because a page that rebinds its name to the listener could send the header too. A preflight runs this
 * check as well: it carries no credentials, but must not bypass the DNS rebinding check.
 */
export function checkHost(request: IncomingMessage, options: PlugboardOptions): PlugError | undefined {
  if (Object.keys(options.keys).length > 0 && forwardedHost(request, options.listen.trustProxy) !== undefined) return undefined
  if (!hostAllowed(options, request.headers.host))
    return { status: 403, kind: "permission", code: "invalid_host", message: "Host header not allowed" }
}

/**
 * The origin to echo in `Access-Control-Allow-Origin` (option `cors`, #256): the request's own origin when it is on the
 * allowlist, `*` when the wildcard is configured (it needs keys), else `undefined`. A request without `Origin` has none.
 */
export function corsOrigin(request: IncomingMessage, options: PlugboardOptions): string | undefined {
  const origins = options.cors?.origins
  const origin = request.headers.origin
  if (origins === undefined || origin === undefined) return undefined
  if (origins.includes("*")) return "*"
  return origins.includes(origin) ? origin : undefined
}

/**
 * Browser-reachable loopback endpoints: block DNS rebinding (Host header) and, on a keyless endpoint, cross-site calls
 * (any Origin header) unless the origin is on the `cors` allowlist (#256).
 */
export function checkOrigin(request: IncomingMessage, options: PlugboardOptions): PlugError | undefined {
  const hostError = checkHost(request, options)
  if (hostError) return hostError
  if (Object.keys(options.keys).length === 0 && request.headers.origin !== undefined && corsOrigin(request, options) === undefined)
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
