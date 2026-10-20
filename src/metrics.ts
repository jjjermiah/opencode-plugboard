/**
 * Process metrics in the Prometheus text exposition format (version 0.0.4), on @prometheus-io/client. No
 * I/O. `createMetrics` makes one `Registry` of its own (the default global registry is never
 * touched, and the default process metrics are never collected); the one the server uses lives
 * in the process runtime (`src/runtime.ts`), so counts survive a plugin generation being
 * replaced. `GET /plugboard/metrics` renders it (opt-in, `metrics: true`).
 *
 * Labels are bounded by construction and carry ids only: `app` is a configured key name (or
 * `_none` before authentication succeeded), `route` is one of the known routes or `unknown`,
 * `status` a response code, `outcome` one of a fixed set (requests and remote image fetches each have their own), `param` a sampling parameter name from
 * `src/openai/sampling.ts`. Never a model string, key, path or client-supplied text.
 */

import { Counter, Gauge, Histogram, Registry } from "@prometheus-io/client"
import type { CoolingTarget } from "./breaker.js"
import type { PlugUsage } from "./contract.js"

/** `app` label of a request that was not authenticated (app names cannot contain an underscore). */
export const NO_APP = "_none"

/** What a request ended as, for the `outcome` label. */
export type Outcome = "ok" | "rejected" | "failed" | "timeout" | "disconnected"

/** Collapses the request log's outcome string and the response status into the bounded `outcome` label. */
export function outcomeLabel(logOutcome: string, status: number): Outcome {
  if (logOutcome === "timeout" || logOutcome === "disconnected") return logOutcome
  if (logOutcome === "error") return "failed"
  if (status >= 500) return "failed"
  if (status >= 400) return "rejected"
  return "ok"
}

/** Process-level values the registry does not own; read from the runtime at scrape time. */
export interface RuntimeSnapshot {
  /** Accepted plugin generations currently serving. */
  readonly generations: number
  /** Whether the event pump is subscribed. */
  readonly pumpRunning: boolean
  /** Request guards outstanding (sessions the runtime still owns, including ones past their response). */
  readonly guards: number
  /** Runtime start, epoch ms. */
  readonly startedAt: number
  /** Targets of fallback chains whose breaker is open or half open (`src/breaker.ts`); absent counts as none. The gauge counts the open ones. */
  readonly cooldowns?: ReadonlyArray<CoolingTarget>
}

/** Request duration buckets, seconds: model calls run from under a second to many minutes. */
const BUCKETS = [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600]

/** Remote image fetch buckets, seconds: a fetch is bounded by `remoteImages.timeoutMs` (20 s by default). */
const FETCH_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30]

/** How one remote image fetch ended, for the `outcome` label: `blocked` is a refused address or scheme, `error` any other failure. */
export type ImageFetchOutcome = "ok" | "blocked" | "too_large" | "timeout" | "error"

/** A counter that ignores zero, negative and non-finite amounts (@prometheus-io/client throws on the last two and would write a zero series for the first). */
const count = <L extends string>(counter: Counter<L>, labels: Record<L, string>, amount = 1): void => {
  // `Record<L, string>` is what `LabelValues<L>` means for a non-empty label list; its conditional type cannot resolve for a generic `L`.
  if (amount > 0 && Number.isFinite(amount)) (counter as Counter<string>).inc(labels, amount)
}

