# Configuration

Options, models, keys and errors. For install and a first call, see the [README](https://github.com/jjjermiah/opencode-plugboard#readme).

## Options

Options live under `options` in the plugin entry. `{env:VAR}` is expanded by OpenCode.

| Option | Default | Meaning |
| --- | --- | --- |
| `listen.host` | `127.0.0.1` | Interface to bind. A non-loopback host without `keys` refuses to start, and serves plain HTTP. See [Remote access](remote-access.md). |
| `listen.port` | `4010` | Port to bind. |
| `keys` | none | Map of app name to API key. The app name groups that app's history sessions. Names match `[a-z0-9-]+`. `default` is reserved. |
| `adminKey` | none | A key that reads every app's usage at `GET /v1/usage` and manages app keys at runtime under `/v1/admin/keys`. It must differ from every app key. It is not an app key: it cannot call the model routes. Without it the admin paths are 404. See [Usage statistics](#usage-statistics) and [Admin keys](#admin-keys). |
| `apps` | none | Map of app name to `{ key?, models?, system?, systemMode?, tools?, maxTools? }`: per-app model scope, system prompt and tool policy. See [Apps and keys](#apps-and-keys). |
| `models` | none (required) | Allowlist of models callers may use. See [Models](#models). |
| `aliases` | none | Map of alias to `provider/model[#variant]`, or to an ordered list of them (fallbacks), or to `skill:<id>@provider/model[#variant]` (a skill bound to a model). Each target must also pass `models`. See [Aliases and fallbacks](#aliases-and-fallbacks) and [Skills and agents](#skills-and-agents). |
| `agents` | none | List of `{ name, model }`: OpenCode agents exposed as `agent/<name>`, each on the `model` given (which must pass `models`). See [Skills and agents](#skills-and-agents). |
| `maxTools` | `32` | Most tools one request may carry. Fixed when the plugin loads. |
| `maxN` | `1` | Most model calls one request may fan out to: `n` on Chat Completions and `/v1/completions`, or prompts times `n` for a prompt array. Each is a full call and a kept session, so `n: 4` costs four times. Above the cap, 400 `too_many_choices`. See [completions](completions.md). |
| `requestTimeoutMs` | `600000` | A request that runs longer is interrupted. |
| `history` | none (keep forever) | `{ maxSessions, maxAgeDays }`. `maxSessions` keeps the newest N sessions per app, `maxAgeDays` deletes older ones; with both, the stricter wins. |
| `dropUnsupportedParams` | `true` | Drop `temperature`, `top_p` and penalties the target model is known to reject, and list them in the `x-plugboard-dropped-params` response header. `false` forwards them as sent. |
| `logFormat` | `text` | `text` writes `key=value` lines; `json` writes one JSON object per line for log pipelines. Ids and outcomes only, never keys or bodies. |
| `metrics` | `false` | Serve Prometheus metrics at `GET /metrics`, with the same authentication as `/v1`. |
| `modelIds` | `canonical` | Ids `/v1/models` lists: `canonical` (`provider/model#variant`), `slugs` (UI-safe `provider--model__variant`) or `both`. Requests accept either spelling. See [Model ids in UIs](#model-ids-in-uis). |
| `limits` | none (unlimited) | Caps on model calls in flight, and calls started per minute per app: `{ maxConcurrent, perApp: { maxConcurrent, requestsPerMinute }, apps: { <name>: { ... } } }`. A call over a cap gets 429 at once. See [Concurrency and rate limits](#concurrency-and-rate-limits). |
| `budgets` | none (unlimited) | Per-app ceilings on requests, tokens and cost for a UTC day, week or month: `{ perApp?, apps? }`. Needs `usage` on. A call over a ceiling gets 429 `budget_exceeded`. See [Budgets](#budgets). |
| `cache` | none (off) | Exact-match response cache in memory: `{ ttlSeconds, maxEntries?, maxBytes?, apps? }`. See [Response cache](#response-cache). |
| `historyUrl` | none | A link to an OpenCode session page: a template with `{id}` (the session id) and optional `{directory}` (the app's directory, URL-encoded). Must be `http(s)`. Responses that carry `x-plugboard-session` also carry `x-plugboard-session-url` with the filled link, and the request log line gains `session_url=`. See [Session links](#session-links). |
| `usage` | `{ enabled: true, retentionDays: 90 }` | Per-app usage by UTC day (requests, errors, latency, tokens, cost, cache, fallbacks, 429s), served at `GET /v1/usage` and by the usage RPC. `enabled: false` records nothing and serves no route. `retentionDays` is 1 to 3650. See [Usage statistics](#usage-statistics). |
| `remoteImages` | `false` | Let the server fetch `http(s)` image URLs from requests (20 MB cap, no redirects, `image/*` only). When on, only public addresses are fetched: loopback, private, link-local, CGNAT and unique-local ranges are refused, and the checked address is the one connected to. Allow internal hosts with `{ "allow": ["images.internal", "*.corp", "10.1.0.0/16"] }`. Fetched images reach the model, so only allow hosts you are happy to have described back to callers. Callers can always send `data:` URLs. |

### Reloads and restarts

Each plugin load is checked against the listener that is already running:

- `listen` (`host` or `port`) needs an OpenCode restart. A different `listen` is rejected while the listener is up.
- Removing a key, or changing a key's value, applies at once, even while an older generation still serves. This holds when the new `keys` add no app and leave at least one app.
- Adding a key, or changing any other option, is rejected while an older generation still serves. The server keeps the options it started with and logs `listener.options_mismatch`. Restart OpenCode to apply it.
- When no accepted generation is live (the listener is in its grace period after the last generation closed, or the server has just started), the next load's options are adopted.

OpenCode loads the plugin once per project directory, and all of those loads share one listener. The first one to load decides the options. A load elsewhere with different options logs once and stays inert, so a project entry cannot serve with weaker auth than the live one. Requests are served from plugboard's own data directory when it is loaded, so a project's provider config doesn't change what callers get. So install it in the global config, which every project loads, and don't repeat it per project.

On a loopback `listen.host`, requests with a `Host` header other than `127.0.0.1`, `localhost` or `[::1]` (on the listen port) get 403 `invalid_host`, and without `keys` a request with an `Origin` header gets 403 `cross_origin_forbidden`. The `Host` check only applies when `listen.host` is loopback. `POST` bodies must be `application/json` (415 otherwise).

Without `keys`, only a loopback `listen.host` is accepted and every caller is the app `default`. Once any key exists, every `/v1` request needs a valid key, loopback included, and `/healthz` stays open. Callers send the key as `Authorization: Bearer <key>`. They never see or need the OpenCode server password.

## Models

Callers name models as `provider/model`, optionally `provider/model#variant` (for example `openai/gpt-6-luna#low`, since ChatGPT models need a variant). Nothing is exposed by accident, so you must list what callers may use in `models`:

- `provider/model` allows that model with any variant.
- `provider/model#variant` allows exactly that variant.
- `provider/*` allows every model of the provider.

With no `models`, `/v1/models` is empty and chat calls return 403. `/v1/models` lists the allowlist intersected with the models enabled on your server, plus your aliases. Each entry has `owned_by` set to the provider and an extra `plugboard` object (`capabilities`, `contextLimit`). The ids contain `/` and `#`, which some UIs mishandle: set `modelIds` to `slugs` or define an alias for those.

`reasoning_effort` in a request picks a variant when the model name has none and the model has one by that name. An alias can point at a model with a variant, which is the easy way to give a client a fixed effort level.

## Model ids in UIs

Some chat UIs mangle `/` and `#`, so `anthropic/claude-haiku-4-5#high` breaks there. Set `modelIds` to `slugs` to list the UI-safe spelling instead: `/` becomes `--` and `#` becomes `__`, so that model is `anthropic--claude-haiku-4-5__high`. `both` lists each id followed by its slug, for clients that accept either.

- Requests accept a slug wherever they accept a canonical id, whatever `modelIds` says. A client that cached a slug keeps working when you change the option.
- An alias still wins over a slug with the same name.
- A model whose id contains `--` has no unambiguous slug. `slugs` leaves it out and it stays listed under `canonical`.
- Aliases are listed as they are in every mode.

`/v1/models?capability=vision` or `?capability=tools` lists only the models whose catalog entry reports image input or tool support. Any other value is rejected. `json` is not offered because the host catalog has no structured-output flag to filter on.

## Aliases and fallbacks

An alias is a short name for a model. Point it at a list to get ordered fallbacks:

```json
"aliases": {
  "smart": "anthropic/claude-sonnet-4-5",
  "fast": ["opencode-go/glm-5.3-flash", "anthropic/claude-haiku-4-5"]
}
```

A request for `fast` goes to the first target. If that call fails before any output reached the client, plugboard retries the next target in a new call, and so on down the list. Rules:

- Only failures before the first event are retried: rate limit, quota, provider unavailable or timeout, provider sign-in failure, a failed model run, or a backend call that throws. Client errors (`invalid_request`, `context_length_exceeded`, `content_filter`) are returned as they are.
- Once any output has been sent (text, reasoning or a tool call), a failure is never retried. A partly streamed answer is not restarted.
- Attempts are capped at the list length and share the request deadline. A disconnect or timeout ends the chain.
- If every target fails, the last error is returned.
- Each attempt is its own history session, so history shows the failed ones too.
- Every target in a list must pass `models`, checked when the options load; a target that does not makes the plugin refuse the options. Targets that are not enabled on the server are skipped at call time.
- A target keeps its own variant (`provider/model#low`). `reasoning_effort` only picks a variant for the first target.
- `/v1/models` lists the alias once, as its first target. The setup page and `GET /v1` show the whole chain.
- A call that ends in an error has no served model, so those responses carry neither header.

A response from a request that used a list alias carries `x-plugboard-model: <provider/model>` (the target that answered) and, when retries happened, `x-plugboard-fallbacks: <n>`. The `model` field of the response is that target too (with `n` above 1 the body keeps the alias, and the headers report the first choice that was served). The request log line has `served=` and `fallbacks=`, and each retry logs `model.fallback` with the failure code. With `metrics: true`, `plugboard_fallbacks_total{app}` counts retries.

## Skills and agents

Two kinds of name sit beside plain models. Both are off until you configure them, and both leave `models` as the one rule for which models run.

**Skill aliases.** An alias target can bind a skill from the OpenCode server:

```json
"aliases": {
  "invoice-parser": "skill:invoice-parser@anthropic/claude-sonnet-4-6"
}
```

The text between `skill:` and `@` is the skill's `id`, as OpenCode lists it. The model after `@` must pass `models`, like any target. A skill target takes one model: it cannot be a list and has no fallbacks. A request with `model: "invoice-parser"` gets the skill's content as the first system part, before the app's `system` policy and the caller's own system prompt. The skill is read from the app directory when the request runs and reused for 30 seconds, so an edit shows up within that window. A skill the server does not have is a 404 `model_not_found` that names it, and nothing runs.

**Agents.** Option `agents` exposes OpenCode agents (see the [permission model](#permission-model) below):

```json
"agents": [{ "name": "review", "model": "anthropic/claude-sonnet-4-6" }]
```

Each entry is listed in `/v1/models` as `agent/review`. A request for it runs a session as that OpenCode agent, on the `model` given in the entry, with the agent's system prompt in place of the caller's. `model` is required and must pass `models`. The agent's own model setting is not read, so the allowlist stays the one rule. An agent the server does not have is a 404 `model_not_found`.

### Permission model

**Agents never run a tool on the server in this release.** The permission model, for an agent entry and for any model request:

- Agents never run server tools. Every OpenCode tool is denied for the session, so an agent answers with its configured persona and model and nothing more. Running tools on the server is a separate decision, tracked for trusted tools in [#82](https://github.com/jjjermiah/opencode-plugboard/issues/82).
- Every OpenCode tool stays denied, whatever the agent's own rules allow. Each session is created with `deny *`, then `allow plugboard_seed_*`. OpenCode merges the agent's rules first and the session's last, and the last matching rule wins, so the session's deny holds over an agent that allows everything. The evidence is in [docs/architecture.md](architecture.md#skills-and-agents-in-the-context-hook).
- Caller tools go back to the caller unexecuted, as for any model. Caller messages replace the history. The seed tools only record the call, and the turn ends.
- Persistent "always" approvals in OpenCode are not consulted for these tools, because the session's deny is checked before them.

Both kinds appear in `/v1/models` with `plugboard.skill` or `plugboard.agent` set. Their answers are never cached (see [Response cache](#response-cache)). Architecture: [docs/architecture.md](architecture.md#skills-and-agents-in-the-context-hook).

## Apps and keys

Each key name is an app. A request made with the `sparkyfitness` key is the app `sparkyfitness`, and its sessions are grouped under that app. Give every tool its own key. You can tell their traffic apart, and revoking one means removing one line. Removing a key, or changing its value, takes effect on the running server at once. Adding a key needs a restart. See [Reloads and restarts](#reloads-and-restarts).

### Per-app policy (`apps`)

Use `apps` to fix an app's behaviour on the server, without touching the app:

```json
{
  "apps": {
    "discord-bot": { "key": "{env:BOT_KEY}", "models": ["fast"], "system": "Answer in two sentences.", "tools": false },
    "coding": { "key": "{env:CODING_KEY}", "models": ["anthropic/*"], "maxTools": 16 }
  }
}
```

| Field | Meaning |
| --- | --- |
| `key` | The app's API key. Same as an entry in `keys`: you can set it in either place, and if you set it in both the values must match or the config is rejected. |
| `models` | Narrows the global `models` for this app. Entries are `provider/model[#variant]`, `provider/*` or an alias name. A model outside the list gets 404 `model_not_found`, as if it did not exist. An alias entry admits that name only; a pattern admits every model it matches, and any alias that points at one. An app can only narrow: a model must pass both lists. A fallback target the app may not use is skipped. Must not be empty. |
| `system` | Text added to the caller's system prompt. |
| `systemMode` | `prepend` (default), `append` or `replace`. `replace` drops the caller's system prompt, including the instruction a `json_object` response format adds. |
| `tools` | `false` drops every tool the caller sends before the model sees it. The request still succeeds, and the response carries `x-plugboard-policy: tools-stripped`. A `json_schema` response format is answered through a tool, so it is dropped too. History that already holds tool calls may be rejected by the provider. |
| `maxTools` | Lowers the global `maxTools` for this app. A request with more tools gets 400 `too_many_tools`. It cannot be higher than the global cap. |

`/v1/models`, `/v1/models/{id}` and the Gemini `/v1beta/models` routes list only what the calling app may use, and the model counts and example on the setup page and `/v1/status` follow the same scope.

Without `keys` the only app is `default`, and `apps.default` configures it. Once any key exists `default` is never used, so `apps.default` is rejected. Every other app in `apps` must have a key. `system` is applied by the context hook that already rewrites a request session, so it shows up in the model request but not in the stored session transcript.

## Concurrency and rate limits

`limits` caps how many model calls run at once, and how many an app may start per minute. Without it nothing is capped.

```json
"limits": {
  "maxConcurrent": 8,
  "perApp": { "maxConcurrent": 2, "requestsPerMinute": 30 },
  "apps": { "coding": { "maxConcurrent": 4 } }
}
```

- `maxConcurrent` at the top caps all apps together.
- `perApp` applies to every app. `apps.<name>` overrides `perApp` field by field for that app: `coding` above gets 4 calls at once and still 30 per minute. Each name must be a configured app (a key in `keys`), or `default` when there are no keys.
- Every value is a positive integer. Unknown keys are rejected at load.
- A call holds one slot in each cap that applies to its app, until its answer ends, fails or the client disconnects. A request that falls back along an alias list holds one slot for all its targets.
- Nothing queues. A call that finds a cap full gets 429 `too_many_requests` at once, before any session is created, so the provider never sees it. The response carries `Retry-After`: 1 second for a full concurrency cap, the seconds left in the window for `rate_limit_exceeded`.
- `requestsPerMinute` is a fixed window of 60 seconds per app, starting at the app's first call in it. A call over the limit gets 429 `rate_limit_exceeded`.
- A refused call takes no slot and counts toward no window.
- A [response cache](#response-cache) hit takes no slot and counts toward no window either. `requestsPerMinute` counts only the calls that reach a model.
- The counts live in the server process: a restart clears them, and two servers do not share them.
- With `metrics: true`, `plugboard_limited_total{app,reason}` counts refusals, where `reason` is `concurrency`, `rate` or `budget` (see [Budgets](#budgets)).

## Budgets

`budgets` caps what each app may use in a window: requests, tokens and cost. It reads the same records as [usage statistics](#usage-statistics), so it needs `usage` on (the default). With `usage: { "enabled": false }` the server refuses to load the option. Retention must cover the windows in use: a `month` ceiling needs `usage.retentionDays` of at least 31 and a `week` ceiling at least 7, or the server refuses to load it, since older days would stop counting.

```json
"budgets": {
  "perApp": { "requests": { "day": 1000 }, "tokens": { "month": 20000000 } },
  "apps": { "coding": { "costUsd": { "month": 50 } } }
}
```

- A ceiling is a metric and a window. The metrics are `requests`, `tokens` and `costUsd`. The windows are `day` (a UTC calendar day), `week` (an ISO week, Monday to Sunday in UTC) and `month` (a calendar month in UTC). Counts are positive integers, and a cost is a positive number of USD. A metric or window that is not set has no ceiling.
- `requests` counts HTTP requests on the model routes, except the ones [limits](#concurrency-and-rate-limits) or a budget refused, and [response cache](#response-cache) hits. `tokens` counts the tokens of answered calls, as usage does. `costUsd` is an estimate at the catalog's list prices. A subscription login does not bill per token, so read it as a comparison between apps, not as a bill.
- `perApp` applies to every app. `apps.<name>` replaces `perApp` metric by metric: in the example, `coding` has its own `costUsd` and keeps `perApp`'s requests and tokens. Each name must be a configured app, as in `limits`.
- Once an app has used a ceiling in the current window, its next call gets 429 `budget_exceeded` before any session is created, so the provider never sees it. The message names each exceeded ceiling, for example `Budget for coding exceeded: cost (USD) month`. `Retry-After` is the seconds until the latest of those windows resets.
- The check runs before a call starts, so the call that crosses a ceiling is still served and the next one is refused. Calls still in flight are not counted until they end, so a burst can pass a ceiling by the calls it started. Budgets are a guard against runaway use, not an exact meter.
- A refused call takes no concurrency slot and spends no requests-per-minute count, because budgets are checked before limits. It counts under `limited` in the usage report and as `plugboard_limited_total{reason="budget"}`. If the usage records cannot be read, the call gets 503 `budget_unavailable` and is not sent to a model.
- At 80% of a ceiling the server logs `budget.warning`, once per app, budget and window. The warning comes back in the next window.
- `GET /v1/usage` adds a `budgets` list to each app: one entry per ceiling, with `metric`, `window`, `limit`, `used` (the current window's count) and `resetsAt`. It reads the current window, not the report's range. An admin report without `app` lists budgets only for apps that have records in its range, so ask for `app=<name>` to see another.
- The counts survive a restart the way usage does: they come from the stored day records, which are written every few seconds.

## Response cache

Pollers and bots often send the same prompt again and again. With `cache` set, plugboard keeps completed answers in memory and replays them for an identical request from the same app, without creating a session or spending quota.

```json
"cache": { "ttlSeconds": 300, "maxEntries": 1000, "maxBytes": 67108864, "apps": ["poller"] }
```

| Field | Default | Meaning |
| --- | --- | --- |
| `ttlSeconds` | required | How long an answer is served after it was stored (1 to 31536000). |
| `maxEntries` | `1000` | Most answers kept. The least recently used goes first. |
| `maxBytes` | `67108864` (64 MiB) | Most bytes kept. An answer bigger than this is served but not kept. |
| `apps` | every app | App names that use the cache. Must be configured apps, or `default` when there are no keys. |

What counts as the same request: the app, the resolved model and variant, messages, system prompt, tools, tool choice and sampling parameters (`temperature`, `top_p`, `max_tokens`, `stop`, penalties). An alias and the model it points to share entries. Apps never share entries. A skill alias or an `agent/<name>` request is never cached, because its answer depends on the skill's content or the agent's prompt, which the key does not cover.

What is kept: answers that ended normally (`stop` or `length`) with text or reasoning. Answers with tool calls are never kept, and neither are errors, aborted requests and empty answers. Structured output (`response_format` `json_schema`) is answered through a tool call, so it is not kept either. Requests with `n` above 1 are never served from the cache or stored, because each choice must be a fresh sample.

A hit replays the stored answer as JSON or as a stream (the text arrives in one chunk), with the same `x-plugboard-model` and `x-plugboard-policy` headers as the original, and reports zero token usage. A hit is answered before the [budgets](#budgets) and the [limits](#concurrency-and-rate-limits): it spends no budget, takes no concurrency slot and counts toward no requests-per-minute window. Every answer carries `x-plugboard-cache: hit` or `miss`. Sampling still matters: with `temperature` above 0, a hit repeats the first answer instead of drawing a new one, so use `apps` to limit the cache to callers that want that.

The cache lives in memory. A server restart, or a change to `cache`, `apps`, `models` or `aliases`, empties it, so a hit can never serve a model the current policy no longer allows. With `metrics` on, `plugboard_cache_requests_total{app,result}` counts hits and misses.

## Usage statistics

Plugboard counts what each app does, per UTC day: model requests and their errors, latency, tokens by kind, cost in USD, cache hits and misses, fallbacks, 429 refusals, and the requests and cost of each model. It is on by default. Set `usage: { "enabled": false }` to record nothing.

With recording on, each non-streaming model answer also carries `x-plugboard-usage` for that one request: `input=<n>; output=<n>; cache_read=<n>; cost_usd=<x.xxxxxx>`. `input` and `output` are the totals the response body reports (cache reads are inside `input`, reasoning inside `output`), and `cost_usd` is priced from the same tokens. A request that fans out with `n` sums its choices. The cost part is left out when the model has no price in the catalog. A streamed answer has no such header: its headers are sent before the usage is known.

Read it with `GET /v1/usage`. `from` and `to` are UTC days (`YYYY-MM-DD`, both inclusive); the default is the 30 days ending today, and a range may span at most 366 days. `app` names one app.

```sh
curl -s "http://127.0.0.1:4010/v1/usage?from=2026-10-01&to=2026-10-11" -H "Authorization: Bearer $PLUGBOARD_ADMIN_KEY"
```

Who may read what:

- **The admin key** (`adminKey`) reads every app, or one with `app`.
- **An app key** reads its own app. Naming another app is a 403 `app_forbidden`.
- **Keyless loopback** (no `keys`) is the app `default`.
- A missing or wrong key is a 401. The admin key is not an app key, so it gets a 401 on `/v1/chat/completions` and the other model routes.

OpenCode's own clients read the same report through the usage RPC, `opencode-plugboard.usage`, method `get`, with the same `from`, `to` and `app` fields. It is reached through OpenCode's password-authenticated API, so it returns every app. The contract is in `src/rpc.ts`, and the package exposes it as `opencode-plugboard/rpc`.

What a response holds (one app, trimmed):

```json
{
  "from": "2026-10-11",
  "to": "2026-10-11",
  "generatedAt": "2026-10-11T18:04:12.000Z",
  "totals": {
    "requests": 4,
    "errors": { "client": 1, "server": 0, "timeout": 0, "disconnected": 0 },
    "latency": { "count": 4, "sumMs": 3120, "buckets": [0, 1, 0, 2, 0, 1, 0, 0, 0, 0, 0, 0, 0], "p50Ms": 1000, "p95Ms": 5000 },
    "tokens": { "input": 812, "cacheRead": 1500, "cacheWrite": 0, "output": 260, "reasoning": 40 },
    "costUsd": 0.0123,
    "cacheHits": 1,
    "cacheMisses": 2,
    "fallbacks": 1,
    "limited": 1,
    "unpricedRequests": 0,
    "lastRequestAt": "2026-10-11T17:58:03.512Z"
  },
  "apps": {
    "alpha": {
      "totals": { "...": "the same fields as the top-level totals" },
      "models": { "openai/gpt-5": { "requests": 3, "tokens": 4120, "costUsd": 0.0123 } },
      "days": [
        { "date": "2026-10-11", "...": "the totals fields, and", "perModel": { "openai/gpt-5": { "requests": 3, "tokens": 4120, "costUsd": 0.0123 } } }
      ]
    }
  }
}
```

The fields, in short:

- `requests` counts HTTP requests on the model routes (`/v1/chat/completions`, `/v1/completions`, `/v1/responses`, `/v1/messages`, and Gemini `generateContent`) that reached an app. Model listing, status, metrics and discovery are not counted.
- `errors.client` counts 4xx answers, including 429 refusals. `errors.server` counts 5xx answers and errors after the response had started. `timeout` and `disconnected` count requests the deadline or the client ended.
- `latency` is a histogram over fixed buckets (up to 100 ms, 250 ms, 500 ms, 1 s, 2.5 s, 5 s, 10 s, 30 s, 1 min, 2 min, 5 min, 10 min, and one above). `p50Ms` and `p95Ms` are estimates: the upper bound of the bucket holding that percentile. Slower requests land in the last bucket, reported as 600000.
- `tokens` splits the usage without overlap, as `plugboard_tokens_total` does: `input` is uncached prompt tokens, `cacheRead` and `cacheWrite` are cached ones, `output` excludes `reasoning`. Only answered model calls count; a cache hit spends none.
- `costUsd` is an estimate at list prices from the catalog (per million tokens, with OpenCode's context tiers). A subscription login does not bill per token, so read it as a comparison between apps, not as a bill. A model with no price adds its calls to `unpricedRequests` and costs 0.
- `cacheHits` and `cacheMisses` count the calls the [response cache](#response-cache) applied to. `fallbacks` counts retries on the next target of an alias. `limited` counts 429 refusals from [limits](#concurrency-and-rate-limits) and [budgets](#budgets).
- `models` and `perModel` are keyed by `provider/model`; the variant is not part of the key.

Retention: days older than `retentionDays` are deleted while requests are served, a page of keys at a time. An idle server keeps them until the next request.

Persistence: each day is written to OpenCode's plugin storage at most every 10 seconds, by the request that finds the last write that old. The newest changes can therefore be in memory only: a restart before the next request loses the last few seconds of traffic, or the whole tail of an idle period. Reports read memory first, so they are never behind.

### Dashboard

`GET /dashboard` on plugboard's own port is a page for the same report: totals for today, 7, 30 or 90 days, a table of apps (sortable by requests, tokens or cost, with errors, p95 latency and the last request), daily charts per app for requests, cost and tokens, and the models by cost. It works on a phone, and follows light or dark mode.

- The page itself needs no key, and it holds no usage. Enter a key on it; the page reads `/v1/usage` with that key and keeps the key in `sessionStorage`, so it lasts for the browser tab and is gone when the tab closes. Sign out clears it.
- The charts use [uPlot](https://github.com/leeoniya/uPlot) (MIT), a pinned dependency that plugboard serves itself from `/dashboard/uplot.js` and `/dashboard/uplot.css`. Nothing loads from another origin, and the page sends no inline script or style. The policy is `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; ...` (see `src/dashboard/page.ts`).
- Days are UTC, so "today" starts at 00:00 UTC.
- With `usage: { "enabled": false }` the page and its files are not served, and the discovery pages do not link them.

## Admin keys

With `adminKey` set, the admin key also adds and revokes app keys at runtime, so a tool gets a key without a config edit and an OpenCode reload.

- `GET /v1/admin/keys` lists the config keys and the runtime keys as `{ keys: [{ id, app, source, createdAt? }] }`. `source` is `config` or `runtime`. No key value is ever listed.
- `POST /v1/admin/keys` with body `{ "app": "bot" }` creates a random key for that app and answers 201 with `{ id, app, key, createdAt }`. The `key` is shown once. Store it then; the server keeps only a digest.
- `DELETE /v1/admin/keys/{id}` revokes a runtime key. The next request with it gets 401.

```sh
curl -H "Authorization: Bearer $ADMIN_KEY" -H "content-type: application/json" -d '{"app":"bot"}' http://127.0.0.1:4010/v1/admin/keys
```

Rules:

- Without `adminKey` these paths are 404. Any credential other than the admin key is 401.
- The app name follows the config rule (`[a-z0-9-]+`, and not `default`). An app that already has a key in `keys` is 409: change that key in the config.
- A config key cannot be revoked through the API (409). Remove it from `keys` and reload.
- A runtime key is stored under the plugin's host storage as the SHA-256 of the key, not as the key. Its `id` is the first 8 hex characters of that digest. Runtime keys survive a config reload and a server restart.
- A runtime key names its app on every request that presents it. It does not make a keyless server require a key: with no config keys, a request without a key stays the app `default`. Deleting the last runtime key therefore never opens or closes access by itself.
- Runtime apps have no `apps` policy. An `apps` entry needs a key in `keys`, so a runtime app gets the global settings only.

## End users

A bot that serves many people is one app, so its history and usage would be one pile. Plugboard reads the caller's end user from the request and keeps the users apart:

- OpenAI Chat Completions, Responses and legacy completions read the `user` field. Anthropic Messages reads `metadata.user_id`. Gemini has no such field.
- The value is trimmed and kept when it is at most 64 characters of `A-Z a-z 0-9 . _ @ : -`. Anything else is dropped, and the response carries `x-plugboard-user-dropped: 1`. A kept value is only ever a label: it never names a directory or a file.
- A kept user prefixes the session title, as `[alice] first words of the prompt`, and is logged as `user=` on the request line.
- `GET /v1/usage` gains a `users` object per app, with `requests`, `tokens` and `costUsd` per user, summed over the range. A day keeps at most 200 distinct users per app; later ones count under `_other`. `GET /v1/usage?user=alice` restricts `users` to that user. The app totals and models still cover every user.

## Session links

A response names its history record in `x-plugboard-session`, but the OpenCode web UI has no URL a plugin can read. Option `historyUrl` is the template you fill in, and it depends on how you reach OpenCode:

```json
{ "historyUrl": "http://opencode.lan:4096/session/{id}" }
```

With it set, every response that carries `x-plugboard-session` also carries `x-plugboard-session-url`, and the request log line gets `session_url=`. A call with `n` above 1 lists the links in choice order, like the session ids. A cache hit has neither, because it writes no session.

`{id}` and `{directory}` are URL-encoded, so a value cannot add a path segment or a query. `{directory}` is the app's directory on the OpenCode host. Putting it in the template shows that path to every caller that reads the header, so leave it out unless your UI needs it. The template is checked when the config loads: it must be an `http(s)` URL with `{id}`, and the only other placeholder allowed is `{directory}`.

## Limits and errors

Errors use the OpenAI error body shape with the matching HTTP status.

| Status | `code` | When | Message |
| --- | --- | --- | --- |
| 401 | `invalid_api_key` | Missing or wrong key | Missing or invalid API key |
| 404 | `model_not_found` | Unknown model, not on the allowlist, or outside the app's `apps.<name>.models` | Model &lt;m&gt; is not available |
| 403 | `no_models_configured` | The `models` option is empty | No models are allowed: set the plugboard `models` option |
| 400 | `too_many_tools` | More tools than `maxTools` | Request has &lt;n&gt; tools; plugboard allows &lt;max&gt; (option `maxTools`) |
| 400 | `too_many_tools` | More tools than the app's `apps.<name>.maxTools` | Request has &lt;n&gt; tools; app &lt;app&gt; allows &lt;max&gt; (option `apps.<app>.maxTools`) |
| 400 | `too_many_choices` | `n` (or prompts times `n`) above `maxN` | n=&lt;n&gt; is above the limit of &lt;max&gt; (option `maxN`; each choice is a full model call) |
| 400 | `unsupported_parameter` | `logprobs`, `top_logprobs`, `best_of` above 1, token-array prompts | names the parameter |
| 429 | `too_many_requests` | A cap on concurrent calls in `limits` is full | Too many concurrent requests |
| 429 | `rate_limit_exceeded` | The app's requests per minute in `limits` are used up | Too many requests per minute |
| 429 | `budget_exceeded` | The app has used a ceiling of its `budgets` in the current window | Budget for &lt;app&gt; exceeded: &lt;metric&gt; &lt;window&gt; |
| 503 | `budget_unavailable` | The usage records for the budget check cannot be read | Could not read the usage records for the budget check |

Provider errors map to an OpenAI error body with the provider's status, including a provider's own rejection of a sampling parameter (ChatGPT models reject `temperature`, for example). Once a stream has started, a failure arrives as an `error` event followed by `[DONE]`. A client that disconnects, SSE included, interrupts the request. Calls over a cap in `limits` get 429 instead (see [Concurrency and rate limits](#concurrency-and-rate-limits)). Sampling parameters a model is known to reject are dropped instead, see `dropUnsupportedParams`.

Supported request fields: messages with system, developer, user text and images, assistant `tool_calls` and tool results; `tools`, `tool_choice`, `response_format` (`json_object`, `json_schema`), `temperature`, `top_p`, `max_tokens`, `max_completion_tokens`, `stop`, `presence_penalty`, `frequency_penalty`, `reasoning_effort`, `n` (up to `maxN`), and streaming with a final usage chunk (`stream_options.include_usage`). The legacy `POST /v1/completions` is served too: see [completions](completions.md).

Behaviours worth knowing:

- `parallel_tool_calls` and `seed` are accepted and ignored.
- `tool_choice` `auto` and `none` work as expected. `required` and a named function are applied as an instruction to the model, because the OpenCode session API has no tool-choice control. A model can still answer in text.
- `response_format` `json_schema` works through a `respond` tool the model is instructed to call, and the arguments come back as the message content. The provider does not enforce the schema, so validate the result. `json_object` adds a system instruction instead and carries no schema, so name the keys in your prompt; weak models may still ignore them.
- A request that carries both `tools` and a `json_schema` response format is changing: it will return the caller's tool calls ([#34](https://github.com/jjjermiah/opencode-plugboard/issues/34)). Don't rely on the current behaviour for that combination.
- A streamed tool call arrives as one delta carrying the whole arguments string.

## Operating

- Every response has an `x-plugboard-request-id` header. The same id is the `id` field on that request's log lines, so a client error can be matched to a server line.
- `GET /healthz` is a cheap liveness check. `GET /v1/status` (needs a key when keys are set) reports uptime, listen address, generation count, event pump state and model count.
- An invalid plugboard option fails the plugin's setup. OpenCode lists the plugin as `failed` with the field and the reason, the server log has an `options.invalid` line at error level, and the port stays closed for that project. When another project's earlier good config still serves the port, `GET /v1/status` shows `configError: { message, at }` and `GET /readyz` returns 503 with the same message as its reason. The next Location that loads valid options clears it.
- `GET /readyz` needs no key. It answers `{"ready":true}` once a generation serves, the event pump runs and the model catalog has loaded. Otherwise it answers 503 `{"ready":false,"reason":...}`, naming the first missing piece. Use it for a load balancer or a service check; [warm-up](warm-up.md#readiness-readyz) explains what makes it ready after a restart.
- Open `http://127.0.0.1:4010/` in a browser for a setup page: the listen address, a `models` suggestion built from what your server offers, and a curl example. With `keys` set, a visitor without a key sees only the address and endpoints; a valid key also shows its own app, the allowlist and the suggestion.
- `/v1/models` entries carry `plugboard.limit`, `modalities`, `cost` (USD per million tokens), `status`, `family` and `released` when the catalog has them.
- With `metrics: true`, `GET /metrics` exposes request counts and durations by app and route, in-flight requests, tokens by kind, dropped sampling params, history sweeps and event pump health. There is no model label, so cardinality stays bounded.
