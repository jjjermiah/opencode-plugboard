/**
 * Ordered model fallbacks: a `ModelCaller` wrapper, so every front-end gets them.
 *
 * An alias written as a list (`"fast": ["a/x", "b/y"]`) is a chain. The route resolves the first
 * target as usual; this wrapper calls it, looks ahead to the first event only, and when that event
 * is a failure of a retryable class (or the call throws, or ends with nothing) it calls the next
 * target in a fresh call, so each attempt is its own session. Once any event has been handed on
 * nothing is retried: a partly streamed answer is never restarted. Attempts are capped at the chain
 * length, share the request's signal (so the deadline and a disconnect end the chain) and nothing is
 * buffered beyond that first event. With option `fallbackAfterMs` (#391), an attempt that has a target after it
 * and produces no event in time is aborted (its session is interrupted and retired by the caller) and the next
 * target is tried; the last target is not bounded by it. An attempt with a target after it is also not made to wait
 * out a host retry: the host's `session.retry.scheduled` before any output fails it at once (`provider_retry`, #391).
 *
 * Each target also has a circuit breaker (option `fallbackCooldown`, `src/breaker.ts`): a target that failed `failureThreshold` times
 * in a row is skipped for `cooldownMs`, so the chain goes straight to the next target. After the cooldown one request is let
 * through; its answer closes the breaker. When every target is cooling down the first one is tried anyway, so a request never fails
 * without an attempt. A target that is skipped counts in `x-plugboard-fallbacks` (the header is the answering target's position among
 * the resolved targets).
 *
 * A call whose model is not an alias with fallbacks goes straight to the wrapped caller.
 */

import type { ServerResponse } from "node:http"
import { createBreaker, type Breaker } from "./breaker.js"
import { DEFAULT_FALLBACK_COOLDOWN, type FallbackCooldown, type PlugboardOptions } from "./config.js"
import type { CallContext, CatalogModel, ModelCaller, ModelRef, PlugError, PlugEvent, PlugRequest, ServedModel } from "./contract.js"
import { RequestAborted } from "./http.js"
import { debugEnabled, log, logDebug, logWarn } from "./log.js"
import { fallbackRefs, refToString } from "./models.js"
import { dropRejected } from "./openai/sampling.js"

export interface FallbackDeps {
  readonly options: PlugboardOptions
  /** The serving Location's enabled models, read once per chain request to know which targets follow, and to skip targets that are not available. */
  loadCatalog(): Promise<ReadonlyArray<CatalogModel>>
  /** A call is about to be retried on the next target (metrics). */
  readonly onFallback?: (app: string) => void
  /** The breaker of the targets; the process's (`processBreaker`) in the plugin. Without one the wrapper keeps a breaker of its own. */
  readonly breaker?: Breaker
  /** A target's breaker opened or closed, or a request skipped a target that is cooling down (metrics). */
  readonly onCooldown?: (event: "open" | "close" | "skip", app: string) => void
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
  "provider_overloaded",
  "provider_timeout",
  "provider_auth_failed",
  "model_run_failed",
  "prompt_failed",
  "backend_failed",
  // Set by the session caller for an attempt with a target after it: the host's retry before any output (#391).
  "provider_retry",
])

export const MODEL_HEADER = "x-plugboard-model"
export const FALLBACKS_HEADER = "x-plugboard-fallbacks"

/** The route's log fields a served model fills in. */
export interface ServedInfo {
  served?: string
  fallbacks?: number
  /** The session page link of the request (option `historyUrl`, src/session/link.ts), for the log line. */
  sessionUrl?: string
}

/**
 * The `CallContext.onServed` of a route: `x-plugboard-model` on every answer (alias or canonical id), and
 * `x-plugboard-fallbacks` when targets failed first, while the headers are still open, plus the log fields.
 * The first call wins, so several choices of one request report the first answer. `then` runs only for a
 * list alias (`served.chain`): a single-call route echoes the target in the body for those, and keeps the
 * model the caller sent for every other request.
 */
export function reportServed(response: ServerResponse, info: ServedInfo, then?: (served: ServedModel) => void): (served: ServedModel) => void {
  return (served) => {
    if (info.served !== undefined) return
    info.served = served.model
    info.fallbacks = served.fallbacks
    if (debugEnabled()) logDebug("model.resolved", { served: served.model, fallbacks: served.fallbacks, chain: served.chain === true })
    if (!response.headersSent && !response.destroyed) {
      response.setHeader(MODEL_HEADER, served.model)
      if (served.fallbacks > 0) response.setHeader(FALLBACKS_HEADER, String(served.fallbacks))
    }
    if (served.chain) then?.(served)
  }
}

