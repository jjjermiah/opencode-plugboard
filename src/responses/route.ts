/**
 * `POST /v1/responses`: the Responses front-end's half of the route. `src/openai/route.ts` has
 * already checked origin, authenticated, and read the JSON body (the same handling and
 * deadline as Chat Completions) and hands over here.
 *
 * Same flow as Chat Completions: parse, resolve the model, call the ModelCaller, encode. Nothing
 * is committed until the encoder emits its first event, so a failure before any output is a
 * real HTTP error even when the client asked for a stream.
 */

import type { ServerResponse } from "node:http"
import { isPlugError, type PlugError, type PlugRequest } from "../contract.js"
import { appPolicy, historyTemplate, hostedToolsFor, reasoningOutputFor, requestedModel } from "../config.js"
import { reportServed, type ServedInfo } from "../fallback.js"
import { boundEvents, sendError, sendJson, sseWriter, type RequestScope } from "../http.js"
import { effortUnavailable, resolveModel, THINKING_HEADER } from "../models.js"
import { reportCache } from "../cache.js"
import { reportDroppedTools, reportParallelTools, reportPolicy, reportServerTools } from "../policy.js"
import { reportUsage } from "../usage-header.js"
import { setSessionLink } from "../session/link.js"
import { reportAffinity } from "../session/affinity.js"
import { STRUCTURED_FALLBACK_HEADER, encodeError } from "../openai/response.js"
import type { ResponsesExchange, ResponsesStreamEvent } from "./response.js"
import { appGeneration } from "../openai/sampling.js"
import type { RouteHost } from "../openai/route.js"
import { parseResponsesRequest } from "./request.js"
import { runResponse, sseFrame } from "./response.js"
import { findItem, forgetAnswer, rememberAnswer } from "./store.js"
import { fullItem, retentionDaysFor } from "./state.js"
import { loadFiles } from "../files/route.js"
import { fileRefs, inlineFiles, restoreFileRefs } from "../files/refs.js"

const SESSION_HEADER = "x-plugboard-session"

export interface ResponsesCall {
  readonly app: string
  readonly body: unknown
  readonly response: ServerResponse
  readonly scope: RequestScope
  /** The route's log fields: the resolved model, and the outcome of a stream that failed after it committed. */
  readonly info: ServedInfo & { model?: string; failed?: string }
}

/** The input and output items of the stored response `previous_response_id` names; the same 400 for an unknown, expired, deleted or another app's id (OpenAI answers 400 here; GET, DELETE and input_items answer 404). */
async function chainOf(host: RouteHost, app: string, body: unknown, days: number): Promise<ReadonlyArray<Record<string, unknown>> | PlugError | undefined> {
  const id = typeof body === "object" && body !== null ? (body as { previous_response_id?: unknown }).previous_response_id : undefined
  if (typeof id !== "string" || id.length === 0) return undefined
  const previous = await host.responses.load(app, id, days)
  if (previous === undefined)
    return {
      status: 400,
      kind: "invalid_request",
      code: "previous_response_not_found",
      param: "previous_response_id",
      message: `Previous response with id '${id.slice(0, 80)}' not found.`,
    }
  const output = (previous.response as { output?: unknown }).output
  return [...previous.input, ...(Array.isArray(output) ? (output as Array<Record<string, unknown>>) : [])]
}

