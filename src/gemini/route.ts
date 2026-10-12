/**
 * The Gemini front-end's half of the route: `GET /v1beta/models`, `GET /v1beta/models/{model}`,
 * `POST /v1beta/models/{model}:generateContent`, `:streamGenerateContent?alt=sse` and `:countTokens` (an estimate, #144) (and the
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
 * HTTP error even for a stream.
 */

import type { IncomingMessage, ServerResponse } from "node:http"
import { isPlugError, type PlugError, type PlugRequest } from "../contract.js"
import { reportServed, type ServedInfo } from "../fallback.js"
import { boundEvents, checkJsonContentType, readJsonBody, sendError, sendJson, sseWriter, type RequestScope } from "../http.js"
import { listAvailableModels, resolveModel } from "../models.js"
import { reportCache } from "../cache.js"
import { reportPolicy } from "../policy.js"
import { reportUsage } from "../usage-header.js"
import { setSessionLink } from "../session/link.js"
import type { RouteHost } from "../openai/route.js"
import { dropRejected } from "../openai/sampling.js"
import { estimateTokens } from "../anthropic/tokens.js"
import { parseGeminiRequest } from "./request.js"
import { encodeGeminiError, encodeGeminiModel, encodeGeminiModelList, runGenerate, sseChunk } from "./response.js"

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
    return fail({ status: 404, kind: "not_found", code: "method_not_supported", message: `Method ${match.verb} is not supported; plugboard serves generateContent, streamGenerateContent and countTokens` })

  if (match.op === "count") {
    const unsupported = checkJsonContentType(request)
    if (unsupported) return fail(unsupported)
    const parsed = parseGeminiRequest(match.model, false, countBody(await readJsonBody(request, scope.signal)), host.options)
    if (isPlugError(parsed)) return fail(parsed)
    const catalog = await scope.race(host.loadCatalog())
    const ref = resolveModel(host.options, match.model, catalog, parsed.reasoningEffort)
    if (isPlugError(ref)) return fail(ref)
    info.model = `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`
    // An estimate, not the provider's count (see src/anthropic/tokens.ts).
    return sendJson(response, 200, { totalTokens: estimateTokens(parsed.request) })
  }

  if (match.op === "list" || match.op === "get") {
    const listed = listAvailableModels(host.options, await scope.race(host.loadCatalog()), app)
    if (match.op === "list") return sendJson(response, 200, encodeGeminiModelList(listed))
    const item = listed.find((m) => m.id === match.model)
    if (!item) return fail({ status: 404, kind: "not_found", code: "model_not_found", param: "model", message: `Model ${match.model} is not available` })
    info.model = item.id
    return sendJson(response, 200, encodeGeminiModel(item))
  }

  if (match.stream && url.searchParams.get("alt") !== "sse")
    return fail({ status: 400, kind: "invalid_request", code: "unsupported_parameter", param: "alt", message: "streamGenerateContent needs the query parameter alt=sse" })
  const unsupported = checkJsonContentType(request)
  if (unsupported) return fail(unsupported)
  const body = await readJsonBody(request, scope.signal)

  const parsed = parseGeminiRequest(match.model, match.stream, body, host.options)
  if (isPlugError(parsed)) return fail(parsed)
  const catalog = await scope.race(host.loadCatalog())
  const ref = resolveModel(host.options, match.model, catalog, parsed.reasoningEffort)
  if (isPlugError(ref)) return fail(ref)
  info.model = `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`
  // Sampling parameters the model is known to reject are dropped and reported, before any response bytes.
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
      app,
      signal: scope.signal,
      onRecord: (recordID, directory) => {
        if (response.headersSent || response.destroyed || !/^[\x21-\x7e]+$/.test(recordID)) return
        response.setHeader(SESSION_HEADER, recordID)
        setSessionLink(response, info, host.options.historyUrl, recordID, directory)
      },
      onServed: reportServed(response, info, (served) => void (exchange.model = served.model)),
      onPolicy: reportPolicy(response),
      onUsage: reportUsage(response, match.stream),
      onCache: reportCache(response),
    }),
    scope,
  )

  if (exchange.stream) {
    const sse = sseWriter(response, scope.signal)
    const { failure } = await runGenerate(sse.paced(events), exchange, (chunk) => sse.write(sseChunk(chunk)))
    if (!sse.started && !response.headersSent) {
      if (!scope.signal.aborted || scope.timedOut) fail(failure ?? { status: 502, kind: "server", message: "No response from the model" })
    } else {
      if (failure) {
        info.failed = failure.code ?? failure.kind
        // Google ends a failed stream with one error object.
        sse.write(sseChunk(encodeGeminiError(failure)))
      }
      if (!response.writableEnded) response.end()
    }
    return
  }

  const run = await runGenerate(events, exchange, () => {})
  if (run.failure || !run.response) return fail(run.failure ?? { status: 502, kind: "server", message: "No response from the model" })
  sendJson(response, 200, run.response)
}
