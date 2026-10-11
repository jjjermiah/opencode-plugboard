/**
 * Concurrency caps and requests per minute per app (option `limits`): a `ModelCaller` wrapper
 * that sits outside the fallback chain, so one request holds one slot however many targets it tries.
 *
 * Before the inner caller runs, a call takes a slot in each concurrency cap that applies to it: the
 * global `maxConcurrent`, and its app's own cap (`apps.<name>` over `perApp`). Each cap is a
 * `p-queue` whose concurrency is the cap, kept on the process runtime so it survives a plugin
 * generation. Nothing waits in a queue: a call that finds a cap full, or its app past its requests
 * per minute, is answered at once with one `error` event (429) and never reaches the model. Every
 * check runs before any slot or window count is taken, so a refused call costs nothing.
 *
 * A slot is freed when the inner stream ends, throws, is closed by the consumer, or the request
 * signal aborts (the abort frees it even if the inner stream ignores the signal). p-queue counts a
 * slot free one microtask after its job resolves, so a call made in that same tick can still be
 * refused; requests arrive from the I/O loop, so this does not happen in practice. The requests per
 * minute limit is a fixed window of 60 s per app, counting the calls admitted in it.
 *
 * A call whose app has no cap that applies goes straight to the wrapped caller.
 */

import PQueue from "p-queue"
import type { LimitCaps, Limits } from "./config.js"
import type { CallContext, ModelCaller, PlugError, PlugEvent, PlugRequest } from "./contract.js"
import { log } from "./log.js"

/** The process-wide queues and windows. Held on the runtime (`src/runtime.ts`), not on a generation. */
export interface LimitState {
  /** One queue per capped scope: `*` for the global cap, an app name for that app's cap. Its concurrency is the cap. */
  readonly queues: Map<string, PQueue>
  /** The requests-per-minute window of each app: its start (epoch ms) and the calls admitted in it. */
  readonly windows: Map<string, { start: number; count: number }>
}

export const createLimitState = (): LimitState => ({ queues: new Map(), windows: new Map() })

export type LimitReason = "concurrency" | "rate"

export interface LimitOptions {
  /** Clock in epoch ms. Tests inject one; the default is `Date.now`. */
  readonly now?: () => number
  /** Called once for each refused call (metrics). */
  readonly onLimited?: (app: string, reason: LimitReason) => void
}

const WINDOW_MS = 60_000
/** Queue key of the global cap. Not an app name: names match `[a-z0-9-]+`. */
const GLOBAL = "*"

/** The caps that apply to `app`: `perApp`, with the app's `apps` entry overriding it field by field. */
export function capsFor(limits: Limits, app: string): LimitCaps {
  const own = limits.apps && Object.hasOwn(limits.apps, app) ? limits.apps[app] : undefined
  return { ...limits.perApp, ...own }
}

const isCapped = (limits: Limits, app: string): boolean => {
  const caps = capsFor(limits, app)
  return limits.maxConcurrent !== undefined || caps.maxConcurrent !== undefined || caps.requestsPerMinute !== undefined
}

/** The caller's events, admitted under the configured caps; see the file comment. `getLimits` is read per call. */
export function withLimits(inner: ModelCaller, getLimits: () => Limits | undefined, state: LimitState, options: LimitOptions = {}): ModelCaller {
  const now = options.now ?? Date.now
  return {
    stream(request, context) {
      const limits = getLimits()
      if (!limits || !isCapped(limits, context.app)) return inner.stream(request, context)
      return admit(inner, limits, state, now, options.onLimited, request, context)
    },
  }
}

async function* admit(
  inner: ModelCaller,
  limits: Limits,
  state: LimitState,
  now: () => number,
  onLimited: LimitOptions["onLimited"],
  request: PlugRequest,
  context: CallContext,
): AsyncGenerator<PlugEvent> {
  const app = context.app
  const caps = capsFor(limits, app)
  const scopes: PQueue[] = []
  if (limits.maxConcurrent !== undefined) scopes.push(queueFor(state, GLOBAL, limits.maxConcurrent))
  if (caps.maxConcurrent !== undefined) scopes.push(queueFor(state, app, caps.maxConcurrent))

  // Decide everything before taking anything: a refused call holds no slot and spends no window count.
  const at = now()
  const current = state.windows.get(app)
  const live = current && at - current.start < WINDOW_MS ? current : undefined
  let refusal: { readonly reason: LimitReason; readonly retryAfterSeconds: number } | undefined
  if (scopes.some((queue) => queue.pending + queue.size >= queue.concurrency)) refusal = { reason: "concurrency", retryAfterSeconds: 1 }
  else if (caps.requestsPerMinute !== undefined && live && live.count >= caps.requestsPerMinute)
    refusal = { reason: "rate", retryAfterSeconds: Math.max(1, Math.ceil((live.start + WINDOW_MS - at) / 1000)) }
  if (refusal) {
    onLimited?.(app, refusal.reason)
    log("request.limited", { app, reason: refusal.reason, retryAfterSeconds: refusal.retryAfterSeconds })
    yield { type: "error", error: limitedError(refusal.reason, refusal.retryAfterSeconds) }
    return
  }

  if (caps.requestsPerMinute !== undefined) {
    if (live) live.count++
    else state.windows.set(app, { start: at, count: 1 })
  }
  const frees = scopes.map(take)
  let freed = false
  const free = () => {
    if (freed) return
    freed = true
    for (const release of frees) release()
  }

  const signal = context.signal
  signal.addEventListener("abort", free, { once: true })
  try {
    for await (const event of inner.stream(request, context)) yield event
  } finally {
    signal.removeEventListener("abort", free)
    free()
  }
}

/** The queue of one capped scope, created on first use, with its concurrency set to the cap in force. */
function queueFor(state: LimitState, key: string, cap: number): PQueue {
  let queue = state.queues.get(key)
  if (!queue) state.queues.set(key, (queue = new PQueue({ concurrency: cap })))
  queue.concurrency = cap
  return queue
}

/** Takes a slot in a queue that has room (checked by the caller). The returned function frees it. */
function take(queue: PQueue): () => void {
  let done = () => {}
  // The job starts at once when a slot is free, so `done` is set before `add` returns.
  void queue.add(() => new Promise<void>((resolve) => (done = resolve)))
  return () => done()
}

/** A 429 with a neutral kind (`rate_limit`, the closest `PlugErrorKind`) and a code the front-ends pass through. */
const limitedError = (reason: LimitReason, retryAfterSeconds: number): PlugError =>
  reason === "concurrency"
    ? { status: 429, kind: "rate_limit", code: "too_many_requests", message: "Too many concurrent requests", retryAfterSeconds }
    : { status: 429, kind: "rate_limit", code: "rate_limit_exceeded", message: "Too many requests per minute", retryAfterSeconds }
