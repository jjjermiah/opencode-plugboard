/**
 * `POST /v1/messages` and `POST /v1/messages/count_tokens` (an estimate, see `tokens.ts`): the Anthropic
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
import { appPolicy, authenticate, bodyLimits, endpointRefusal, historyTemplate, requestedModel } from "../config.js"
import { liveOptions } from "../runtime.js"
import { bodyUserId, noteEndUser, requestUser, withEndUser } from "../user.js"
import { isPlugError, type PlugError, type PlugRequest } from "../contract.js"
import {
  BodyError,
  bodyPlugError,
  RequestAborted,
  boundEvents,
  checkJsonContentType,
  checkOrigin,
  readJsonBody,
  sendError,
  sendJson,
  sseWriter,
  type RequestScope,
} from "../http.js"
import { reportServed, type ServedInfo } from "../fallback.js"
import { resolveModel } from "../models.js"
import { reportCache } from "../cache.js"
import { reportParallelTools, reportPolicy, reportServerTools } from "../policy.js"
import { reportUsage } from "../usage-header.js"
import { setSessionLink } from "../session/link.js"
import { sessionRequest } from "../session/caller.js"
import { reportAffinity } from "../session/affinity.js"
import { appGeneration, dropRejected, stopOf } from "../openai/sampling.js"
import type { RouteHost } from "../openai/route.js"
import { parseMessagesRequest } from "./request.js"
import { estimateTokens } from "./tokens.js"
import { encodeError, messagesStatus, runMessage, sseFrame } from "./response.js"

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

const SESSION_HEADER = "x-plugboard-session"
const DROPPED_HEADER = "x-plugboard-dropped-params"
const MESSAGES = "/v1/messages"
/** The 400 `parseThinking` gives when the budget is not below `max_tokens` (src/anthropic/request.ts). */
const BUDGET_REFUSAL = "thinking.budget_tokens: must be less than max_tokens"
const COUNT_TOKENS = "/v1/messages/count_tokens"

/** Paths this front-end owns, whatever the method. */
export const isMessagesPath = (path: string) => path === MESSAGES || path === COUNT_TOKENS

export interface MessagesCall {
  readonly path: string
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly scope: RequestScope
  /** The route's log fields: the route name, the app, the resolved model, dropped parameters, and the outcome of a stream that failed after it committed. */
  readonly info: ServedInfo & { route: string; app?: string; model?: string; failed?: string; dropped?: string; user?: string }
}

const header = (request: IncomingMessage, name: string): string | undefined => {
  const value = request.headers[name]
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined
}

/** `Authorization: Bearer` first (Claude Code with ANTHROPIC_AUTH_TOKEN), then `x-api-key` (the Anthropic SDKs). One key store. */
export const authenticateRequest = async (host: RouteHost, request: IncomingMessage) => {
  const options = liveOptions(host.options)
  const runtime = host.keys ? await host.keys.digests() : []
  const bearer = authenticate(options, request.headers.authorization, runtime)
  const apiKey = header(request, "x-api-key")
  return isPlugError(bearer) && apiKey ? authenticate(options, `Bearer ${apiKey}`, runtime) : bearer
}

