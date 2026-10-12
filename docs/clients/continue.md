# Continue

Verified: docs only. The model block, `apiBase`, `useResponsesApi`, `useLegacyCompletionsEndpoint` and the `capabilities` values were checked against docs.continue.dev (the OpenAI provider page and the config reference). The config file location was not re-checked. Not run: Continue is an IDE extension, and the dev server at `127.0.0.1:4010` was down.

Continue is an open-source coding assistant for VS Code and JetBrains. It is configured in `config.yaml`. Its OpenAI provider can call either Chat Completions or Responses, and it picks by model name unless you set `useResponsesApi`.

## Plugboard options

```jsonc
"options": {
  "keys": { "continue": "{env:PLUGBOARD_KEY_CONTINUE}" },
  "models": ["anthropic/claude-haiku-4-5"],
  "aliases": { "fast": "anthropic/claude-haiku-4-5" }
}
```

## Continue config

In `config.yaml`, one model entry per route:

```yaml
name: Plugboard
version: 1.0.0
schema: v1
models:
  - name: Plugboard fast (chat)
    provider: openai
    model: fast
    apiBase: http://127.0.0.1:4010/v1
    apiKey: <your app key>
    useResponsesApi: false
    capabilities:
      - tool_use
      - image_input
  - name: Plugboard fast (responses)
    provider: openai
    model: fast
    apiBase: http://127.0.0.1:4010/v1
    apiKey: <your app key>
    useResponsesApi: true
    capabilities:
      - tool_use
      - image_input
```

- `apiBase` ends in `/v1`, as in Continue's own example. The OpenAI provider adds `/chat/completions` or `/responses`.
- `apiKey` takes the plugboard app key, not a provider key. The file then holds the key in plain text, so keep it out of version control.
- `capabilities` replaces Continue's detection from the model name. Continue does not know `fast`, so the entries list `tool_use` (needed for Agent mode) and `image_input`. Set only the ones the model really supports.

A copyable version is in [examples/continue/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/continue).

## Routes

- **Chat Completions** (`useResponsesApi: false`): `POST /v1/chat/completions`. Streaming, tool calls, and images.
- **Responses** (`useResponsesApi: true`): `POST /v1/responses`, with the same features on the Responses wire format.

Continue uses Responses by default only for o-series and gpt-5 model names, per its docs. A name like `fast` uses Chat Completions unless you set `useResponsesApi: true`.

`useLegacyCompletionsEndpoint: true` forces the legacy `/v1/completions` route, which plugboard also serves ([completions](../completions.md)). This page does not use it.

## Quirks

- A model named like `gpt-5` or an o-series model defaults to Responses. Set `useResponsesApi: false` to keep it on Chat Completions, as Continue's docs show for `gpt-5`.
- Continue marks its JSON config as deprecated. Use `config.yaml`.
- Plugboard ids such as `anthropic/claude-haiku-4-5#low` contain `/` and `#`. Put an alias such as `fast` in `model` to keep the config simple.
