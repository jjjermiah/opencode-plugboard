/**
 * OpenAI front-end route table: `GET /healthz`, `GET /readyz`, `GET /v1/models`, `GET /v1/models/{id}`,
 * `POST /v1/chat/completions` (`n` > 1 through `./fanout.ts`), and the dispatch of `POST /v1/responses`
 * and `POST /v1/completions` to `src/responses/route.ts` and `src/completions/route.ts`.
 * Plugboard's own routes live under `/plugboard/` (`/plugboard/usage`, `/plugboard/admin/keys`,
 * `/plugboard/status`, `/plugboard/metrics`, `/plugboard/dashboard`, `/plugboard/health`, `/plugboard/ready`),
 * with `/healthz` and `/readyz` kept at the root for probes. Keyless discovery is `GET /` and `GET /v1`
 * (`src/discovery.ts`). Their errors are `application/problem+json` (`sendProblem`, `src/http.ts`), while the
 * model routes keep their provider's error shape.
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
 *
 * A caller's `x-request-id` (1 to 128 safe characters) is echoed back as `x-request-id` and logged as `clientRequestId`
 * on the request's log line. It never replaces the plugboard id.
 */

import type { IncomingMessage, ServerResponse } from "node:http"
import { serveAdmin } from "../admin/route.js"
import {
  DEFAULT_APP,
  appPolicy,
  authenticate,
  authenticateUsage,
  bodyLimits,
  credentialDigest,
  endpointRefusal,
  sessionUrlTemplate,
  keyIsLive,
  maxChoicesFor,
  maxChoicesOption,
  reasoningOutputFor,
  requestTimeoutFor,
  requestTimeoutOption,
  requestedModel,
  type Endpoint,
  type PlugboardOptions,
} from "../config.js"
import { isPlugError, type CatalogModel, type ModelCaller, type PlugError, type PlugRequest } from "../contract.js"
import { buildDiscovery, buildStatus, readiness, renderDiscoveryHtml, sendText } from "../discovery.js"
import { PACKAGE_VERSION } from "../version.js"
import {
  BodyError,
  bodyPlugError,
  REQUEST_ID_HEADER,
  CLIENT_REQUEST_ID_HEADER,
  clientRequestId,
  RequestAborted,
  beginRequest,
  boundEvents,
  checkJsonContentType,
  checkHost,
  checkOrigin,
  CORS_EXPOSED_HEADERS,
  corsOrigin,
  finishRequest,
  readJsonBody,
  sendError,
  sendJson,
  sendProblem,
  sseWriter,
  type RequestScope,
} from "../http.js"
import { reportServed, type ServedInfo } from "../fallback.js"
import { clientAddress, forwardedOrigin } from "../forwarded.js"
import { encodeGeminiError } from "../gemini/response.js"
import { geminiAuthorization, matchGeminiRoute, serveGemini } from "../gemini/route.js"
import { errorMessage, logError, logRequest, withRequestId } from "../log.js"
import { NO_APP, outcomeLabel, type Metrics } from "../metrics.js"
import { effortUnavailable, filterByCapability, listAvailableModels, parseCapability, resolveModel, THINKING_HEADER } from "../models.js"
import { parseCacheDirective, reportCache, reportCacheDirective } from "../cache.js"
import { reportParallelTools, reportPolicy, reportOpencodeTools } from "../policy.js"
import { reportUsage } from "../usage-header.js"
import { authenticateRequest, isMessagesPath, serveMessages } from "../anthropic/route.js"
import { encodeModel, encodeModelPage, modelPageQuery, pageModels } from "../anthropic/response.js"
import { serveCompletions } from "../completions/route.js"
import { matchStoredRoute, serveResponses, serveStoredResponse } from "../responses/route.js"
import type { ResponseStore } from "../responses/state.js"
import { inlineRequestFiles, isFilesPath, matchFilesRoute, serveFiles } from "../files/route.js"
import { matchGeminiFilesRoute, serveGeminiFiles, uploadSessionApp, type UploadCredential } from "../files/gemini/route.js"
import type { FileStore } from "../files/state.js"
import { liveOptions, processMetrics, processStatus, type RuntimeStatus } from "../runtime.js"
import { budgetFor, budgetStatus } from "../budgets.js"
import type { KeyStore } from "../keys.js"
import type { UsageRecorder } from "../usage.js"
import { DASHBOARD_ROUTES } from "../dashboard/page.js"
import { serveDashboard } from "../dashboard/assets.js"
import { bodyUser, noteEndUser, requestUser, withEndUser } from "../user.js"
import { setSessionLink } from "../session/link.js"
import { reportAffinity } from "../session/affinity.js"
import type { SessionPromptDeps } from "../session/caller.js"
import { chatCodec, serveChoices } from "./fanout.js"
import { parseChatRequest } from "./request.js"
import { STRUCTURED_FALLBACK_HEADER, collectCompletion, encodeError, encodeModelList, streamCompletion, type OpenAiExchange } from "./response.js"
import { appGeneration, dropRejected } from "./sampling.js"

