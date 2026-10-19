# Zed

Zed's agent, with plugboard as an OpenAI-compatible provider, an Anthropic-compatible provider, or both.

## Connect

In **Agent Settings → LLM Providers → Add Provider**, or in `settings.json`:

<<< @/../examples/zed/settings.json

- The OpenAI-compatible `api_url` ends in `/v1`; the Anthropic one is the origin.
- `max_tokens` is the context window (required).
- The key goes in the provider's settings UI or in an environment variable named after the provider: `PLUGBOARD_API_KEY` for `Plugboard`, `PLUGBOARD_ANTHROPIC_API_KEY` for `Plugboard Anthropic`.

The file is in [examples/zed/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/zed).

## What works

Streaming and tool calls on both providers; images where you enable them.

## Limits

- OpenAI-compatible models default to `images: false`; set `capabilities: { "images": true }` on a model that takes images.
- A model that works only on the Responses API needs `capabilities.chat_completions: false`.
