import { describe, expect, test } from "bun:test"
import { register } from "prom-client"
import { createMetrics, NO_APP, outcomeLabel } from "../../src/metrics.js"

const snapshot = { generations: 1, pumpRunning: false, guards: 0, startedAt: 1_700_000_000_500 }

/** The sample lines (not HELP/TYPE) of one metric family. */
const samples = (text: string, name: string) => text.split("\n").filter((line) => line.startsWith(name) && !line.startsWith("#"))

describe("#56 outcomeLabel collapses outcomes into a bounded set", () => {
  test.each([
    ["ok", 200, "ok"],
    ["status_404", 404, "rejected"],
    ["body_413", 413, "rejected"],
    ["status_503", 503, "failed"],
    ["error", 200, "failed"],
    ["timeout", 504, "timeout"],
    ["disconnected", 200, "disconnected"],
  ] as const)("%s with status %d -> %s", (log, status, outcome) => {
    expect(outcomeLabel(log, status)).toBe(outcome)
  })
})

describe("#56 createMetrics: Prometheus text", () => {
  test("requests are counted by app, route, status and outcome, with a duration histogram", async () => {
    const metrics = createMetrics()
    metrics.requestStarted()
    metrics.requestFinished({ app: "alpha", route: "POST /v1/chat/completions", status: 200, outcome: "ok", ms: 700 })
    metrics.requestStarted()
    metrics.requestFinished({ app: "alpha", route: "POST /v1/chat/completions", status: 200, outcome: "ok", ms: 50 })
    const text = await metrics.render(snapshot)
    expect(samples(text, "plugboard_requests_total")).toEqual(['plugboard_requests_total{app="alpha",route="POST /v1/chat/completions",status="200",outcome="ok"} 2'])
    const buckets = samples(text, "plugboard_request_duration_seconds_bucket")
    expect(buckets).toContain('plugboard_request_duration_seconds_bucket{le="0.1",app="alpha",route="POST /v1/chat/completions"} 1')
    expect(buckets).toContain('plugboard_request_duration_seconds_bucket{le="1",app="alpha",route="POST /v1/chat/completions"} 2')
    expect(buckets.at(-1)).toBe('plugboard_request_duration_seconds_bucket{le="+Inf",app="alpha",route="POST /v1/chat/completions"} 2')
    expect(samples(text, "plugboard_request_duration_seconds_sum")).toEqual(['plugboard_request_duration_seconds_sum{app="alpha",route="POST /v1/chat/completions"} 0.75'])
    expect(text).toContain("# TYPE plugboard_request_duration_seconds histogram")
    expect(text.endsWith("\n")).toBe(true)
  })

  test("the scrape itself is not counted as in flight", async () => {
    const metrics = createMetrics()
    metrics.requestStarted()
    expect(await metrics.render(snapshot)).toContain("\nplugboard_requests_in_flight 0\n")
    metrics.requestStarted()
    expect(await metrics.render(snapshot)).toContain("\nplugboard_requests_in_flight 1\n")
  })

  test("tokens are split into non-overlapping kinds; zero kinds are not written", async () => {
    const metrics = createMetrics()
    metrics.tokens("alpha", { inputTokens: 10, outputTokens: 7, reasoningTokens: 3, cacheReadTokens: 4 })
    expect(samples(await metrics.render(snapshot), "plugboard_tokens_total")).toEqual([
      'plugboard_tokens_total{app="alpha",kind="input"} 6',
      'plugboard_tokens_total{app="alpha",kind="cache_read"} 4',
      'plugboard_tokens_total{app="alpha",kind="output"} 4',
      'plugboard_tokens_total{app="alpha",kind="reasoning"} 3',
    ])
  })

  test("dropped params, sweeps and runtime gauges", async () => {
    const metrics = createMetrics()
    metrics.dropped(["temperature", "top_p"])
    metrics.dropped(["temperature"])
    metrics.sweep("ok", 4)
    metrics.sweep("failed", 0)
    const text = await metrics.render({ generations: 2, pumpRunning: true, guards: 5, startedAt: 1_700_000_000_500 })
    expect(samples(text, "plugboard_dropped_params_total")).toEqual(['plugboard_dropped_params_total{param="temperature"} 2', 'plugboard_dropped_params_total{param="top_p"} 1'])
    expect(samples(text, "plugboard_history_sweeps_total")).toEqual(['plugboard_history_sweeps_total{result="ok"} 1', 'plugboard_history_sweeps_total{result="failed"} 1'])
    expect(samples(text, "plugboard_history_sessions_removed_total")).toEqual(["plugboard_history_sessions_removed_total 4"])
    for (const line of ["plugboard_generations 2", "plugboard_event_pump_up 1", "plugboard_session_guards 5", "plugboard_start_time_seconds 1700000000"]) expect(text).toContain(`\n${line}\n`)
  })

  test("a counter without labels reads 0 before its first event; one with labels has no series yet", async () => {
    const text = await createMetrics().render(snapshot)
    expect(samples(text, "plugboard_history_sessions_removed_total")).toEqual(["plugboard_history_sessions_removed_total 0"])
    expect(samples(text, "plugboard_requests_total")).toEqual([])
    expect(text).toContain("# TYPE plugboard_requests_total counter")
  })

  test("label values are escaped (backslash, quote, newline)", async () => {
    const metrics = createMetrics()
    metrics.requestFinished({ app: NO_APP, route: 'a"b\\c\nd', status: 400, outcome: "rejected", ms: 1 })
    expect(samples(await metrics.render(snapshot), "plugboard_requests_total")).toEqual(['plugboard_requests_total{app="_none",route="a\\"b\\\\c\\nd",status="400",outcome="rejected"} 1'])
  })

  test("negative or non-finite amounts are ignored", async () => {
    const metrics = createMetrics()
    metrics.requestFinished({ app: "a", route: "r", status: 200, outcome: "ok", ms: Number.NaN })
    metrics.tokens("a", { inputTokens: Number.POSITIVE_INFINITY })
    metrics.sweep("ok", -3)
    const text = await metrics.render(snapshot)
    expect(samples(text, "plugboard_request_duration_seconds_count")).toEqual([])
    expect(samples(text, "plugboard_tokens_total")).toEqual([])
    expect(samples(text, "plugboard_history_sessions_removed_total")).toEqual(["plugboard_history_sessions_removed_total 0"])
  })

  test("each registry is its own: the default one is untouched and no process metrics are collected", async () => {
    const first = createMetrics()
    const second = createMetrics()
    first.fallback("alpha")
    expect(samples(await second.render(snapshot), "plugboard_fallbacks_total")).toEqual([])
    expect(samples(await first.render(snapshot), "plugboard_fallbacks_total")).toEqual(['plugboard_fallbacks_total{app="alpha"} 1'])
    expect((await register.metrics()).trim()).toBe("")
    expect(await first.render(snapshot)).not.toContain("process_cpu")
  })

  test("the content type is the registry's (text format 0.0.4)", () => {
    expect(createMetrics().contentType).toBe("text/plain; version=0.0.4; charset=utf-8")
  })
})