export async function serveResponses(host: RouteHost, { app, body, response, scope, info }: ResponsesCall): Promise<void> {
  const fail = (error: PlugError) => sendError(response, error, encodeError(error))

  // Retention is the app's history retention, for both the lookup and the new record.
  const days = retentionDaysFor(host.options, app)
  const history = await scope.race(chainOf(host, app, body, days))
  if (history !== undefined && isPlugError(history)) return fail(history)
  // `input_file` and `input_image` parts with a `file_id` (in this request or in the chain before it) are replaced by the inline form of
  // the stored file before the decoder runs (since next). A stored response keeps the reference, not the bytes (`restoreFileRefs`).
  const loaded = await loadFiles(host, app, fileRefs("responses", body, history ?? []), scope)
  if (isPlugError(loaded)) return fail(loaded)
  const inlined = inlineFiles("responses", body, loaded)
  if (isPlugError(inlined)) return fail(inlined)
  const inlinedChain = history === undefined ? undefined : inlineFiles("responses", { input: history }, loaded)
  if (inlinedChain !== undefined && isPlugError(inlinedChain)) return fail(inlinedChain)
  const parsed = parseResponsesRequest(
    inlined,
    host.options,
    (itemId) => findItem(app, itemId),
    (inlinedChain as { input: ReadonlyArray<Record<string, unknown>> } | undefined)?.input,
    hostedToolsFor(host.options, app),
  )
  if (isPlugError(parsed)) return fail(parsed)
  // `store: false` keeps nothing for retrieval, so its output items cannot be referenced later (#426).
  const keeps = (body as { store?: unknown }).store !== false
  /** Every input item the model sees, which is what a stored response keeps and `input_items` lists. */
  const stored = () => [...(history ?? []), ...restoreFileRefs(parsed.inputItems)]
  const catalog = await scope.race(host.loadCatalog())
  const requested = requestedModel(host.options, app, parsed.request.model, parsed.reasoningEffort)
  const ref = resolveModel(host.options, requested.model, catalog, requested.effort)
  if (isPlugError(ref)) return fail(ref)
  info.model = `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`
  if (effortUnavailable(catalog, ref, requested.effort)) response.setHeader(THINKING_HEADER, "unavailable")
  const generation = appGeneration(appPolicy(host.options, app), parsed.request.generation)
  const call: PlugRequest = { ...parsed.request, model: requested.model, generation, ref }
  reportParallelTools(response, call)
  reportDroppedTools(response, parsed.droppedTools)
  // The echoed object shows what the model gets: the app's cap and sampling defaults, not only the caller's values (#263, #264).
  const exchange: ResponsesExchange = {
    ...parsed.exchange,
    model: requested.model,
    reasoningOutput: reasoningOutputFor(host.options, app),
    envelope: {
      ...parsed.exchange.envelope,
      max_output_tokens: generation.maxTokens ?? null,
      temperature: generation.temperature ?? null,
      top_p: generation.topP ?? null,
    },
  }

  // Abandoned requests (client gone, deadline passed) must never reach the model caller.
  if (scope.signal.aborted) throw scope.signal.reason
  const events = boundEvents(
    host.caller.stream(call, {
      app,
      signal: scope.signal,
      onRecord: (recordID, directory) => {
        if (response.headersSent || response.destroyed || !/^[\x21-\x7e]+$/.test(recordID)) return
        response.setHeader(SESSION_HEADER, recordID)
        setSessionLink(response, info, historyTemplate(host.options, app), recordID, directory)
      },
      onServed: reportServed(response, info, (served) => void (exchange.model = served.model)),
      onPolicy: reportPolicy(response),
      onAffinity: reportAffinity(response),
      onUsage: reportUsage(response, exchange.stream),
      onServerTools: reportServerTools(response, exchange.stream),
      onCache: reportCache(response),
    }),
    scope,
  )

  if (exchange.stream) {
    const sse = sseWriter(response, scope.signal)
    // The closing event of a kept answer goes out after the answer is stored, so a client that retrieves it at once finds it.
    const closing: { event?: ResponsesStreamEvent } = {}
    const write = (event: ResponsesStreamEvent) => {
      if (keeps && (event.type === "response.completed" || event.type === "response.incomplete")) closing.event = event
      else sse.write(sseFrame(event))
    }
    const run = await runResponse(sse.paced(events), exchange, write, () => sse.started)
    if (keeps && run.response && !run.failure) rememberAnswer(app, run.response)
    if (keeps && run.response && !run.failure) await host.responses.save(app, days, stored(), run.response)
    if (closing.event) sse.write(sseFrame(closing.event))
    if (!sse.started && !response.headersSent) {
      if (!scope.signal.aborted || scope.timedOut) fail(run.failure ?? { status: 502, kind: "server", message: "No response from the model" })
    } else {
      if (run.failure) info.failed = run.failure.code ?? run.failure.kind
      if (!response.writableEnded) response.end()
    }
    return
  }

  const run = await runResponse(events, exchange, () => {})
  if (run.failure || !run.response) return fail(run.failure ?? { status: 502, kind: "server", message: "No response from the model" })
  if (keeps) {
    rememberAnswer(app, run.response)
    await host.responses.save(app, days, stored(), run.response)
  }
  if (run.structuredFallback) response.setHeader(STRUCTURED_FALLBACK_HEADER, "text")
  sendJson(response, 200, run.response)
}

/** A stored-response route: `GET` or `DELETE /v1/responses/{id}`, or `GET /v1/responses/{id}/input_items`. `route` is the log and metrics name, never carrying the id. */
export interface StoredRoute {
  readonly route: "GET /v1/responses/{id}" | "DELETE /v1/responses/{id}" | "GET /v1/responses/{id}/input_items"
  readonly id: string
}

