# Configuration

Options, models, keys and errors. For install and a first call, see the [README](https://github.com/jjjermiah/opencode-plugboard#readme).

## Options

Options live under `options` in the plugin entry. `{env:VAR}` is expanded by OpenCode.

| Option | Default | Meaning |
| --- | --- | --- |
| `listen.host` | `127.0.0.1` | Interface to bind. A non-loopback host without `keys` refuses to start. |
| `listen.port` | `4010` | Port to bind. |
| `keys` | none | Map of app name to API key. The app name groups that app's history sessions. Names match `[a-z0-9-]+`. `default` is reserved. |
| `apps` | none | Map of app name to `{ key?, models?, system?, systemMode?, tools?, maxTools? }`: per-app model scope, system prompt and tool policy. See [Apps and keys](#apps-and-keys). |
| `models` | none (required) | Allowlist of models callers may use. See [Models](#models). |
| `aliases` | none | Map of alias to `provider/model[#variant]`, or to an ordered list of them (fallbacks). Each target must also pass `models`. See [Aliases and fallbacks](#aliases-and-fallbacks). |
| `maxTools` | `32` | Most tools one request may carry. Fixed when the plugin loads. |
| `maxN` | `1` | Most model calls one request may fan out to: `n` on Chat Completions and `/v1/completions`, or prompts times `n` for a prompt array. Each is a full call and a kept session, so `n: 4` costs four times. Above the cap, 400 `too_many_choices`. See [completions](completions.md). |
| `requestTimeoutMs` | `600000` | A request that runs longer is interrupted. |
| `history` | none (keep forever) | `{ maxSessions, maxAgeDays }`. `maxSessions` keeps the newest N sessions per app, `maxAgeDays` deletes older ones; with both, the stricter wins. |
| `dropUnsupportedParams` | `true` | Drop `temperature`, `top_p` and penalties the target model is known to reject, and list them in the `x-plugboard-dropped-params` response header. `false` forwards them as sent. |
| `logFormat` | `text` | `text` writes `key=value` lines; `json` writes one JSON object per line for log pipelines. Ids and outcomes only, never keys or bodies. |
| `metrics` | `false` | Serve Prometheus metrics at `GET /metrics`, with the same authentication as `/v1`. |
| `modelIds` | `canonical` | Ids `/v1/models` lists: `canonical` (`provider/model#variant`), `slugs` (UI-safe `provider--model__variant`) or `both`. Requests accept either spelling. See [Model ids in UIs](#model-ids-in-uis). |
| `remoteImages` | `false` | Let the server fetch `http(s)` image URLs from requests (20 MB cap, no redirects, `image/*` only). When on, only public addresses are fetched: loopback, private, link-local, CGNAT and unique-local ranges are refused, and the checked address is the one connected to. Allow internal hosts with `{ "allow": ["images.internal", "*.corp", "10.1.0.0/16"] }`. Fetched images reach the model, so only allow hosts you are happy to have described back to callers. Callers can always send `data:` URLs. |

Changes to `listen` need a server restart; other option changes apply on config reload.

OpenCode loads the plugin once per project directory, and all of those loads share one listener. The first one to load decides the options. A load elsewhere with different options logs once and stays inert, so a project entry cannot serve with weaker auth than the live one. When none is live, for example during a config reload, the next load's options are adopted. Requests are served from plugboard's own data directory when it is loaded, so a project's provider config doesn't change what callers get. So install it in the global config, which every project loads, and don't repeat it per project.

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

## Apps and keys

Each key name is an app. A request made with the `sparkyfitness` key is the app `sparkyfitness`, and its sessions are grouped under that app. Give every tool its own key. You can tell their traffic apart, and revoking one means removing one line.

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

Provider errors map to an OpenAI error body with the provider's status, including a provider's own rejection of a sampling parameter (ChatGPT models reject `temperature`, for example). Once a stream has started, a failure arrives as an `error` event followed by `[DONE]`. A client that disconnects, SSE included, interrupts the request. There is no per-app concurrency limit yet ([#54](https://github.com/jjjermiah/opencode-plugboard/issues/54)). Sampling parameters a model is known to reject are dropped instead, see `dropUnsupportedParams`.

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
- Open `http://127.0.0.1:4010/` in a browser for a setup page: the listen address, a `models` suggestion built from what your server offers, and a curl example. With `keys` set, a visitor without a key sees only the address and endpoints; a valid key also shows its own app, the allowlist and the suggestion.
- `/v1/models` entries carry `plugboard.limit`, `modalities`, `cost` (USD per million tokens), `status`, `family` and `released` when the catalog has them.
- With `metrics: true`, `GET /metrics` exposes request counts and durations by app and route, in-flight requests, tokens by kind, dropped sampling params, history sweeps and event pump health. There is no model label, so cardinality stays bounded.
