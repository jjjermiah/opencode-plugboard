/**
 * OpenAI front-end route table: `GET /healthz`, `GET /v1/models`, `GET /v1/models/{id}`,
 * `POST /v1/chat/completions`, and the dispatch of `POST /v1/responses` to `src/responses/route.ts`.
 *
 * The flow is: establish cancellation and the deadline, check origin, authenticate, parse, resolve
 * the model, call the ModelCaller, encode. Parsing, policy and encoding are imported directly;
 * only effects (the model caller, the catalog and the serving generation's options) arrive
 * through `RouteHost`.
 *
 * Response header `x-plugboard-session: <id>` carries the id of the history record the call
 * writes (the `ModelCaller` reports it through `CallContext.onRecord`). It is set before the
 * response headers go out (JSON body or first SSE chunk); an id reported after that is ignored.
 */

import type { IncomingMessage, ServerResponse } from "node:http"
import { authenticate, type PlugboardOptions } from "../config.js"
import { isPlugError, type CatalogModel, type ModelCaller, type PlugError, type PlugRequest } from "../contract.js"
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
import { errorMessage, log, logError } from "../log.js"
import { listAvailableModels, resolveModel } from "../models.js"
import { serveResponses } from "../responses/route.js"
import { parseChatRequest } from "./request.js"
import { collectCompletion, encodeError, encodeModelList, streamCompletion } from "./response.js"
import { dropRejected } from "./sampling.js"

/** What the serving generation supplies per request. */
export interface RouteHost {
  readonly options: PlugboardOptions
  readonly caller: ModelCaller
  /** The serving Location's enabled models. */
  loadCatalog(): Promise<ReadonlyArray<CatalogModel>>
}

const SESSION_HEADER = "x-plugboard-session"
const DROPPED_HEADER = "x-plugboard-dropped-params"
const MODEL_PREFIX = "/v1/models/"
const KNOWN_ROUTES = ["GET /v1/models", "POST /v1/chat/completions", "POST /v1/responses"]

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

export function createOpenAiRoute(host: RouteHost) {
  const fail = (response: ServerResponse, error: PlugError, close = false) =>
    sendJson(response, error.status, encodeError(error), { close })

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
    info.route = modelId !== undefined || KNOWN_ROUTES.includes(route) || route === "GET /healthz" ? route : "unknown"

    const rejected = checkOrigin(request, host.options)
    if (rejected) return fail(response, rejected)

    if (route === "GET /healthz") return sendJson(response, 200, { ok: true })

    // Authenticate before anything reveals which routes exist: an unauthenticated caller sees 401 for every path but /healthz.
    const auth = authenticate(host.options, request.headers.authorization)
    if (isPlugError(auth)) return fail(response, auth)
    info.app = auth.app

    if (modelId === undefined && !KNOWN_ROUTES.includes(route)) {
      return fail(response, {
        status: 404,
        kind: "not_found",
        code: "not_found",
        message: `No route for ${request.method} ${path}`,
      })
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
    }
    const call: PlugRequest = { ...parsed.request, ...(sampled ? { generation: sampled.generation } : {}), ref }
    const { exchange } = parsed

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
    const started = Date.now()
    const id = crypto.randomUUID().slice(0, 8)
    const info: RequestInfo = { route: "unparsed" }
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
      if (info.route !== "GET /healthz" || outcome !== "ok") {
        const fields = { id, route: info.route, app: info.app, model: info.model, dropped: info.dropped, status: response.statusCode, ms: Date.now() - started, outcome, error }
        if (outcome === "error" || response.statusCode >= 500) logError("request.failed", fields)
        else log("request", fields)
      }
    }
  }
}
