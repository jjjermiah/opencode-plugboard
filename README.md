# opencode-plugboard

An OpenCode V2 plugin that turns your OpenCode server into an OpenAI-compatible endpoint, backed by the providers you already connected there.

You logged in to ChatGPT, Claude, Copilot or OpenCode Go once, in OpenCode. Your other tools (a Discord bot, n8n, Open WebUI, a script) only speak the OpenAI API, so each one wants its own key or its own gateway with its own logins. Plugboard serves `/v1/chat/completions` and `/v1/models` from inside OpenCode, so those tools can reuse the logins you already have. Tool calls go back to the caller to execute. OpenCode never runs them.

OpenCode V2 has no such endpoint, and the V1 plugins that did this stopped working when the plugin API changed. Plugboard is V2 only. It was developed against OpenCode 2.0.26.

Status: v0.1, in development. Only Chat Completions and `/v1/models` are planned for the first release. See the [roadmap](#roadmap).

## Quick start

Install it in your global OpenCode config (`~/.config/opencode/opencode.jsonc`). It has to be global. See [History](#history) for why.

```jsonc
{
  "plugins": [
    {
      "package": "opencode-plugboard",
      "options": {
        "keys": { "my-app": "{env:PLUGBOARD_KEY_MY_APP}" },
        "models": ["anthropic/claude-sonnet-4-6", "github-copilot/*"],
        "aliases": { "fast": "opencode-go/glm-5.3-flash" }
      }
    }
  ]
}
```

Restart OpenCode, then touch the server once so it loads the plugin (see [Warm-up](#warm-up-for-always-on-servers)). The endpoint listens on `127.0.0.1:4010`.

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

`GET /healthz` returns OK when the listener is up.

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

Changes to `listen` need a server restart; other option changes apply on config reload. The global config is the only source of options: while a Location with the global options is live, a plugin entry elsewhere with different options logs once and stays inert.
On a loopback `listen.host`, requests with a `Host` header other than `127.0.0.1`, `localhost` or `[::1]` (on the listen port) get 403 `invalid_host`, and without `keys` a request with an `Origin` header gets 403 `cross_origin_forbidden`. `POST` bodies must be `application/json` (415 otherwise).

Without `keys`, only a loopback `listen.host` is accepted and every caller is the app `default`. Once any key exists, every request needs a valid key, loopback included. Callers send it as `Authorization: Bearer <key>`. They never see or need the OpenCode server password.

## Models

Callers name models as `provider/model`, optionally `provider/model#variant` (for example `openai/gpt-6-luna#low`, since ChatGPT models need a variant). Nothing is exposed by accident, so you must list what callers may use in `models`:

- `provider/model` allows that model with any variant.
- `provider/model#variant` allows exactly that variant.
- `provider/*` allows every model of the provider.

With no `models`, `/v1/models` is empty and chat calls return 403. `/v1/models` lists the allowlist intersected with the models enabled on your server, plus your aliases. Each entry has `owned_by` set to the provider.

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

## Warm-up for always-on servers

OpenCode loads no plugin until a client touches the server, so after a restart the port stays closed until something connects. On a machine that runs `opencode serve` all the time, add one call right after start. Any request that makes OpenCode load a project works. `opencode api get /api/agent` does.

On Linux, in the OpenCode systemd unit (retry until the server answers; pass the same server credentials your service uses, if you set any):

```ini
[Service]
ExecStartPost=-/bin/sh -c 'for i in $(seq 1 30); do opencode api get /api/agent >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'
```

On macOS, a second launchd job that runs once at login and after boot (`~/Library/LaunchAgents/dev.plugboard.warmup.plist`):

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
    <string>for i in $(seq 1 30); do opencode api get /api/agent >/dev/null 2>&1 &amp;&amp; exit 0; sleep 1; done; exit 1</string>
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

Provider errors map to an OpenAI error body with the provider's status. Once a stream has started, a failure arrives as an `error` event followed by `[DONE]`. A client that disconnects, SSE included, interrupts the request. `parallel_tool_calls` and `seed` are accepted and ignored when the provider can't honour them. There is no per-app concurrency limit in v0.1.

Supported request fields: messages with system, developer, user text and images, assistant `tool_calls` and tool results; `tools`, `tool_choice`, `response_format` (`json_object`, `json_schema`), `temperature`, `top_p`, `max_tokens`, `max_completion_tokens`, `stop`, `presence_penalty`, `frequency_penalty`, `reasoning_effort`, and streaming with a final usage chunk (`stream_options.include_usage`).

## How it works

Each request becomes a session in the app's directory, using OpenCode's own request path, so provider fixes and auth plugins (Claude via an auth plugin, ChatGPT, Copilot) still apply.

1. A front-end parses the OpenAI request into a format-neutral request, and the core checks the key and resolves the model.
2. The session backend creates a session in the app directory and swaps the caller's system prompt, messages and tools in for OpenCode's own with a `context` hook.
3. Caller tools map onto a pool of `maxTools` placeholder tools that never execute.
4. When the model has emitted its tool calls, the plugin interrupts the turn and returns the calls to the caller. Text streams out as it arrives.
5. The front-end encodes the events as JSON or SSE, and the session stays as history.

`response_format` with a JSON schema becomes a forced `respond` tool, and its arguments come back as the message content.

The model call sits behind one interface, `ModelCaller`, so a native backend can replace the session backend later without touching the front-ends ([roadmap](https://github.com/jjjermiah/opencode-plugboard/issues/3)).

## Compatibility

Checked by hand on OpenCode 2.0.26: plain text, a tool call returned unexecuted, a tool-result turn and an image, on `github-copilot`, `anthropic` (Claude through an auth plugin), `openai` (ChatGPT) and `opencode-go`. Streaming and structured output are part of the v0.1 gate and not yet confirmed.

Client testing is planned, not done. The v0.1 release gate is: OpenAI SDK (Python and JS), Vercel AI SDK, LangChain, Open WebUI, n8n, curl golden fixtures and pydantic-ai. I will list a client here only after it has passed one plain chat and one tool round trip.

## Roadmap

Work is tracked in GitHub issues. The [v0.1 milestone](https://github.com/jjjermiah/opencode-plugboard/milestone/1) lists what is needed before the first release, and the [later milestone](https://github.com/jjjermiah/opencode-plugboard/milestone/2) holds the rest: the `/v1/responses`, `/v1/messages` and Gemini front-ends, agent mode, a native backend, a compatibility harness, history pruning and an upstream request to boot plugins at server start.

Not planned: V1 support, embeddings, audio, image generation.

## License

MIT
