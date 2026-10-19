# Kilo Code

A VS Code agent with a CLI. Its custom provider can speak Chat Completions, the Responses API or Anthropic Messages, and plugboard serves all three.

## Connect (VS Code)

Settings → **Providers** → **Custom provider**:

| Field | Chat Completions | Responses | Anthropic |
| --- | --- | --- | --- |
| Provider API | OpenAI Compatible | OpenAI Responses | Anthropic Messages |
| Base URL | `http://127.0.0.1:4010/v1` | `http://127.0.0.1:4010/v1` | `http://127.0.0.1:4010` |
| API key | your plugboard key | your plugboard key | your plugboard key |

Kilo fills the model list from `/v1/models`; add a model by hand if it doesn't.

## Connect (CLI)

In `kilo.jsonc`:

```json
{
  "provider": {
    "plugboard": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Plugboard",
      "options": {
        "baseURL": "http://127.0.0.1:4010/v1",
        "apiKey": "{env:PLUGBOARD_KEY}"
      },
      "models": {
        "fast": { "name": "fast", "limit": { "context": 200000, "output": 16384 } }
      }
    }
  },
  "model": "plugboard/fast"
}
```

A copy is in [examples/kilo-code/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/kilo-code).

## What works

Streaming, native tool calls, images and the model list on all three formats.

## Limits

- If the model picker mangles names with `/` or `#`, use an alias or set `modelIds` to `slugs` in the plugboard options ([Model ids in UIs](../configuration.md#model-ids-in-uis)).
