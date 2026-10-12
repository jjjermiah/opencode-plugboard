/**
 * Real loopback HTTP for the HTTP-layer tests: a `node:http` server on 127.0.0.1 with an
 * ephemeral port, and a raw `node:http` client that controls every header (Host, Origin,
 * Content-Length) and can read an SSE stream frame by frame or hang up mid-response.
 *
 * `startRoute` serves the real OpenAI route (`createOpenAiRoute`) with a fake model caller. The
 * options are parsed after the port is known, because the Host check compares the Host header's
 * port with `listen.port`.
 */
import { createServer, request as httpRequest, type ClientRequest, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { createParser } from "eventsource-parser"
import type { PlugboardOptions } from "../../src/config.js"
import type { CatalogModel, ModelCaller } from "../../src/contract.js"
import { createMetrics, type Metrics } from "../../src/metrics.js"
import { createOpenAiRoute } from "../../src/openai/route.js"
import type { UsageRecorder } from "../../src/usage.js"
import type { KeyStore } from "../../src/keys.js"
import type { RuntimeStatus } from "../../src/runtime.js"
import { CATALOG, testOptions } from "./fixtures.js"

export interface Reply {
  readonly status: number
  readonly headers: IncomingHttpHeaders
  readonly text: string
  /** The body parsed as JSON (untyped: tests assert its shape). */
  json(): any
}

export interface SendInit {
  readonly method?: string
  readonly path?: string
  readonly headers?: Record<string, string | number>
  /** An object is sent as JSON, a string or Buffer as is; either way `content-type: application/json` unless a content-type is given. */
  readonly body?: unknown
}

export interface OpenStream {
  readonly status: number
  readonly headers: IncomingHttpHeaders
  /** Everything received so far. */
  readonly received: string
  /** Waits until the received text satisfies `check` (default 1 s). */
  waitFor(check: (received: string) => boolean, ms?: number): Promise<string>
  /** Resolves with the full text when the server ends the response (or the socket closes). */
  readonly ended: Promise<string>
  /** Stop reading without closing: the socket buffers fill up (a slow reader). */
  pause(): void
  /** Hang up: destroys the client socket. */
  destroy(): void
}

export interface Loopback {
  readonly port: number
  readonly url: string
  /** One request; resolves with the full response. */
  send(init?: SendInit): Promise<Reply>
  /** One request whose response is read incrementally. Resolves once the status line and headers arrive. */
  open(init?: SendInit): Promise<OpenStream>
  /** Sends a request and returns the raw client request, e.g. to hang up before any response. */
  raw(init?: SendInit): ClientRequest
  close(): Promise<void>
}

function encodeBody(init: SendInit): { headers: Record<string, string | number>; payload?: string | Buffer } {
  const headers: Record<string, string | number> = { ...init.headers }
  if (init.body === undefined) return { headers }
  if (!Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) headers["content-type"] = "application/json"
  if (typeof init.body === "string" || Buffer.isBuffer(init.body)) return { headers, payload: init.body }
  return { headers, payload: JSON.stringify(init.body) }
}

function start(port: number, init: SendInit, onResponse: (response: IncomingMessage) => void, onError: (error: Error) => void) {
  const { headers, payload } = encodeBody(init)
  const client = httpRequest({ host: "127.0.0.1", port, method: init.method ?? (init.body === undefined ? "GET" : "POST"), path: init.path ?? "/", headers, agent: false })
  client.on("response", onResponse)
  client.on("error", onError)
  client.end(payload)
  return client
}

/** Listen on 127.0.0.1 (or `host`, e.g. `::1`) with an ephemeral port. The client always connects to 127.0.0.1. */
export async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void, host = "127.0.0.1"): Promise<Loopback> {
  const server: Server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, host, resolve))
  const port = (server.address() as AddressInfo).port
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    send: (init = {}) =>
      new Promise((resolve, reject) => {
        start(
          port,
          init,
          (response) => {
            const chunks: Buffer[] = []
            response.on("data", (chunk: Buffer) => chunks.push(chunk))
            response.on("end", () => {
              const text = Buffer.concat(chunks).toString("utf8")
              resolve({ status: response.statusCode ?? 0, headers: response.headers, text, json: () => JSON.parse(text) })
            })
            response.on("error", reject)
          },
          reject,
        )
      }),
    open: (init = {}) =>
      new Promise((resolve, reject) => {
        const client = start(
          port,
          init,
          (response) => {
            let received = ""
            const listeners = new Set<() => void>()
            response.setEncoding("utf8")
            response.on("data", (chunk: string) => {
              received += chunk
              for (const listener of listeners) listener()
            })
            const ended = new Promise<string>((done) => {
              response.on("end", () => done(received))
              response.on("close", () => done(received))
              response.on("error", () => done(received))
            })
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              get received() {
                return received
              },
              ended,
              waitFor: (check, ms = 1_000) =>
                new Promise((done, fail) => {
                  if (check(received)) return done(received)
                  const timer = setTimeout(() => {
                    listeners.delete(listener)
                    fail(new Error(`Timed out after ${ms} ms; received so far:\n${received}`))
                  }, ms)
                  const listener = () => {
                    if (!check(received)) return
                    clearTimeout(timer)
                    listeners.delete(listener)
                    done(received)
                  }
                  listeners.add(listener)
                  void ended.then(listener)
                }),
              pause: () => {
                response.pause()
                client.socket?.pause()
              },
              destroy: () => client.destroy(),
            })
          },
          reject,
        )
      }),
    raw: (init = {}) =>
      start(
        port,
        init,
        (response) => response.resume(),
        () => {},
      ),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

