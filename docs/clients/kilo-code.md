# Kilo Code

Verified: docs only. The VS Code provider choices, the base URL form and the model auto-detection were checked against kilo.ai (the OpenAI-compatible provider page). Two things are not in Kilo's docs: the CLI config shape (taken from third-party integration guides, marked below) and the base URL form for the Anthropic choice. Not run: Kilo Code is a VS Code extension, and the dev server at `127.0.0.1:4010` was down.

Kilo Code is a VS Code agent with a CLI. Its custom provider lets you choose the wire format: OpenAI Compatible (Chat Completions), OpenAI Responses, or Anthropic Messages. Each choice uses a different plugboard route, so Kilo is the one client on this list that can exercise all three.

## Plugboard options

```jsonc
"options": {
  "keys": { "kilo-code": "{env:PLUGBOARD_KEY_KILO_CODE}" },
  "models": ["anthropic/claude-sonnet-4-6", "openai/gpt-5.6-luna#low"],
  "aliases": { "fast": "openai/gpt-5.6-luna#low" }
}
```

Every alias target must also be in `models`. Swap the models for ones your OpenCode server is signed in to.

## VS Code

Settings, then **Providers**, then **Custom provider**:

| Field | Chat Completions | Responses | Anthropic |
| --- | --- | --- | --- |
| Provider API | OpenAI Compatible | OpenAI Responses | Anthropic Messages |
| Base URL | `http://127.0.0.1:4010/v1` | `http://127.0.0.1:4010/v1` | `http://127.0.0.1:4010` |
| API key | a plugboard app key | a plugboard app key | a plugboard app key |

Kilo's docs say to choose OpenAI Compatible for a Chat Completions endpoint, OpenAI Responses for OpenAI and xAI models, and Anthropic Messages for Anthropic and MiniMax models. Their base URL example for the OpenAI choices ends in `/v1`. They do not say what the Anthropic choice expects. This page uses the root, which is what plugboard needs ([Anthropic Messages](../messages.md)). Check it on your Kilo build before you rely on it.

Kilo fetches the model list from `/v1/models` when the URL serves one. If detection fails, add the model by hand. The list shows only what the app's allowlist permits.

## CLI config

Kilo's docs point the CLI at a `kilo.jsonc` file and do not show the provider block. The form below is the one third-party Kilo guides use. Its file name and directory are not confirmed by Kilo's docs.

```json
{
  "provider": {
    "plugboard": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Plugboard",
      "options": {
        "baseURL": "http://127.0.0.1:4010/v1",
        "apiKey": "{env:PLUGBOARD_KEY_KILO_CODE}"
      },
      "models": {
        "fast": { "name": "fast", "limit": { "context": 200000, "output": 16384 } }
      }
    }
  },
  "model": "plugboard/fast"
}
```

The `{env:...}` form for the key also comes from those guides. A copyable version is in [examples/kilo-code/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/kilo-code).

## Features exercised

- **Chat Completions**: `POST /v1/chat/completions` with streaming, native tool calls, images, and the model list.
- **Responses**: `POST /v1/responses` with function tools.
- **Anthropic Messages**: `POST /v1/messages` with the same tool and streaming paths.

## Quirks

- The provider API choice decides the wire format. A choice that does not match the route gives a 400 or 404 from plugboard, not a wrong answer.
- Kilo's docs say generic OpenAI-compatible providers send `max_tokens`, and that Azure GPT-5 deployments reject it. Plugboard passes `max_tokens` through, so check a reasoning model before you rely on it.
- If the model picker mangles ids that contain `/` or `#`, set `modelIds` to `slugs` on the plugboard options, or use an alias ([model ids in UIs](../configuration.md#model-ids-in-uis)).
