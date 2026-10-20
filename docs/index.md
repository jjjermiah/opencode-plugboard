---
title: What is plugboard
# The hero above the docs layout (theme/HomeHero.vue). The outline is off: the page is short and the sidebar lists everything.
homeHero: true
pageClass: plug-home
aside: false
outline: false
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

## Where to go next

1. [Install and first request](install.md).
2. [Connect your app](connect.md): pick your API or your client.
3. The guides, one task each: [apps and keys](guides/apps-and-keys.md), [models and aliases](guides/models-and-aliases.md), [limits, budgets and caching](guides/limits-budgets-and-caching.md), [tools, output and images](guides/tools-output-and-images.md), [history, usage and monitoring](guides/history-usage-and-monitoring.md), [serving other machines](guides/serving-other-machines.md).
4. The [configuration reference](configuration.md) when you need an exact option.

Plugboard is early (0.x). A minor release can change an option or a default, so read the [changelog](https://github.com/jjjermiah/opencode-plugboard/blob/main/CHANGELOG.md) before you upgrade. Only OpenCode V2 is supported.

## What it serves

| API | Endpoint | Page |
| --- | --- | --- |
| OpenAI Chat Completions | `POST /v1/chat/completions` | [Chat Completions](chat-completions.md) |
| OpenAI Responses | `POST /v1/responses`, `GET`/`DELETE /v1/responses/{id}` | [Responses](responses.md) |
| Anthropic Messages | `POST /v1/messages`, `POST /v1/messages/count_tokens` | [Messages](messages.md) |
| Gemini | `POST /v1beta/models/{model}:generateContent`, `:streamGenerateContent`, `:countTokens` | [Gemini](gemini.md) |
| Files | `/v1/files`, `/v1beta/files` | [Files](files.md) |
| Legacy completions | `POST /v1/completions` | [Completions](completions.md) |
| Models | `GET /v1/models`, `GET /v1/models/{id}` | [APIs](apis.md) |

Plugboard does not serve embeddings, audio, image generation or `logprobs`. See the [known gaps](apis.md#known-gaps).
