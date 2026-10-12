# Chatbox

Verified: docs only, 2026-10-12. The provider types ("OpenAI API compatible", "Google Gemini compatible"), the API Host and API Key fields, and the default API path `/v1/chat/completions` were checked against Chatbox's provider guide (docs.chatboxai.app/en/guides/providers). The Gemini host value is not stated in that guide; the Gemini route below is from plugboard's own API, not from Chatbox docs, and is unverified in Chatbox. Not run: Chatbox is a desktop and mobile app, and the dev server at `127.0.0.1:4010` was not listening.

Chatbox is a desktop and mobile chat client. It stores provider settings itself, so there is no config file to copy. Each provider takes an API host and a key, and you add it under **Settings > Model Provider > Add**.

## Plugboard options

```jsonc
"options": {
  "keys": { "chatbox": "{env:PLUGBOARD_KEY_CHATBOX}" },
  "models": ["anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-4-6"],
  "aliases": {
    "fast": "anthropic/claude-haiku-4-5",
    "smart": "anthropic/claude-sonnet-4-6"
  }
}
```

Every alias target must also be in `models`.

## OpenAI route (Chat Completions)

Settings > Model Provider > Add:

- **Provider type**: OpenAI API compatible.
- **API Host**: `http://127.0.0.1:4010/v1`. Chatbox appends `/chat/completions` itself, so the host ends in `/v1`.
- **API Key**: a plugboard app key.
- **API Path**: leave the default, `/v1/chat/completions`. Do not add `/chat/completions` to the host.
- **Models**: add `fast` (or any id from `/v1/models`). Capability settings are optional; an unconfigured model is treated as plain text.

Then press **Check**. A successful check means the endpoint answered.

## Gemini route (generateContent)

Settings > Model Provider > Add:

- **Provider type**: Google Gemini compatible.
- **API Host**: `http://127.0.0.1:4010`, the plugboard root, with no `/v1`. The request path becomes `/v1beta/models/{model}:generateContent`, which plugboard serves.
- **API Key**: the same plugboard app key. Plugboard reads it from `x-goog-api-key` on the Gemini route.
- **Models**: add `fast`.

This route exercises a different wire format from the OpenAI route, so run both checks separately.

## Features exercised

- OpenAI route: Chat Completions, with streaming and image input when the model's capability is enabled.
- Gemini route: `generateContent`, when Chatbox's Gemini-compatible provider is used.

## Quirks

- Chatbox fills in the API path itself. Adding `/chat/completions` to the host gives a 404.
- Per-model capabilities (vision, tools) must be set by hand. Chatbox does not detect them from plugboard.
- The Gemini-compatible provider sends Gemini's request shape, so a fault on that route does not show up on the OpenAI route, and the reverse.

## Not verified

- A chat through each provider type in Chatbox. This needs the desktop or mobile app against a live plugboard.
