# Cline

Verified: docs only, 2026-10-13. The **OpenAI Compatible** provider, its three required settings (Base URL, API Key, Model), and the Model Configuration fields (max output tokens, context window, image support, computer use) were rechecked today against Cline's OpenAI Compatible provider page, <https://docs.cline.bot/provider-config/openai-compatible>. The issue said agent mode needs native tool calling and that the plain OpenAI provider's Base URL field is missing on recent versions; neither claim is on that page, so both are marked unverified below. Not run: Cline is a VS Code extension, and the dev server at `127.0.0.1:4010` was not listening.

Cline is a coding agent in VS Code. Its **OpenAI Compatible** provider sends Chat Completions requests to any base URL, so it calls plugboard's `POST /v1/chat/completions`. The extension stores its settings itself, so there is no config file. This page is the settings to enter.

## Plugboard options

```jsonc
"options": {
  "keys": { "cline": "{env:PLUGBOARD_KEY_CLINE}" },
  "models": ["anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-4-6"],
  "aliases": {
    "fast": "anthropic/claude-haiku-4-5",
    "smart": "anthropic/claude-sonnet-4-6"
  }
}
```

Every alias target must also be in `models`.

## Cline settings

Open Cline's settings (gear icon), then set:

- **API Provider**: OpenAI Compatible. Pick this, not the plain OpenAI provider.
- **Base URL**: `http://127.0.0.1:4010/v1`. Keep `/v1`.
- **API Key**: a plugboard app key.
- **Model**: `fast`, or any id from `/v1/models`.
- **Model Configuration**: set **Context Window** and **Max Output Tokens** to the model's real numbers. Cline's docs describe these as the way to configure a custom model id. Turn on **Image Support** only for a model that takes images, and **Computer Use** only for a model with tool calling.

## Features exercised

- Chat Completions with streaming.
- Native tool calling, for agent mode (file reads and edits, command runs). Whether Cline requires it is unverified; see Quirks.
- Image input, when **Image Support** is on for the model.

## Quirks

- Cline's docs say the **Base URL** must be the provider's OpenAI-compatible endpoint, not `https://api.openai.com/v1`. Set it to plugboard's `/v1` base.
- Set the context window and max output tokens by hand for a custom model id. Cline cannot look them up.
- Agent mode depends on the model returning tool calls. A model without tool calling can chat but cannot act. The issue said Cline refuses such models; that is not in the docs and was not tested.

## Not verified

- An agentic turn in VS Code through plugboard. This needs the extension and a live plugboard.
- The issue's claim about the plain OpenAI provider's Base URL field on recent versions.
