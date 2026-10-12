# SillyTavern

Verified: docs only, 2026-10-12. The source name (**Custom (OpenAI-compatible)** under **API: Chat Completion**), the `/v1` hint with "Do NOT add the /chat/completions suffix", the model dropdown behavior (dropdown from `/v1/models`, otherwise a text field), **Bypass API status check**, **Test Message**, and the warning that custom endpoints are not guaranteed compatible were checked against SillyTavern's OpenAI API connection page (docs.sillytavern.app/usage/api-connections/openai). The issue's field labels ("Custom Endpoint (Base URL)", "Custom API Key") and its citation of a fixed bug (#5275) are not in that page, so this page does not use them. Not run: SillyTavern is a web app, and the dev server at `127.0.0.1:4010` was not listening.

SillyTavern is a front end for chat and roleplay. Its **Custom (OpenAI-compatible)** source sends Chat Completions requests to any endpoint you give it, so it calls plugboard's `POST /v1/chat/completions`.

## Plugboard options

```jsonc
"options": {
  "keys": { "sillytavern": "{env:PLUGBOARD_KEY_SILLYTAVERN}" },
  "models": ["anthropic/claude-haiku-4-5"],
  "aliases": { "fast": "anthropic/claude-haiku-4-5" }
}
```

Every alias target must also be in `models`.

## SillyTavern config

**API Connections > API: Chat Completion**, then **Chat Completion Source: Custom (OpenAI-compatible)**:

- **Endpoint**: `http://127.0.0.1:4010/v1`. Keep `/v1`. Do not add `/chat/completions`.
- **API key**: a plugboard app key, in the key field for the custom source.
- **Model**: the dropdown fills from `GET /v1/models` if plugboard answers it, which it does. If the dropdown stays empty, type `fast` into the text field.
- Press **Test Message** to send one prompt and confirm the connection. Leave **Bypass API status check** off unless the test passes and the status warning is wrong.

A compose setup for the app itself is in [examples/sillytavern/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/sillytavern). It only runs SillyTavern; the plugboard settings are entered in the UI above.

## Features exercised

- Chat Completions for chat turns, with streaming as set in SillyTavern. Streaming was not verified here.
- Model listing from `/v1/models`, which feeds the dropdown.
- Tool calling, if the prompt pipeline keeps tool calls. Not verified here.

## Quirks

- SillyTavern warns that it does not guarantee compatibility with every endpoint. Its docs say the custom source may error on requests it considers invalid.
- Prompt post-processing can break strict endpoints. The **Strict** and **Single user message** options merge roles; use them only if plugboard rejects the default message order.
- Tool calling is off when the post-processing option "no tools" is in use. Pick a "with tools" variant or leave post-processing at **None** to test tools.

## Not verified

- A chat, streaming, and the dropdown population through the UI. These need a running SillyTavern and a live plugboard.
