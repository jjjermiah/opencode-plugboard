# Zed

Zed's agent, with plugboard as an OpenAI-compatible provider, an Anthropic-compatible provider, or both.

## Connect

In **Agent Settings → LLM Providers → Add Provider**, or in `settings.json`:

```json
{
  "language_models": {
    "openai_compatible": {
      "Plugboard": {
        "api_url": "http://127.0.0.1:4010/v1",
        "available_models": [
          { "name": "fast", "display_name": "fast", "max_tokens": 200000 }
        ]
      }
    },
    "anthropic_compatible": {
      "Plugboard Anthropic": {
        "api_url": "http://127.0.0.1:4010",
        "available_models": [
          { "name": "smart", "display_name": "smart", "max_tokens": 200000, "max_output_tokens": 8192 }
        ]
      }
    }
  }
}
```

- The OpenAI-compatible `api_url` ends in `/v1`; the Anthropic one is the origin.
- `max_tokens` is the context window (required).
- The key goes in the provider's settings UI or in an environment variable named after the provider: `PLUGBOARD_API_KEY` for `Plugboard`, `PLUGBOARD_ANTHROPIC_API_KEY` for `Plugboard Anthropic`.

A copy is in [examples/zed/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/zed).

## What works

Streaming and tool calls on both providers; images where you enable them.

## Limits

- OpenAI-compatible models default to `images: false`; set `capabilities: { "images": true }` on a model that takes images.
- A model that works only on the Responses API needs `capabilities.chat_completions: false`.
