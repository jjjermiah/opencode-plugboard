/**
 * Process metrics in the Prometheus text exposition format (version 0.0.4), hand-rolled: no
 * dependency, no I/O. One registry lives in the process runtime (`src/runtime.ts`), so counts
 * survive a plugin generation being replaced. `GET /metrics` renders it (opt-in, `metrics: true`).
 *
 * Labels are bounded by construction and carry ids only: `app` is a configured key name (or
 * `_none` before authentication succeeded), `route` is one of the known routes or `unknown`,
 * `status` a response code, `outcome` one of a fixed set, `param` a sampling parameter name from
 * `src/openai/sampling.ts`. Never a model string, key, path or client-supplied text.
 */

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

const escapeLabel = (value: string): string => value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"')
const escapeHelp = (value: string): string => value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n")
const labelText = (names: ReadonlyArray<string>, values: ReadonlyArray<string>): string =>
  names.length === 0 ? "" : `{${names.map((name, index) => `${name}="${escapeLabel(values[index] ?? "")}"`).join(",")}}`

class Counter {
  private readonly series = new Map<string, { values: string[]; total: number }>()
  constructor(
    readonly name: string,
    readonly help: string,
    private readonly labels: ReadonlyArray<string>,
  ) {}
  add(values: ReadonlyArray<string>, amount = 1): void {
    if (!(amount > 0) || !Number.isFinite(amount)) return
    const key = values.join("\u0000")
    const entry = this.series.get(key)
    if (entry) entry.total += amount
    else this.series.set(key, { values: [...values], total: amount })
  }
  render(): string[] {
    const lines = [`# HELP ${this.name} ${escapeHelp(this.help)}`, `# TYPE ${this.name} counter`]
    for (const { values, total } of this.series.values()) lines.push(`${this.name}${labelText(this.labels, values)} ${total}`)
    return lines
  }
}

class Histogram {
  private readonly series = new Map<string, { values: string[]; counts: number[]; sum: number; count: number }>()
  constructor(
    readonly name: string,
    readonly help: string,
    private readonly labels: ReadonlyArray<string>,
  ) {}
  observe(values: ReadonlyArray<string>, seconds: number): void {
    if (!(seconds >= 0) || !Number.isFinite(seconds)) return
    const key = values.join("\u0000")
    let entry = this.series.get(key)
    if (!entry) this.series.set(key, (entry = { values: [...values], counts: BUCKETS.map(() => 0), sum: 0, count: 0 }))
    BUCKETS.forEach((bound, index) => {
      if (seconds <= bound) entry.counts[index]! += 1
    })
    entry.sum += seconds
    entry.count += 1
  }
  render(): string[] {
    const lines = [`# HELP ${this.name} ${escapeHelp(this.help)}`, `# TYPE ${this.name} histogram`]
    for (const { values, counts, sum, count } of this.series.values()) {
      const names = [...this.labels, "le"]
      BUCKETS.forEach((bound, index) => lines.push(`${this.name}_bucket${labelText(names, [...values, String(bound)])} ${counts[index]}`))
      lines.push(`${this.name}_bucket${labelText(names, [...values, "+Inf"])} ${count}`)
      lines.push(`${this.name}_sum${labelText(this.labels, values)} ${sum}`)
      lines.push(`${this.name}_count${labelText(this.labels, values)} ${count}`)
    }
    return lines
  }
}

const gauge = (name: string, help: string, value: number): string[] => [
  `# HELP ${name} ${escapeHelp(help)}`,
  `# TYPE ${name} gauge`,
  `${name} ${value}`,
]

export interface Metrics {
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
  render(snapshot: RuntimeSnapshot): string
}

export function createMetrics(): Metrics {
  let inFlight = 0
  const requests = new Counter("plugboard_requests_total", "Requests handled, by app, route, response status and outcome.", ["app", "route", "status", "outcome"])
  const duration = new Histogram("plugboard_request_duration_seconds", "Time from request start to the end of the response, by app and route.", ["app", "route"])
  const tokens = new Counter(
    "plugboard_tokens_total",
    "Tokens of completed model calls, by app and kind. Kinds do not overlap: input is uncached prompt tokens, cache_read and cache_write are cached prompt tokens, output excludes reasoning.",
    ["app", "kind"],
  )
  const dropped = new Counter("plugboard_dropped_params_total", "Sampling parameters dropped because the target model rejects them, by parameter.", ["param"])
  const fallbacks = new Counter("plugboard_fallbacks_total", "Model calls retried on the next target of an alias after a failure before any output, by app.", ["app"])
  const sweeps = new Counter("plugboard_history_sweeps_total", "History sweeps that ended, by result.", ["result"])
  const removed = new Counter("plugboard_history_sessions_removed_total", "Request sessions removed by history sweeps.", [])

  return {
    requestStarted: () => void inFlight++,
    requestFinished({ app, route, status, outcome, ms }) {
      inFlight = Math.max(0, inFlight - 1)
      requests.add([app, route, String(status), outcome])
      duration.observe([app, route], ms / 1000)
    },
    tokens(app, usage) {
      const cacheRead = usage.cacheReadTokens ?? 0
      const cacheWrite = usage.cacheWriteTokens ?? 0
      const reasoning = usage.reasoningTokens ?? 0
      tokens.add([app, "input"], Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite))
      tokens.add([app, "cache_read"], cacheRead)
      tokens.add([app, "cache_write"], cacheWrite)
      tokens.add([app, "output"], Math.max(0, (usage.outputTokens ?? 0) - reasoning))
      tokens.add([app, "reasoning"], reasoning)
    },
    dropped(params) {
      for (const param of params) dropped.add([param])
    },
    fallback: (app) => fallbacks.add([app]),
    sweep(result, count) {
      sweeps.add([result])
      removed.add([], count)
    },
    render(snapshot) {
      const lines = [
        ...requests.render(),
        ...duration.render(),
        // The scrape itself is in flight; do not report it.
        ...gauge("plugboard_requests_in_flight", "Requests being handled right now, not counting this scrape.", Math.max(0, inFlight - 1)),
        ...tokens.render(),
        ...dropped.render(),
        ...fallbacks.render(),
        ...sweeps.render(),
        ...removed.render(),
        ...gauge("plugboard_generations", "Accepted plugin generations (one per OpenCode Location) serving requests.", snapshot.generations),
        ...gauge("plugboard_event_pump_up", "1 while the event pump is subscribed to the OpenCode event bus, else 0 (it starts with the first request).", snapshot.pumpRunning ? 1 : 0),
        ...gauge("plugboard_session_guards", "Request guards outstanding: request sessions plugboard still owns, including ones whose response has ended.", snapshot.guards),
        ...gauge("plugboard_start_time_seconds", "Start of the plugboard runtime in this process, Unix time.", Math.floor(snapshot.startedAt / 1000)),
      ]
      return lines.join("\n") + "\n"
    },
  }
}
