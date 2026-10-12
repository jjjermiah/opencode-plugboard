/**
 * OpenAI front-end route table: `GET /healthz`, `GET /readyz`, `GET /v1/models`, `GET /v1/models/{id}`,
 * `POST /v1/chat/completions` (`n` > 1 through `./fanout.ts`), and the dispatch of `POST /v1/responses`
 * and `POST /v1/completions` to `src/responses/route.ts` and `src/completions/route.ts`.
 * Observability and first-run routes (`src/discovery.ts`, `src/metrics.ts`): `GET /` and `GET /v1`
 * (keyless discovery), the authenticated `GET /v1/status`, `GET /metrics` (option `metrics`), and the
 * usage dashboard `GET /dashboard` with its assets (option `usage`, `src/dashboard/`).
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
import { serveAdmin } from "../admin/route.js"
import { DEFAULT_APP, authenticate, authenticateUsage, bodyLimits, historyTemplate, type PlugboardOptions } from "../config.js"
import { isPlugError, type CatalogModel, type ModelCaller, type PlugError, type PlugRequest } from "../contract.js"
import { buildDiscovery, buildStatus, readiness, renderDiscoveryHtml, sendText } from "../discovery.js"
import {
  BodyError,
  bodyPlugError,
  RequestAborted,
  beginRequest,
  boundEvents,
  checkJsonContentType,
  checkOrigin,
  finishRequest,
  readJsonBody,
  sendError,
  sendJson,
  sseWriter,
  type RequestScope,
} from "../http.js"
import { reportServed, type ServedInfo } from "../fallback.js"
import { encodeGeminiError } from "../gemini/response.js"
import { geminiAuthorization, matchGeminiRoute, serveGemini } from "../gemini/route.js"
import { errorMessage, log, logError, withRequestId } from "../log.js"
import { NO_APP, outcomeLabel, type Metrics } from "../metrics.js"
import { filterByCapability, listAvailableModels, parseCapability, resolveModel } from "../models.js"
import { reportCache } from "../cache.js"
import { reportParallelTools, reportPolicy, reportServerTools } from "../policy.js"
import { reportUsage } from "../usage-header.js"
import { isMessagesPath, serveMessages } from "../anthropic/route.js"
import { serveCompletions } from "../completions/route.js"
import { serveResponses } from "../responses/route.js"
import { liveOptions, processMetrics, processStatus, type RuntimeStatus } from "../runtime.js"
import { budgetFor, budgetStatus } from "../budgets.js"
import type { KeyStore } from "../keys.js"
import type { UsageRecorder } from "../usage.js"
import { DASHBOARD_ROUTES } from "../dashboard/page.js"
import { serveDashboard } from "../dashboard/assets.js"
import { bodyUser, noteEndUser } from "../user.js"
import { setSessionLink } from "../session/link.js"
import { reportAffinity } from "../session/affinity.js"
import { chatCodec, serveChoices } from "./fanout.js"
import { parseChatRequest } from "./request.js"
import { STRUCTURED_FALLBACK_HEADER, collectCompletion, encodeError, encodeModelList, streamCompletion } from "./response.js"
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
  /** Per-app usage (`src/usage.ts`): fed from the request log point, and served by `GET /v1/usage` when present. */
  readonly usage?: UsageRecorder
  /** Runtime app keys (src/keys.ts, #55): their digests authenticate, and the admin routes (src/admin/route.ts) read them. */
  readonly keys?: KeyStore
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
interface RequestInfo extends ServedInfo {
  route: string
  app?: string
  model?: string
  /** Set when a response committed as 200 and then failed (a stream error frame): the log outcome and the error code. */
  failed?: string
  /** Sampling parameters dropped for this model (comma list), when any. */
  dropped?: string
  /** The end user the body named, when kept (src/user.ts). */
  user?: string
}

