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

Cost is an estimate at list prices. Use it to compare apps, not as a bill. Each change is written to storage as it lands, so a restart loses at most a write that was still in flight. One response also reports its own use in `x-plugboard-usage`.

## Look at it

- **Dashboard.** Open `http://127.0.0.1:4010/plugboard/dashboard` and enter a key. The Usage tab has cards for requests, tokens, cost, errors and cache hits (with the change against the previous period), daily charts, a sortable table of apps and a table of models. A range picker covers today, 7, 30 and 90 days. The Models tab lists what `/v1/models` returns for an app key, with capability badges, context length and price, a button that copies the model id, and a ready curl, Python or JavaScript snippet. The page follows light or dark mode and works on a phone. It holds no data and needs no key to load. The admin key reads usage but cannot list models: the Models tab asks for an app key.
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
- The series: `plugboard_requests_total`, `plugboard_request_duration_seconds`, `plugboard_requests_in_flight`, `plugboard_tokens_total`, `plugboard_fallbacks_total`, `plugboard_fallback_cooldown_events_total`, `plugboard_fallback_cooldown_targets`, `plugboard_limited_total`, `plugboard_cache_requests_total`, `plugboard_dropped_params_total`, `plugboard_remote_image_fetches_total`, `plugboard_remote_image_bytes_total`, `plugboard_remote_image_fetch_duration_seconds`, `plugboard_usage_missing_total`, `plugboard_settled_from_transcript_total`, `plugboard_history_sweeps_total`, `plugboard_history_sessions_removed_total`, `plugboard_event_pump_up`, `plugboard_generations`, `plugboard_session_guards` and `plugboard_start_time_seconds`. There is no model label, so cardinality stays bounded.
- Every response has an `x-plugboard-request-id`. The same id is on that request's log lines. A caller's `x-request-id` is echoed and logged as `clientRequestId` on the request line.
- `logLevel` picks the lowest level written. `logRequests: false` drops the per-request access lines. Problems stay visible at `warn`.
- Probes: `GET /healthz` is liveness. `GET /readyz` says whether the listener, the event pump and the model catalog are ready.
- `GET /plugboard/status` reports uptime, the listen address, the plugboard version and the OpenCode version.

## Related options

All in the [configuration reference](../configuration.md#history-usage-and-monitoring):

- [`sessions`](../configuration.md#options), [hidden app sessions](../configuration.md#hidden-app-sessions), [session links](../configuration.md#session-links)
- [Usage statistics](../configuration.md#usage-statistics) and [the dashboard](../configuration.md#dashboard)
- `metrics`, `logFormat`, `logLevel`, `logRequests`, and [Operating](../configuration.md#operating)
- The [response headers](../headers.md) and [error codes](../errors.md)

Next: [Serving other machines](serving-other-machines.md).
