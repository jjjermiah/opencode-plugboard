---
layout: home
title: What is plugboard
hero:
  name: opencode-plugboard
  text: Your OpenCode logins, served as an API
  tagline: An OpenCode V2 plugin. OpenAI, Anthropic and Gemini compatible apps call it with their own key and use the models you already have in OpenCode.
  actions:
    - theme: brand
      text: Install and first request
      link: /install
    - theme: alt
      text: Connect your app
      link: /connect
    - theme: alt
      text: View on GitHub
      link: https://github.com/jjjermiah/opencode-plugboard
features:
  - title: One key per app
    details: Traffic, history and usage stay separate. Revoking a tool means removing one line.
    link: /guides/apps-and-keys
  - title: Models you choose
    details: Expose an allowlist under short aliases, with fallback chains when a provider fails.
    link: /guides/models-and-aliases
  - title: Limits and spend
    details: Cap concurrency, rate and budget per app, and replay repeated answers from a cache.
    link: /guides/limits-budgets-and-caching
  - title: Tools, output and images
    details: Tool calls go back to the caller. JSON schema output and images work through the usual SDK calls.
    link: /guides/tools-output-and-images
  - title: See what happened
    details: Every request is a session. Usage by app, a dashboard, a TUI page and Prometheus metrics.
    link: /guides/history-usage-and-monitoring
  - title: Serve other machines
    details: Bind a private address, use a proxy or a tunnel, and keep an always-on server awake.
    link: /guides/serving-other-machines
---

## What it is

You run OpenCode with some provider logins: Claude, ChatGPT, Copilot, OpenCode Go. Plugboard adds one HTTP listener to that server. A Discord bot, n8n, Open WebUI or a script can then call it as if it were the OpenAI, Anthropic or Gemini API. None of them needs a provider key, and none needs the OpenCode server password.

OpenCode never runs your tools. When the model asks for a tool, plugboard sends the call back to the caller, which runs it and sends the result.

```
client ──▶ plugboard listener ──▶ OpenCode session ──▶ provider
  ▲                                                        │
  └──── reply; tool calls go back to the caller ◀──────────┘
```

Each request becomes an OpenCode session in a directory for its app, so provider fixes and auth plugins in OpenCode still apply, and you can read what every app asked.

## What it serves

| API | Endpoint | Page |
| --- | --- | --- |
| OpenAI Chat Completions | `POST /v1/chat/completions` | [Chat Completions](chat-completions.md) |
| OpenAI Responses | `POST /v1/responses` | [Responses](responses.md) |
| Anthropic Messages | `POST /v1/messages`, `POST /v1/messages/count_tokens` | [Messages](messages.md) |
| Gemini | `POST /v1beta/models/{model}:generateContent`, `:streamGenerateContent`, `:countTokens` | [Gemini](gemini.md) |
| Legacy completions | `POST /v1/completions` | [Completions](completions.md) |
| Models | `GET /v1/models`, `GET /v1/models/{id}` | [APIs](apis.md) |

Plugboard does not serve embeddings, audio, image generation or `logprobs`. See the [known gaps](apis.md#known-gaps).

## Where to go next

1. [Install and first request](install.md): about five minutes.
2. [Connect your app](connect.md): pick your API or your client.
3. The guides, one task each: [apps and keys](guides/apps-and-keys.md), [models and aliases](guides/models-and-aliases.md), [limits, budgets and caching](guides/limits-budgets-and-caching.md), [tools, output and images](guides/tools-output-and-images.md), [history, usage and monitoring](guides/history-usage-and-monitoring.md), [serving other machines](guides/serving-other-machines.md).
4. The [configuration reference](configuration.md) when you need an exact option.

Plugboard is early (0.x). A minor release can change an option or a default, so read the [changelog](https://github.com/jjjermiah/opencode-plugboard/blob/main/CHANGELOG.md) before you upgrade. Only OpenCode V2 is supported.
