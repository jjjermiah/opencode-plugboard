# LobeChat

A self-hosted chat app. Its OpenAI provider reads its key, base URL and model list from the environment.

## Connect

<<< @/../examples/lobechat/.env.example#snippet{ini}

- `OPENAI_PROXY_URL` must include `/v1`; without it every chat answers 404.
- `OPENAI_MODEL_LIST` controls the picker: `-all` hides the built-in OpenAI models, `+fast` adds your alias. Use `name=Display Name` to rename.
- Restart the container after changing these.

A compose file that loads it is in [examples/lobechat/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/lobechat).

## What works

Streamed chat, and tool calls and image input for models whose picker entry enables them.

## Limits

- The picker comes from `OPENAI_MODEL_LIST`, not from plugboard's `/v1/models`.
