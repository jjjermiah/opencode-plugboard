# Zed

Verified: docs only. The `openai_compatible` and `anthropic_compatible` settings, the capability flags and the key variable rule were checked against zed.dev (Use API Access). The issue's `language_models.openai` form was corrected: that key configures Zed's built-in OpenAI provider, not a custom endpoint. Not run: Zed is an editor, and the dev server at `127.0.0.1:4010` was down.

Zed is a code editor with a built-in agent. The agent accepts custom providers. An OpenAI-compatible provider calls `/v1/chat/completions`, and an Anthropic-compatible provider calls `/v1/messages`. This page sets up both against plugboard.

## Plugboard options

```jsonc
"options": {
  "keys": { "zed": "{env:PLUGBOARD_KEY_ZED}" },
  "models": ["anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-4-6"],
  "aliases": {
    "fast": "anthropic/claude-haiku-4-5",
    "smart": "anthropic/claude-sonnet-4-6"
  }
}
```

Every alias target must also be in `models`.

## Zed config

Either add the providers in the UI: **Agent Settings** (`agent: open settings`), then **LLM Providers**, then **Add Provider**. Choose OpenAI-compatible or Anthropic, and fill in the name, the API URL, the model id and the context window.

Or add them to `settings.json`:

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

- The OpenAI-compatible `api_url` ends in `/v1`. The Anthropic-compatible `api_url` is the root, with no `/v1`, because Zed's docs describe the service by its base URL and the Anthropic SDK adds `/v1/messages` itself.
- `max_tokens` is the model's context window, and Zed requires it. For reasoning models, also set `max_completion_tokens` to cap reasoning cost.
- The key is not in `settings.json`. Zed reads it from the provider's settings UI, or from the variable it derives from the provider name: `<PROVIDER_NAME>_API_KEY`, so `Plugboard` reads `PLUGBOARD_API_KEY` and `Plugboard Anthropic` reads `PLUGBOARD_ANTHROPIC_API_KEY`. The `OPENAI_API_KEY` variable belongs to Zed's built-in OpenAI provider.

A copyable version is in [examples/zed/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/zed).

## Features exercised

- **OpenAI-compatible**: `POST /v1/chat/completions` with streaming and tool calls. Its capability defaults are `tools: true`, `images: false` and `chat_completions: true`.
- **Anthropic-compatible**: `POST /v1/messages` with streaming and tool calls. Its capabilities are `tools`, `images` and `prompt_caching`, and `prompt_caching` defaults to off.
- Custom headers under `language_models.<provider>.custom_headers` are supported by both providers, per Zed's docs. Plugboard does not need them.

## Quirks

- OpenAI-compatible models inherit a fixed capability set. Change it with a `capabilities` object on the model. `images: true` is needed only for a model that takes images.
- A model that only works on the Responses API needs `capabilities.chat_completions: false`. Plugboard serves `/v1/responses` for that case ([Responses API](../responses.md)). This page did not check Zed's Responses path against plugboard.
- Set `max_tokens` to the context window, not the output limit. Set `max_output_tokens` on the Anthropic model to cap output.
