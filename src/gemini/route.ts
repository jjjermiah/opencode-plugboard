/**
 * The Gemini front-end's half of the route: `GET /v1beta/models`, `GET /v1beta/models/{model}`,
 * `POST /v1beta/models/{model}:generateContent`, `:streamGenerateContent` (`?alt=sse` as SSE, else a streamed JSON
 * array) and `:countTokens` (an estimate, #144) (and the
 * `POST /v1/models/{model}:...` spelling). `src/openai/route.ts` matches the path
 * (`matchGeminiRoute`), checks the origin, authenticates (`geminiAuthorization` supplies the
 * credential) and hands over here; errors on these routes use Google's body (`encodeGeminiError`).
 *
 * The `{model}` segment is an alias or `provider/model[#variant]`, percent-decoded. Ids contain `/`
 * and `#`: a literal `/` works, a `#` must be sent as `%23` (SDKs build the URL as a string, so
 * `#` is cut as a fragment there; use an alias).
 *
 * Same flow as the other front-ends: parse, resolve the model, call the ModelCaller, encode. Nothing
 * is committed until the encoder emits its first chunk, so a failure before any output is a real
 * HTTP error even for a stream. `candidateCount` above 1 is one model call per candidate through
 * the shared fan-out (`src/openai/fanout.ts`), capped by `maxChoices`.
 */

import type { IncomingMessage, ServerResponse } from "node:http"
import { isPlugError, type PlugError, type PlugRequest } from "../contract.js"
import { reportServed, type ServedInfo } from "../fallback.js"
import { appPolicy, bodyLimits, sessionUrlTemplate, maxChoicesFor, maxChoicesOption, requestedModel } from "../config.js"
import { boundEvents, checkJsonContentType, readJsonBody, sendError, sendJson, sseWriter, type RequestScope } from "../http.js"
import { effortUnavailable, listAvailableModels, modelNotAvailable, resolveModel, THINKING_HEADER } from "../models.js"
import { parseCacheDirective, reportCache, reportCacheDirective } from "../cache.js"
import { reportPolicy, reportOpencodeTools } from "../policy.js"
import { reportUsage } from "../usage-header.js"
import { setSessionLink } from "../session/link.js"
import { sessionRequest } from "../session/caller.js"
import { reportAffinity } from "../session/affinity.js"
import type { RouteHost } from "../openai/route.js"
import { serveChoices } from "../openai/fanout.js"
import { STRUCTURED_FALLBACK_HEADER } from "../openai/response.js"
import { appGeneration, dropRejected } from "../openai/sampling.js"
import { estimateTokens } from "../anthropic/tokens.js"
import { inlineRequestFiles } from "../files/route.js"
import { parseGeminiRequest } from "./request.js"
import { arrayWire, encodeGeminiError, encodeGeminiModel, encodeGeminiModelList, geminiCodec, noResponse, runGenerate, sseWire } from "./response.js"

const SESSION_HEADER = "x-plugboard-session"
const DROPPED_HEADER = "x-plugboard-dropped-params"

export type GeminiMatch =
  | { readonly op: "list"; readonly route: string }
  | { readonly op: "get"; readonly route: string; readonly model: string }
  | { readonly op: "generate"; readonly route: string; readonly model: string; readonly stream: boolean }
  | { readonly op: "count"; readonly route: string; readonly model: string }
  /** A method on a model that plugboard does not serve (`countTokens`, `embedContent`, ...). */
  | { readonly op: "unsupported"; readonly route: string; readonly verb: string }

/** `countTokens` takes the request's contents at the top level, or wrapped as `generateContentRequest`. */
const countBody = (body: unknown): unknown =>
  typeof body === "object" && body !== null && "generateContentRequest" in body ? (body as { generateContentRequest: unknown }).generateContentRequest : body

const decode = (raw: string): string | undefined => {
  try {
    return decodeURIComponent(raw)
  } catch {
    return undefined
  }
}

/**
 * Recognises the Gemini paths. `GET /v1/models...` stays with the OpenAI routes: only `POST`
 * with a `:method` suffix is claimed under `/v1/`. Logs get the `route` label, never the path.
 */
