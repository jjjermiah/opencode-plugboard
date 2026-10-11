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
import { boundEvents, sendJson, sseWriter, type RequestScope } from "../http.js"
import { resolveModel } from "../models.js"
import { encodeError } from "../openai/response.js"
import type { RouteHost } from "../openai/route.js"
import { parseResponsesRequest } from "./request.js"
import { runResponse, sseFrame } from "./response.js"

const SESSION_HEADER = "x-plugboard-session"

export interface ResponsesCall {
  readonly app: string
  readonly body: unknown
  readonly response: ServerResponse
  readonly scope: RequestScope
  /** The route's log fields: the resolved model, and the outcome of a stream that failed after it committed. */
  readonly info: { model?: string; failed?: string }
}

export async function serveResponses(host: RouteHost, { app, body, response, scope, info }: ResponsesCall): Promise<void> {
  const fail = (error: PlugError) => sendJson(response, error.status, encodeError(error))

  const parsed = parseResponsesRequest(body, host.options)
  if (isPlugError(parsed)) return fail(parsed)
  const catalog = await scope.race(host.loadCatalog())
  const ref = resolveModel(host.options, parsed.request.model, catalog, parsed.reasoningEffort)
  if (isPlugError(ref)) return fail(ref)
  info.model = `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`
  const call: PlugRequest = { ...parsed.request, ref }
  const { exchange } = parsed

  // Abandoned requests (client gone, deadline passed) must never reach the model caller.
  if (scope.signal.aborted) throw scope.signal.reason
  const events = boundEvents(
    host.caller.stream(call, {
      app,
      signal: scope.signal,
      onRecord: (recordID) => {
        if (response.headersSent || response.destroyed || !/^[\x21-\x7e]+$/.test(recordID)) return
        response.setHeader(SESSION_HEADER, recordID)
      },
    }),
    scope,
  )

  if (exchange.stream) {
    const sse = sseWriter(response, scope.signal)
    const { failure } = await runResponse(sse.paced(events), exchange, (event) => sse.write(sseFrame(event)))
    if (!sse.started && !response.headersSent) {
      if (!scope.signal.aborted || scope.timedOut) fail(failure ?? { status: 502, kind: "server", message: "No response from the model" })
    } else {
      if (failure) info.failed = failure.code ?? failure.kind
      if (!response.writableEnded) response.end()
    }
    return
  }

  const run = await runResponse(events, exchange, () => {})
  if (run.failure || !run.response) return fail(run.failure ?? { status: 502, kind: "server", message: "No response from the model" })
  sendJson(response, 200, run.response)
}