export interface Metrics {
  /** The `Content-Type` of `render`'s text, as the registry reports it. */
  readonly contentType: string
  /** A request entered the handler. Pair with `requestFinished`. */
  requestStarted(): void
  requestFinished(input: { readonly app: string; readonly route: string; readonly status: number; readonly outcome: Outcome; readonly ms: number }): void
  /** Token usage of one model call, as a non-overlapping breakdown (see `plugboard_tokens_total`). */
  tokens(app: string, usage: PlugUsage): void
  /** Sampling parameters dropped for one request. */
  dropped(params: ReadonlyArray<string>): void
  /** A model call failed before any output and was retried on the next target of its alias. */
  fallback(app: string): void
  /** A target's breaker opened or closed, or a call skipped a target that is cooling down (`src/breaker.ts`). */
  cooldown(app: string, event: "open" | "close" | "skip"): void
  /**
   * A run closed without the host's usage: its step did not finish in the settle window (`settleMs`). `reason` is `stop` (a stop
   * sequence ended the answer, #390) or `disconnect` (the client left). Counted, not estimated.
   */
  usageMissing(app: string, reason: "stop" | "disconnect"): void
  /** A request whose terminal events never came was settled from the host's stored messages (`silenceMs`, #515). */
  settledFromTranscript(app: string): void
  /** One remote image fetch ended: its outcome, the body bytes read (0 when none), and how long it took in milliseconds. Never the URL or host. */
  imageFetch(input: { readonly outcome: ImageFetchOutcome; readonly bytes: number; readonly ms: number }): void
  /** A call was refused with 429 by a concurrency cap (`concurrency`), a requests-per-minute limit (`rate`) or a budget (`budget`). */
  limited(app: string, reason: "concurrency" | "rate" | "budget"): void
  /** A call the response cache applied to: a stored answer replayed (`hit`) or the model run (`miss`). */
  cache(app: string, result: "hit" | "miss"): void
  /** One history sweep ended. */
  sweep(result: "ok" | "failed" | "timeout", removed: number): void
  /** The exposition text. Called from a request that is itself in flight, which is not counted. */
  render(snapshot: RuntimeSnapshot): Promise<string>
}