export function matchGeminiRoute(method: string | undefined, path: string): GeminiMatch | undefined {
  if (path === "/v1beta/models") return method === "GET" ? { op: "list", route: "GET /v1beta/models" } : undefined
  for (const prefix of ["/v1beta/models/", "/v1/models/"]) {
    if (!path.startsWith(prefix) || path.length === prefix.length) continue
    const rest = path.slice(prefix.length)
    if (method === "GET") {
      if (prefix === "/v1/models/") return undefined
      const model = decode(rest)
      return model === undefined ? undefined : { op: "get", route: "GET /v1beta/models/{model}", model }
    }
    if (method !== "POST") return undefined
    // The method is after the last colon; ids may contain colons themselves (`llama3:8b`).
    const colon = rest.lastIndexOf(":")
    const verb = colon > 0 ? rest.slice(colon + 1) : ""
    const model = decode(rest.slice(0, colon))
    if (!/^[A-Za-z]+$/.test(verb) || model === undefined) return undefined
    if (verb === "generateContent" || verb === "streamGenerateContent")
      return { op: "generate", route: `POST ${prefix.slice(0, -1)}/{model}:${verb}`, model: model.startsWith("models/") ? model.slice(7) : model, stream: verb === "streamGenerateContent" }
    if (verb === "countTokens") return { op: "count", route: `POST ${prefix.slice(0, -1)}/{model}:countTokens`, model: model.startsWith("models/") ? model.slice(7) : model }
    // The client's verb never becomes a metric or log label: every other verb is `unknown` (#135).
    return { op: "unsupported", route: "unknown", verb }
  }
  return undefined
}

/**
 * The credential in the form `authenticate` reads: `Authorization` as sent, else the Gemini key
 * as `x-goog-api-key` or the `key` query parameter. Query strings end up in proxy and access
 * logs; plugboard never logs the URL, but prefer the header.
 */
export function geminiAuthorization(request: IncomingMessage, url: URL): string | undefined {
  if (request.headers.authorization !== undefined) return request.headers.authorization
  const key = request.headers["x-goog-api-key"] ?? url.searchParams.get("key")
  return typeof key === "string" && key.length > 0 ? `Bearer ${key}` : undefined
}

export interface GeminiCall {
  readonly match: GeminiMatch
  readonly request: IncomingMessage
  readonly url: URL
  readonly app: string
  readonly response: ServerResponse
  readonly scope: RequestScope
  /** The route's log fields: the resolved model, and the outcome of a stream that failed after it committed. */
  readonly info: ServedInfo & { model?: string; failed?: string; dropped?: string }
}

