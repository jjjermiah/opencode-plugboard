# AnythingLLM

Verified: docs and source reference, 2026-10-12. The provider name (**Generic OpenAI**) and the caution that it is for OpenAI-compatible endpoints were checked on AnythingLLM's docs page. The environment variables were checked against `server/.env.example` on the `master` branch of Mintplex-Labs/anything-llm: `GENERIC_OPEN_AI_BASE_PATH`, `GENERIC_OPEN_AI_API_KEY`, `GENERIC_OPEN_AI_MODEL_PREF`, `GENERIC_OPEN_AI_MODEL_TOKEN_LIMIT`. The issue named `GENERIC_OPENAI_STREAMING_DISABLED`; that name is not in the reference, so this page does not use it. The docs page did not render its field list, so the UI field names below come from the issue and are unverified in the UI. Not run: AnythingLLM is a desktop or Docker app, and the dev server at `127.0.0.1:4010` was not listening.

AnythingLLM is a self-hosted assistant with RAG and agents. Its **Generic OpenAI** provider takes any OpenAI-compatible base URL, so it calls plugboard's `POST /v1/chat/completions`.

## Plugboard options

```jsonc
"options": {
  "keys": { "anythingllm": "{env:PLUGBOARD_KEY_ANYTHINGLLM}" },
  "models": ["anthropic/claude-haiku-4-5"],
  "aliases": { "fast": "anthropic/claude-haiku-4-5" }
}
```

Every alias target must also be in `models`.

## AnythingLLM config

Either fill in the UI, or set the variables in the environment (`.env` or a compose file). A copyable compose file is in [examples/anythingllm/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/anythingllm).

**Settings > AI Providers > LLM > Generic OpenAI** (UI labels as the issue gives them, not checked in the UI):

- **Base URL**: `http://127.0.0.1:4010/v1`. Keep `/v1`.
- **API Key**: a plugboard app key.
- **Chat Model Name**: `fast`, typed by hand.
- **Token context window**: the model's real window. Set it, or AnythingLLM truncates context silently.
- **Max Tokens**: the model's output limit.

Environment equivalents:

```sh
LLM_PROVIDER=generic-openai
GENERIC_OPEN_AI_BASE_PATH=http://127.0.0.1:4010/v1
GENERIC_OPEN_AI_API_KEY=<your plugboard app key>
GENERIC_OPEN_AI_MODEL_PREF=fast
GENERIC_OPEN_AI_MODEL_TOKEN_LIMIT=200000
```

`GENERIC_OPEN_AI_MODEL_MAX_TOKEN_KEY` sets the request field for the max-tokens value. It defaults to `max_tokens`. Leave it unset unless your endpoint wants `max_completion_tokens`.

## Features exercised

- Chat Completions for chat turns.
- Streaming. Not verified here.
- Tool calls, when AnythingLLM uses the provider as an agent provider. Not verified here.

## Quirks

- There is no model discovery. The model name is typed by hand, and a wrong name fails only on the first chat.
- Set the context window and max tokens to the real numbers. Defaults that are too low truncate context without an error.
- The reference notes that native tool calling is on by default for providers that support it, and `PROVIDER_DISABLE_NATIVE_TOOL_CALLING` turns it off per provider. If a tool turn misbehaves, that is the switch to try.
- This is the **developer** provider. AnythingLLM's own docs say to use it only when you know the endpoint and each input.

## Not verified

- A chat through the UI, streaming behavior, and the streaming toggle. Those need a running AnythingLLM and a live plugboard.
