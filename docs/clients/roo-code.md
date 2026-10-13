# Roo Code

Verified: docs only, 2026-10-13. The **OpenAI Compatible** provider, the Base URL, API Key and Model fields, the six Model Configuration fields (max output tokens, context window, image support, computer use, input price, output price), and the native-tool-calling requirement were rechecked today against Roo Code's OpenAI Compatible provider page, <https://docs.roocode.com/providers/openai-compatible> (last updated on that page: May 15, 2026). That page says Roo Code uses native tool calling only and that some OpenAI-compatible providers partially implement the tools API. Not run: Roo Code is a VS Code extension, and the dev server at `127.0.0.1:4010` was not listening.

Roo Code is a VS Code coding agent, a fork of Cline. Its **OpenAI Compatible** provider sends Chat Completions requests to any base URL, so it calls plugboard's `POST /v1/chat/completions`. Roo Code needs native tool calling: a model without it cannot be used.

## Plugboard options

```jsonc
"options": {
  "keys": { "roo-code": "{env:PLUGBOARD_KEY_ROO_CODE}" },
  "models": ["anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-4-6"],
  "aliases": {
    "fast": "anthropic/claude-haiku-4-5",
    "smart": "anthropic/claude-sonnet-4-6"
  }
}
```

Every alias target must also be in `models`. Use a model that supports tool calling; `fast` must resolve to one.

## Roo Code settings

Open the Roo Code settings panel, then set:

- **API Provider**: OpenAI Compatible.
- **Base URL**: `http://127.0.0.1:4010/v1`. Keep `/v1`.
- **API Key**: a plugboard app key.
- **Model**: `fast`, or any id from `/v1/models` that supports tool calling.
- **Model Configuration**: the six fields the docs list are **Max Output Tokens**, **Context Window**, **Image Support**, **Computer Use**, **Input Price** and **Output Price**. Set **Context Window** and **Max Output Tokens** to the model's real numbers. Turn on **Image Support** only for a model that takes images, and **Computer Use** only for a model with tool calling. Set the two prices if you track cost; the docs do not say what they change.

## Features exercised

- Chat Completions with streaming.
- Native tool calling. Roo Code streams tool-call arguments incrementally, so the round trip has to work on plugboard's streamed tool deltas.
- Image input, when **Image Support** is on.

## Quirks

- Roo Code requires native tool calling. A model without it cannot run tasks; check the model before setting it.
- Partial tools-API implementations are a known gap in OpenAI-compatible providers. The tool round trip is what to test first, not chat.
- Set the context window and max output tokens by hand for a custom model id.

## Not verified

- An agentic tool-using task in VS Code through plugboard. This needs the extension and a live plugboard.