/** What the serving generation supplies per request. */
export interface RouteHost {
  readonly options: PlugboardOptions
  readonly caller: ModelCaller
  /** The serving Location's enabled models. */
  loadCatalog(): Promise<ReadonlyArray<CatalogModel>>
  /** Metrics registry; the process runtime's by default. Only written to when option `metrics` is on. */
  readonly metrics?: Metrics
  /** Runtime facts for `/plugboard/status` and `/plugboard/metrics`; the process runtime's by default. */
  readonly status?: () => RuntimeStatus
  /** The host OpenCode version, from the plugin context (`ctx.app.version`); `/plugboard/status` omits it when absent (#347). */
  readonly opencodeVersion?: string
  /** Per-app usage (`src/usage.ts`): fed from the request log point, and served by `GET /plugboard/usage` when present. */
  readonly usage?: UsageRecorder
  /** Runtime app keys (src/keys.ts, #55): their digests authenticate, and the admin routes (src/admin/route.ts) read them. */
  readonly keys?: KeyStore
  /** The session port, persona lookup and backend gate that `count_tokens` and `countTokens` read the prompt through (#201). Absent: the count covers the caller's request and the app's policy. */
  readonly session?: SessionPromptDeps
  /** Stored Responses (src/responses/state.ts, since 0.51.0): behind `previous_response_id` and `GET`/`DELETE /v1/responses/{id}`. */
  readonly responses: ResponseStore
  /** Uploaded files (src/files/state.ts, since next): behind the Files APIs and every `file_id` and `fileUri`. */
  readonly files: FileStore
}