export interface RouteServer extends Loopback {
  readonly options: PlugboardOptions
  /** The route's metrics registry (fresh per server; written only when option `metrics` is on). */
  readonly metrics: Metrics
}

/** The runtime facts `/v1/status` and `/metrics` report, fixed for tests (the real ones come from src/runtime.ts). */
export const TEST_STATUS: RuntimeStatus = { runtimeVersion: 8, generations: 1, pumpRunning: false, guards: 0, startedAt: Date.UTC(2026, 9, 11), servingConfirmed: false, catalogLoaded: false }

export interface RouteSetup {
  readonly caller: ModelCaller
  /** Raw plugin options (`listen` is filled in); defaults to `testOptions()`'s. */
  readonly options?: Record<string, unknown>
  readonly catalog?: ReadonlyArray<CatalogModel> | (() => Promise<ReadonlyArray<CatalogModel>>)
  /** Runtime facts for `/v1/status` and `/metrics`; `TEST_STATUS` by default, so no process runtime is created. */
  readonly status?: () => RuntimeStatus
  /** The usage recorder behind `GET /v1/usage` (and the request log point). Absent: no usage route. */
  readonly usage?: UsageRecorder
  /** The runtime app key store (src/keys.ts, #55) behind the admin routes and runtime keys. Absent: no runtime keys. */
  readonly keys?: KeyStore
}

/** The real OpenAI route behind a loopback listener, with a fake model caller and a fixed catalog. */
export async function startRoute(setup: RouteSetup): Promise<RouteServer> {
  let handle: ((request: IncomingMessage, response: ServerResponse) => Promise<void>) | undefined
  const server = await listen((request, response) => void handle!(request, response))
  const options = testOptions({ ...setup.options, listen: { host: "127.0.0.1", port: server.port } })
  const catalog = setup.catalog ?? CATALOG
  const metrics = createMetrics()
  handle = createOpenAiRoute({
    options,
    caller: setup.caller,
    loadCatalog: typeof catalog === "function" ? catalog : async () => catalog,
    metrics,
    status: setup.status ?? (() => TEST_STATUS),
    ...(setup.usage ? { usage: setup.usage } : {}),
    ...(setup.keys ? { keys: setup.keys } : {}),
  })
  return { ...server, options, metrics }
}

/** One parsed SSE item, in stream order: an event (`data`, and `event` when named) or a comment (`: keepalive`). */
export interface SseFrame {
  readonly event?: string
  readonly data?: string
  readonly comment?: string
}

/**
 * Parse an SSE body with eventsource-parser, the parser real clients use (AI SDK, `eventsource`),
 * so tests assert what a client sees: multi-line data joined, `\r\n` handled, events without data
 * not dispatched. Comments are kept in order for the keepalive checks (#129); tests that care about
 * exact bytes read `OpenStream.received` instead.
 */
export function parseSse(text: string): SseFrame[] {
  const frames: SseFrame[] = []
  const parser = createParser({
    onEvent: (message) => void frames.push({ ...(message.event === undefined ? {} : { event: message.event }), data: message.data }),
    onComment: (comment) => void frames.push({ comment: comment.trim() }),
    onError: (error) => {
      throw error
    },
  })
  // No trailing blank line is added: an event the server did not terminate is not delivered, as for a real client.
  parser.feed(text)
  return frames
}

/** The JSON payloads of the `data:` frames, without `[DONE]` and comments. */
export const sseData = (text: string): any[] =>
  parseSse(text)
    .filter((frame) => frame.data !== undefined && frame.data !== "[DONE]")
    .map((frame) => JSON.parse(frame.data!))
