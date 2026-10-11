/**
 * Process metrics in the Prometheus text exposition format (version 0.0.4), on prom-client. No
 * I/O. `createMetrics` makes one `Registry` of its own (the default global registry is never
 * touched, and the default process metrics are never collected); the one the server uses lives
 * in the process runtime (`src/runtime.ts`), so counts survive a plugin generation being
 * replaced. `GET /metrics` renders it (opt-in, `metrics: true`).
 *
 * Labels are bounded by construction and carry ids only: `app` is a configured key name (or
 * `_none` before authentication succeeded), `route` is one of the known routes or `unknown`,
 * `status` a response code, `outcome` one of a fixed set, `param` a sampling parameter name from
 * `src/openai/sampling.ts`. Never a model string, key, path or client-supplied text.
 */

import { Counter, Gauge, Histogram, Registry } from "prom-client"
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
}

/** Request duration buckets, seconds: model calls run from under a second to many minutes. */
const BUCKETS = [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600]

/** A counter that ignores zero, negative and non-finite amounts (prom-client throws on the last two and would write a zero series for the first). */
const count = <L extends string>(counter: Counter<L>, labels: Record<L, string>, amount = 1): void => {
  if (amount > 0 && Number.isFinite(amount)) counter.inc(labels, amount)
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
  const fallbacks = new Counter({
    name: "plugboard_fallbacks_total",
    help: "Model calls retried on the next target of an alias after a failure before any output, by app.",
    labelNames: ["app"],
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
      startTime.set(Math.floor(snapshot.startedAt / 1000))
      return registry.metrics()
    },
  }
}
