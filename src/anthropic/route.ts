/**
 * `POST /v1/messages` (and a clear 404 for `POST /v1/messages/count_tokens`): the Anthropic
 * Messages front-end's half of the route. `src/openai/route.ts` hands every request for these
 * paths over before it does anything else, because this route differs from the OpenAI ones in
 * three ways: errors use Anthropic's body shape from the first check on, `x-api-key` authenticates
 * as well as `Authorization: Bearer`, and there is no `[DONE]`.
 *
 * Same flow as the other front-ends: origin check, authenticate, parse, resolve the model, call
 * the ModelCaller, encode. Nothing is committed until the encoder emits its first event, so a
 * failure before any output is a real HTTP error even when the client asked for a stream.
 * `anthropic-version` and `anthropic-beta` are accepted and ignored.
 */

import type { IncomingMessage, ServerResponse } from "node:http"
import { authenticate } from "../config.js"
import { isPlugError, type PlugError, type PlugRequest } from "../contract.js"
import {
  BodyError,
  RequestAborted,
  boundEvents,
  checkJsonContentType,
  checkOrigin,
  readJsonBody,
  sendJson,
  sseWriter,
  type RequestScope,
} from "../http.js"
import { reportServed, type ServedInfo } from "../fallback.js"
import { resolveModel } from "../models.js"
import { reportPolicy } from "../policy.js"
import { dropRejected } from "../openai/sampling.js"
import type { RouteHost } from "../openai/route.js"
import { parseMessagesRequest } from "./request.js"
import { encodeError, runMessage, sseFrame } from "./response.js"

const SESSION_HEADER = "x-plugboard-session"
const DROPPED_HEADER = "x-plugboard-dropped-params"
const MESSAGES = "/v1/messages"
const COUNT_TOKENS = "/v1/messages/count_tokens"

/** Paths this front-end owns, whatever the method. */
export const isMessagesPath = (path: string) => path === MESSAGES || path === COUNT_TOKENS

export interface MessagesCall {
  readonly path: string
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly scope: RequestScope
  /** The route's log fields: the route name, the app, the resolved model, dropped parameters, and the outcome of a stream that failed after it committed. */
  readonly info: ServedInfo & { route: string; app?: string; model?: string; failed?: string; dropped?: string }
}

const header = (request: IncomingMessage, name: string): string | undefined => {
  const value = request.headers[name]
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined
}

/** `Authorization: Bearer` first (Claude Code with ANTHROPIC_AUTH_TOKEN), then `x-api-key` (the Anthropic SDKs). One key store. */
const authenticateRequest = (host: RouteHost, request: IncomingMessage) => {
  const bearer = authenticate(host.options, request.headers.authorization)
  const apiKey = header(request, "x-api-key")
  return isPlugError(bearer) && apiKey ? authenticate(host.options, `Bearer ${apiKey}`) : bearer
}

export async function serveMessages(host: RouteHost, call: MessagesCall): Promise<void> {
  const { path, request, response, scope, info } = call
  const fail = (error: PlugError, close = false) => sendJson(response, error.status, encodeError(error), { close })
  if (request.method === "POST") info.route = `POST ${path}`
  response.setHeader("request-id", `req_${crypto.randomUUID().replaceAll("-", "")}`)

  try {
    await serve()
  } catch (caught) {
    // Answer in this route's error shape, then rethrow: the shared handler logs the outcome and
    // finds the response already sent.
    if (!response.headersSent) {
      if (caught instanceof BodyError) fail({ status: caught.status, kind: "invalid_request", message: caught.message }, caught.status === 413)
      else if (caught instanceof RequestAborted) {
        if (caught.kind === "timeout") fail(scope.timeoutError, true)
      } else fail({ status: 500, kind: "server", message: "Internal server error" })
    }
    throw caught
  }

  async function serve(): Promise<void> {
    if (request.method !== "POST")
      return fail({ status: 405, kind: "invalid_request", code: "method_not_allowed", message: `Method ${request.method} is not allowed for ${path}; use POST` })
    const rejected = checkOrigin(request, host.options)
    if (rejected) return fail(rejected)
    const auth = authenticateRequest(host, request)
    if (isPlugError(auth)) return fail(auth)
    info.app = auth.app
    if (path === COUNT_TOKENS)
      return fail({ status: 404, kind: "not_found", code: "not_found", message: "count_tokens is not supported by plugboard" })
    const unsupported = checkJsonContentType(request)
    if (unsupported) return fail(unsupported)

    const body = await readJsonBody(request, scope.signal)
    const parsed = parseMessagesRequest(body, host.options)
    if (isPlugError(parsed)) return fail(parsed)
    const catalog = await scope.race(host.loadCatalog())
    const ref = resolveModel(host.options, parsed.request.model, catalog, parsed.reasoningEffort)
    if (isPlugError(ref)) return fail(ref)
    info.model = `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`
    // Sampling parameters the model is known to reject are dropped; `top_k` has no neutral
    // equivalent and is always dropped. Both are reported before any response bytes.
    const sampled = host.options.dropUnsupportedParams ? dropRejected(ref, parsed.request.generation) : undefined
    const dropped = [...(sampled?.dropped ?? []), ...(parsed.topKIgnored ? ["top_k"] : [])]
    if (dropped.length > 0) {
      info.dropped = dropped.join(",")
      response.setHeader(DROPPED_HEADER, info.dropped)
    }
    const model: PlugRequest = { ...parsed.request, ...(sampled ? { generation: sampled.generation } : {}), ref }
    const { exchange } = parsed

    // Abandoned requests (client gone, deadline passed) must never reach the model caller.
    if (scope.signal.aborted) throw scope.signal.reason
    const events = boundEvents(
      host.caller.stream(model, {
        app: auth.app,
        signal: scope.signal,
        onRecord: (recordID) => {
          if (response.headersSent || response.destroyed || !/^[\x21-\x7e]+$/.test(recordID)) return
          response.setHeader(SESSION_HEADER, recordID)
        },
        onServed: reportServed(response, info, (served) => void (exchange.model = served.model)),
        onPolicy: reportPolicy(response),
      }),
      scope,
    )

    if (exchange.stream) {
      const sse = sseWriter(response, scope.signal)
      const { failure, started } = await runMessage(sse.paced(events), exchange, (event) => sse.write(sseFrame(event)))
      if (!sse.started && !response.headersSent) {
        if (!scope.signal.aborted || scope.timedOut) fail(failure ?? { status: 502, kind: "server", message: "No response from the model" })
      } else {
        if (failure) {
          info.failed = failure.code ?? failure.kind
          // Committed by a keepalive before the encoder wrote anything: the encoder left the error for us.
          if (!started && !response.writableEnded) sse.write(sseFrame(encodeError(failure)))
        }
        if (!response.writableEnded) response.end()
      }
      return
    }

    const run = await runMessage(events, exchange, () => {})
    if (run.failure || !run.message) return fail(run.failure ?? { status: 502, kind: "server", message: "No response from the model" })
    sendJson(response, 200, run.message)
  }
}