export function createMetrics(): Metrics {
  let inFlight = 0
  const registry = new Registry()
  // Registration order is the order of the exposition text.
  const requests = new Counter({
    name: "plugboard_requests_total",
    help: "Requests handled, by app, route, response status and outcome.",
    labelNames: ["app", "route", "status", "outcome"],
    registers: [registry],
  })
  const duration = new Histogram({
    name: "plugboard_request_duration_seconds",
    help: "Time from request start to the end of the response, by app and route.",
    labelNames: ["app", "route"],
    buckets: BUCKETS,
    registers: [registry],
  })
  const inFlightGauge = new Gauge({ name: "plugboard_requests_in_flight", help: "Requests being handled right now, not counting this scrape.", registers: [registry] })
  const tokens = new Counter({
    name: "plugboard_tokens_total",
    help: "Tokens of completed model calls, by app and kind. Kinds do not overlap: input is uncached prompt tokens, cache_read and cache_write are cached prompt tokens, output excludes reasoning.",
    labelNames: ["app", "kind"],
    registers: [registry],
  })
  const dropped = new Counter({
    name: "plugboard_dropped_params_total",
    help: "Sampling parameters dropped because the target model rejects them, by parameter.",
    labelNames: ["param"],
    registers: [registry],
  })
  const usageMissing = new Counter({
    name: "plugboard_usage_missing_total",
    help: "Runs that closed without the host's usage (the step did not finish within settleMs), by app and reason (stop or disconnect).",
    labelNames: ["app", "reason"],
    registers: [registry],
  })
  const settledFromTranscript = new Counter({
    name: "plugboard_settled_from_transcript_total",
    help: "Requests settled from the host's stored messages because OpenCode's event stream never delivered the end of the answer (option silenceMs), by app.",
    labelNames: ["app"],
    registers: [registry],
  })
  const fallbacks = new Counter({
    name: "plugboard_fallbacks_total",
    help: "Model calls retried on the next target of an alias after a failure before any output, by app.",
    labelNames: ["app"],
    registers: [registry],
  })
  const cooldowns = new Counter({
    name: "plugboard_fallback_cooldown_events_total",
    help: "Circuit breaker events of fallback chains, by app and event: open (a target is skipped for its cooldown), close (a probe answered) and skip (a call went past a cooling target).",
    labelNames: ["app", "event"],
    registers: [registry],
  })
  const cooling = new Gauge({ name: "plugboard_fallback_cooldown_targets", help: "Fallback chain targets being skipped right now (breaker open, cooldown not over).", registers: [registry] })
  const limited = new Counter({
    name: "plugboard_limited_total",
    help: "Model calls refused with 429 by a concurrency cap, a requests-per-minute limit or a budget, by app and reason.",
    labelNames: ["app", "reason"],
    registers: [registry],
  })
  const cache = new Counter({
    name: "plugboard_cache_requests_total",
    help: "Model calls the response cache applied to, by app and result (hit or miss). Absent unless the `responseCache` option is set.",
    labelNames: ["app", "result"],
    registers: [registry],
  })
  const imageFetches = new Counter({
    name: "plugboard_remote_image_fetches_total",
    help: "Remote image fetches ended, by outcome: ok, blocked (address or scheme refused), too_large, timeout or error. Absent unless the `remoteImages` option is on.",
    labelNames: ["outcome"],
    registers: [registry],
  })
  const imageBytes = new Counter({ name: "plugboard_remote_image_bytes_total", help: "Bytes of remote image bodies read.", registers: [registry] })
  const imageFetchDuration = new Histogram({
    name: "plugboard_remote_image_fetch_duration_seconds",
    help: "Time one remote image fetch took, by outcome.",
    labelNames: ["outcome"],
    buckets: FETCH_BUCKETS,
    registers: [registry],
  })
  const sweeps = new Counter({ name: "plugboard_history_sweeps_total", help: "History sweeps that ended, by result.", labelNames: ["result"], registers: [registry] })
  const removed = new Counter({ name: "plugboard_history_sessions_removed_total", help: "Request sessions removed by history sweeps.", registers: [registry] })
  const generations = new Gauge({ name: "plugboard_generations", help: "Accepted plugin generations (one per OpenCode Location) serving requests.", registers: [registry] })
  const pumpUp = new Gauge({
    name: "plugboard_event_pump_up",
    help: "1 while the event pump is subscribed to the OpenCode event bus, else 0 (it starts with the first request).",
    registers: [registry],
  })
  const guards = new Gauge({
    name: "plugboard_session_guards",
    help: "Request guards outstanding: request sessions plugboard still owns, including ones whose response has ended.",
    registers: [registry],
  })
  const startTime = new Gauge({ name: "plugboard_start_time_seconds", help: "Start of the plugboard runtime in this process, Unix time.", registers: [registry] })

  return {
    contentType: registry.contentType,
    requestStarted: () => void inFlight++,
    requestFinished({ app, route, status, outcome, ms }) {
      inFlight = Math.max(0, inFlight - 1)
      count(requests, { app, route, status: String(status), outcome })
      const seconds = ms / 1000
      if (seconds >= 0 && Number.isFinite(seconds)) duration.observe({ app, route }, seconds)
    },
    tokens(app, usage) {
      const cacheRead = usage.cacheReadTokens ?? 0
      const cacheWrite = usage.cacheWriteTokens ?? 0
      const reasoning = usage.reasoningTokens ?? 0
      count(tokens, { app, kind: "input" }, Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite))
      count(tokens, { app, kind: "cache_read" }, cacheRead)
      count(tokens, { app, kind: "cache_write" }, cacheWrite)
      count(tokens, { app, kind: "output" }, Math.max(0, (usage.outputTokens ?? 0) - reasoning))
      count(tokens, { app, kind: "reasoning" }, reasoning)
    },
    dropped(params) {
      for (const param of params) count(dropped, { param })
    },
    fallback: (app) => count(fallbacks, { app }),
    cooldown: (app, event) => count(cooldowns, { app, event }),
    usageMissing: (app, reason) => count(usageMissing, { app, reason }),
    settledFromTranscript: (app) => count(settledFromTranscript, { app }),
    limited: (app, reason) => count(limited, { app, reason }),
    cache: (app, result) => count(cache, { app, result }),
    imageFetch({ outcome, bytes, ms }) {
      count(imageFetches, { outcome })
      if (bytes > 0 && Number.isFinite(bytes)) imageBytes.inc(bytes)
      const seconds = ms / 1000
      if (seconds >= 0 && Number.isFinite(seconds)) imageFetchDuration.observe({ outcome }, seconds)
    },
    sweep(result, amount) {
      count(sweeps, { result })
      if (amount > 0 && Number.isFinite(amount)) removed.inc(amount)
    },
    render(snapshot) {
      // The scrape itself is in flight; do not report it.
      inFlightGauge.set(Math.max(0, inFlight - 1))
      generations.set(snapshot.generations)
      pumpUp.set(snapshot.pumpRunning ? 1 : 0)
      guards.set(snapshot.guards)
      cooling.set(snapshot.cooldowns?.filter((target) => target.state === "open").length ?? 0)
      startTime.set(Math.floor(snapshot.startedAt / 1000))
      return registry.metrics()
    },
  }
}
