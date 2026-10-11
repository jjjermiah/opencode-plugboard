/**
 * OpenAI front-end route table: `GET /healthz`, `GET /v1/models`, `GET /v1/models/{id}`,
 * `POST /v1/chat/completions` (`n` > 1 through `./fanout.ts`), and the dispatch of `POST /v1/responses`
 * and `POST /v1/completions` to `src/responses/route.ts` and `src/completions/route.ts`.
 * Observability and first-run routes (`src/discovery.ts`, `src/metrics.ts`): `GET /` and `GET /v1`
 * (keyless discovery), the authenticated `GET /v1/status`, and `GET /metrics` (option `metrics`).
 *
 * The flow is: establish cancellation and the deadline, check origin, authenticate, parse, resolve
 * the model, call the ModelCaller, encode. Parsing, policy and encoding are imported directly;
 * only effects (the model caller, the catalog and the serving generation's options) arrive
 * through `RouteHost`.
 *
 * Response header `x-plugboard-session: <id>` carries the id of the history record the call
 * writes (the `ModelCaller` reports it through `CallContext.onRecord`). It is set before the
 * response headers go out (JSON body or first SSE chunk); an id reported after that is ignored.
 *
 * Response header `x-plugboard-request-id: <id>` is set on every response, before anything else
 * can fail. The same id is the `id` of the request's log line, and of every other log line emitted
 * while the request is being handled (`withRequestId` in `src/log.ts`).
 */

import type { IncomingMessage, ServerResponse } from "node:http"
import { DEFAULT_APP, authenticate, type PlugboardOptions } from "../config.js"
import { isPlugError, type CatalogModel, type ModelCaller, type PlugError, type PlugRequest } from "../contract.js"
import { buildDiscovery, buildStatus, renderDiscoveryHtml, sendText } from "../discovery.js"
import {
  BodyError,
  RequestAborted,
  beginRequest,
  boundEvents,
  checkJsonContentType,
  checkOrigin,
  finishRequest,
  readJsonBody,
  sendJson,
  sseWriter,
  type RequestScope,
} from "../http.js"
import { errorMessage, log, logError, withRequestId } from "../log.js"
import { NO_APP, outcomeLabel, type Metrics } from "../metrics.js"
import { listAvailableModels, resolveModel } from "../models.js"
import { isMessagesPath, serveMessages } from "../anthropic/route.js"
import { serveCompletions } from "../completions/route.js"
import { serveResponses } from "../responses/route.js"
import { processMetrics, processStatus, type RuntimeStatus } from "../runtime.js"
import { chatCodec, serveChoices } from "./fanout.js"
import { parseChatRequest } from "./request.js"
import { collectCompletion, encodeError, encodeModelList, streamCompletion } from "./response.js"
import { dropRejected } from "./sampling.js"

/** What the serving generation supplies per request. */
export interface RouteHost {
  readonly options: PlugboardOptions
  readonly caller: ModelCaller
  /** The serving Location's enabled models. */
  loadCatalog(): Promise<ReadonlyArray<CatalogModel>>
  /** Metrics registry; the process runtime's by default. Only written to when option `metrics` is on. */
  readonly metrics?: Metrics
  /** Runtime facts for `/v1/status` and `/metrics`; the process runtime's by default. */
  readonly status?: () => RuntimeStatus
}

