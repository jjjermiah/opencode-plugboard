/**
 * HTTP route table: `GET /healthz`, `GET /v1/models`, `POST /v1/chat/completions`.
 *
 * Everything format- or config-specific arrives through the injected `RouteDeps` (config lane:
 * options, auth, model resolution; OpenAI lane: request parsing and response encoding), so
 * this file knows only the flow: authenticate, parse, resolve, call the ModelCaller, encode.
 */

import type { IncomingMessage, ServerResponse } from "node:http"
import type { CatalogModel, ModelCaller, ModelRef, PlugError, PlugEvent, PlugRequest, PlugboardOptions } from "./contract.js"

export interface RouteDeps {
  parseOptions(raw: unknown): PlugboardOptions
  authenticate(options: PlugboardOptions, authorization: string | undefined): { app: string } | PlugError
  toCatalog(raw: unknown[]): CatalogModel[]
  resolveModel(options: PlugboardOptions, model: string, catalog: CatalogModel[], reasoningEffort?: string): ModelRef | PlugError
  listModels(options: PlugboardOptions, catalog: CatalogModel[]): object[]
  parseChatRequest(
    body: unknown,
    options: PlugboardOptions,
  ): { request: Omit<PlugRequest, "ref">; reasoningEffort?: string } | PlugError
  collectCompletion(events: AsyncIterable<PlugEvent>, request: PlugRequest): Promise<{ status: number; body: object }>
  streamCompletion(events: AsyncIterable<PlugEvent>, request: PlugRequest, write: (chunk: string) => void): Promise<void>
  encodeError(error: PlugError): object
}

/** What the serving generation supplies per request. */
export interface RouteHost {
  readonly options: PlugboardOptions
  readonly caller: ModelCaller
  /** Raw `ctx.model.list` data from the serving Location. */
  loadCatalog(): Promise<unknown[]>
}

const MAX_BODY_BYTES = 32 * 1024 * 1024

const isPlugError = (value: unknown): value is PlugError =>
  typeof value === "object" && value !== null && "status" in value && "type" in value && "message" in value

class BodyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function readBody(request: IncomingMessage): Promise<unknown> {
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

const sendJson = (response: ServerResponse, status: number, payload: unknown) => {
  if (response.headersSent) return
  const body = JSON.stringify(payload)
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) })
  response.end(body)
}

/**
 * Bound the event stream by the request timeout. On timeout the caller is aborted
 * (so the session is interrupted) and a 504 error event ends the stream.
 */
async function* withTimeout(
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
  const listenHost = options.listen.host.toLowerCase().replace(/^\[|\]$/g, "")
  const loopback = listenHost === "localhost" || listenHost === "::1" || /^127(\.\d{1,3}){3}$/.test(listenHost)
  if (!loopback) return true
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec((hostHeader ?? "").trim().toLowerCase())
  if (!match || !LOOPBACK_HOSTS.has(match[1]!)) return false
  return (match[2] ?? "80") === String(options.listen.port)
}

export function createRouter(deps: RouteDeps, host: RouteHost) {
  const fail = (response: ServerResponse, error: PlugError) => sendJson(response, error.status, deps.encodeError(error))

  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    const route = `${request.method} ${url.pathname}`
    try {
      // Browser-reachable loopback endpoints: block DNS rebinding and cross-site calls (CSRF).
      if (!hostAllowed(host.options, request.headers.host))
        return fail(response, { status: 403, type: "permission_error", code: "invalid_host", message: "Host header not allowed" })
      if (Object.keys(host.options.keys).length === 0 && request.headers.origin !== undefined)
        return fail(response, {
          status: 403,
          type: "permission_error",
          code: "cross_origin_forbidden",
          message: "Cross-origin requests are not allowed on a keyless endpoint; configure `keys`",
        })

      if (route === "GET /healthz") return sendJson(response, 200, { ok: true })

      const known = ["GET /v1/models", "POST /v1/chat/completions"]
      if (!known.includes(route)) {
        return fail(response, {
          status: 404,
          type: "not_found_error",
          code: "not_found",
          message: `No route for ${request.method} ${url.pathname}`,
        })
      }

      const auth = deps.authenticate(host.options, request.headers.authorization)
      if (isPlugError(auth)) return fail(response, auth)

      if (route === "GET /v1/models") {
        const catalog = deps.toCatalog(await host.loadCatalog())
        return sendJson(response, 200, { object: "list", data: deps.listModels(host.options, catalog) })
      }

      const contentType = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase()
      if (contentType !== "application/json")
        return fail(response, {
          status: 415,
          type: "invalid_request_error",
          code: "unsupported_media_type",
          message: "Content-Type must be application/json",
        })

      const body = await readBody(request)
      const parsed = deps.parseChatRequest(body, host.options)
      if (isPlugError(parsed)) return fail(response, parsed)
      const catalog = deps.toCatalog(await host.loadCatalog())
      const ref = deps.resolveModel(host.options, parsed.request.model, catalog, parsed.reasoningEffort)
      if (isPlugError(ref)) return fail(response, ref)
      const plug: PlugRequest = { ...parsed.request, ref }

      // Client disconnect (also mid-SSE) aborts the call, which interrupts the session.
      const controller = new AbortController()
      response.on("close", () => {
        if (!response.writableFinished) controller.abort()
      })
      const events = withTimeout(host.caller.stream(plug, { app: auth.app, signal: controller.signal }), host.options.requestTimeoutMs, controller)

      if (plug.stream) {
        // Errors before any content are real HTTP errors, not a 200 SSE stream: pull events
        // until the first one that is not reasoning (which streaming drops anyway).
        const iterator = events[Symbol.asyncIterator]()
        let first = await iterator.next()
        while (!first.done && first.value.type === "reasoning-delta") first = await iterator.next()
        if (!first.done && first.value.type === "error") {
          void iterator.return?.(undefined)?.catch?.(() => {})
          return fail(response, first.value.error)
        }
        const lead = first
        const rest: AsyncIterable<PlugEvent> = {
          async *[Symbol.asyncIterator]() {
            try {
              if (!lead.done) yield lead.value
              while (true) {
                const next = await iterator.next()
                if (next.done) return
                yield next.value
              }
            } finally {
              void iterator.return?.(undefined)?.catch?.(() => {})
            }
          },
        }
        let started = false
        await deps.streamCompletion(rest, plug, (chunk) => {
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
        })
        if (!started && !response.headersSent) sendJson(response, 502, deps.encodeError({ status: 502, type: "server_error", message: "No response from the model" }))
        else if (!response.writableEnded) response.end()
        return
      }

      const result = await deps.collectCompletion(events, plug)
      sendJson(response, result.status, result.body)
    } catch (error) {
      if (error instanceof BodyError) return fail(response, { status: error.status, type: "invalid_request_error", message: error.message })
      const message = error instanceof Error ? error.message : String(error)
      console.error("[opencode-plugboard] request failed", error)
      if (response.headersSent) return void response.end()
      fail(response, { status: 500, type: "server_error", message })
    }
  }
}