export async function serveGemini(host: RouteHost, { match, request, url, app, response, scope, info }: GeminiCall): Promise<void> {
  const fail = (error: PlugError) => sendError(response, error, encodeGeminiError(error))

  if (match.op === "unsupported")
    return fail({
      status: 404,
      kind: "not_found",
      code: "method_not_supported",
      message: `Method ${match.verb} is not supported; plugboard serves generateContent, streamGenerateContent and countTokens`,
    })

  if (match.op === "count") {
    const unsupported = checkJsonContentType(request)
    if (unsupported) return fail(unsupported)
    const counting = await inlineRequestFiles(host, app, "gemini", countBody(await readJsonBody(request, scope.signal, bodyLimits(host.options, app, host.keys?.appNames()))), scope)
    if (isPlugError(counting)) return fail(counting)
    const parsed = parseGeminiRequest(match.model, false, counting, { ...host.options, maxChoices: maxChoicesFor(host.options, app) }, maxChoicesOption(host.options, app))
    if (isPlugError(parsed)) return fail(parsed)
    const catalog = await scope.race(host.loadCatalog())
    const requested = requestedModel(host.options, app, match.model, parsed.reasoningEffort)
    const ref = resolveModel(host.options, requested.model, catalog, requested.effort)
    if (isPlugError(ref)) return fail(ref)
    info.model = `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`
    // An estimate, not the provider's count (see src/anthropic/tokens.ts). The request as the session sends it: the app's policy, persona and OpenCode tools count too (#201).
    const counted = await scope.race(sessionRequest(host.session, app, { ...parsed.request, model: requested.model, ref }, appPolicy(host.options, app), scope.signal))
    if (isPlugError(counted)) return fail(counted)
    return sendJson(response, 200, { totalTokens: estimateTokens(counted, ref.id) })
  }

  if (match.op === "list" || match.op === "get") {
    const listed = listAvailableModels(host.options, await scope.race(host.loadCatalog()), app)
    if (match.op === "list") return sendJson(response, 200, encodeGeminiModelList(listed))
    const item = listed.find((m) => m.id === match.model)
    if (!item) return fail({ status: 404, kind: "not_found", code: "model_not_found", param: "model", message: modelNotAvailable(match.model, "GET /v1beta/models") })
    info.model = item.id
    return sendJson(response, 200, encodeGeminiModel(item))
  }

  // `alt=sse` is SSE; no `alt` (or `alt=json`) is Google's default, a JSON array streamed as it is produced.
  const alt = url.searchParams.get("alt")
  if (match.stream && alt !== null && alt !== "sse" && alt !== "json")
    return fail({ status: 400, kind: "invalid_request", code: "unsupported_parameter", param: "alt", message: "streamGenerateContent takes alt=sse, or no alt for a streamed JSON array" })
  const wire = alt === "sse" ? sseWire() : arrayWire()
  const unsupported = checkJsonContentType(request)
  if (unsupported) return fail(unsupported)
  // The caller's cache headers: a bad value is a 400 before the body is read.
  const cache = parseCacheDirective(request.headers)
  if (isPlugError(cache)) return fail(cache)
  // A `fileData.fileUri` naming a stored file is replaced by the inline form of that file before the decoder runs (since next).
  const body = await inlineRequestFiles(host, app, "gemini", await readJsonBody(request, scope.signal, bodyLimits(host.options, app, host.keys?.appNames())), scope)
  if (isPlugError(body)) return fail(body)

  // The app's own `maxChoices` is the cap for this request; the decoder checks `candidateCount` against it.
  const parsed = parseGeminiRequest(match.model, match.stream, body, { ...host.options, maxChoices: maxChoicesFor(host.options, app) }, maxChoicesOption(host.options, app))
  if (isPlugError(parsed)) return fail(parsed)
  const catalog = await scope.race(host.loadCatalog())
  const requested = requestedModel(host.options, app, match.model, parsed.reasoningEffort)
  const ref = resolveModel(host.options, requested.model, catalog, requested.effort)
  if (isPlugError(ref)) return fail(ref)
  info.model = `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`
  if (effortUnavailable(catalog, ref, requested.effort)) response.setHeader(THINKING_HEADER, "unavailable")
  // Sampling parameters the model is known to reject are dropped and reported, before any response bytes.
  const generation = appGeneration(appPolicy(host.options, app), parsed.request.generation)
  const sampled = host.options.dropUnsupportedParams ? dropRejected(ref, generation) : undefined
  if (sampled && sampled.dropped.length > 0) {
    info.dropped = sampled.dropped.join(",")
    response.setHeader(DROPPED_HEADER, info.dropped)
  }
  const call: PlugRequest = { ...parsed.request, model: requested.model, generation: sampled?.generation ?? generation, ref }
  const { exchange } = parsed
  // The answer names the model it runs on: the app's pin, else the caller's (#261).
  exchange.model = requested.model

  // candidateCount > 1: one independent call per candidate, merged (src/openai/fanout.ts).
  if (parsed.candidates > 1) return serveChoices(host, { app, calls: Array.from({ length: parsed.candidates }, () => call), response, scope, info, codec: geminiCodec(exchange, wire), cache })

  // Abandoned requests (client gone, deadline passed) must never reach the model caller.
  if (scope.signal.aborted) throw scope.signal.reason
  const events = boundEvents(
    host.caller.stream(call, {
      app,
      signal: scope.signal,
      onRecord: (recordID, directory) => {
        if (response.headersSent || response.destroyed || !/^[\x21-\x7e]+$/.test(recordID)) return
        response.setHeader(SESSION_HEADER, recordID)
        setSessionLink(response, info, sessionUrlTemplate(host.options, app), recordID, directory)
      },
      onServed: reportServed(response, info, (served) => void (exchange.model = served.model)),
      onPolicy: reportPolicy(response),
      onAffinity: reportAffinity(response),
      onUsage: reportUsage(response, match.stream),
      onOpencodeTools: reportOpencodeTools(response, match.stream),
      cache,
      onCache: reportCache(response),
      onCacheDirective: reportCacheDirective(response),
    }),
    scope,
  )

  if (exchange.stream) {
    const sse = sseWriter(response, scope.signal, undefined, wire)
    const { failure } = await runGenerate(sse.paced(events), exchange, (chunk) => sse.write(wire.frame(chunk)))
    if (!sse.started && !response.headersSent) {
      if (!scope.signal.aborted || scope.timedOut) fail(failure ?? noResponse())
    } else {
      if (failure) {
        info.failed = failure.code ?? failure.kind
        // Google ends a failed stream with one error object (the last element of a JSON array).
        sse.write(wire.frame(encodeGeminiError(failure)))
      }
      sse.write(wire.end())
      if (!response.writableEnded) response.end()
    }
    return
  }

  const run = await runGenerate(events, exchange, () => {})
  if (run.failure || !run.response) return fail(run.failure ?? noResponse())
  if (run.structuredFallback) response.setHeader(STRUCTURED_FALLBACK_HEADER, "text")
  sendJson(response, 200, run.response)
}
