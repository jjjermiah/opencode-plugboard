/**
 * Ordered model fallbacks: a `ModelCaller` wrapper, so every front-end gets them.
 *
 * An alias written as a list (`"fast": ["a/x", "b/y"]`) is a chain. The route resolves the first
 * target as usual; this wrapper calls it, looks ahead to the first event only, and when that event
 * is a failure of a retryable class (or the call throws, or ends with nothing) it calls the next
 * target in a fresh call, so each attempt is its own session. Once any event has been handed on
 * nothing is retried: a partly streamed answer is never restarted. Attempts are capped at the chain
 * length, share the request's signal (so the deadline and a disconnect end the chain) and nothing is
 * buffered beyond that first event.
 *
 * A call whose model is not an alias with fallbacks goes straight to the wrapped caller.
 */

import type { ServerResponse } from "node:http"
import type { PlugboardOptions } from "./config.js"
import type { CallContext, CatalogModel, ModelCaller, ModelRef, PlugError, PlugEvent, PlugRequest, ServedModel } from "./contract.js"
import { log } from "./log.js"
import { fallbackRefs, refToString } from "./models.js"
import { dropRejected } from "./openai/sampling.js"

export interface FallbackDeps {
  readonly options: PlugboardOptions
  /** The serving Location's enabled models; read only after a first failure, to skip targets that are not available. */
  loadCatalog(): Promise<ReadonlyArray<CatalogModel>>
  /** A call is about to be retried on the next target (metrics). */
  readonly onFallback?: (app: string) => void
}

/**
 * Failures that say something about this model or provider, not about the request: another target
 * may well answer. Client errors (invalid request, context length, content filter) and plugboard's
 * own failures (backend not ready, bad preparation) are not retried. `provider_auth_failed` is: a
 * provider that lost its sign-in is as down as one that is rate limiting.
 */
const RETRYABLE = new Set([
  "rate_limited",
  "quota_exceeded",
  "provider_unavailable",
  "provider_timeout",
  "provider_auth_failed",
  "model_run_failed",
  "prompt_failed",
  "backend_failed",
])

export const MODEL_HEADER = "x-plugboard-model"
export const FALLBACKS_HEADER = "x-plugboard-fallbacks"

/** The route's log fields a served model fills in. */
export interface ServedInfo {
  served?: string
  fallbacks?: number
}

/**
 * The `CallContext.onServed` of a route: `x-plugboard-model` (and `x-plugboard-fallbacks` when targets
 * failed first) while the headers are still open, and the log fields. The first call wins, so several
 * choices of one request report the first answer. `then` runs for that first call (a single-call route
 * echoes the served model in the body there).
 */
export function reportServed(response: ServerResponse, info: ServedInfo, then?: (served: ServedModel) => void): (served: ServedModel) => void {
  return (served) => {
    if (info.served !== undefined) return
    info.served = served.model
    info.fallbacks = served.fallbacks
    if (!response.headersSent && !response.destroyed) {
      response.setHeader(MODEL_HEADER, served.model)
      if (served.fallbacks > 0) response.setHeader(FALLBACKS_HEADER, String(served.fallbacks))
    }
    then?.(served)
  }
}

export const isRetryable = (error: PlugError): boolean => error.code !== undefined && RETRYABLE.has(error.code)

/** The caller's events with a chain of fallbacks behind the request's model; see the file comment. */
export function withFallbacks(inner: ModelCaller, deps: FallbackDeps): ModelCaller {
  return {
    stream(request, context) {
      if (!Object.hasOwn(deps.options.fallbacks, request.model)) return inner.stream(request, context)
      return chain(inner, deps, request, context)
    },
  }
}

async function* chain(inner: ModelCaller, deps: FallbackDeps, request: PlugRequest, context: CallContext): AsyncGenerator<PlugEvent> {
  let rest: ModelRef[] | undefined
  let ref = request.ref
  let attempt = 0
  for (;;) {
    // The history id of this attempt: handed on only if the attempt is the one that answers (or the last).
    let recordID: string | undefined
    const next = attempt === 0 ? request : retarget(deps.options, request, ref)
    const iterator = inner.stream(next, { ...context, onRecord: (id) => void (recordID = id) })[Symbol.asyncIterator]()

    let first: IteratorResult<PlugEvent> | undefined
    let thrown: { readonly error: unknown } | undefined
    try {
      first = await iterator.next()
    } catch (error) {
      thrown = { error }
    }

    // Why this attempt failed before any output, or undefined when it answered.
    let reason: string | undefined
    if (thrown) reason = "caller_error"
    else if (first!.done) reason = "no_response"
    else if (first!.value.type === "error" && isRetryable(first!.value.error)) reason = first!.value.error.code
    if (context.signal.aborted) reason = undefined

    if (reason !== undefined) {
      rest ??= await resolveRest(deps, request, context.app)
      const target = rest[attempt]
      if (target) {
        if (!thrown) await close(iterator)
        log("model.fallback", { app: context.app, from: refToString(ref), to: refToString(target), reason, attempt: attempt + 1 })
        deps.onFallback?.(context.app)
        ref = target
        attempt++
        continue
      }
      log("model.fallback_exhausted", { app: context.app, attempts: attempt + 1, reason })
    }

    // Answered, ran out of targets, or the request ended: this attempt's outcome is the response.
    if (recordID !== undefined) report(context, recordID)
    if (thrown) throw thrown.error
    if (first!.done) return
    // An error is not an answer: a call that fails (non-retryable, or on its last target) reports no served model.
    if (reason === undefined && first!.value.type !== "error") context.onServed?.({ model: refToString(ref), fallbacks: attempt })
    try {
      yield first!.value
      for (let step = await iterator.next(); !step.done; step = await iterator.next()) yield step.value
    } finally {
      await close(iterator)
    }
    return
  }
}

/** The request for a later target: its ref, and the sampling parameters that target is known to reject dropped. */
function retarget(options: PlugboardOptions, request: PlugRequest, ref: ModelRef): PlugRequest {
  return { ...request, ref, ...(options.dropUnsupportedParams ? { generation: dropRejected(ref, request.generation).generation } : {}) }
}

/** The fallbacks that are allowed and enabled. A catalog that cannot be loaded leaves none: the failure stands. */
async function resolveRest(deps: FallbackDeps, request: PlugRequest, app: string): Promise<ModelRef[]> {
  try {
    return fallbackRefs(deps.options, request.model, await deps.loadCatalog(), app)
  } catch {
    return []
  }
}

const report = (context: CallContext, recordID: string): void => {
  try {
    context.onRecord?.(recordID)
  } catch {}
}

/** Ends an attempt's stream so its cleanup runs; it must never fail the request. */
async function close(iterator: AsyncIterator<PlugEvent>): Promise<void> {
  try {
    await iterator.return?.()
  } catch {}
}
