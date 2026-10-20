/**
 * `POST /v1/completions`: the legacy completions front-end's half of the route.
 * `src/openai/route.ts` has already checked origin, authenticated, and read the JSON body (the
 * same handling and deadline as Chat Completions) and hands over here.
 *
 * Same flow as Chat Completions: parse, resolve the model, drop sampling parameters the model
 * rejects, call the ModelCaller, encode. Every request goes through `serveChoices`, a single
 * prompt with `n` 1 being the case of one choice. Nothing is committed until the first text, so a
 * failure before it is a real HTTP error even when the client asked for a stream.
 */

import type { ServerResponse } from "node:http"
import { isPlugError, type PlugError, type PlugRequest } from "../contract.js"
import type { ServedInfo } from "../fallback.js"
import { sendError, type RequestScope } from "../http.js"
import { resolveModel } from "../models.js"
import { serveChoices } from "../openai/fanout.js"
import { encodeError } from "../openai/response.js"
import type { RouteHost } from "../openai/route.js"
import { appPolicy, maxChoicesFor, maxChoicesOption, requestedModel } from "../config.js"
import { appGeneration, dropRejected } from "../openai/sampling.js"
import { parseCompletionsRequest } from "./request.js"
import { completionsCodec } from "./response.js"

const DROPPED_HEADER = "x-plugboard-dropped-params"

export interface CompletionsCall {
  readonly app: string
  readonly body: unknown
  readonly response: ServerResponse
  readonly scope: RequestScope
  /** The route's log fields: the resolved model, the sampling parameters dropped, and the outcome of a stream that failed after it committed. */
  readonly info: ServedInfo & { model?: string; failed?: string; dropped?: string }
}

export async function serveCompletions(host: RouteHost, { app, body, response, scope, info }: CompletionsCall): Promise<void> {
  const fail = (error: PlugError) => sendError(response, error, encodeError(error))

  // The app's own `maxChoices` (#270) is the cap for this request; the decoder checks against `options.maxN`.
  const parsed = parseCompletionsRequest(body, { ...host.options, maxChoices: maxChoicesFor(host.options, app) }, maxChoicesOption(host.options, app))
  if (isPlugError(parsed)) return fail(parsed)
  const catalog = await scope.race(host.loadCatalog())
  const requested = requestedModel(host.options, app, parsed.requests[0]!.model, parsed.reasoningEffort)
  const ref = resolveModel(host.options, requested.model, catalog, requested.effort)
  if (isPlugError(ref)) return fail(ref)
  info.model = `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`
  // Same sampling drop as Chat Completions: every prompt carries the same parameters.
  const policy = appPolicy(host.options, app)
  const sampled = host.options.dropUnsupportedParams ? dropRejected(ref, appGeneration(policy, parsed.requests[0]!.generation)) : undefined
  if (sampled && sampled.dropped.length > 0) {
    info.dropped = sampled.dropped.join(",")
    response.setHeader(DROPPED_HEADER, info.dropped)
  }
  // Choice `i` answers prompt `floor(i / n)`.
  const calls: PlugRequest[] = parsed.requests.flatMap((request) =>
    Array.from({ length: parsed.n }, (): PlugRequest => ({ ...request, model: requested.model, generation: sampled ? sampled.generation : appGeneration(policy, request.generation), ref })),
  )
  // The answer names the model it runs on: the app's pin, else the caller's (#261).
  parsed.exchange.model = requested.model
  return serveChoices(host, { app, calls, response, scope, info, codec: completionsCodec(parsed.exchange) })
}