const SESSION_HEADER = "x-plugboard-session"
const REQUEST_ID_HEADER = "x-plugboard-request-id"
const DROPPED_HEADER = "x-plugboard-dropped-params"
const MODEL_PREFIX = "/v1/models/"
const KNOWN_ROUTES = ["GET /v1/models", "POST /v1/chat/completions", "POST /v1/completions", "POST /v1/responses", "GET /v1/status"]
/** Pages anyone may fetch; they decide for themselves how much to show (see `src/discovery.ts`). */
const DISCOVERY_ROUTES = ["GET /", "GET /v1"]
/** Allows a page's inline style and nothing else: no scripts, images, fonts or frames. */
const PAGE_HEADERS = { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'", "x-frame-options": "DENY", "referrer-policy": "no-referrer" }

/** Records the token usage of every finished model call (see `plugboard_tokens_total`); events pass through untouched. */
function metered(caller: ModelCaller, metrics: Metrics): ModelCaller {
  return {
    stream(request, context) {
      const inner = caller.stream(request, context)
      return (async function* () {
        for await (const event of inner) {
          if (event.type === "finish" && event.usage) metrics.tokens(context.app, event.usage)
          yield event
        }
      })()
    },
  }
}

const decodeSegment = (raw: string): string => {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** What a request log line may carry: ids and outcomes only. */
interface RequestInfo {
  route: string
  app?: string
  model?: string
  /** Set when a response committed as 200 and then failed (a stream error frame): the log outcome and the error code. */
  failed?: string
  /** Sampling parameters dropped for this model (comma list), when any. */
  dropped?: string
}

export function createOpenAiRoute(routeHost: RouteHost) {
  // Metrics are written only when the option is on: off means no bookkeeping, no wrapped event stream.
  const metrics = routeHost.options.metrics ? (routeHost.metrics ?? processMetrics()) : undefined
  const runtimeStatus = routeHost.status ?? processStatus
  const host: RouteHost = metrics ? { ...routeHost, caller: metered(routeHost.caller, metrics) } : routeHost
  /** Routes with a handler of their own. `GET /metrics` exists only when enabled; otherwise it is an unknown path. */
  const known = (route: string) => KNOWN_ROUTES.includes(route) || DISCOVERY_ROUTES.includes(route) || (metrics !== undefined && route === "GET /metrics")

  const fail = (response: ServerResponse, error: PlugError, close = false) =>
    sendJson(response, error.status, encodeError(error), { close })

  /** The catalog for a page that can do without it: a failure is logged and reported as absent; an abort still ends the request. */
  async function optionalCatalog(scope: RequestScope): Promise<ReadonlyArray<CatalogModel> | undefined> {
    try {
      return await scope.race(host.loadCatalog())
    } catch (caught) {
      if (caught instanceof RequestAborted) throw caught
      logError("catalog.failed", { error: errorMessage(caught) })
      return undefined
    }
  }

  /** The route proper. Throws `BodyError`, `RequestAborted` or an unexpected error; `handle` maps them. */
  async function serve(request: IncomingMessage, response: ServerResponse, scope: RequestScope, info: RequestInfo): Promise<void> {
    let url: URL
    try {
      url = new URL(request.url ?? "/", "http://127.0.0.1")
    } catch {
      return fail(response, { status: 400, kind: "invalid_request", code: "invalid_request_target", message: "Malformed request target" })
    }
    const path = url.pathname
    const modelId = request.method === "GET" && path.startsWith(MODEL_PREFIX) && path.length > MODEL_PREFIX.length ? decodeSegment(path.slice(MODEL_PREFIX.length)) : undefined
    const route = `${request.method} ${modelId !== undefined ? "/v1/models/{id}" : path}`
    // Arbitrary client paths stay out of the log.
    info.route = modelId !== undefined || known(route) || route === "GET /healthz" ? route : "unknown"
    // Anthropic Messages: its own error shape and x-api-key auth, so it takes the request from here.
    if (isMessagesPath(path)) return serveMessages(host, { path, request, response, scope, info })

    const rejected = checkOrigin(request, host.options)
    if (rejected) return fail(response, rejected)

    if (route === "GET /healthz") return sendJson(response, 200, { ok: true })

    // First-run pages: reachable without a key, so what they show depends on the caller (`buildDiscovery`).
    // With `keys` set, a request without credentials gets the minimal page; wrong credentials are a 401.
    if (DISCOVERY_ROUTES.includes(route)) {
      const keyed = Object.keys(host.options.keys).length > 0
      let app: string | undefined = keyed ? undefined : DEFAULT_APP
      if (keyed && request.headers.authorization !== undefined) {
        const auth = authenticate(host.options, request.headers.authorization)
        if (isPlugError(auth)) return fail(response, auth)
        app = auth.app
      }
      info.app = app
      const doc = buildDiscovery({ options: host.options, app, catalog: app === undefined ? undefined : await optionalCatalog(scope) })
      if (route === "GET /v1") return sendJson(response, 200, doc)
      return sendText(response, 200, "text/html; charset=utf-8", renderDiscoveryHtml(doc), PAGE_HEADERS)
    }

    // Authenticate before anything reveals which routes exist: an unauthenticated caller sees 401 for every path but /healthz and the first-run pages.
    const auth = authenticate(host.options, request.headers.authorization)
    if (isPlugError(auth)) return fail(response, auth)
    info.app = auth.app

    if (modelId === undefined && !known(route)) {
      return fail(response, {
        status: 404,
        kind: "not_found",
        code: "not_found",
        message: `No route for ${request.method} ${path}`,
      })
    }

    if (route === "GET /v1/status") {
      const catalog = await optionalCatalog(scope)
      return sendJson(response, 200, buildStatus({ options: host.options, app: auth.app, runtime: runtimeStatus(), catalog }))
    }

    if (route === "GET /metrics" && metrics) {
      return sendText(response, 200, "text/plain; version=0.0.4; charset=utf-8", metrics.render(runtimeStatus()))
    }

    if (route === "GET /v1/models" || modelId !== undefined) {
      const listed = listAvailableModels(host.options, await scope.race(host.loadCatalog()))
      if (modelId === undefined) return sendJson(response, 200, encodeModelList(listed))
      const item = listed.find((m) => m.id === modelId)
      if (!item) {
        return fail(response, {
          status: 404,
          kind: "not_found",
          code: "model_not_found",
          param: "model",
          message: `Model ${modelId} is not available`,
        })
      }
      info.model = item.id
      return sendJson(response, 200, (encodeModelList([item]) as { data: object[] }).data[0])
    }

    const unsupported = checkJsonContentType(request)
    if (unsupported) return fail(response, unsupported)

    const body = await readJsonBody(request, scope.signal)
    if (route === "POST /v1/responses") return serveResponses(host, { app: auth.app, body, response, scope, info })
    if (route === "POST /v1/completions") return serveCompletions(host, { app: auth.app, body, response, scope, info })
    const parsed = parseChatRequest(body, host.options)
    if (isPlugError(parsed)) return fail(response, parsed)
    const catalog = await scope.race(host.loadCatalog())
    const ref = resolveModel(host.options, parsed.request.model, catalog, parsed.reasoningEffort)
    if (isPlugError(ref)) return fail(response, ref)
    info.model = `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`
    // Sampling parameters the model is known to reject are dropped and reported (header and log), before any response bytes.
    const sampled = host.options.dropUnsupportedParams ? dropRejected(ref, parsed.request.generation) : undefined
    if (sampled && sampled.dropped.length > 0) {
      info.dropped = sampled.dropped.join(",")
      response.setHeader(DROPPED_HEADER, info.dropped)
      metrics?.dropped(sampled.dropped)
    }
    const call: PlugRequest = { ...parsed.request, ...(sampled ? { generation: sampled.generation } : {}), ref }
    const { exchange } = parsed
    // n > 1: one independent call per choice, merged (src/openai/fanout.ts).
    if (parsed.n > 1)
      return serveChoices(host, { app: auth.app, calls: Array.from({ length: parsed.n }, () => call), response, scope, info, codec: chatCodec(exchange) })

    // Abandoned requests (client gone, deadline passed) must never reach the model caller.
    if (scope.signal.aborted) throw scope.signal.reason
    const events = boundEvents(
      host.caller.stream(call, {
        app: auth.app,
        signal: scope.signal,
        onRecord: (recordID) => {
          if (response.headersSent || response.destroyed || !/^[\x21-\x7e]+$/.test(recordID)) return
          response.setHeader(SESSION_HEADER, recordID)
        },
      }),
      scope,
    )

    if (exchange.stream) {
      // Nothing is committed until the first model event that is not a terminal one (reasoning
      // counts: `paced` then commits 200 and sends keepalive comments), so a failure before that is a
      // real HTTP error. After it, a failure is an SSE error frame.
      const sse = sseWriter(response, scope.signal)
      const { failure, started } = await streamCompletion(sse.paced(events), exchange, sse.write)
      if (!sse.started && !response.headersSent) {
        if (!scope.signal.aborted || scope.timedOut) fail(response, failure ?? { status: 502, kind: "server", message: "No response from the model" })
      } else {
        if (failure) {
          info.failed = failure.code ?? failure.kind
          // Committed by a keepalive before the encoder wrote anything: the encoder left the error for us.
          if (!started && !response.writableEnded) sse.write(`data: ${JSON.stringify(encodeError(failure))}\n\ndata: [DONE]\n\n`)
        }
        if (!response.writableEnded) response.end()
      }
      return
    }

    const result = await collectCompletion(events, exchange)
    sendJson(response, result.status, result.body)
  }

  /** Never rejects: every failure ends in a response (or a closed socket) and one log line. */
  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // Generated here, never taken from the client: the id is echoed and logged, so it must not be attacker-controlled text.
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 12)
    if (!response.headersSent) response.setHeader(REQUEST_ID_HEADER, id)
    return withRequestId(id, () => run(request, response, id))
  }

  async function run(request: IncomingMessage, response: ServerResponse, id: string): Promise<void> {
    const started = Date.now()
    const info: RequestInfo = { route: "unparsed" }
    metrics?.requestStarted()
    const scope = beginRequest(request, response, host.options.requestTimeoutMs)
    let outcome = "ok"
    let error: string | undefined
    try {
      try {
        await serve(request, response, scope, info)
      } catch (caught) {
        if (caught instanceof RequestAborted) {
          outcome = caught.kind
          if (caught.kind === "timeout") {
            if (response.headersSent) response.end()
            else fail(response, scope.timeoutError, true)
          }
        } else if (caught instanceof BodyError) {
          outcome = `body_${caught.status}`
          // 413: the client may still be sending; answer, then close (see `finishRequest`).
          fail(response, { status: caught.status, kind: "invalid_request", message: caught.message }, caught.status === 413)
        } else {
          // Unexpected: the message goes to the log only; the client gets a generic one.
          outcome = "error"
          error = errorMessage(caught)
          if (response.headersSent) {
            if (!response.writableEnded) response.end()
          } else fail(response, { status: 500, kind: "server", message: "Internal server error" })
        }
      }
      if (outcome === "ok" && scope.signal.aborted) outcome = scope.timedOut ? "timeout" : "disconnected"
      else if (outcome === "ok" && info.failed !== undefined) {
        outcome = "error"
        error = info.failed
      } else if (outcome === "ok" && response.statusCode >= 400) outcome = `status_${response.statusCode}`
    } catch (caught) {
      outcome = "error"
      error = errorMessage(caught)
    } finally {
      scope.dispose()
      try {
        finishRequest(request, response)
      } catch {}
      const ms = Date.now() - started
      metrics?.requestFinished({ app: info.app ?? NO_APP, route: info.route, status: response.statusCode, outcome: outcomeLabel(outcome, response.statusCode), ms })
      // Probes and scrapes that succeed are not worth a line each.
      if ((info.route !== "GET /healthz" && info.route !== "GET /metrics") || outcome !== "ok") {
        const fields = { id, route: info.route, app: info.app, model: info.model, dropped: info.dropped, status: response.statusCode, ms, outcome, error }
        if (outcome === "error" || response.statusCode >= 500) logError("request.failed", fields)
        else log("request", fields)
      }
    }
  }
}