export function createOpenAiRoute(routeHost: RouteHost) {
  // Metrics are written only when the option is on: off means no bookkeeping, no wrapped event stream.
  const metrics = routeHost.options.metrics ? (routeHost.metrics ?? processMetrics()) : undefined
  const runtimeStatus = routeHost.status ?? processStatus
  const host: RouteHost = metrics ? { ...routeHost, caller: metered(routeHost.caller, metrics) } : routeHost
  /** The runtime app keys that authenticate (loaded from storage on first use, #55). */
  const runtimeDigests = async () => (host.keys ? await host.keys.digests() : [])
  /** Routes with a handler of their own. `GET /metrics` exists only when enabled; otherwise it is an unknown path. */
  const known = (route: string) =>
    KNOWN_ROUTES.includes(route) ||
    DISCOVERY_ROUTES.includes(route) ||
    (metrics !== undefined && route === "GET /metrics") ||
    (host.usage !== undefined && (route === "GET /v1/usage" || DASHBOARD_ROUTES.has(route)))
  /** Responses to Gemini routes: errors there use Google's body. */
  const googleErrors = new WeakSet<ServerResponse>()
  const fail = (response: ServerResponse, error: PlugError, close = false) =>
    sendError(response, error, googleErrors.has(response) ? encodeGeminiError(error) : encodeError(error), { close })

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
    const gemini = matchGeminiRoute(request.method, path)
    // Any /v1beta path is Google's API, even one that matches no Gemini route (#150): its errors use Google's body.
    const googleShaped = gemini !== undefined || path === "/v1beta" || path.startsWith("/v1beta/")
    if (googleShaped) googleErrors.add(response)
    const route = gemini?.route ?? `${request.method} ${modelId !== undefined ? "/v1/models/{id}" : path}`
    // Arbitrary client paths stay out of the log.
    info.route = gemini || modelId !== undefined || known(route) || route === "GET /healthz" || route === "GET /readyz" ? route : "unknown"
    // Anthropic Messages: its own error shape and x-api-key auth, so it takes the request from here.
    if (isMessagesPath(path)) return serveMessages(host, { path, request, response, scope, info })

    const rejected = checkOrigin(request, host.options)
    if (rejected) return fail(response, rejected)

    if (route === "GET /healthz") return sendJson(response, 200, { ok: true })

    // Readiness (#160): no key, like /healthz. 503 until a generation serves, the pump runs and the catalog has loaded.
    if (route === "GET /readyz") {
      const verdict = readiness(runtimeStatus())
      return sendJson(response, verdict.ready ? 200 : 503, verdict)
    }

    // First-run pages: reachable without a key, so what they show depends on the caller (`buildDiscovery`).
    // With `keys` set, a request without credentials gets the minimal page; wrong credentials are a 401.
    if (DISCOVERY_ROUTES.includes(route)) {
      const keyed = Object.keys(host.options.keys).length > 0
      let app: string | undefined = keyed ? undefined : DEFAULT_APP
      if (keyed && request.headers.authorization !== undefined) {
        const auth = authenticate(liveOptions(host.options), request.headers.authorization, await runtimeDigests())
        if (isPlugError(auth)) return fail(response, auth)
        app = auth.app
      }
      info.app = app
      const doc = buildDiscovery({ options: host.options, app, catalog: app === undefined ? undefined : await optionalCatalog(scope) })
      if (route === "GET /v1") return sendJson(response, 200, doc)
      return sendText(response, 200, "text/html; charset=utf-8", renderDiscoveryHtml(doc), PAGE_HEADERS)
    }

    // The usage dashboard (#141): a page and its files, keyless like the discovery pages. Its data comes from `GET /v1/usage`, behind a key.
    if (host.usage && DASHBOARD_ROUTES.has(route)) return serveDashboard(request, response, route)

    // Usage has its own credentials: the admin key reads every app, any other key only its own app (`authenticateUsage`).
    if (route === "GET /v1/usage" && host.usage) return serveUsage(request, response, url, host.usage, info)

    // `/metrics` with `adminKey` set: the admin key alone (#285). Its series name every app, so an app key may not read them.
    // Without `adminKey` it keeps the `/v1` authentication, and any app key sees every app's series (documented).
    if (route === "GET /metrics" && metrics && host.options.adminKey !== undefined) {
      const who = authenticateUsage(liveOptions(host.options), request.headers.authorization, await runtimeDigests())
      if (isPlugError(who)) return fail(response, who)
      if (!who.admin) return fail(response, { status: 403, kind: "permission", code: "admin_key_required", message: "Metrics need the admin key (option `adminKey`)" })
      return sendText(response, 200, metrics.contentType, await metrics.render(runtimeStatus()))
    }

    // Runtime app keys (#55): the admin routes answer the admin key only, and are a 404 without `adminKey`.
    if (path === "/v1/admin/keys" || path.startsWith("/v1/admin/keys/"))
      return serveAdmin({ options: liveOptions(host.options), keys: host.keys }, { path, request, response, scope, info })

    // Authenticate before anything reveals which routes exist: an unauthenticated caller sees 401 for every path but /healthz and the first-run pages.
    // Gemini clients also send the key as `x-goog-api-key` or `?key=` (see `geminiAuthorization`).
    const auth = authenticate(liveOptions(host.options), googleShaped ? geminiAuthorization(request, url) : request.headers.authorization, await runtimeDigests())
    if (isPlugError(auth)) return fail(response, auth)
    info.app = auth.app

    // A /v1beta path no Gemini route matches: the AI SDK and LangChain send a model id with a slash and no `models/` prefix (#150).
    if (googleShaped && !gemini)
      return fail(response, {
        status: 404,
        kind: "not_found",
        code: "not_found",
        message: `No Gemini route for ${request.method} ${path}. Expected POST /v1beta/models/{model}:generateContent or POST /v1beta/models/{model}:streamGenerateContent; the path must start with /v1beta/models/. GET /v1beta/models lists the models.`,
      })

    if (!gemini && modelId === undefined && !known(route)) {
      return fail(response, {
        status: 404,
        kind: "not_found",
        code: "not_found",
        message: `No route for ${request.method} ${path}`,
      })
    }

    if (gemini) return serveGemini(host, { match: gemini, request, url, app: auth.app, response, scope, info })

    if (route === "GET /v1/status") {
      const catalog = await optionalCatalog(scope)
      return sendJson(response, 200, buildStatus({ options: host.options, app: auth.app, runtime: runtimeStatus(), catalog }))
    }

    if (route === "GET /metrics" && metrics) {
      return sendText(response, 200, metrics.contentType, await metrics.render(runtimeStatus()))
    }

    if (route === "GET /v1/models" || modelId !== undefined) {
      // `?capability=vision|tools` filters the list (#61). Any other value is refused before the catalog loads.
      const requested = modelId === undefined ? url.searchParams.get("capability") : null
      const capability = requested === null ? undefined : parseCapability(requested)
      if (requested !== null && capability === undefined)
        return fail(response, { status: 400, kind: "invalid_request", code: "invalid_capability", param: "capability", message: "capability must be vision or tools" })
      const listed = listAvailableModels(host.options, await scope.race(host.loadCatalog()), auth.app)
      if (modelId === undefined) return sendJson(response, 200, encodeModelList(capability ? filterByCapability(listed, capability) : listed))
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

    const body = await readJsonBody(request, scope.signal, bodyLimits(host.options))
    noteEndUser(response, info, bodyUser(body))
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
    reportParallelTools(response, call)
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
        onRecord: (recordID, directory) => {
          if (response.headersSent || response.destroyed || !/^[\x21-\x7e]+$/.test(recordID)) return
          response.setHeader(SESSION_HEADER, recordID)
          setSessionLink(response, info, historyTemplate(host.options, auth.app), recordID, directory)
        },
        // An alias with fallbacks: report which target answered, and echo it as the response model.
        onServed: reportServed(response, info, (served) => void (exchange.model = served.model)),
        onPolicy: reportPolicy(response),
        onUsage: reportUsage(response, exchange.stream),
        onServerTools: reportServerTools(response, exchange.stream),
        onCache: reportCache(response),
        onAffinity: reportAffinity(response),
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
    if (result.structuredFallback) response.setHeader(STRUCTURED_FALLBACK_HEADER, "text")
    sendJson(response, result.status, result.body, { retryAfterSeconds: result.retryAfterSeconds })
  }

  /** `GET /v1/usage?from=&to=&app=`. An app key may name only its own app (another one is a 403); the admin key may name any app or none. */
  async function serveUsage(request: IncomingMessage, response: ServerResponse, url: URL, usage: UsageRecorder, info: RequestInfo): Promise<void> {
    const who = authenticateUsage(liveOptions(host.options), request.headers.authorization, await runtimeDigests())
    if (isPlugError(who)) return fail(response, who)
    const app = url.searchParams.get("app") ?? undefined
    if (!who.admin) {
      if (app !== undefined && app !== who.app)
        return fail(response, { status: 403, kind: "permission", code: "app_forbidden", message: "This key cannot read the usage of another app" })
      info.app = who.app
    }
    const report = await usage.query({
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      app: who.admin ? app : who.app,
      user: url.searchParams.get("user") || undefined,
    })
    if (isPlugError(report)) return fail(response, report)
    // Each app's budget state, read from its current window rather than from the report's range (src/budgets.ts).
    if (host.options.budgets) {
      const at = Date.now()
      for (const [name, entry] of Object.entries(report.apps)) {
        const budget = budgetFor(host.options.budgets, name)
        if (budget) entry.budgets = await budgetStatus(usage, budget, name, at)
      }
    }
    return sendJson(response, 200, report)
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
          // Every refusal but an invalid body (400) may leave the client still sending: answer, then close (see `finishRequest`).
          fail(response, bodyPlugError(caught), caught.status !== 400)
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
      if (info.app !== undefined) host.usage?.request({ app: info.app, route: info.route, status: response.statusCode, outcome: outcomeLabel(outcome, response.statusCode), ms, ...(info.user === undefined ? {} : { user: info.user }) })
      // Probes and scrapes that succeed are not worth a line each. A readiness probe is never logged: it repeats until the backend is ready.
      const probe = info.route === "GET /readyz" || ((info.route === "GET /healthz" || info.route === "GET /metrics") && outcome === "ok")
      if (!probe) {
        const fields = { id, route: info.route, app: info.app, user: info.user, session_url: info.sessionUrl, model: info.model, served: info.served, fallbacks: info.fallbacks, dropped: info.dropped, status: response.statusCode, ms, outcome, error }
        if (outcome === "error" || response.statusCode >= 500) logError("request.failed", fields)
        else log("request", fields)
      }
    }
  }
}
