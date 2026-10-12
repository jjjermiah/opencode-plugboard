# LobeChat

Verified: docs only, 2026-10-12. `OPENAI_PROXY_URL` (default `https://api.openai.com/v1`) and `OPENAI_MODEL_LIST` were checked against LobeHub's model provider environment reference (raw `docs/self-hosting/environment-variables/model-provider.mdx` on `main`). The issue named `CUSTOM_MODELS`; that variable does not exist, the model list key is `OPENAI_MODEL_LIST`. Not run: LobeChat is a web app, and the dev server at `127.0.0.1:4010` was not listening at the time.

LobeChat is a self-hosted chat app with many providers. Its OpenAI provider reads an API key and a base URL from the environment. Point the base URL at plugboard, and LobeChat calls plugboard's `POST /v1/chat/completions`.

## Plugboard options

```jsonc
"options": {
  "keys": { "lobechat": "{env:PLUGBOARD_KEY_LOBECHAT}" },
  "models": ["anthropic/claude-haiku-4-5"],
  "aliases": { "fast": "anthropic/claude-haiku-4-5" }
}
```

Every alias target must also be in `models`.

## LobeChat config

Set two variables on the deployment:

```sh
OPENAI_API_KEY=<your plugboard app key>
OPENAI_PROXY_URL=http://127.0.0.1:4010/v1
OPENAI_MODEL_LIST=-all,+fast
```

- `OPENAI_PROXY_URL` replaces the OpenAI base URL. Include `/v1`: plugboard serves `/v1/chat/completions`, and LobeChat appends only the path after the base. The LobeHub docs say the `/v1` suffix depends on the provider; for plugboard it is required.
- `OPENAI_MODEL_LIST` controls the picker. `-all,+fast` hides the built-in OpenAI models and adds `fast`. Use the alias or an id from `/v1/models`. The syntax is `+` to add, `-` to hide, `name=display` to rename.
- Use `OPENAI_MODEL_LIST`, not `CUSTOM_MODELS`.

A copyable compose setup is in [examples/lobechat/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/lobechat).

## Features exercised

- Chat Completions, streamed, which is how LobeChat sends its chat turns.
- Tool calls and image input, when the chosen model supports them and the picker entry enables them.
- Model listing: the picker uses `OPENAI_MODEL_LIST`, not plugboard's `/v1/models`.

## Quirks

- A `/v1`-less base URL returns 404 on every chat request.
- Changes to env variables need a container restart.
- Plugboard app keys are sent as `Authorization: Bearer`, the same header the OpenAI SDK sends.

## Not verified

- A LobeChat instance chatting and streaming through plugboard. This needs a running LobeChat and a live plugboard; neither was run here.