const SESSION_HEADER = "x-plugboard-session"
const DROPPED_HEADER = "x-plugboard-dropped-params"
const MODEL_PREFIX = "/v1/models/"
/** `GET /v1/models` and `GET /v1/models/{id}` read credentials as the Messages route does, so `x-api-key` works there too (#399). */
const isModelsRead = (method: string | undefined, path: string) => method === "GET" && (path === "/v1/models" || path.startsWith(MODEL_PREFIX))
/** The Files routes read credentials the same way: `x-api-key` works there too (the Anthropic SDKs send it). */
const isKeyAnywhere = (method: string | undefined, path: string) => isModelsRead(method, path) || isFilesPath(path)
const isGeminiPath = (path: string) => path === "/v1beta" || path.startsWith("/v1beta/") || path.startsWith("/upload/v1beta/")
const KNOWN_ROUTES = ["GET /v1/models", "POST /v1/chat/completions", "POST /v1/completions", "POST /v1/responses", "GET /plugboard/status"]
/** The endpoint family of each OpenAI route (`apps.<name>.endpoints`, #268). Gemini and `/v1/models/{id}` are classified where they are matched. */
const ENDPOINT_BY_ROUTE: Readonly<Record<string, Endpoint>> = {
  "POST /v1/chat/completions": "chat",
  "POST /v1/completions": "completions",
  "POST /v1/responses": "responses",
  "GET /v1/models": "models",
}
/** Plugboard's own routes: the namespace whose errors are problem+json. */
const PLUGBOARD_PREFIX = "/plugboard"
/** The liveness and readiness probes: at the root (kept for probes) and under `/plugboard/`. */
const HEALTH_ROUTES = ["GET /healthz", "GET /plugboard/health"]
const READY_ROUTES = ["GET /readyz", "GET /plugboard/ready"]
/** Pages anyone may fetch; they decide for themselves how much to show (see `src/discovery.ts`). */
const DISCOVERY_ROUTES = ["GET /", "GET /v1"]
/** Allows a page's inline style and nothing else: no scripts, images, fonts or frames. */
const PAGE_HEADERS = { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'", "x-frame-options": "DENY", "referrer-policy": "no-referrer" }

/**
 * Runs one metrics or usage write. A throw there is logged (once per failed write, under the request's id, with the write's name)
 * and the request goes on: it never changes the answer or stops the access log.
 */
function recorded(write: string, record: () => void): void {
  try {
    record()
  } catch (caught) {
    logError("metrics.record_failed", { write, error: errorMessage(caught) })
  }
}

/** Records the token usage of every finished model call (see `plugboard_tokens_total`); events pass through untouched. */
function metered(caller: ModelCaller, metrics: Metrics): ModelCaller {
  return {
    stream(request, context) {
      const inner = caller.stream(request, context)
      return (async function* () {
        for await (const event of inner) {
          recorded("tokens", () => {
            if (event.type === "finish" && event.usage) metrics.tokens(context.app, event.usage)
          })
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
  /** The caller's `x-request-id`, when it sent a valid one (#514). */
  clientRequestId?: string
  /** The client address behind a trusted proxy (`listen.trustProxy`, #266); set only when that option is on. */
  client?: string
}

export function createOpenAiRoute(routeHost: RouteHost) {
  // Metrics are written only when the option is on: off means no bookkeeping, no wrapped event stream.
  const metrics = routeHost.options.metrics ? (routeHost.metrics ?? processMetrics()) : undefined
  const runtimeStatus = routeHost.status ?? processStatus
  const host: RouteHost = metrics ? { ...routeHost, caller: metered(routeHost.caller, metrics) } : routeHost
  /** The runtime app keys that authenticate (loaded from storage on first use, #55). */
  const runtimeDigests = async () => (host.keys ? await host.keys.digests() : [])
  /** Routes with a handler of their own. `GET /plugboard/metrics` exists only when enabled; otherwise it is an unknown path. */
  const known = (route: string) =>
    KNOWN_ROUTES.includes(route) ||
    DISCOVERY_ROUTES.includes(route) ||
    (metrics !== undefined && route === "GET /plugboard/metrics") ||
    (host.usage !== undefined && (route === "GET /plugboard/usage" || DASHBOARD_ROUTES.has(route)))
  /** Responses to Gemini routes: errors there use Google's body. */
  const googleErrors = new WeakSet<ServerResponse>()
  /** Responses on `/plugboard/` routes: errors there are problem+json, with the request target as `instance`. */
  const plugboardErrors = new WeakMap<ServerResponse, string>()
  const fail = (response: ServerResponse, error: PlugError, close = false) => {
    const instance = plugboardErrors.get(response)
    if (instance !== undefined) return sendProblem(response, error, instance, { close })
    return sendError(response, error, googleErrors.has(response) ? encodeGeminiError(error) : encodeError(error), { close })
  }

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

  /**
   * The app the request authenticates as, read before its deadline is armed (#257). It applies the same credential rules as
   * `serve` and answers nothing: any refusal is `serve`'s to give (I15), so `undefined` only means the global deadline applies.
   */
  async function requestApp(request: IncomingMessage): Promise<string | undefined> {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1")
      const path = url.pathname
      const auth =
        isMessagesPath(path) || isKeyAnywhere(request.method, path)
          ? await authenticateRequest(host, request)
          : authenticate(liveOptions(host.options), isGeminiPath(path) ? geminiAuthorization(request, url) : request.headers.authorization, await runtimeDigests())
      return isPlugError(auth) ? undefined : auth.app
    } catch {
      return undefined
    }
  }

  /** The key the request carries as an upload sees it: its digest when it is a live key, and the check for any digest (config keys as they are now, and runtime keys). */
  async function uploadCredential(request: IncomingMessage, url: URL): Promise<UploadCredential> {
    const runtime = await runtimeDigests()
    const options = liveOptions(host.options)
    const alive = (digest: Buffer) => keyIsLive(options, digest, runtime)
    const presented = credentialDigest(geminiAuthorization(request, url))
    return { digest: presented !== undefined && alive(presented) ? presented : undefined, alive }
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
    if (path === PLUGBOARD_PREFIX || path.startsWith(`${PLUGBOARD_PREFIX}/`)) plugboardErrors.set(response, request.url ?? path)
    const modelId = request.method === "GET" && path.startsWith(MODEL_PREFIX) && path.length > MODEL_PREFIX.length ? decodeSegment(path.slice(MODEL_PREFIX.length)) : undefined
    const gemini = matchGeminiRoute(request.method, path)
    // The stored-response routes carry an id in the path: they are logged and counted under their template, never with the id.
    const stored = matchStoredRoute(request.method, path)
    // The Files routes (since next) carry an id or a name in the path too, so they are logged under their template as well.
    const files = matchFilesRoute(request.method, path)
    const geminiFiles = matchGeminiFilesRoute(request.method, path)
    // Any /v1beta path is Google's API, even one that matches no Gemini route (#150): its errors use Google's body.
    const googleShaped = gemini !== undefined || geminiFiles !== undefined || isGeminiPath(path)
    if (googleShaped) googleErrors.add(response)
    const route = gemini?.route ?? stored?.route ?? files?.route ?? geminiFiles?.route ?? `${request.method} ${modelId !== undefined ? "/v1/models/{id}" : path}`
    // Arbitrary client paths stay out of the log.
    info.route = gemini || stored || files || geminiFiles || modelId !== undefined || known(route) || HEALTH_ROUTES.includes(route) || READY_ROUTES.includes(route) ? route : "unknown"
    // CORS (#256). An allowed browser origin gets its headers on every answer. Its preflight (OPTIONS with a requested method)
    // is answered here, before authentication, because a preflight carries no credentials; the Host check still runs first.
    if (host.options.cors !== undefined) {
      response.setHeader("vary", "Origin")
      const allowed = corsOrigin(request, host.options)
      if (allowed !== undefined) {
        response.setHeader("access-control-allow-origin", allowed)
        response.setHeader("access-control-expose-headers", CORS_EXPOSED_HEADERS)
        if (request.method === "OPTIONS" && request.headers["access-control-request-method"] !== undefined) {
          const hostError = checkHost(request, host.options)
          if (hostError) return fail(response, hostError)
          response.writeHead(204, {
            "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
            "access-control-allow-headers":
              "authorization, content-type, x-api-key, x-goog-api-key, x-request-id, cache-control, x-plugboard-cache, x-plugboard-cache-namespace, x-portkey-cache-namespace, x-portkey-cache-force-refresh, helicone-cache-seed",
            ...(host.options.cors.allowPrivateNetwork && request.headers["access-control-request-private-network"] === "true" ? { "access-control-allow-private-network": "true" } : {}),
          })
          response.end()
          return
        }
      }
    }

    // Anthropic Messages: its own error shape and x-api-key auth, so it takes the request from here.
    if (isMessagesPath(path)) return serveMessages(host, { path, request, response, scope, info })

    const rejected = checkOrigin(request, host.options)
    if (rejected) return fail(response, rejected)

    if (HEALTH_ROUTES.includes(route)) return sendJson(response, 200, { ok: true })

    // Readiness (#160): no key, like the liveness probe. 503 until a generation serves, the pump runs and the catalog has loaded.
    // `/readyz` answers its document as before; `/plugboard/ready` answers a refusal as a problem (`not_ready`).
    if (READY_ROUTES.includes(route)) {
      const verdict = readiness(runtimeStatus())
      if (route === "GET /readyz") return sendJson(response, verdict.ready ? 200 : 503, verdict)
      if (verdict.ready) return sendJson(response, 200, verdict)
      return fail(response, { status: 503, kind: "server", code: "not_ready", message: verdict.reason })
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
      // Behind a trusted proxy on a keyed endpoint, the base URL is the public origin the proxy names (#266).
      const publicOrigin = keyed ? forwardedOrigin(request, host.options.listen.trustProxy) : undefined
      const doc = buildDiscovery({ options: host.options, app, catalog: app === undefined ? undefined : await optionalCatalog(scope), publicOrigin, requestHost: request.headers.host })
      if (route === "GET /v1") return sendJson(response, 200, doc)
      return sendText(response, 200, "text/html; charset=utf-8", renderDiscoveryHtml(doc), PAGE_HEADERS)
    }

    // The usage dashboard (#141): a page and its files, keyless like the discovery pages. Its data comes from `GET /plugboard/usage`, behind a key.
    if (host.usage && DASHBOARD_ROUTES.has(route)) return serveDashboard(request, response, route)

    // Usage has its own credentials: the admin key reads every app, any other key only its own app (`authenticateUsage`).
    if (route === "GET /plugboard/usage" && host.usage) return serveUsage(request, response, url, host.usage, info)

    // `/plugboard/metrics` with `adminKey` set: the admin key alone (#285). Its series name every app, so an app key may not read them.
    // Without `adminKey` it keeps the usual authentication, and any app key sees every app's series (documented).
    if (route === "GET /plugboard/metrics" && metrics && host.options.adminKey !== undefined) {
      const who = authenticateUsage(liveOptions(host.options), request.headers.authorization, await runtimeDigests())
      if (isPlugError(who)) return fail(response, who)
      if (!who.admin) return fail(response, { status: 403, kind: "permission", code: "admin_key_required", message: "Metrics need the admin key (option `adminKey`)" })
      return sendText(response, 200, metrics.contentType, await metrics.render(runtimeStatus()))
    }

    // Runtime app keys (#55): the admin routes answer the admin key only, and are a 404 without `adminKey`.
    if (path === "/plugboard/admin/keys" || path.startsWith("/plugboard/admin/keys/"))
      return serveAdmin({ options: liveOptions(host.options), keys: host.keys }, { path, request, response, scope, info })

    // `/plugboard/status` also takes the admin key (#311): the operator view names no app, so it is answered without one. The admin key
    // is checked here and not in `authenticate`, so it stays out of the model routes. Any other credential goes on to the rules below.
    if (route === "GET /plugboard/status") {
      const operator = authenticateUsage(liveOptions(host.options), request.headers.authorization, await runtimeDigests())
      if (!isPlugError(operator) && operator.admin)
        return sendJson(
          response,
          200,
          buildStatus({ options: host.options, runtime: runtimeStatus(), catalog: await optionalCatalog(scope), packageVersion: PACKAGE_VERSION, opencodeVersion: host.opencodeVersion }),
        )
    }

    // Authenticate before anything reveals which routes exist: an unauthenticated caller sees 401 for every path but the probes and the first-run pages.
    // Gemini clients also send the key as `x-goog-api-key` or `?key=` (see `geminiAuthorization`).
    // A resumable Gemini upload chunk with no key at all is authorized by its upload id (a capability url, as Google's is: google-genai sends
    // no key on the chunks). An unknown id falls through to the usual check, which is a 401 (I15).
    // An upload stays good only while the key that started it is live (a revoked or rotated-out key ends it): `credential` carries that check.
    const credential: UploadCredential | undefined = geminiFiles ? await uploadCredential(request, url) : undefined
    const uploadApp = credential && geminiFiles?.op === "upload" && geminiAuthorization(request, url) === undefined ? uploadSessionApp(url.searchParams.get("upload_id"), credential.alive) : undefined
    const auth =
      uploadApp !== undefined
        ? { app: uploadApp }
        : isKeyAnywhere(request.method, path)
          ? await authenticateRequest(host, request)
          : authenticate(liveOptions(host.options), googleShaped ? geminiAuthorization(request, url) : request.headers.authorization, await runtimeDigests())
    if (isPlugError(auth)) return fail(response, auth)
    info.app = auth.app

    // A /v1beta path no Gemini route matches: the AI SDK and LangChain send a model id with a slash and no `models/` prefix (#150).
    if (googleShaped && !gemini && !geminiFiles)
      return fail(response, {
        status: 404,
        kind: "not_found",
        code: "not_found",
        message: `No Gemini route for ${request.method} ${path}. Expected POST /v1beta/models/{model}:generateContent or POST /v1beta/models/{model}:streamGenerateContent; the path must start with /v1beta/models/. GET /v1beta/models lists the models.`,
      })

    if (!gemini && !geminiFiles && !stored && !files && modelId === undefined && !known(route)) {
      return fail(response, {
        status: 404,
        kind: "not_found",
        code: "not_found",
        message: `No route for ${request.method} ${path}`,
      })
    }

    // An app may be limited to some endpoints (#268). Checked after authentication and route existence (I15): a refusal is a 403, never a 404.
    const endpoint: Endpoint | undefined =
      files || geminiFiles ? "files" : gemini ? "gemini" : stored ? "responses" : modelId !== undefined ? "models" : Object.hasOwn(ENDPOINT_BY_ROUTE, route) ? ENDPOINT_BY_ROUTE[route] : undefined
    const refusal = endpoint === undefined ? undefined : endpointRefusal(host.options, auth.app, endpoint)
    if (refusal) return fail(response, refusal)

    if (gemini) return serveGemini(host, { match: gemini, request, url, app: auth.app, response, scope, info })

    // Files (since next): each lookup is under the caller's own app, never another's (I33).
    if (files) return serveFiles(host, { app: auth.app, match: files, request, url, response, scope })
    if (geminiFiles && credential) return serveGeminiFiles(host, { app: auth.app, match: geminiFiles, request, url, response, scope, credential })

    // Stored Responses: read or deleted under the caller's own app, never another's (I32).
    if (stored) return serveStoredResponse(host, { app: auth.app, match: stored, url, response, scope })

    if (route === "GET /plugboard/status") {
      const catalog = await optionalCatalog(scope)
      return sendJson(response, 200, buildStatus({ options: host.options, app: auth.app, runtime: runtimeStatus(), catalog, packageVersion: PACKAGE_VERSION, opencodeVersion: host.opencodeVersion }))
    }

    if (route === "GET /plugboard/metrics" && metrics) {
      return sendText(response, 200, metrics.contentType, await metrics.render(runtimeStatus()))
    }

    if (route === "GET /v1/models" || modelId !== undefined) {
      // `?capability=vision|tools` filters the list (#61). Any other value is refused before the catalog loads.
      const requested = modelId === undefined ? url.searchParams.get("capability") : null
      const capability = requested === null ? undefined : parseCapability(requested)
      if (requested !== null && capability === undefined)
        return fail(response, { status: 400, kind: "invalid_request", code: "invalid_capability", param: "capability", message: "capability must be vision or tools" })
      const listed = listAvailableModels(host.options, await scope.race(host.loadCatalog()), auth.app)
      // The Anthropic SDKs send `anthropic-version`; they read Anthropic's list shape, everything else keeps OpenAI's (#399).
      const anthropic = request.headers["anthropic-version"] !== undefined
      if (modelId === undefined) {
        const models = capability ? filterByCapability(listed, capability) : listed
        if (!anthropic) return sendJson(response, 200, encodeModelList(models))
        // Anthropic pages this list with limit (default 20, max 1000), after_id and before_id (#457).
        const query = modelPageQuery(url.searchParams)
        if (isPlugError(query)) return fail(response, query)
        const page = pageModels(models, query)
        if (!page) {
          const param = query.beforeId === undefined ? "after_id" : "before_id"
          return fail(response, { status: 400, kind: "invalid_request", code: "invalid_cursor", param, message: `${param} is not a listed model` })
        }
        return sendJson(response, 200, encodeModelPage(page.models, page.hasMore))
      }
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
      return sendJson(response, 200, anthropic ? encodeModel(item) : (encodeModelList([item]) as { data: object[] }).data[0])
    }

    const unsupported = checkJsonContentType(request)
    if (unsupported) return fail(response, unsupported)
    // The caller's cache headers: a bad value is a 400 before the body is read.
    const cache = parseCacheDirective(request.headers)
    if (isPlugError(cache)) return fail(response, cache)

    const sent = await readJsonBody(request, scope.signal, bodyLimits(host.options, auth.app, host.keys?.appNames()))
    // The end user: the app's `userHeader` when the request sends it (#272), else the body's `user`.
    const user = requestUser(request.headers, appPolicy(host.options, auth.app)?.userHeader, bodyUser(sent))
    const body = withEndUser(sent, user, "user")
    noteEndUser(response, info, user)
    if (route === "POST /v1/responses") return serveResponses(host, { app: auth.app, body, response, scope, info, cache })
    if (route === "POST /v1/completions") return serveCompletions(host, { app: auth.app, body, response, scope, info, cache })
    // The app's own `maxChoices` (#270) is the cap for this request; the decoder checks against `options.maxChoices`.
    // A `file_id` part is replaced by the inline form of the stored file before the decoder runs (since next).
    const inlined = await inlineRequestFiles(host, auth.app, "chat", body, scope)
    if (isPlugError(inlined)) return fail(response, inlined)
    const parsed = parseChatRequest(inlined, { ...host.options, maxChoices: maxChoicesFor(host.options, auth.app) }, maxChoicesOption(host.options, auth.app))
    if (isPlugError(parsed)) return fail(response, parsed)
    const catalog = await scope.race(host.loadCatalog())
    const requested = requestedModel(host.options, auth.app, parsed.request.model, parsed.reasoningEffort)
    const ref = resolveModel(host.options, requested.model, catalog, requested.effort)
    if (isPlugError(ref)) return fail(response, ref)
    info.model = `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`
    if (effortUnavailable(catalog, ref, requested.effort)) response.setHeader(THINKING_HEADER, "unavailable")
    // Sampling parameters the model is known to reject are dropped and reported (header and log), before any response bytes.
    const generation = appGeneration(appPolicy(host.options, auth.app), parsed.request.generation)
    const sampled = host.options.dropUnsupportedParams ? dropRejected(ref, generation) : undefined
    if (sampled && sampled.dropped.length > 0) {
      info.dropped = sampled.dropped.join(",")
      response.setHeader(DROPPED_HEADER, info.dropped)
      recorded("dropped", () => metrics?.dropped(sampled.dropped))
    }
    const call: PlugRequest = { ...parsed.request, model: requested.model, generation: sampled?.generation ?? generation, ref }
    reportParallelTools(response, call)
    // Per app, then global (`reasoningOutputFor`): the decoder does not know the app.
    const exchange: OpenAiExchange = { ...parsed.exchange, reasoningOutput: reasoningOutputFor(host.options, auth.app) }
    // The answer names the model it runs on: the app's pin, else the caller's (#261).
    exchange.model = requested.model
    // n > 1: one independent call per choice, merged (src/openai/fanout.ts).
    if (parsed.n > 1) return serveChoices(host, { app: auth.app, calls: Array.from({ length: parsed.n }, () => call), response, scope, info, codec: chatCodec(exchange), cache })

    // Abandoned requests (client gone, deadline passed) must never reach the model caller.
    if (scope.signal.aborted) throw scope.signal.reason
    const events = boundEvents(
      host.caller.stream(call, {
        app: auth.app,
        signal: scope.signal,
        onRecord: (recordID, directory) => {
          if (response.headersSent || response.destroyed || !/^[\x21-\x7e]+$/.test(recordID)) return
          response.setHeader(SESSION_HEADER, recordID)
          setSessionLink(response, info, sessionUrlTemplate(host.options, auth.app), recordID, directory)
        },
        // An alias with fallbacks: report which target answered, and echo it as the response model.
        onServed: reportServed(response, info, (served) => void (exchange.model = served.model)),
        onPolicy: reportPolicy(response),
        onUsage: reportUsage(response, exchange.stream),
        onOpencodeTools: reportOpencodeTools(response, exchange.stream),
        cache,
        onCache: reportCache(response),
        onCacheDirective: reportCacheDirective(response),
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

  /** `GET /plugboard/usage?from=&to=&app=`. An app key may name only its own app (another one is a 403); the admin key may name any app or none. */
  async function serveUsage(request: IncomingMessage, response: ServerResponse, url: URL, usage: UsageRecorder, info: RequestInfo): Promise<void> {
    const who = authenticateUsage(liveOptions(host.options), request.headers.authorization, await runtimeDigests())
    if (isPlugError(who)) return fail(response, who)
    const app = url.searchParams.get("app") ?? undefined
    if (!who.admin) {
      if (app !== undefined && app !== who.app) return fail(response, { status: 403, kind: "permission", code: "app_forbidden", message: "This key cannot read the usage of another app" })
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
    // The caller's own `x-request-id` is a second, separate field: bounded and charset-checked, echoed and logged, never used as the id (#514).
    const clientId = clientRequestId(request)
    if (!response.headersSent) {
      response.setHeader(REQUEST_ID_HEADER, id)
      if (clientId !== undefined) response.setHeader(CLIENT_REQUEST_ID_HEADER, clientId)
    }
    return withRequestId(id, () => run(request, response, id, clientId))
  }

  async function run(request: IncomingMessage, response: ServerResponse, id: string, clientId: string | undefined): Promise<void> {
    const started = Date.now()
    const info: RequestInfo = { route: "unparsed", ...(clientId === undefined ? {} : { clientRequestId: clientId }) }
    if (host.options.listen.trustProxy !== undefined) info.client = clientAddress(request, host.options.listen.trustProxy)
    recorded("requestStarted", () => metrics?.requestStarted())
    // The deadline is armed after the app is known, so an app's own `requestTimeoutMs` (#257) applies from the first await.
    const app = await requestApp(request)
    const scope = beginRequest(request, response, requestTimeoutFor(host.options, app), undefined, requestTimeoutOption(host.options, app))
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
      recorded("requestFinished", () => metrics?.requestFinished({ app: info.app ?? NO_APP, route: info.route, status: response.statusCode, outcome: outcomeLabel(outcome, response.statusCode), ms }))
      recorded("usage", () => {
        if (info.app !== undefined)
          host.usage?.request({
            app: info.app,
            route: info.route,
            status: response.statusCode,
            outcome: outcomeLabel(outcome, response.statusCode),
            ms,
            ...(info.user === undefined ? {} : { user: info.user }),
          })
      })
      // Probes and scrapes that succeed are not worth a line each. A readiness probe is never logged: it repeats until the backend is ready.
      const probe = READY_ROUTES.includes(info.route) || ((HEALTH_ROUTES.includes(info.route) || info.route === "GET /plugboard/metrics") && outcome === "ok")
      if (!probe) {
        const fields = {
          id,
          clientRequestId: info.clientRequestId,
          route: info.route,
          app: info.app,
          user: info.user,
          client: info.client,
          session_url: info.sessionUrl,
          model: info.model,
          served: info.served,
          fallbacks: info.fallbacks,
          dropped: info.dropped,
          status: response.statusCode,
          ms,
          outcome,
          error,
        }
        if (outcome === "error" || response.statusCode >= 500) logError("request.failed", fields)
        else logRequest("request", fields)
      }
    }
  }
}
