# Continue

An open-source coding assistant for VS Code and JetBrains, configured in `config.yaml`.

## Connect

```yaml
name: Plugboard
version: 1.0.0
schema: v1
models:
  - name: Plugboard fast
    provider: openai
    model: fast
    apiBase: http://127.0.0.1:4010/v1
    apiKey: <your plugboard key>
    capabilities:
      - tool_use
      - image_input
```

- `apiBase` ends in `/v1`.
- Continue can't detect capabilities for an alias, so list them: `tool_use` (needed for Agent mode) and `image_input`, only if the model really supports them.
- The file holds the key in plain text; keep it out of version control.

A copy is in [examples/continue/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/continue).

## What works

Chat with streaming, Agent mode tool calls and images. `useResponsesApi: true` switches the entry to the [Responses API](../responses.md); `useLegacyCompletionsEndpoint: true` to [legacy completions](../completions.md).

## Limits

- A model named like `gpt-5` or an o-series model uses the Responses API by default; set `useResponsesApi: false` to keep it on Chat Completions.