export const isRetryable = (error: PlugError): boolean => error.code !== undefined && RETRYABLE.has(error.code)

/** The `reason` of a fallback whose target produced no model event within `fallbackAfterMs` (#391). */
export const FIRST_EVENT_DEADLINE = "first_event_deadline"

/**
 * The failures that count against a target's breaker: what the provider did (rate limit, quota, unavailable, overloaded, timeout, sign-in, a host
 * retry) and a missed first-event deadline. The rest of `RETRYABLE` still moves the chain on, but says nothing about the target: a
 * backend that throws, a prompt that could not start, a failed model run, an empty stream.
 */
const COUNTED = new Set(["rate_limited", "quota_exceeded", "provider_unavailable", "provider_overloaded", "provider_timeout", "provider_auth_failed", "provider_retry", FIRST_EVENT_DEADLINE])

/** The caller's events with a chain of fallbacks behind the request's model; see the file comment. */
export function withFallbacks(inner: ModelCaller, deps: FallbackDeps): ModelCaller {
  const breaker = deps.breaker ?? createBreaker()
  return {
    stream(request, context) {
      if (!Object.hasOwn(deps.options.fallbacks, request.model)) return reportPlain(inner.stream(request, context), context, request.ref)
      return chain(inner, deps, breaker, request, context)
    },
  }
}

/** The cooldown settings in force, or `false` when option `fallbackCooldown` turns the breaker off. */
export const cooldownOf = (options: PlugboardOptions): FallbackCooldown | false => options.fallbackCooldown ?? DEFAULT_FALLBACK_COOLDOWN

/**
 * A call that is not a list alias: no retry, but the answer still names its model (`x-plugboard-model`, #279).
 * Reported before the first non-error event, so a failed call reports nothing, as in `chain`.
 */
async function* reportPlain(events: AsyncIterable<PlugEvent>, context: CallContext, ref: ModelRef): AsyncGenerator<PlugEvent> {
  let reported = false
  for await (const event of events) {
    if (!reported && event.type !== "error") {
      reported = true
      context.onServed?.({ model: refToString(ref), fallbacks: 0 })
    }
    yield event
  }
}

