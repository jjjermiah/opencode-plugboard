# Configuration

Options, models, keys and errors. For install and a first call, see the [README](https://github.com/jjjermiah/opencode-plugboard#readme).

## Options

Options live under `options` in the plugin entry. `{env:VAR}` is expanded by OpenCode.

| Option | Default | Meaning |
| --- | --- | --- |
| `listen.host` | `127.0.0.1` | Interface to bind. A non-loopback host without `keys` refuses to start, and serves plain HTTP. See [Remote access](remote-access.md). |
| `listen.port` | `4010` | Port to bind. |
| `keys` | none | Map of app name to API key. The app name groups that app's history sessions. Names match `[a-z0-9-]+`. `default` is reserved. |
| `adminKey` | none | A key that reads every app's usage at `GET /plugboard/usage` and manages app keys at runtime under `/plugboard/admin/keys`. It must differ from every app key. It is not an app key: it cannot call the model routes. Without it the admin paths are 404. See [Usage statistics](#usage-statistics) and [Admin keys](#admin-keys). |
| `apps` | none | Map of app name to `{ key?, models?, system?, systemMode?, tools?, maxTools?, maxN?, history?, serverTools?, maxServerToolSteps? }`: per-app model scope, system prompt, tool policy and OpenCode tools the app may run. See [Apps and keys](#apps-and-keys). |
| `models` | none (required) | Allowlist of models callers may use. See [Models](#models). |
| `aliases` | none | Map of alias to `provider/model[#variant]`, or to an ordered list of them (fallbacks), or to `skill:<id>@provider/model[#variant]` (a skill bound to a model, since 0.20.0). Each target must also pass `models`. See [Aliases and fallbacks](#aliases-and-fallbacks) and [Skills and agents](#skills-and-agents). |
| `agents` (since 0.20.0) | none | List of `{ name, model }`: OpenCode agents exposed as `agent/<name>`, each on the `model` given (which must pass `models`). See [Skills and agents](#skills-and-agents). |
| `maxTools` | `64` | Most tools one request may carry. Fixed when the plugin loads. Each slot is a registered placeholder tool (a few KiB per Location), so the default covers coding agents with MCP servers (Claude Code sends 36). A request over the cap gets a 400 that names this option. |
| `maxN` | `1` | Most model calls one request may fan out to: `n` on Chat Completions and `/v1/completions`, or prompts times `n` for a prompt array. Each is a full call and a kept session, so `n: 4` costs four times. Above the cap, 400 `too_many_choices`. See [completions](completions.md). |
| `requestTimeoutMs` | `600000` | A request that runs longer is interrupted. |
| `history` | `{ maxAgeDays: 30 }` | `{ maxSessions, maxAgeDays }`. `maxSessions` keeps the newest N sessions per app (unset: no count limit). `maxAgeDays` deletes older ones: 30 by default, `0` turns the age limit off (keep forever). With both, the stricter wins. `hidden` (since 0.30.0) keeps request sessions out of OpenCode's top-level lists, see [Hidden app sessions](#hidden-app-sessions-since-0-30-0). `apps.<name>.history` overrides these per app (since 0.27.0). Gotcha: the 30-day default applies to an app that sets only `maxSessions`. See [History](history.md). |
| `dropUnsupportedParams` | `true` | Drop `temperature`, `top_p` and penalties the target model is known to reject, and list them in the `x-plugboard-dropped-params` response header. `false` forwards them as sent. |
| `logFormat` | `text` | `text` writes `key=value` lines; `json` writes one JSON object per line for log pipelines. Ids and outcomes only, never keys or bodies. |
| `logLevel` | `info` | Lowest level written: `debug`, `info`, `warn` or `error` (since 0.27.0). Below it a line is dropped. Process-wide. Neither this nor `logRequests` changes what a line holds. What each level shows: `error`: errors and the admin key audit lines (`admin.key_created`, `admin.key_revoked`, written at every level). `warn`: adds the problems `request.limited`, `request.budget_exceeded`, `budget.warning`, `model.fallback_exhausted`, `affinity.anchor_recreated`, `answer.empty` and `history.swept` when a deletion failed. `info` (the default): adds the access lines, `model.fallback`, `history.swept` and `listener.listening`. `debug`: adds the keep-alive line `location.keepalive`, and for each model request one line per step: `request.received` (the app and the model asked), `model.resolved` (the target that answered, its failed fallbacks and whether the alias is a list), `session.created` (the session id), `model.first_event` (the event type) and `model.finished` (the finish reason, input and output tokens, duration). None of them holds a prompt, a body or a key. Each is built only when debug is on, so at `info` none of their fields is built (since 0.29.0, #262). |
| `logRequests` | `true` | `false` drops the per-request access lines (`request`, `request.finished`) and keeps warnings and errors (since 0.27.0). |
| `listen.trustProxy` (since 0.26.0) | none | The reverse proxies whose forwarded headers are read: `true` (loopback only), or a list of IP addresses and CIDR ranges such as `["127.0.0.1", "10.0.0.0/8"]`. Headers from any other peer are ignored. See [Reverse proxies](#reverse-proxies-since-0-26-0). |
| `cors` (since 0.26.0) | none | Browser origins that may call plugboard: `{ "origins": ["https://chat.example.net"], "allowPrivateNetwork": false }`. Each origin is `http(s)://host[:port]`; `"*"` alone needs `keys`. See [Browser origins](#browser-origins-since-0-26-0). |
| `requireKeys` (since 0.26.0) | `false` | Makes a keyless server impossible. With `true`, `keys` must be set (otherwise the plugin refuses to load), and every request needs a key, loopback included. `/healthz` and `/readyz` stay open. Absent or `false`: keyless loopback works as before. Use it on a shared machine, where loopback is not a security boundary.
| `keepAlive` (since 0.26.0) | `true` | Keeps OpenCode's Location for this plugin warm, so the server's 60-minute idle eviction does not close plugboard's listener. Every 30 minutes the plugin renames one dedicated session, `plugboard keep-alive`, which it creates once and never prompts; that rename is a durable session event, which is what the eviction timer counts. `false` turns the loop off, and then an idle server stops serving until something touches it again (see [Operating](#operating) and `docs/warm-up.md`). Only the process's one loop runs. |
| `metrics` | `false` | Serve Prometheus metrics at `GET /plugboard/metrics`. Without `adminKey` it uses the same authentication as `/v1`, and any app key reads every app's series. With `adminKey` set, only the admin key reads it: an app key gets 403 `admin_key_required`. See [Operating](#operating). |
| `modelIds` | `canonical` | Ids `/v1/models` lists: `canonical` (`provider/model#variant`), `slugs` (UI-safe `provider--model__variant`) or `both`. Requests accept either spelling. See [Model ids in UIs](#model-ids-in-uis). |
| `limits` | none (unlimited) | Caps on model calls in flight, and calls started per minute per app: `{ maxConcurrent, perApp: { maxConcurrent, requestsPerMinute }, apps: { <name>: { ... } } }`. A call over a cap gets 429 at once. See [Concurrency and rate limits](#concurrency-and-rate-limits). Also `maxBodyBytesInFlight` and `bodyReadTimeoutMs` (since 0.21.0) bound request bodies, see [Request bodies](#request-bodies). |
| `budgets` | none (unlimited) | Per-app ceilings on requests, tokens and cost for a UTC day, week or month: `{ perApp?, apps? }`. Needs `usage` on. A call over a ceiling gets 429 `budget_exceeded`. See [Budgets](#budgets). |
| `cache` | none (off) | Exact-match response cache in memory: `{ ttlSeconds, maxEntries?, maxBytes?, apps? }`. See [Response cache](#response-cache). |
| `promptCache` | `{ affinity: "off", scope: "app", maxAnchors? }` | Provider prompt-cache affinity: `affinity` `off` or `anchor`, `scope` `app` or `user`, `maxAnchors` (default 1000) the most anchors one app may hold. Also per app as `apps.<name>.promptCache`. See [Prompt-cache affinity](#prompt-cache-affinity). |
| `historyUrl` (since 0.20.0) | none | A link to an OpenCode session page: a template with `{id}` (the session id) and optional `{directory}` (the app's directory, URL-encoded). Must be `http(s)`. Responses that carry `x-plugboard-session` also carry `x-plugboard-session-url` with the filled link, and the request log line gains `session_url=`. See [Session links](#session-links). |
| `usage` | `{ enabled: true, retentionDays: 90 }` | Per-app usage by UTC day (requests, errors, latency, tokens, cost, cache, fallbacks, 429s), served at `GET /plugboard/usage` and by the usage RPC. `enabled: false` records nothing and serves no route. `retentionDays` is 1 to 3650. See [Usage statistics](#usage-statistics). |
| `remoteImages` | `false` | Let the server fetch `http(s)` image URLs from requests (20 MB cap, no redirects, `image/*` only). When on, only public addresses are fetched: loopback, private, link-local, CGNAT and unique-local ranges are refused, and the checked address is the one connected to. Allow internal hosts with `{ "allow": ["images.internal", "*.corp", "10.1.0.0/16"] }`. Fetched images reach the model, so only allow hosts you are happy to have described back to callers. Callers can always send `data:` URLs. |

### Reverse proxies (since 0.26.0)

Behind Traefik, nginx or Caddy, plugboard sees the proxy's address, and the proxy's own `Host` (the public name) fails the loopback Host check. Option `listen.trustProxy` (#266) names the proxies whose forwarded headers are read:

```jsonc
"listen": {
  "host": "127.0.0.1",
  "port": 4010,
  "trustProxy": ["127.0.0.1", "10.0.0.0/8"]
}
```

- Headers are read only when the request's immediate peer (the socket address, never a header) is on the list. From any other peer, `X-Forwarded-For`, `X-Forwarded-Host` and `X-Forwarded-Proto` are ignored.
- `X-Forwarded-For` gives the client: the rightmost address that is not a trusted proxy. The request log line gets a `client=` field, and only when this option is set.
- On a keyed endpoint, a trusted proxy's `X-Forwarded-Host` passes the Host check, and the discovery page's base URL uses `X-Forwarded-Proto` with that host. The proxy must send `X-Forwarded-Host`; without it the Host check reads the `Host` header as before.
- On a keyless endpoint, forwarded headers are never used for the Host check: a page that rebinds its name to the listener could send the same header. Keyless plus a proxy is refused by the Host check, so set `keys`.
- Forwarded headers never authenticate: a key is still required on a keyed endpoint.

Read [SECURITY](https://github.com/jjjermiah/opencode-plugboard/blob/main/SECURITY.md) before you trust a loopback address: a browser on the same machine can reach a loopback listener through DNS rebinding.

### Browser origins (since 0.26.0)

A web page in a browser runs on its own origin and calls plugboard from there. Option `cors` (#256) names the origins that may do that:

```jsonc
"cors": {
  "origins": ["https://chat.example.net", "http://localhost:3000"],
  "allowPrivateNetwork": false
}
```

- An allowed origin gets `Access-Control-Allow-Origin` (its own origin, with `Vary: Origin`) on every answer. The rest of each answer is unchanged.
- Its preflight (`OPTIONS` with `Access-Control-Request-Method`) is answered `204` before authentication, because a preflight carries no credentials. The Host check still runs first. The preflight reveals only which origins are allowed.
- The actual request still needs its key on a keyed endpoint. On a keyless endpoint, an allowed origin is no longer refused, and every other `Origin` still gets 403 `cross_origin_forbidden`.
- An origin off the list gets no CORS header, so the browser blocks the response.
- An allowed origin's answer also carries `Access-Control-Expose-Headers` (since 0.27.0, #314): the `x-plugboard-*` response headers (`x-plugboard-request-id`, `x-plugboard-session`, `x-plugboard-session-url`, `x-plugboard-model`, `x-plugboard-fallbacks`, `x-plugboard-usage`, `x-plugboard-policy`, `x-plugboard-server-tools`, `x-plugboard-parallel-tools`, `x-plugboard-dropped-params`, `x-plugboard-cache`, `x-plugboard-affinity`, `x-plugboard-user-dropped`, `x-plugboard-structured-fallback`) and `retry-after`. A page can read them with `response.headers.get(...)`.
- `allowPrivateNetwork: true` adds `Access-Control-Allow-Private-Network: true` when the preflight asks for it (Private Network Access). Off by default.
- `"*"` echoes `*` for any origin. It must stand alone and needs `keys`: a wildcard never sits in front of a keyless endpoint.

The responses do not expose the `x-plugboard-*` headers to a browser script, because `Access-Control-Expose-Headers` is not set.

### Remote image limits (since 0.26.0)

`remoteImages` (#259) takes the same `true` and `{ "allow": [...] }` forms as before. Each field below is optional and only tightens the fetch: the SSRF filter (I17), the address pinning and the 50 MB total per request stay in force.

| Field | Default (today's behaviour) | Meaning |
|---|---|---|
| `schemes` | `["http", "https"]` | URL schemes that may be fetched. `["https"]` makes an `http` URL fail with `image_fetch_failed`. Redirect targets are checked too. |
| `maxBytes` | `20971520` (20 MB) | Size cap for one fetched image, 1 to 104857600. The 50 MB total per request still applies. |
| `maxItems` | none | Most remote URLs one request may fetch, 1 to 1000. The next one fails with `too_many_remote_images`; data URLs are not counted. |
| `maxRedirects` | `0` | Redirects the fetcher follows, 0 to 10. Each target goes through the address check again. |
| `timeoutMs` | `20000` | Time allowed for one fetch, 1 to 600000. |

```jsonc
"remoteImages": {
  "allow": ["images.internal"],
  "schemes": ["https"],
  "maxBytes": 5242880,
  "maxItems": 4,
  "maxRedirects": 0,
  "timeoutMs": 10000
}
```

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

Every answer carries `x-plugboard-model: <provider/model>`, the target that answered, whether the request named an alias or a model id (a canonical id gets its own id back). A request that used a list alias also carries `x-plugboard-fallbacks: <n>` when retries happened, and the `model` field of its response is that target (with `n` above 1 the body keeps the alias, and the headers report the first choice that was served). A request for a single-target alias keeps the alias in the body. The request log line has `served=` and `fallbacks=`, and each retry logs `model.fallback` with the failure code. With `metrics: true`, `plugboard_fallbacks_total{app}` counts retries.

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

Each key name is an app. A request made with the `my-app` key is the app `my-app`, and its sessions are grouped under that app. Give every tool its own key. You can tell their traffic apart, and revoking one means removing one line. Removing a key, or changing its value, takes effect on the running server at once. Adding a key needs a restart. See [Reloads and restarts](#reloads-and-restarts).

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
| `tools` | `false` drops every tool the caller sends before the model sees it. The request still succeeds, and the response carries `x-plugboard-policy: tools-stripped`. A `json_schema` response format is still answered: the `respond` tool it uses is kept and forced, and only the caller's tools go (#252). History that already holds tool calls may be rejected by the provider. |
| `maxTools` | Lowers the global `maxTools` for this app. A request with more tools gets 400 `too_many_tools`. It cannot be higher than the global cap. |
| `history` | `{ maxSessions?, maxAgeDays? }` (since 0.27.0). A field replaces the global `history` field for this app; an unset field falls back to it. An app with no limit in either place keeps its sessions forever. Each is 1 or more. `maxAgeDays` cannot be `0` for an app (the global one can), so to keep sessions longer set a large value such as `36500`. Gotcha: the global `maxAgeDays` defaults to 30, so an app that sets only `maxSessions` is still pruned after 30 days. |
| `maxN` | Lowers the global `maxN` for this app (since 0.27.0). A request with a higher `n` (or prompts times `n`) gets 400 `too_many_choices`, and the message names the option that applied: `apps.<name>.maxN` for this app, else `maxN`. It cannot be higher than the global cap, so to allow a larger `n` for one app, raise the global `maxN` first and then lower it for the other apps. Unset: the global `maxN` applies. |
| `serverTools` (since 0.21.0) | Off by default. A list of exact OpenCode tool ids (for example `websearch`) that this app's sessions may run themselves, 1 to 32 entries. See the warning below. |
| `maxServerToolSteps` (since 0.21.0) | How many model steps of one request may run a server tool, `8` by default, 1 to 100. It counts steps, not calls. Needs `serverTools`. |
| `maxServerToolCalls` (since 0.24.0) | How many server tool calls one request may run in all its steps together, `16` by default, 1 to 1000. The call past it fails the request. Needs `serverTools`. |
| `endpoints` (since 0.26.0) | The endpoint families this app may call: a non-empty list of `chat`, `completions`, `responses`, `messages`, `gemini` and `models`. Absent: every endpoint. A call outside the list is a 403 `endpoint_forbidden`, in the route's own error shape. See [Endpoint names](#endpoint-names-since-0-26-0). |
| `history.hidden` (since 0.30.0) | Per app: `apps.<name>.history.hidden`, a boolean that overrides the global `history.hidden`. `true` makes the app's request sessions children of one parent session, `plugboard: <app>`, so they leave OpenCode's session lists. Default off. See [Hidden app sessions](#hidden-app-sessions-since-0-30-0). |
| `historyUrl` (since 0.23.0) | The session link template for this app: a string with `{id}` (see [Session links](#session-links)), or `false` for no link, no `x-plugboard-session-url` and no `session_url=` log field. Absent: the global `historyUrl`. Set `false` for an app you do not trust with the OpenCode server address. |

> **Security: `serverTools` lets an app's key run OpenCode tools on the server.** Anyone holding that app's key can make the model call each listed tool, and the tool runs with the server's own OpenCode credentials and permissions. The prompt steers which arguments the model passes. A tool that reads files or runs commands can reach what the server's OpenCode process can reach, within whatever limits that tool enforces itself. Give such a key only to a caller you would trust with those tools, list the fewest tools the app needs, and never list tools on the keyless `default` app or on a key shared with others. Plugboard checks that each listed tool is a direct tool of the server's OpenCode right now and denies every other tool, but it cannot limit what a listed tool does.

Rules:

- Each id is checked when the request arrives, not at startup. If the server does not offer a listed tool, the request gets 400 `server_tool_unavailable` and nothing is created. Only direct tools can be listed. CodeMode tools cannot, and MCP tools are CodeMode tools by default, so to list an MCP tool, configure its server in OpenCode with `codemode: false`. Ids may not contain wildcards, may not repeat, and may not be `execute` (CodeMode, which would run everything it wraps), `subagent` or `task` (they start a child session with that agent's own rules, outside the deny-all, #195), or a `plugboard_seed_*` name. The keyless `default` app cannot have `serverTools`.
- The app's sessions allow exactly the listed ids, and only as far as the agent's own OpenCode permissions allow them (#194). The agent is the one the request runs as: the persona's agent, or the selected default. Each listed tool needs an `allow` rule for it there. A tool with none is refused with 400 `server_tool_denied_by_operator`, and nothing is created. The agent's `deny` rules still deny the resources they name (`read: { "*.env": "deny" }` still blocks `.env` reads), and an `ask` rule counts as a `deny`, because no one answers a prompt from a request session. An app without `serverTools` is unchanged: every OpenCode tool is denied.
- OpenCode runs a server tool and the model continues with its result. Server tool calls are not returned as `tool_calls`; the final answer comes back as usual. A step that mixes server and caller tool calls returns the caller's calls to the caller and interrupts the rest. Its server calls may already have run: the host starts a tool when the model calls it, before the step ends, so interrupting cannot undo them (#198).
- A caller tool may not share a name with a server tool (400 `server_tool_collision`). A request with `tool_choice` `none` is offered no server tools.
- A request runs at most `maxServerToolSteps` steps that use server tools (a step counts once, however many calls it makes). The next such step fails the request with 502 `server_tool_steps_exceeded`.
- A request runs at most `maxServerToolCalls` server tool calls across all its steps. The call past the cap fails the request with 502 `server_tool_calls_exceeded`, and the turn is interrupted. Calls in the same step as the cap crossing may already have run: the host runs a tool as soon as the model calls it, and plugboard only stops the turn afterwards.
- Once a request has finished (its answer returned, the client gone, or the timeout), a server tool call the session still makes is logged as `server_tool.after_request` (tool, the request's running counts) and the turn is interrupted again. This is the late side of the race in #14; the step and call caps keep counting after the request ends.
- Answers of these apps bypass the response cache, because a tool's output is live.
- A non-streaming answer that ran server tools carries `x-plugboard-server-tools: <n>`, the number of server tool calls OpenCode ran for it (the choices of `n` add up). The header is absent when no server tool ran, and a stream never gets it, because its headers are sent first.
- Each server tool call writes one `server_tool.call` log line (app, tool, duration, `ok`). Its arguments and output are never logged.

`/v1/models`, `/v1/models/{id}` and the Gemini `/v1beta/models` routes list only what the calling app may use, and the model counts and example on the setup page and `/plugboard/status` follow the same scope.

Without `keys` the only app is `default`, and `apps.default` configures it. Once any key exists `default` is never used, so `apps.default` is rejected. Every other app in `apps` must have a key. `system` is applied by the context hook that already rewrites a request session, so it shows up in the model request but not in the stored session transcript.

### Endpoint names (since 0.26.0)

`apps.<name>.endpoints` (#268) limits a key to the routes its app needs. Each name is one endpoint family:

| Name | Routes |
|---|---|
| `chat` | `POST /v1/chat/completions` |
| `completions` | `POST /v1/completions` |
| `responses` | `POST /v1/responses` |
| `messages` | `POST /v1/messages` and `POST /v1/messages/count_tokens` |
| `gemini` | the `/v1beta/models/...` routes (and `/v1/models/{model}:generateContent`) |
| `models` | `GET /v1/models` and `GET /v1/models/{id}` |

```jsonc
"apps": {
  "discord-bot": { "endpoints": ["chat"] },   // Chat Completions only
  "claude-code": { "endpoints": ["messages"] }, // Anthropic Messages only
  "ui-picker": { "endpoints": ["models"] }      // lists models, cannot call one
}
```

The check runs after authentication, so an unauthenticated caller still gets a 401. A refused call is a 403 `endpoint_forbidden` whose message names `apps.<name>.endpoints`; the model is never called. Usage, status, metrics, the dashboard and the probes are not affected by this list. Any other name, or an empty list, fails at load.

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

## Request bodies

Every route reads its JSON body through one check, before any of it is buffered. Two options under `limits` bound it:

```json
"limits": { "maxBodyBytesInFlight": 134217728, "bodyReadTimeoutMs": 30000 }
```

- `maxBodyBytesInFlight` caps the bytes of request bodies being read at once, across every app and route in the server process. The default is 128 MiB. A body whose declared `Content-Length` would take the total over the cap is refused with 503 `server_busy` and `Retry-After: 1` before it is read. A body without a length is counted as its bytes arrive, and refused once they would go over. It is not per app.
- `bodyReadTimeoutMs` is how long a body may take to arrive in full. The default is 30 seconds. A slower body gets 408 `body_read_timeout`, and its bytes are released.
- Both are positive integers. The cap is shared by every plugin reload, so it holds for the whole server process. Keep it above the largest body you expect: a body that alone exceeds it is always refused. A body is never larger than 32 MiB, whatever the cap.

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
- `GET /plugboard/usage` adds a `budgets` list to each app: one entry per ceiling, with `metric`, `window`, `limit`, `used` (the current window's count) and `resetsAt`. It reads the current window, not the report's range. An admin report without `app` lists budgets only for apps that have records in its range, so ask for `app=<name>` to see another.
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

## Prompt-cache affinity

Providers cache a prompt by its prefix. Some also route by a session key: OpenAI takes `prompt_cache_key`, and the ChatGPT subscription takes a `session-id` header. OpenCode derives that key from the session's affinity, which is the session's parent when it has one, else the session itself. Each plugboard request is a new session, so with the default the key changes on every request and the provider cannot route to the cache it wrote.

```jsonc
"promptCache": { "affinity": "anchor", "scope": "app" }
```

With `anchor`, plugboard creates one long-lived anchor session per scope key and makes each request session its child. The anchor is never prompted, and it is not pruned. The request session still runs in the app directory, with its own history entry, session link and usage. Only the affinity changes: it stays the anchor's id.

| `scope` | One anchor per | A request without the key |
|---|---|---|
| `app` (default) | app | not applicable: every request has it |
| `user` | end user (the `user` field of the request) | no affinity: a fresh session, as with `off` |

Set it for every app as `promptCache`, or for one app as `apps.<name>.promptCache`; the app's own value wins.

Every response from an app with `anchor` carries `x-plugboard-affinity`: `anchor` when the request is under its key's anchor, `none` when it got no affinity. A request gets `none` when it has no key (`scope: "user"` without a `user` field), or when its key is new and the app already holds `maxAnchors` anchors. Such a request still runs, as a top-level session, as it did before. Absent: the policy is `off`.

Measured on the dev server (2026-10-12, runs 2 to 4 of a repeated prompt, about 4,000 tokens): ChatGPT subscription models (`openai/*`) hit the cache on 8 of 9 repeat runs with `anchor` and 2 of 9 with `off`. Anthropic, Copilot GPT and Qwen already cached without it and were unchanged. GLM and Copilot Gemini showed no cache reads in any mode. Expect a gain on ChatGPT only.

Anchors are kept, and they are sessions in OpenCode's list. There is one per app, or one per end user under `scope: "user"`, so a busy multi-user app grows one anchor per user. `maxAnchors` caps that: the count is the anchors stored for the app, and concurrent first requests from new users can briefly exceed it. Setting `maxAnchors` above the number of users you expect keeps every user cached; a lower value sends the overflow users to `none` (no harm, just no cache affinity).

**Pruning never touches anchors.** `history` prunes only the request sessions plugboard indexed when it created them. Anchors are never indexed, so they stay until you remove them.

**Removing an anchor.** Delete its session in OpenCode, the way you delete any session. Nothing else is needed: the next request for that key sees the missing parent, forgets the stored anchor, makes a new one and retries the request's session once (logged as `affinity.anchor_recreated`). Deleting an anchor does not free a slot under `maxAnchors`, because the stored record of its key stays until that key is requested again. To lower the count, raise `maxAnchors`, or drop the `affinity/<app>/anchor/` records from the plugin storage (there is no command for that yet).

## Hidden app sessions (since 0.30.0)

OpenCode lists only root sessions (no parent) in its session lists: the TUI, the app's home screen and the session switcher. Every plugboard request is a session, so an API app fills those lists. With `history.hidden` on, a request session is a child of one long-lived parent per app, titled `plugboard: <app>`, and the lists show that one parent instead of every request.

```jsonc
"history": { "hidden": true }
"apps": { "bot": { "history": { "hidden": false } } }
```

The default is off, and the request sessions stay top-level as before. An app's own `history.hidden` replaces the global one for that app.

What it hides and what it does not:

- **Hidden:** the request sessions, in OpenCode's TUI and web or desktop session lists, and on the app's home screen.
- **Still shown:** the parent `plugboard: <app>`, one entry per app. It has no messages.
- **Not hidden:** the settings workspace view, which lists sessions by directory and does not filter children. The iOS app is not verified (it is not in this repo).
- **Still works:** history pruning, session links, usage and budgets all read the child sessions as before.

**Deleting the parent deletes every session under it.** OpenCode removes the children with the parent, so deleting `plugboard: <app>` removes that app's whole request history. It removes them one at a time, each with an interrupt and a wait, so a parent with thousands of children can take a while to delete. Plugboard recreates the parent on the next request, once, the same way it recreates a deleted anchor (`affinity.anchor_recreated` is logged). Concurrent requests that find the parent gone share that one new parent. A deleted parent costs its history and nothing else.

**Existing sessions are not moved.** OpenCode cannot reparent a session, so the request sessions made before the option was turned on stay top-level. Turning it off again does not move the children back either.

With `promptCache` mode `anchor` and scope `app` on the same app, one parent serves both: the parent is the prompt-cache anchor, so the cache key does not change. Scope `user` is refused at load, because the hidden parent is one per app and cannot also be the per-user anchor. Turn one of the two off for that app.

Which title the parent gets depends on which option made it first. With `history.hidden` on from the start, it is `plugboard: <app>`. If a `promptCache` app-scope anchor already existed (titled `plugboard anchor: <app>`) when `history.hidden` was turned on, that parent keeps its old title: plugboard does not rename it. Its children are still hidden, and the session is the same one.

**The cap (`promptCache.maxAnchors`, default 1000) also caps a hidden app**, even with `promptCache` off, because the parent is one stored anchor of the app. If the app is at its cap, a request runs as a top-level session, shown in the lists, and the log line `history.hidden_parent_unavailable` is written once per app for each run of the plugin, not once per request. The usual way to reach the cap is a stored `scope: user` record left from an earlier config: those records are not dropped by changing the config (see the anchor section below), so raise `maxAnchors` or remove the records.

## Usage statistics

Plugboard counts what each app does, per UTC day: model requests and their errors, latency, tokens by kind, cost in USD, cache hits and misses, fallbacks, 429 refusals, and the requests and cost of each model. It is on by default. Set `usage: { "enabled": false }` to record nothing.

With recording on, each non-streaming model answer also carries `x-plugboard-usage` for that one request: `input=<n>; output=<n>; cache_read=<n>; cache_write=<n>; cost_usd=<x.xxxxxx>`. `input` and `output` are the totals the response body reports (cache reads and writes are inside `input`, reasoning inside `output`); `cache_write` is the input the provider wrote to its cache (0 when none), and `cost_usd` is priced from the same tokens. A request that fans out with `n` sums its choices. The cost part is left out when the model has no price in the catalog. A streamed answer has no such header: its headers are sent before the usage is known.

Read it with `GET /plugboard/usage`. `from` and `to` are UTC days (`YYYY-MM-DD`, both inclusive); the default is the 30 days ending today, and a range may span at most 366 days. `app` names one app.

```sh
curl -s "http://127.0.0.1:4010/plugboard/usage?from=2026-10-01&to=2026-10-11" -H "Authorization: Bearer $PLUGBOARD_ADMIN_KEY"
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

Persistence: each day is written to OpenCode's plugin storage as its changes land. Writes of one day never overlap, so a change made during a write is written next; a restart loses only changes whose write was still in flight or failed. Reports read memory first, so they are never behind.

### Dashboard

`GET /plugboard/dashboard` on plugboard's own port is a page for the same report: totals for today, 7, 30 or 90 days, a table of apps (sortable by requests, tokens or cost, with errors, p95 latency and the last request), daily charts per app for requests, cost and tokens, and the models by cost. It works on a phone, and follows light or dark mode.

- The page itself needs no key, and it holds no usage. Enter a key on it; the page reads `/plugboard/usage` with that key and keeps the key in `sessionStorage`, so it lasts for the browser tab and is gone when the tab closes. Sign out clears it.
- The charts use [uPlot](https://github.com/leeoniya/uPlot) (MIT), a pinned dependency that plugboard serves itself from `/plugboard/dashboard/uplot.js` and `/plugboard/dashboard/uplot.css`. Nothing loads from another origin, and the page sends no inline script or style. The policy is `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; ...` (see `src/dashboard/page.ts`).
- Days are UTC, so "today" starts at 00:00 UTC.
- With `usage: { "enabled": false }` the page and its files are not served, and the discovery pages do not link them.

## Admin keys

With `adminKey` set, the admin key also adds and revokes app keys at runtime, so a tool gets a key without a config edit and an OpenCode reload.

- `GET /plugboard/admin/keys` lists the config keys and the runtime keys as `{ keys: [{ id, app, source, createdAt? }] }`. `source` is `config` or `runtime`. No key value is ever listed.
- `POST /plugboard/admin/keys` with body `{ "app": "bot" }` creates a random key for that app and answers 201 with `{ id, app, key, createdAt }`. The `key` is shown once. Store it then; the server keeps only a digest.
- `DELETE /plugboard/admin/keys/{id}` revokes a runtime key. The next request with it gets 401.

```sh
curl -H "Authorization: Bearer $ADMIN_KEY" -H "content-type: application/json" -d '{"app":"bot"}' http://127.0.0.1:4010/plugboard/admin/keys
```

Rules:

- Without `adminKey` these paths are 404. Any credential other than the admin key is 401.
- The app name follows the config rule (`[a-z0-9-]+`, and not `default`). An app that already has a key in `keys` is 409: change that key in the config. An app with `apps.<name>.serverTools` is 409 `app_has_server_tools` (#197): a runtime key would run OpenCode tools, so its key lives in the config only.
- A config key cannot be revoked through the API (409). Remove it from `keys` and reload.
- A runtime key is stored under the plugin's host storage as the SHA-256 of the key, not as the key. Its `id` is the first 8 hex characters of that digest. Runtime keys survive a config reload and a server restart.
- A runtime key names its app on every request that presents it. It does not make a keyless server require a key: with no config keys, a request without a key stays the app `default`. Deleting the last runtime key therefore never opens or closes access by itself.
- Runtime apps have no `apps` policy. An `apps` entry needs a key in `keys`, so a runtime app gets the global settings only.

### Which key opens which route

Every `/plugboard/` route, and the key it takes. A row with no key is a probe or a page; its data routes take a key. A key that the rule does not name gets 401 (no credentials or a wrong one) or 403 (a valid key the rule refuses). On a keyless loopback server a request without credentials is the `default` app, so the 401 column applies once `keys` is set. Pinned by `test/http/plugboard-key-rule.test.ts` (#311).

| Route | No key | App key | Admin key (`adminKey`) |
|-------|--------|---------|------------------------|
| `GET /plugboard/health`, `GET /plugboard/ready` | 200 (probe) | 200 | 200 |
| `GET /plugboard/dashboard` and its files | 200 (page) | 200 | 200 (the page asks for a key; its data is `/plugboard/usage`) |
| `GET /plugboard/status` | 401 | its own app's view (200) | the operator view, no app (200) |
| `GET /plugboard/usage` | 401 | its own app only; another `app` is 403 | every app; `app` may name any (200) |
| `GET /plugboard/metrics` (`metrics: true`) | 401 | with `adminKey` set: 403 `admin_key_required`; without it: 200, and every app's series | 200 |
| `GET /plugboard/admin/keys`, `POST /plugboard/admin/keys`, `DELETE /plugboard/admin/keys/{keyId}` | 401 | 401 | 200 (404 without `adminKey`) |

The admin key is not an app key: on the model routes (`/v1/...`, `/v1beta/...`) it is a 401.

## End users

A bot that serves many people is one app, so its history and usage would be one pile. Plugboard reads the caller's end user from the request and keeps the users apart:

- OpenAI Chat Completions, Responses and legacy completions read the `user` field. Anthropic Messages reads `metadata.user_id`. Gemini has no such field.
- The value is trimmed and kept when it is at most 64 characters of `A-Z a-z 0-9 . _ @ : -`. Anything else is dropped, and the response carries `x-plugboard-user-dropped: 1`. A kept value is only ever a label: it never names a directory or a file.
- A kept user prefixes the session title, as `[alice] first words of the prompt`, and is logged as `user=` on the request line.
- `GET /plugboard/usage` gains a `users` object per app, with `requests`, `tokens` and `costUsd` per user, summed over the range. A day keeps at most 200 distinct users per app; later ones count under `_other`. `GET /plugboard/usage?user=alice` restricts `users` to that user. The app totals and models still cover every user.

## Session links

A response names its history record in `x-plugboard-session`, but the OpenCode web UI has no URL a plugin can read. Option `historyUrl` is the template you fill in, and it depends on how you reach OpenCode:

```json
{ "historyUrl": "http://opencode.example:4096/session/{id}" }
```

With it set, every response that carries `x-plugboard-session` also carries `x-plugboard-session-url`, and the request log line gets `session_url=`. A call with `n` above 1 lists the links in choice order, like the session ids. A cache hit has neither, because it writes no session.

`{id}` and `{directory}` are URL-encoded, so a value cannot add a path segment or a query. `{directory}` is the app's directory on the OpenCode host. Putting it in the template shows that path to every caller that reads the header, so leave it out unless your UI needs it. The template is checked when the config loads: it must be an `http(s)` URL with `{id}`, and the only other placeholder allowed is `{directory}`.

**The link reveals your OpenCode server's address to every app that receives it.** Whoever holds an app key can read the template's host and port from `x-plugboard-session-url`, and does not need the OpenCode server password to see where the server is. Set `apps.<name>.historyUrl` to `false` for an app you do not trust with that address: its responses then carry no `x-plugboard-session-url`, and its log line has no `session_url=`. A string in the same field gives that app its own template (the same checks apply, and the error names `apps.<name>.historyUrl`). An app without the field inherits the global `historyUrl`.

## Limits and errors

Errors use the OpenAI error body shape with the matching HTTP status.

| Status | `code` | When | Message |
| --- | --- | --- | --- |
| 401 | `invalid_api_key` | Missing or wrong key | Missing or invalid API key |
| 404 | `model_not_found` | Unknown model, not on the allowlist, or outside the app's `apps.<name>.models` | Model &lt;m&gt; is not available |
| 403 | `no_models_configured` | The `models` option is empty | No models are allowed: set the plugboard `models` option |
| 400 | `too_many_tools` | More tools than `maxTools` | Request has &lt;n&gt; tools; plugboard allows &lt;max&gt; (option `maxTools`) |
| 400 | `too_many_tools` | More tools than the app's `apps.<name>.maxTools` | Request has &lt;n&gt; tools; app &lt;app&gt; allows &lt;max&gt; (option `apps.<app>.maxTools`) |
| 409 | `app_has_server_tools` | `POST /plugboard/admin/keys` for an app with `apps.<name>.serverTools` | App &lt;name&gt; runs OpenCode tools; a runtime key would give the same power, so none is minted. Set the key in the plugboard config |
| 400 | `server_tool_unavailable` | A tool in the app's `apps.<name>.serverTools` is not a direct tool of the server right now | OpenCode tool(s) not available in this location: &lt;tools&gt; (option `apps.<name>.serverTools`). CodeMode tools, including MCP tools by default, cannot be listed; set codemode: false on the tool |
| 400 | `server_tool_denied_by_operator` | A listed server tool has no `allow` rule in the OpenCode permissions of the agent the request runs as | The OpenCode permissions of this app's agent do not allow `<tool>` (option `apps.<name>.serverTools`). Add an allow rule for it to the agent, or remove it from serverTools |
| 400 | `server_tool_collision` | A caller tool has the name of one of the app's `serverTools` | Tool &lt;name&gt; is one of this app's OpenCode server tools (option `apps.<name>.serverTools`); rename the caller's tool |
| 502 | `server_tool_calls_exceeded` | The model ran more server tool calls than `maxServerToolCalls` | The model used more OpenCode tool calls than this app allows |
| 502 | `server_tool_steps_exceeded` | The model ran more server-tool steps than `maxServerToolSteps` | The model used more OpenCode tool steps than this app allows |
| 400 | `too_many_choices` | `n` (or prompts times `n`) above `maxN` or the app's `apps.<name>.maxN` | n=&lt;n&gt; is above the limit of &lt;max&gt; (option `maxN`, or `apps.<name>.maxN` for this app; each choice is a full model call) |
| 400 | `unsupported_parameter` | `logprobs`, `top_logprobs`, `best_of` above 1, token-array prompts | names the parameter |
| 429 | `too_many_requests` | A cap on concurrent calls in `limits` is full | Too many concurrent requests |
| 429 | `rate_limit_exceeded` | The app's requests per minute in `limits` are used up | Too many requests per minute |
| 429 | `budget_exceeded` | The app has used a ceiling of its `budgets` in the current window | Budget for &lt;app&gt; exceeded: &lt;metric&gt; &lt;window&gt; |
| 503 | `budget_unavailable` | The usage records for the budget check cannot be read | Could not read the usage records for the budget check |
| 503 | `server_busy` | The request body would take the bytes being read over `limits.maxBodyBytesInFlight` (see [Request bodies](#request-bodies)) | Too many request bodies are being read; retry shortly |
| 408 | `body_read_timeout` | The request body did not arrive within `limits.bodyReadTimeoutMs` | Request body was not received within &lt;n&gt; ms (option limits.bodyReadTimeoutMs) |
| 413 | (none, no `code` field) | A request body over 32 MiB | Request body too large |
| 415 | `unsupported_media_type` | A `POST` body whose `Content-Type` is not `application/json` | Content-Type must be application/json |
| 400 | `invalid_user` | The `user` query parameter of `GET /plugboard/usage` is not 1 to 64 characters of the allowed set | `user` must be 1 to 64 characters of A-Z, a-z, 0-9, `.`, `_`, `@`, `:` or `-` |
| 502 | `structured_output_missing` | A `json_schema` answer with neither a `respond` call nor text that matches the schema | The model did not return JSON matching the response schema. Say the expected JSON, with its keys and types, in the prompt. |

Provider errors map to an OpenAI error body with the provider's status, including a provider's own rejection of a sampling parameter (ChatGPT models reject `temperature`, for example). Once a stream has started, a failure arrives as an `error` event followed by `[DONE]`. A client that disconnects, SSE included, interrupts the request. Calls over a cap in `limits` get 429 instead (see [Concurrency and rate limits](#concurrency-and-rate-limits)). Sampling parameters a model is known to reject are dropped instead, see `dropUnsupportedParams`.

Supported request fields: messages with system, developer, user text and images (a `file` content part must be a PDF given as a `data:application/pdf;base64,...` URL; any other file data is a 400 `invalid_file`), assistant `tool_calls` and tool results; `tools`, `tool_choice`, `response_format` (`json_object`, `json_schema`), `temperature`, `top_p`, `max_tokens`, `max_completion_tokens`, `stop`, `presence_penalty`, `frequency_penalty`, `reasoning_effort`, `n` (up to `maxN`), and streaming with a final usage chunk (`stream_options.include_usage`). The legacy `POST /v1/completions` is served too: see [completions](completions.md).

Behaviours worth knowing:

- `parallel_tool_calls: false` keeps the first tool call of an answer and drops the rest. The OpenCode session API cannot turn parallel calls off on every route, so plugboard enforces it, and the response carries `x-plugboard-parallel-tools: limited`. `true` (the default) returns every call the model makes. `seed` is accepted and ignored. Anthropic's `tool_choice.disable_parallel_tool_use: true` works the same way on `/v1/messages`.
- `tool_choice` `auto` and `none` work as expected. `required` and a named function are applied as an instruction to the model, because the OpenCode session API has no tool-choice control. A model can still answer in text.
- `response_format` `json_schema` works through a `respond` tool the model is instructed to call, and the arguments come back as the message content. The provider does not enforce the schema, so validate the result. `json_object` adds a system instruction instead and carries no schema, so name the keys in your prompt; weak models may still ignore them.
- A model that answers in text instead of calling `respond` still counts when its final text is the JSON the schema asks for (#170; the same on Responses and Gemini, #173). The check is deliberately small: the top-level `type`, the top-level `required` keys, and the `type` of each top-level property. Anything else in the schema is not checked. Such an answer carries `x-plugboard-structured-fallback: text` on a non-streamed response. A streamed one cannot carry it, because the headers are sent before the answer is known. Text that does not match is a 502 `structured_output_missing`.
- A request that carries both `tools` and a `json_schema` response format is changing: it will return the caller's tool calls ([#34](https://github.com/jjjermiah/opencode-plugboard/issues/34)). Don't rely on the current behaviour for that combination.
- A streamed tool call arrives as one delta carrying the whole arguments string.

## Operating

- Every response has an `x-plugboard-request-id` header. The same id is the `id` field on that request's log lines, so a client error can be matched to a server line.
- `GET /healthz` is a cheap liveness check. `GET /plugboard/status` (needs a key when keys are set) reports uptime, listen address, generation count, event pump state and model count.
- An invalid plugboard option fails the plugin's setup. OpenCode lists the plugin as `failed` with the field and the reason, the server log has an `options.invalid` line at error level, and the port stays closed for that project. When another project's earlier good config still serves the port, `GET /plugboard/status` shows `configError: { message, at }` and `GET /readyz` returns 503 with the same message as its reason. The next Location that loads valid options clears it.
- `GET /readyz` needs no key. It answers `{"ready":true}` once a generation serves, the event pump runs and the model catalog has loaded. Otherwise it answers 503 `{"ready":false,"reason":...}`, naming the first missing piece. Use it for a load balancer or a service check; [warm-up](warm-up.md#readiness-readyz) explains what makes it ready after a restart.
- Open `http://127.0.0.1:4010/` in a browser for a setup page: the listen address, a `models` suggestion built from what your server offers, and a curl example. With `keys` set, a visitor without a key sees only the address and endpoints; a valid key also shows its own app, the allowlist and the suggestion.
- `/v1/models` entries carry `plugboard.limit`, `modalities`, `cost` (USD per million tokens), `status`, `family` and `released` when the catalog has them.
- With `metrics: true`, `GET /plugboard/metrics` exposes request counts and durations by app and route, in-flight requests, tokens by kind, dropped sampling params, history sweeps and event pump health. There is no model label, so cardinality stays bounded.
- The series carry each app's name, so the scrape is a traffic profile of every app. With `adminKey` set, only the admin key reads `/plugboard/metrics` (an app key gets 403 `admin_key_required`, #285). Without `adminKey`, the `/v1` authentication applies and any app key reads every app's series; that is the documented choice, so set `adminKey` before you scrape a server whose apps should not see each other.
