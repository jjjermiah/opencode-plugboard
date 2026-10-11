# opencode-plugboard

An OpenCode V2 plugin that turns your OpenCode server into an OpenAI-compatible endpoint, backed by the providers you already connected there.

You logged in to ChatGPT, Claude, Copilot or OpenCode Go once, in OpenCode. Your other tools (a Discord bot, n8n, Open WebUI, a script) only speak the OpenAI API, so each one wants its own key or its own gateway with its own logins. Plugboard serves `/v1/chat/completions` and `/v1/models` from inside OpenCode, so those tools can reuse the logins you already have. Tool calls go back to the caller to execute. OpenCode never runs your tools.

OpenCode V2 has no such endpoint, and the V1 plugins that did this stopped working when the plugin API changed. Plugboard is V2 only. It is pinned to OpenCode 2.0.26 (peer range `>=2.0.26 <2.1`), the version it was developed and checked against.

Status: v0.1, in development and not published yet. Chat Completions and the model list only. There is no `/v1/responses`, see [Known gaps](#known-gaps) and the [roadmap](#roadmap).

Docs: [architecture](docs/architecture.md), [development](docs/development.md), [clients](#clients).

## Quick start

Install it in your global OpenCode config (`~/.config/opencode/opencode.jsonc`). It has to be global. See [History](#history) for why. Until the package is on npm, set `package` to the path of a checkout.

```jsonc
{
  "plugins": [
    {
      "package": "opencode-plugboard",
      "options": {
        "keys": { "my-app": "{env:PLUGBOARD_KEY_MY_APP}" },
        "models": ["anthropic/claude-sonnet-4-6", "github-copilot/*", "opencode-go/glm-5.3-flash"],
        "aliases": { "fast": "opencode-go/glm-5.3-flash" }
      }
    }
  ]
}
```

Every alias target must also be allowed in `models`, which is why the example lists `opencode-go/glm-5.3-flash`. Restart OpenCode, then touch the server once so it loads the plugin (see [Warm-up](#warm-up-for-always-on-servers)). The endpoint listens on `127.0.0.1:4010`.

```sh
export PLUGBOARD_KEY_MY_APP=choose-a-long-random-string   # before starting OpenCode

curl http://127.0.0.1:4010/v1/chat/completions \
  -H "Authorization: Bearer $PLUGBOARD_KEY_MY_APP" \
  -H "Content-Type: application/json" \
  -d '{"model": "fast", "messages": [{"role": "user", "content": "reply with exactly: pong"}]}'
```

Any OpenAI SDK works by changing the base URL and key:

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:4010/v1", api_key="<your key>")
reply = client.chat.completions.create(
    model="anthropic/claude-sonnet-4-6",
    messages=[{"role": "user", "content": "Say hi."}],
)
print(reply.choices[0].message.content)
```

```js
import OpenAI from "openai"

const client = new OpenAI({ baseURL: "http://127.0.0.1:4010/v1", apiKey: "<your key>" })
const stream = await client.chat.completions.create({
  model: "fast",
  messages: [{ role: "user", content: "Say hi." }],
  stream: true,
})
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? "")
```

`GET /healthz` returns OK when the listener is up. `GET /v1/models/{id}` returns one model from the list. Every chat response carries an `x-plugboard-session` header with the id of the OpenCode session that recorded it, so you can find the request in [History](#history).

## Clients

One short page per client, with a config snippet, a chat, a tool call, a structured-output note and the gotchas found in testing. Versions and dates are on each page; the raw evidence is in [`compat/results`](compat/results).

| Client | Page | Result (2026-10-11) |
| --- | --- | --- |
| OpenAI Python SDK | [openai-python](docs/clients/openai-python.md) | pass |
| OpenAI JS SDK | [openai-js](docs/clients/openai-js.md) | pass |
| Vercel AI SDK | [vercel-ai-sdk](docs/clients/vercel-ai-sdk.md) | pass with `createOpenAICompatible` or `.chat()`; the default `@ai-sdk/openai` call needs `/v1/responses` |
| LangChain Python | [langchain-python](docs/clients/langchain-python.md) | pass |
| LangChain JS | [langchain-js](docs/clients/langchain-js.md) | pass except `gpt-5.6*` ids, which force the Responses API |
| pydantic-ai | [pydantic-ai](docs/clients/pydantic-ai.md) | pass with `OpenAIChatModel` |
| Open WebUI | [open-webui](docs/clients/open-webui.md) | pass |
| n8n | [n8n](docs/clients/n8n.md) | pass with "Use Responses API" off |
| Anything else | [any-app](docs/clients/any-app.md) | base URL, key, model id |

Checks drove each client's own SDK or API against a dev server. They covered one plain chat, a tool round trip, streaming, an image and structured output on `fast`, a Claude model and a ChatGPT model. I did not use a browser for Open WebUI.

## Known gaps

- **No `/v1/responses` yet.** Clients that default to the Responses API fail with `404 No route for POST /v1/responses`. That includes the Vercel AI SDK's `@ai-sdk/openai` default call (use `createOpenAICompatible` or `.chat(id)`), LangChain JS for `gpt-5.6*` ids, and n8n's "Use Responses API" option (turn it off).
- Only `n=1`, no `logprobs`, no embeddings, audio or image generation.
- No history pruning, no per-app concurrency limit.

## Options

Options live under `options` in the plugin entry. `{env:VAR}` is expanded by OpenCode.

| Option | Default | Meaning |
| --- | --- | --- |
| `listen.host` | `127.0.0.1` | Interface to bind. A non-loopback host without `keys` refuses to start. |
| `listen.port` | `4010` | Port to bind. |
| `keys` | none | Map of app name to API key. The app name is also the history directory. Names match `[a-z0-9-]+`. `default` is reserved. |
| `models` | none (required) | Allowlist of models callers may use. See [Models](#models). |
| `aliases` | none | Map of alias to `provider/model[#variant]`. Each target must also pass `models`. |
| `maxTools` | `32` | Most tools one request may carry. Fixed when the plugin loads. |
| `requestTimeoutMs` | `600000` | A request that runs longer is interrupted. |
| `remoteImages` | `false` | Let the server fetch `http(s)` image URLs from requests (20 MB cap, no redirects, `image/*` only). Off by default because it lets callers make the host request internal addresses; callers can always send `data:` URLs. |

Changes to `listen` need a server restart; other option changes apply on config reload.

OpenCode loads the plugin once per project directory, and all of those loads share one listener. The first one to load decides the options. A load elsewhere with different options logs once and stays inert while any other load is live, so a project entry cannot serve with weaker auth than the live one. When none is live, for example during a config reload, the next load's options are adopted. So install it in the global config, which every project loads, and don't repeat it per project.

On a loopback `listen.host`, requests with a `Host` header other than `127.0.0.1`, `localhost` or `[::1]` (on the listen port) get 403 `invalid_host`, and without `keys` a request with an `Origin` header gets 403 `cross_origin_forbidden`. `POST` bodies must be `application/json` (415 otherwise).

Without `keys`, only a loopback `listen.host` is accepted and every caller is the app `default`. Once any key exists, every request needs a valid key, loopback included. Callers send it as `Authorization: Bearer <key>`. They never see or need the OpenCode server password.

## Models

Callers name models as `provider/model`, optionally `provider/model#variant` (for example `openai/gpt-6-luna#low`, since ChatGPT models need a variant). Nothing is exposed by accident, so you must list what callers may use in `models`:

- `provider/model` allows that model with any variant.
- `provider/model#variant` allows exactly that variant.
- `provider/*` allows every model of the provider.

With no `models`, `/v1/models` is empty and chat calls return 403. `/v1/models` lists the allowlist intersected with the models enabled on your server, plus your aliases. Each entry has `owned_by` set to the provider and an extra `plugboard` object (`capabilities`, `contextLimit`). The ids contain `/` and `#`, which some UIs mishandle, so define an alias for those.

`reasoning_effort` in a request picks a variant when the model name has none and the model has one by that name. An alias can point at a model with a variant, which is the easy way to give a client a fixed effort level.

## Apps and keys

Each key name is an app. A request made with the `sparkyfitness` key is the app `sparkyfitness`, and its history lands in its own directory. Give every tool its own key. You can tell their traffic apart, and revoking one means removing one line.

## History

Every request is kept as an OpenCode session, so you can see what each app asked and what the model answered. Plugboard keeps the full caller transcript in each session (system prompt, messages, images as attachments, tool calls and results) plus the reply. The title is the first user message. A ten-turn chat is ten sessions, each complete.

Sessions live in a per-app directory, so they never show up in your real projects:

```
$XDG_DATA_HOME/opencode-plugboard/<app>/        # default ~/.local/share/opencode-plugboard/<app>/
```

In OpenCode they appear as one group per app in the desktop and phone app home screen. In the TUI they are visible in the all-projects view (ctrl+a), not in a project's own list. Nothing deletes them yet ([pruning is a roadmap item](https://github.com/jjjermiah/opencode-plugboard/issues/8)).

OpenCode loads plugin hooks per directory, so plugboard has to be loaded in those app directories, which is why it needs the global config. Everywhere outside the data root it is inert: it only joins the shared listener and registers no hooks, tools or agent rules, so your real projects behave as before.

History records every prompt and reply, so treat the data directory as sensitive.

## Warm-up for always-on servers

OpenCode loads no plugin until a client touches the server, so after a restart the port stays closed until something connects. On a machine that runs `opencode serve` all the time, add one call right after start. Any request that makes OpenCode load a project works. `opencode api get /api/agent` does.

On Linux, in the OpenCode systemd unit (retry until the server answers; pass the same server credentials your service uses, if you set any):

```ini
[Service]
ExecStartPost=-/bin/sh -c 'for i in $(seq 1 30); do opencode api get /api/agent >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'
```

On macOS, a launchd job (`~/Library/LaunchAgents/dev.plugboard.warmup.plist`). It runs once when launchd loads it, which is at login and after boot. It does not run again when OpenCode restarts by itself, so after an OpenCode restart on its own, touch the server yourself (`launchctl kickstart -k gui/$(id -u)/dev.plugboard.warmup` reruns it) or run the same command from whatever restarts OpenCode.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.plugboard.warmup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>for i in $(seq 1 30); do opencode api get /api/agent >/dev/null 2>&amp;1 &amp;&amp; exit 0; sleep 1; done; exit 1</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
```

If `opencode` is not on the job's `PATH`, use its full path. A request to `/healthz` before the warm-up gets connection refused, which is expected. I'd like OpenCode to boot plugins at server start so none of this is needed ([upstream request](https://github.com/jjjermiah/opencode-plugboard/issues/2)).

When config reloads happen, plugboard keeps the port open through a short grace period, so a reload does not drop connections. If no plugboard generation is alive when a request arrives, the caller gets a 503.

## Limits and errors

Errors use the OpenAI error body shape with the matching HTTP status.

| Status | `code` | When | Message |
| --- | --- | --- | --- |
| 401 | `invalid_api_key` | Missing or wrong key | Missing or invalid API key |
| 404 | `model_not_found` | Unknown model or not on the allowlist | Model &lt;m&gt; is not available |
| 403 | `no_models_configured` | The `models` option is empty | No models are allowed: set the plugboard `models` option |
| 400 | `too_many_tools` | More tools than `maxTools` | Request has &lt;n&gt; tools; plugboard allows &lt;max&gt; (option `maxTools`) |
| 400 | `unsupported_parameter` | `n` above 1, `logprobs`, `top_logprobs` | names the parameter |

Provider errors map to an OpenAI error body with the provider's status, including a provider's own rejection of a sampling parameter (ChatGPT models reject `temperature`, for example). Once a stream has started, a failure arrives as an `error` event followed by `[DONE]`. A client that disconnects, SSE included, interrupts the request. There is no per-app concurrency limit in v0.1.

Supported request fields: messages with system, developer, user text and images, assistant `tool_calls` and tool results; `tools`, `tool_choice`, `response_format` (`json_object`, `json_schema`), `temperature`, `top_p`, `max_tokens`, `max_completion_tokens`, `stop`, `presence_penalty`, `frequency_penalty`, `reasoning_effort`, and streaming with a final usage chunk (`stream_options.include_usage`).

Behaviours worth knowing:

- `parallel_tool_calls` and `seed` are accepted and ignored.
- `tool_choice` `auto` and `none` work as expected. `required` and a named function are applied as an instruction to the model, because the OpenCode session API has no tool-choice control. A model can still answer in text.
- `response_format` `json_schema` (and `json_object`) work through a `respond` tool the model is instructed to call, and the arguments come back as the message content. It worked on every model tested, but the provider does not enforce the schema.
- A streamed tool call arrives as one delta carrying the whole arguments string.

## How it works

Each request becomes a session in the app's directory, using OpenCode's own request path, so provider fixes and auth plugins (Claude via an auth plugin, ChatGPT, Copilot) still apply.

1. A front-end parses the OpenAI request into a format-neutral request, and the core checks the key and resolves the model.
2. The session backend creates a session in the app directory and swaps the caller's system prompt, messages and tools in for OpenCode's own with a `context` hook.
3. Caller tools map onto a pool of `maxTools` placeholder tools. A placeholder settles at once with a fixed no-op result, so history shows a completed call. Nothing of yours runs.
4. When the model has emitted its tool calls, the plugin interrupts the turn and returns the calls to the caller. Text streams out as it arrives.
5. The front-end encodes the events as JSON or SSE, and the session stays as history.

The model call sits behind one interface, `ModelCaller`, so a native backend can replace the session backend later without touching the front-ends ([roadmap](https://github.com/jjjermiah/opencode-plugboard/issues/3)). [docs/architecture.md](docs/architecture.md) has the details: lifetimes, process-wide state and the freeze-safety rules.

## Roadmap

Work is tracked in GitHub issues. The [v0.1 milestone](https://github.com/jjjermiah/opencode-plugboard/milestone/1) lists what is needed before the first release, and the [later milestone](https://github.com/jjjermiah/opencode-plugboard/milestone/2) holds the rest: the `/v1/responses`, `/v1/messages` and Gemini front-ends, agent mode, a native backend, history pruning and an upstream request to boot plugins at server start.

Not planned: V1 support, embeddings, audio, image generation.

## License

MIT
