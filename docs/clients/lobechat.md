# LobeChat

A self-hosted chat app. Its OpenAI provider reads its key, base URL and model list from the environment.

## Connect

```sh
OPENAI_API_KEY=<your plugboard key>
OPENAI_PROXY_URL=http://127.0.0.1:4010/v1
OPENAI_MODEL_LIST=-all,+fast
```

- `OPENAI_PROXY_URL` must include `/v1`; without it every chat answers 404.
- `OPENAI_MODEL_LIST` controls the picker: `-all` hides the built-in OpenAI models, `+fast` adds your alias. Use `name=Display Name` to rename.
- Restart the container after changing these.

A compose setup is in [examples/lobechat/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/lobechat).

## What works

Streamed chat, and tool calls and image input for models whose picker entry enables them.

## Limits

- The picker comes from `OPENAI_MODEL_LIST`, not from plugboard's `/v1/models`.
