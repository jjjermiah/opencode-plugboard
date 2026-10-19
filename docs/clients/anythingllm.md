# AnythingLLM

A self-hosted assistant with RAG and agents. Use its **Generic OpenAI** LLM provider.

## Connect

In **Settings → AI Providers → LLM → Generic OpenAI**: Base URL `http://127.0.0.1:4010/v1`, your plugboard key, the model name typed by hand (such as `fast`), and the model's real context window and max tokens. Or set the environment:

```sh
LLM_PROVIDER=generic-openai
GENERIC_OPEN_AI_BASE_PATH=http://127.0.0.1:4010/v1
GENERIC_OPEN_AI_API_KEY=<your plugboard key>
GENERIC_OPEN_AI_MODEL_PREF=fast
GENERIC_OPEN_AI_MODEL_TOKEN_LIMIT=200000
```

A compose file is in [examples/anythingllm/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/anythingllm).

## What works

Chat, streaming, and agent tool calls.

## Limits

- There is no model discovery; a wrong name fails on the first chat.
- Set the context window and max tokens to the model's real values. Values that are too low truncate the context without an error.
- If agent tool turns misbehave, try `PROVIDER_DISABLE_NATIVE_TOOL_CALLING` to fall back to prompt-based tools.
- Embeddings are not served by plugboard; use another embedding provider for documents.
