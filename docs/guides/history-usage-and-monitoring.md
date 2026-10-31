# History, usage and monitoring

**The problem.** Something answered badly, or the bill went up. You need to see what each app asked, what the model said, how much it used, and whether the server is healthy.

## Read what was said: history

Every request is kept as an OpenCode session in a directory for its app, so it never mixes with your projects. Chat responses carry the session id as `x-plugboard-session`.

```jsonc plugboard
"sessions": { "maxSessions": 500, "maxAgeDays": 30 }   // the global limits; the stricter one wins within an app
```

- Sessions older than 30 days are pruned by default. `"maxAgeDays": 0` keeps them forever.
- One app can keep a different amount: `apps.<name>.sessions`. An unset field falls back to the global one.
- Set `sessions.hideFromList: true` to keep request sessions out of OpenCode's session lists. They become children of one `plugboard: <app>` parent.
- Set `sessionUrl` to get a `x-plugboard-session-url` link in each response.

History holds every prompt and reply, so treat OpenCode's database as sensitive. More: [Session history](../history.md).

## See what each app used: usage statistics

Usage is recorded per app and per UTC day: requests, errors, latency, tokens, estimated cost, cache hits, fallbacks and 429 refusals. It is on by default. An admin key reads every app, and an app key reads only its own.

```jsonc plugboard
"adminKey": "{env:PLUGBOARD_ADMIN_KEY}",   // reads every app; not a model key
"usage": { "retentionDays": 90 }           // the default; { "enabled": false } turns it off
```

```sh
curl -s "http://127.0.0.1:4010/plugboard/usage?from=2026-10-01&to=2026-10-11" \
  -H "Authorization: Bearer $PLUGBOARD_ADMIN_KEY"
```

A trimmed response:

```json
{"from": "2026-10-01", "to": "2026-10-11",
 "totals": {"requests": 40, "tokens": {"input": 8120, "output": 2600}, "costUsd": 0.12, "cacheHits": 9},
 "apps": {"discord-bot": {"totals": {"requests": 31}, "models": {"opencode-go/glm-5.3-flash": {"requests": 31}}}}}
```

To split one app by purpose, a bot's cron jobs against its interactive chat, send `x-plugboard-tag: cron` on a request. The report then has a `tags` object per app with requests, errors, tokens and cost per tag, and `?tag=cron` narrows it. See [Usage tags](../configuration.md#usage-tags).

Cost is an estimate at list prices. Use it to compare apps, not as a bill. Each change is written to storage as it lands, so a restart loses at most a write that was still in flight. One response also reports its own use in `x-plugboard-usage`.

## Look at it

- **Dashboard.** Open `http://127.0.0.1:4010/plugboard/dashboard` and enter a key. The Usage tab has cards for requests, tokens, cost, errors and cache hits (with the change against the previous period), daily charts, a sortable table of apps, a table of models and, once requests carry a tag, a table of tags. A range picker covers today, 7, 30 and 90 days. The Models tab lists what `/v1/models` returns for an app key, with capability badges, context length and price, a button that copies the model id, and a ready curl, Python or JavaScript snippet. The page follows light or dark mode and works on a phone. It holds no data and needs no key to load. The admin key reads usage but cannot list models: the Models tab asks for an app key.
- **OpenCode TUI.** Type `/plugboard` in OpenCode's prompt for the same numbers in the terminal. See [the TUI page](../tui.md).
- **OpenCode clients** read the same report through the `opencode-plugboard/rpc` entry.

## Watch the server: metrics and logs

Prometheus metrics are off by default. Turn them on, and get structured logs when a pipeline reads them.

```jsonc plugboard
"metrics": true,
"logFormat": "json"   // one object per line; ids and outcomes only, never keys or bodies
```

```sh
curl -s http://127.0.0.1:4010/plugboard/metrics -H "Authorization: Bearer $PLUGBOARD_ADMIN_KEY" | grep plugboard_requests_total
```