export async function serveMessages(host: RouteHost, call: MessagesCall): Promise<void> {
  const { path, request, response, scope, info } = call
  const fail = (error: PlugError, close = false) => sendError(response, { ...error, status: messagesStatus(error) }, encodeError(error), { close })
  if (request.method === "POST") info.route = `POST ${path}`
  response.setHeader("request-id", `req_${crypto.randomUUID().replaceAll("-", "")}`)

  try {
    await serve()
  } catch (caught) {
    // Answer in this route's error shape, then rethrow: the shared handler logs the outcome and
    // finds the response already sent.
    if (!response.headersSent) {
      if (caught instanceof BodyError) fail(bodyPlugError(caught), caught.status !== 400)
      else if (caught instanceof RequestAborted) {
        if (caught.kind === "timeout") fail(scope.timeoutError, true)
      } else fail({ status: 500, kind: "server", message: "Internal server error" })
    }
    throw caught
  }

  async function serve(): Promise<void> {
    const rejected = checkOrigin(request, host.options)
    if (rejected) return fail(rejected)
    // Authenticate before the method check, so an unauthenticated caller cannot map this path (#137).
    const auth = await authenticateRequest(host, request)
    if (isPlugError(auth)) return fail(auth)
    info.app = auth.app
    if (request.method !== "POST")
      return fail({ status: 405, kind: "invalid_request", code: "method_not_allowed", message: `Method ${request.method} is not allowed for ${path}; use POST` })
    // An app may be limited to some endpoints (#268): refused after authentication and the method check, in this shape.
    const refused = endpointRefusal(host.options, auth.app, "messages")
    if (refused) return fail(refused)
    const unsupported = checkJsonContentType(request)
    if (unsupported) return fail(unsupported)

    const sent = await readJsonBody(request, scope.signal, bodyLimits(host.options, auth.app))
    // The end user: the app's `userHeader` when the request sends it (#272), else the body's `metadata.user_id`.
    const user = requestUser(request.headers, appPolicy(host.options, auth.app)?.userHeader, bodyUserId(sent))
    const body = withEndUser(sent, user, "metadata")
    noteEndUser(response, info, user)
    // count_tokens takes the message body without max_tokens; the parser needs one, so a placeholder stands in
    // (the count never uses it). A max_tokens the client did send is still validated.
    // The app's output cap (#263) lowers `max_tokens` before it is parsed, so the thinking-budget rule (budget < max_tokens) refuses a
    // cap that cannot hold the budget with the existing 400. A count never uses `max_tokens`, so the cap does not apply to it.
    const cap = path === COUNT_TOKENS ? undefined : appPolicy(host.options, auth.app)?.maxOutputTokens
    const capped = cap !== undefined && isRecord(body) && typeof body.max_tokens === "number" && body.max_tokens > cap ? { ...body, max_tokens: cap } : body
    const sized = path === COUNT_TOKENS && isRecord(body) && body.max_tokens === undefined ? { ...body, max_tokens: Number.MAX_SAFE_INTEGER } : capped
    const parsed = parseMessagesRequest(sized, host.options)
    // A budget refused because the app's cap lowered `max_tokens` says so: the same 400, with the option named (#263).
    if (isPlugError(parsed))
      return fail(
        capped !== body && parsed.message === BUDGET_REFUSAL
          ? { ...parsed, message: `${BUDGET_REFUSAL}; apps.${auth.app}.maxOutputTokens (${cap}) lowers max_tokens` }
          : parsed,
      )
    const catalog = await scope.race(host.loadCatalog())
    const requested = requestedModel(host.options, auth.app, parsed.request.model, parsed.reasoningEffort)
    const ref = resolveModel(host.options, requested.model, catalog, requested.effort)
    if (isPlugError(ref)) return fail(ref)
    info.model = `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`
    // The request as the session sends it: the app's policy, persona and server tools are counted too (#201).
    if (path === COUNT_TOKENS) {
      const counted = await scope.race(sessionRequest(host.session, auth.app, { ...parsed.request, model: requested.model, ref }, appPolicy(host.options, auth.app), scope.signal))
      if (isPlugError(counted)) return fail(counted)
      return sendJson(response, 200, { input_tokens: estimateTokens(counted) })
    }
    // Sampling parameters the model is known to reject are dropped; `top_k` has no neutral
    // equivalent and is always dropped. Both are reported before any response bytes.
    const generation = appGeneration(appPolicy(host.options, auth.app), parsed.request.generation)
    const sampled = host.options.dropUnsupportedParams ? dropRejected(ref, generation) : undefined
    const dropped = [...(sampled?.dropped ?? []), ...(parsed.topKIgnored ? ["top_k"] : [])]
    if (dropped.length > 0) {
      info.dropped = dropped.join(",")
      response.setHeader(DROPPED_HEADER, info.dropped)
    }
    const model: PlugRequest = { ...parsed.request, model: requested.model, generation: sampled?.generation ?? generation, ref }
    reportParallelTools(response, model)
    // The stop sequences the answer is matched on (#390): the caller's, else the app's default. The model never gets them.
    const exchange = { ...parsed.exchange, stop: stopOf(appPolicy(host.options, auth.app), parsed.request.generation) ?? [] }
    // The answer names the model it runs on: the app's pin, else the caller's (#261).
    exchange.model = requested.model

    // Abandoned requests (client gone, deadline passed) must never reach the model caller.
    if (scope.signal.aborted) throw scope.signal.reason
    const events = boundEvents(
      host.caller.stream(model, {
        app: auth.app,
        signal: scope.signal,
        onRecord: (recordID, directory) => {
          if (response.headersSent || response.destroyed || !/^[\x21-\x7e]+$/.test(recordID)) return
          response.setHeader(SESSION_HEADER, recordID)
          setSessionLink(response, info, historyTemplate(host.options, auth.app), recordID, directory)
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
