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
import { appPolicy, historyTemplate, requestedModel } from "../config.js"
import { reportServed, type ServedInfo } from "../fallback.js"
import { boundEvents, sendError, sendJson, sseWriter, type RequestScope } from "../http.js"
import { resolveModel } from "../models.js"
import { reportCache } from "../cache.js"
import { reportParallelTools, reportPolicy, reportServerTools } from "../policy.js"
import { reportUsage } from "../usage-header.js"
import { setSessionLink } from "../session/link.js"
import { reportAffinity } from "../session/affinity.js"
import { STRUCTURED_FALLBACK_HEADER, encodeError } from "../openai/response.js"
import type { ResponsesExchange } from "./response.js"
import { appGeneration } from "../openai/sampling.js"
import type { RouteHost } from "../openai/route.js"
import { parseResponsesRequest } from "./request.js"
import { runResponse, sseFrame } from "./response.js"
import { findItem, rememberAnswer } from "./store.js"

const SESSION_HEADER = "x-plugboard-session"

export interface ResponsesCall {
  readonly app: string
  readonly body: unknown
  readonly response: ServerResponse
  readonly scope: RequestScope
  /** The route's log fields: the resolved model, and the outcome of a stream that failed after it committed. */
  readonly info: ServedInfo & { model?: string; failed?: string }
}

export async function serveResponses(host: RouteHost, { app, body, response, scope, info }: ResponsesCall): Promise<void> {
  const fail = (error: PlugError) => sendError(response, error, encodeError(error))

  const parsed = parseResponsesRequest(body, host.options, (itemId) => findItem(app, itemId))
  if (isPlugError(parsed)) return fail(parsed)
  const catalog = await scope.race(host.loadCatalog())
  const requested = requestedModel(host.options, app, parsed.request.model, parsed.reasoningEffort)
  const ref = resolveModel(host.options, requested.model, catalog, requested.effort)
  if (isPlugError(ref)) return fail(ref)
  info.model = `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`
  const generation = appGeneration(appPolicy(host.options, app), parsed.request.generation)
  const call: PlugRequest = { ...parsed.request, model: requested.model, generation, ref }
  reportParallelTools(response, call)
  // The echoed object shows what the model gets: the app's cap and sampling defaults, not only the caller's values (#263, #264).
  const exchange: ResponsesExchange = {
    ...parsed.exchange,
    model: requested.model,
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
    const run = await runResponse(sse.paced(events), exchange, (event) => sse.write(sseFrame(event)), () => sse.started)
    if (run.response && !run.failure) rememberAnswer(app, run.response)
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
  rememberAnswer(app, run.response)
  if (run.structuredFallback) response.setHeader(STRUCTURED_FALLBACK_HEADER, "text")
  sendJson(response, 200, run.response)
}