const STORED_PATH = /^\/v1\/responses\/([^/]+)(\/input_items)?$/

export function matchStoredRoute(method: string | undefined, path: string): StoredRoute | undefined {
  const match = STORED_PATH.exec(path)
  if (!match) return undefined
  let id = match[1]!
  try {
    id = decodeURIComponent(id)
  } catch {}
  if (match[2] !== undefined) return method === "GET" ? { route: "GET /v1/responses/{id}/input_items", id } : undefined
  if (method === "GET") return { route: "GET /v1/responses/{id}", id }
  if (method === "DELETE") return { route: "DELETE /v1/responses/{id}", id }
  return undefined
}

export interface StoredCall {
  readonly app: string
  readonly match: StoredRoute
  readonly url: URL
  readonly response: ServerResponse
  readonly scope: RequestScope
}

const INPUT_ITEMS_LIMIT = { min: 1, max: 100, fallback: 20 }

const badQuery = (message: string, param: string, code: string): PlugError => ({ status: 400, kind: "invalid_request", code, param, message })

/** The `limit` query of the input item list: an integer from 1 to 100, 20 when absent (OpenAI's rule and error codes). */
function pageLimit(raw: string | null): number | PlugError {
  if (raw === null) return INPUT_ITEMS_LIMIT.fallback
  if (!/^-?\d+$/.test(raw)) return badQuery("Invalid type for 'limit': expected an integer.", "limit", "invalid_type")
  const limit = Number(raw)
  if (limit < INPUT_ITEMS_LIMIT.min)
    return badQuery(`Invalid 'limit': integer below minimum value. Expected a value >= ${INPUT_ITEMS_LIMIT.min}, but got ${limit} instead.`, "limit", "integer_below_min_value")
  if (limit > INPUT_ITEMS_LIMIT.max)
    return badQuery(`Invalid 'limit': integer above maximum value. Expected a value <= ${INPUT_ITEMS_LIMIT.max}, but got ${limit} instead.`, "limit", "integer_above_max_value")
  return limit
}

/**
 * `GET /v1/responses/{id}`, `DELETE /v1/responses/{id}` and `GET /v1/responses/{id}/input_items`. Authentication and the
 * endpoint check ran before this; the app is the caller's own, and every lookup is under it (I32). An id that is unknown,
 * expired, deleted, or another app's is the same 404, in OpenAI's body (`invalid_request_error`).
 */
export async function serveStoredResponse(host: RouteHost, { app, match, url, response, scope }: StoredCall): Promise<void> {
  const fail = (error: PlugError) => sendError(response, error, encodeError(error))
  const days = retentionDaysFor(host.options, app)
  const missing = () => fail({ status: 404, kind: "invalid_request", message: `Response with id '${match.id.slice(0, 80)}' not found.` })

  if (match.route === "DELETE /v1/responses/{id}") {
    if (!(await scope.race(host.responses.remove(app, match.id)))) return missing()
    forgetAnswer(app, match.id)
    return sendJson(response, 200, { id: match.id, object: "response.deleted", deleted: true })
  }

  if (match.route === "GET /v1/responses/{id}" && url.searchParams.get("stream") === "true")
    return fail({ status: 400, kind: "invalid_request", code: "unsupported_parameter", param: "stream", message: "Streaming a stored response is not supported: retrieve it without stream" })

  const record = await scope.race(host.responses.load(app, match.id, days))
  if (record === undefined) return missing()
  if (match.route === "GET /v1/responses/{id}") return sendJson(response, 200, record.response)

  const limit = pageLimit(url.searchParams.get("limit"))
  if (isPlugError(limit)) return fail(limit)
  const order = url.searchParams.get("order") ?? "desc"
  if (order !== "asc" && order !== "desc") return fail(badQuery(`Invalid value: '${order.slice(0, 20)}'. Supported values are: 'asc' and 'desc'.`, "order", "invalid_value"))
  // A record kept before items were stored in full shape may still hold a message without `type` (#546).
  const items = order === "asc" ? record.input.map(fullItem) : record.input.map(fullItem).reverse()
  const after = url.searchParams.get("after")
  const start = after === null ? 0 : items.findIndex((item) => item.id === after) + 1
  if (after !== null && start === 0) return fail(badQuery("Invalid 'after': no input item has this id.", "after", "invalid_cursor"))
  const page = items.slice(start, start + limit)
  return sendJson(response, 200, {
    object: "list",
    data: page,
    first_id: page[0]?.id ?? null,
    last_id: page.at(-1)?.id ?? null,
    has_more: start + limit < items.length,
  })
}
