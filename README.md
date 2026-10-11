# opencode-plugboard

[![npm](https://img.shields.io/npm/v/opencode-plugboard)](https://www.npmjs.com/package/opencode-plugboard)
[![license](https://img.shields.io/npm/l/opencode-plugboard)](https://github.com/jjjermiah/opencode-plugboard/blob/main/LICENSE)
[![CI](https://github.com/jjjermiah/opencode-plugboard/actions/workflows/ci.yml/badge.svg)](https://github.com/jjjermiah/opencode-plugboard/actions/workflows/ci.yml)

An OpenCode V2 plugin that serves an OpenAI-compatible API from your OpenCode server, so your other apps reuse the provider logins you already made in OpenCode.

```
client ──▶ plugboard listener ──▶ OpenCode session ──▶ provider
  ▲                                                        │
  └──── reply; tool calls go back to the caller ◀──────────┘
```

Tools like n8n, Open WebUI or a Discord bot only speak the OpenAI API, so each wants its own key or its own gateway. Plugboard serves `/v1/chat/completions`, `/v1/responses` and `/v1/models` from inside OpenCode. OpenCode never runs your tools.

## Quick start

Tested on OpenCode 2.0.26. The peer range `>=2.0.26 <2.1` allows 2.0.x patch releases.

**1. Pick a key** for your app, in the environment OpenCode starts from:

```sh
export PLUGBOARD_KEY_MY_APP=choose-a-long-random-string
```

**2. Install it** in your global config (`~/.config/opencode/opencode.jsonc`). It has to be global, see [History](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/history.md). OpenCode installs it from npm the first time it loads.

```jsonc
{
  "plugins": [
    {
      "package": "opencode-plugboard@0.5.0",
      "options": {
        "keys": { "my-app": "{env:PLUGBOARD_KEY_MY_APP}" },
        "models": ["anthropic/claude-sonnet-4-6", "github-copilot/*", "opencode-go/glm-5.3-flash"],
        "aliases": { "fast": "opencode-go/glm-5.3-flash" }
      }
    }
  ]
}
```

Every alias target must also be allowed in `models`. Pin the version as shown. A bare `"opencode-plugboard"` means `latest`, so a cache refresh or `opencode plugin update` can pull code you have not read. A global plugin runs inside OpenCode in every project, next to your provider logins, so update the number on purpose after reading the [changelog](https://github.com/jjjermiah/opencode-plugboard/blob/main/CHANGELOG.md).

**3. Restart OpenCode, then touch the server once.** OpenCode loads no plugin until a client connects, so the port stays closed until then:

```sh
opencode api get /api/agent
```

For an always-on server, run that from the service unit, see [warm-up](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/warm-up.md).

**4. Call it.** The endpoint listens on `127.0.0.1:4010`. This prints `pong`:

```sh
curl -s http://127.0.0.1:4010/v1/chat/completions \
  -H "Authorization: Bearer $PLUGBOARD_KEY_MY_APP" \
  -H "Content-Type: application/json" \
  -d '{"model": "fast", "messages": [{"role": "user", "content": "reply with exactly: pong"}]}' \
  | jq -r '.choices[0].message.content'
```

Any OpenAI SDK works by changing the base URL (`http://127.0.0.1:4010/v1`) and the key. Next:

- [Clients](#clients): config for Python, JS, Vercel AI SDK, LangChain, pydantic-ai, Open WebUI, n8n.
- [Configuration](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/configuration.md): options, models, keys, errors.
- [Reaching plugboard from another host or container](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/any-app.md#reaching-plugboard-from-another-host-or-container).
- [History](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/history.md): every request is kept as an OpenCode session.
- [Architecture](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/architecture.md) and [development](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/development.md).

`GET /healthz` returns OK when the listener is up and needs no key.

## What this is not

Plugboard is early (0.x) and narrow on purpose.

- **V2 only.** OpenCode V2 has no OpenAI endpoint, and the V1 plugins that had one stopped working when the plugin API changed. V1 is not planned.
- **Two formats:** Chat Completions and Responses. `/v1/responses` is a stateless subset, see [docs/responses.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/responses.md). Anthropic Messages and Gemini front-ends are on the [roadmap](#roadmap).
- **Not planned:** embeddings, audio, image generation. Only `n=1`, no `logprobs`.
- **No concurrency limit per app** yet ([#54](https://github.com/jjjermiah/opencode-plugboard/issues/54), [#86](https://github.com/jjjermiah/opencode-plugboard/issues/86)).
- **Not a gateway with its own provider keys.** It only reuses what OpenCode is logged in to.

How it differs from a standalone gateway:

- [LiteLLM](https://github.com/BerriAI/litellm) is a separate gateway you run and give its own provider keys. It covers many more providers and API shapes. Pick it when you want a standalone service. Pick plugboard when OpenCode already holds the logins you want to reuse, such as a ChatGPT or Copilot subscription. Plugboard also gives each app its own key and history, an explicit model allowlist, and rules that keep it from ever freezing the host.

The most common first failure is an SDK defaulting to `/v1/responses` for newer models. Plugboard serves it, but some clients need `store: false` or a "use chat completions" switch. Check the client's page below.

## Clients

One short page per client, with a config snippet, a chat, a tool call, a structured-output note and the gotchas found in testing. Versions and dates are on each page; the raw evidence is in [`compat/results`](https://github.com/jjjermiah/opencode-plugboard/tree/main/compat/results).

| Client | Page | Last run (2026-10-11) |
| --- | --- | --- |
| OpenAI Python SDK | [openai-python](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/openai-python.md) | pass |
| OpenAI JS SDK | [openai-js](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/openai-js.md) | pass |
| Vercel AI SDK | [vercel-ai-sdk](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/vercel-ai-sdk.md) | pass with `createOpenAICompatible` or `.chat()`; structured output needs `supportsStructuredOutputs: true` there; the default `openai(id)` call works through `/v1/responses` (set `store: false` for multi-turn) |
| LangChain Python | [langchain-python](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/langchain-python.md) | pass; `json_mode` on `fast` was unreliable |
| LangChain JS | [langchain-js](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/langchain-js.md) | pass except `gpt-5.6*` ids, which force the Responses API, and `json_mode` on `fast` |
| pydantic-ai | [pydantic-ai](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/pydantic-ai.md) | pass with `OpenAIChatModel` |
| Open WebUI | [open-webui](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/open-webui.md) | pass over its HTTP API; no browser, no structured output in its UI |
| n8n | [n8n](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/n8n.md) | pass with "Use Responses API" off |
| Anything else | [any-app](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/any-app.md) | base URL, key, model id |

Each run drove the client's own SDK or API against a dev server at an earlier commit: a plain chat, a tool round trip, streaming, an image and structured output on `fast`, a Claude model and a ChatGPT model. A pass is not a clean sweep, and the notes say where it was not. The latest full run is in [compat/results/release-candidate.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/compat/results/release-candidate.md).

## How it works

Each request becomes an OpenCode session in the app's own directory, using OpenCode's request path, so provider fixes and auth plugins still apply. The plugin swaps the caller's prompt, messages and tools in for OpenCode's own. Caller tools map to placeholder tools that settle at once with a no-op result. When the model has emitted its tool calls, the plugin interrupts the turn and returns them to the caller. Text streams out as it arrives. [docs/architecture.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/architecture.md) has the lifetimes and the freeze-safety rules.

## Roadmap

Work is tracked in GitHub issues: the [v0.1 milestone](https://github.com/jjjermiah/opencode-plugboard/milestone/1) and the [later milestone](https://github.com/jjjermiah/opencode-plugboard/milestone/2), which holds the `/v1/messages` and Gemini front-ends, agent mode, a native backend, usage accounting, rate limits and an upstream request to boot plugins at server start.

## License

MIT