- With `adminKey` set, only the admin key reads the metrics, because the series name every app.
- The series: `plugboard_requests_total`, `plugboard_request_duration_seconds`, `plugboard_requests_in_flight`, `plugboard_tokens_total`, `plugboard_fallbacks_total`, `plugboard_circuit_breaker_events_total`, `plugboard_circuit_breaker_targets`, `plugboard_limited_total`, `plugboard_cache_requests_total`, `plugboard_dropped_params_total`, `plugboard_remote_image_fetches_total`, `plugboard_remote_image_bytes_total`, `plugboard_remote_image_fetch_duration_seconds`, `plugboard_usage_missing_total`, `plugboard_settled_from_transcript_total`, `plugboard_sessions_sweeps_total`, `plugboard_sessions_removed_total`, `plugboard_event_pump_up`, `plugboard_generations`, `plugboard_session_guards` and `plugboard_start_time_seconds`. There is no model label and no tag label, so cardinality stays bounded: a usage tag is free-form, so it lives in the usage report, not in the metrics.
- Every response has an `x-plugboard-request-id`. The same id is on that request's log lines. A caller's `x-request-id` is echoed and logged as `clientRequestId` on the request line.
- The request line also carries the size of the request: `body_bytes`, and the count and bytes of its system prompts, messages and tools (`tool_count`, `tool_bytes`). Look there first when a small question costs many prompt tokens.
- `logLevel` picks the lowest level written. `logRequests: false` drops the per-request access lines. Problems stay visible at `warn`.
- Probes: `GET /healthz` is liveness. `GET /readyz` says whether the listener, the event pump and the model catalog are ready.
- `GET /plugboard/status` reports uptime, the listen address, the plugboard version and the OpenCode version.

## Alerts and a Grafana dashboard

The repository has ready-made monitoring for the metrics above, so you do not write PromQL: [`monitoring/prometheus-rules.yml`](https://github.com/jjjermiah/opencode-plugboard/blob/main/monitoring/prometheus-rules.yml) and [`monitoring/grafana-dashboard.json`](https://github.com/jjjermiah/opencode-plugboard/blob/main/monitoring/grafana-dashboard.json).

**1. Scrape the metrics.** Prometheus sends the admin key as a bearer token. Keep the key in a file, not in `prometheus.yml`.

```yaml
scrape_configs:
  - job_name: plugboard
    metrics_path: /plugboard/metrics
    authorization:
      credentials_file: /etc/prometheus/plugboard-admin-key   # the key, one line
    static_configs:
      - targets: ["127.0.0.1:4010"]
```

The rules look for the job name `plugboard`. If yours differs, change `job="plugboard"` in the two `up` rules.

**2. Load the rules.** Copy the file next to Prometheus, list it under `rule_files`, and reload.

```yaml
rule_files:
  - /etc/prometheus/plugboard-rules.yml
```

`promtool check rules plugboard-rules.yml` checks the file. Every threshold has a comment on how to tune it. Route the alerts with the `severity` label (`info`, `warning`, `critical`).

**3. Import the dashboard.** In Grafana, Dashboards, New, Import, upload `grafana-dashboard.json`, and pick your Prometheus data source. The `Prometheus` variable picks the data source and the `App` variable filters every panel by app. The panels show requests per second by app and route, responses by status, the 5xx share, p50 and p95 latency, tokens per second and per range, the cache hit ratio, circuit breaker state and events, fallbacks, and limit and budget refusals.

The alerts:

| Alert | Severity | Fires when |
|---|---|---|
| `PlugboardDown` | critical | Prometheus cannot read the metrics for 2 minutes. The server is down, or the admin key is wrong. |
| `PlugboardTargetMissing` | critical | There is no `up` series for the job. |
| `PlugboardHighErrorRate` | warning | More than 5% of an app's requests ended in a 5xx for 5 minutes (at least 5 requests). A 4xx never counts. |
| `PlugboardRateLimited` | info | An app got 429 from a concurrency cap or a requests-per-minute limit. |
| `PlugboardBudgetExhausted` | warning | An app was refused because a budget is used up. |
| `PlugboardCircuitBreakerOpen` | warning | A fallback target was skipped by an open breaker for most of 10 minutes. |
| `PlugboardFallbacksSpiking` | warning | 10 or more calls moved to the next target of their alias in 10 minutes. |
| `PlugboardHighLatency` | warning | An app's p95 response time is above 2 minutes for 10 minutes. |
| `PlugboardEventPumpDown` | critical | Requests arrive while plugboard is not subscribed to OpenCode's events. |

The rules file also records the request rate, the 5xx share, p95 latency and the cache hit ratio per app, as `plugboard:...` series you can graph or alert on yourself.

What the metrics cannot tell you:

- There is no gauge for how close a budget is to its ceiling. The alert fires on refusals. The server logs `budget.warning` at 80%, and `/plugboard/usage` shows the totals.
- Cost and per-model figures are not metrics (a model name is caller text and would make the series unbounded). Read them from [the usage report](#see-what-each-app-used-usage-statistics).

## Related options

All in the [configuration reference](../configuration.md#history-usage-and-monitoring):

- [`sessions`](../configuration.md#options), [hidden app sessions](../configuration.md#hidden-app-sessions), [session links](../configuration.md#session-links)
- [Usage statistics](../configuration.md#usage-statistics) and [the dashboard](../configuration.md#dashboard)
- `metrics`, `logFormat`, `logLevel`, `logRequests`, and [Operating](../configuration.md#operating)
- The [response headers](../headers.md) and [error codes](../errors.md)

Next: [Serving other machines](serving-other-machines.md).
