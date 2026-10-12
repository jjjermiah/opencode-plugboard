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
import { appPolicy, authenticate, bodyLimits, historyTemplate } from "../config.js"
import { liveOptions } from "../runtime.js"
import { bodyUserId, noteEndUser } from "../user.js"
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
import { requestSystem } from "../session/context.js"
import { dropRejected } from "../openai/sampling.js"
import type { RouteHost } from "../openai/route.js"
import { parseMessagesRequest } from "./request.js"
import { estimateTokens } from "./tokens.js"
import { encodeError, messagesStatus, runMessage, sseFrame } from "./response.js"

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

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
  readonly info: ServedInfo & { route: string; app?: string; model?: string; failed?: string; dropped?: string; user?: string }
}

const header = (request: IncomingMessage, name: string): string | undefined => {
  const value = request.headers[name]
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined
}

/** `Authorization: Bearer` first (Claude Code with ANTHROPIC_AUTH_TOKEN), then `x-api-key` (the Anthropic SDKs). One key store. */
const authenticateRequest = async (host: RouteHost, request: IncomingMessage) => {
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
    const unsupported = checkJsonContentType(request)
    if (unsupported) return fail(unsupported)

    const body = await readJsonBody(request, scope.signal, bodyLimits(host.options))
    noteEndUser(response, info, bodyUserId(body))
    // count_tokens takes the message body without max_tokens; the parser needs one, so a placeholder stands in
    // (the count never uses it). A max_tokens the client did send is still validated.
    const sized = path === COUNT_TOKENS && isRecord(body) && body.max_tokens === undefined ? { ...body, max_tokens: Number.MAX_SAFE_INTEGER } : body
    const parsed = parseMessagesRequest(sized, host.options)
    if (isPlugError(parsed)) return fail(parsed)
    const catalog = await scope.race(host.loadCatalog())
    const ref = resolveModel(host.options, parsed.request.model, catalog, parsed.reasoningEffort)
    if (isPlugError(ref)) return fail(ref)
    info.model = `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`
    // The system prompt the session will send: the app's policy and the tool-choice steering are added before the model reads it (#201).
    if (path === COUNT_TOKENS) return sendJson(response, 200, { input_tokens: estimateTokens({ ...parsed.request, system: requestSystem(parsed.request, [], appPolicy({ apps: host.options.apps }, auth.app)) }) })
    // Sampling parameters the model is known to reject are dropped; `top_k` has no neutral
    // equivalent and is always dropped. Both are reported before any response bytes.
    const sampled = host.options.dropUnsupportedParams ? dropRejected(ref, parsed.request.generation) : undefined
    const dropped = [...(sampled?.dropped ?? []), ...(parsed.topKIgnored ? ["top_k"] : [])]
    if (dropped.length > 0) {
      info.dropped = dropped.join(",")
      response.setHeader(DROPPED_HEADER, info.dropped)
    }
    const model: PlugRequest = { ...parsed.request, ...(sampled ? { generation: sampled.generation } : {}), ref }
    reportParallelTools(response, model)
    const { exchange } = parsed

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