async function* chain(inner: ModelCaller, deps: FallbackDeps, breaker: Breaker, request: PlugRequest, context: CallContext): AsyncGenerator<PlugEvent> {
  const cooldown = cooldownOf(deps.options)
  // The targets in order: the request's own, then the fallbacks that are allowed and enabled.
  const targets = [request.ref, ...(await resolveRest(deps, request, context.app))]
  const name = (index: number): string => refToString(targets[index]!)

  /** The first target from `from` on that is not cooling down, claiming its slot (`token` for a probe); the targets skipped on the way are logged. */
  const select = (from: number): { readonly index: number; readonly token?: number } | undefined => {
    for (let index = from; index < targets.length; index++) {
      if (!cooldown) return { index }
      const claim = breaker.claim(name(index), cooldown)
      if (claim.verdict !== "skip") return { index, token: claim.token }
      const until = breaker.until(name(index))
      log("fallback.cooldown.skip", { app: context.app, target: name(index), ...(until === undefined ? {} : { until: new Date(until).toISOString() }) })
      deps.onCooldown?.("skip", context.app)
    }
    return undefined
  }
  /** The first target after `index` that would run now, or undefined. Takes no slot. */
  const lookAhead = (index: number): number | undefined => {
    for (let at = index + 1; at < targets.length; at++) if (!cooldown || breaker.peek(name(at), cooldown)) return at
    return undefined
  }
  const note = (event: "opened" | "reopened" | "closed" | undefined, model: string): void => {
    if (event === undefined) return
    const until = breaker.until(model)
    if (event === "closed") log("fallback.cooldown.close", { app: context.app, target: model })
    else
      logWarn("fallback.cooldown.open", {
        app: context.app,
        target: model,
        reopened: event === "reopened",
        cooldownMs: cooldown === false ? undefined : cooldown.cooldownMs,
        ...(until === undefined ? {} : { until: new Date(until).toISOString() }),
      })
    deps.onCooldown?.(event === "closed" ? "close" : "open", context.app)
  }

  // Every target cooling down: the first one is tried anyway, so the request always gets an attempt. It holds no probe slot.
  let chosen = select(0)
  if (chosen === undefined) {
    logWarn("fallback.cooldown.all_open", { app: context.app, targets: targets.length })
    chosen = { index: 0 }
  }
  let { index, token } = chosen
  let attempts = 0
  for (;;) {
    attempts++
    const ref = targets[index]!
    // The history id of this attempt: handed on only if the attempt is the one that answers (or the last).
    let recorded: { id: string; directory?: string } | undefined
    const next = index === 0 ? request : retarget(deps.options, request, ref)
    // Whether a target follows this attempt. With a first-event deadline, an attempt that has one is aborted when the
    // deadline passes; the last target is not. A host retry before any output also fails it at once (#391). A target
    // that is cooling down does not follow: the attempt is then the last one that would run.
    const ahead = lookAhead(index)
    const following = ahead !== undefined
    const deadline = deps.options.fallbackAfterMs ?? 0
    const bounded = deadline > 0 && following
    const deadlineAbort = bounded ? new AbortController() : undefined
    let timedOut = false
    const timer = deadlineAbort
      ? setTimeout(() => {
          timedOut = true
          // Cancelled by plugboard, not by a client that left: the caller interrupts the attempt at once and gives it no settle window (#391).
          deadlineAbort.abort(new RequestAborted("cancelled"))
        }, deadline)
      : undefined
    const signal = deadlineAbort ? AbortSignal.any([context.signal, deadlineAbort.signal]) : context.signal

    let iterator: AsyncIterator<PlugEvent> | undefined
    let first: IteratorResult<PlugEvent> | undefined
    let thrown: { readonly error: unknown } | undefined
    try {
      iterator = inner.stream(next, { ...context, signal, fallbackNext: following, onRecord: (id, directory) => void (recorded = { id, directory }) })[Symbol.asyncIterator]()
      first = await iterator.next()
    } catch (error) {
      thrown = { error }
    } finally {
      clearTimeout(timer)
    }

    // Why this attempt failed before any output, or undefined when it answered.
    let reason: string | undefined
    if (timedOut) reason = FIRST_EVENT_DEADLINE
    else if (thrown) reason = "caller_error"
    else if (first!.done) reason = "no_response"
    else if (first!.value.type === "error" && isRetryable(first!.value.error)) reason = first!.value.error.code
    if (context.signal.aborted) reason = undefined

    // The target's breaker: a failure of the provider counts, an answer closes it, and any other end (the client left, a failure that is
    // plugboard's own) only gives back the probe slot, if this attempt holds it.
    if (cooldown) {
      const model = refToString(ref)
      if (reason !== undefined && COUNTED.has(reason)) note(breaker.failure(model, cooldown), model)
      else if (reason === undefined && !thrown && !first!.done && first!.value.type !== "error") note(breaker.success(model), model)
      else breaker.release(model, token)
    }

    if (reason !== undefined) {
      // The look-ahead took no slot, so another request may have taken the probe of the target it found: it is then tried without one, as the
      // attempt was told it follows (and may have been aborted for it).
      const to = select(index + 1) ?? (ahead === undefined ? undefined : { index: ahead })
      if (to !== undefined) {
        if (iterator && (!thrown || timedOut)) await close(iterator)
        log("model.fallback", { app: context.app, from: refToString(ref), to: name(to.index), reason, attempt: attempts })
        deps.onFallback?.(context.app)
        index = to.index
        token = to.token
        continue
      }
      logWarn("model.fallback_exhausted", { app: context.app, attempts, reason })
    }

    // Answered, ran out of targets, or the request ended: this attempt's outcome is the response.
    if (recorded !== undefined) report(context, recorded)
    if (thrown) throw thrown.error
    if (first!.done) return
    // An error is not an answer: a call that fails (non-retryable, or on its last target) reports no served model.
    if (reason === undefined && first!.value.type !== "error") context.onServed?.({ model: refToString(ref), fallbacks: index, chain: true })
    try {
      yield first!.value
      for (let step = await iterator!.next(); !step.done; step = await iterator!.next()) yield step.value
    } finally {
      await close(iterator!)
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

const report = (context: CallContext, recorded: { readonly id: string; readonly directory?: string }): void => {
  try {
    context.onRecord?.(recorded.id, recorded.directory)
  } catch {}
}

/** Ends an attempt's stream so its cleanup runs; it must never fail the request. */
async function close(iterator: AsyncIterator<PlugEvent>): Promise<void> {
  try {
    await iterator.return?.()
  } catch {}
}
