# Continue

An open-source coding assistant for VS Code and JetBrains, configured in `config.yaml`.

## Connect

<<< @/../examples/continue/config.yaml#snippet

- The first entry uses Chat Completions, the second the [Responses API](../responses.md). Keep the one you need.
- `apiBase` ends in `/v1`.
- Continue can't detect capabilities for an alias, so list them: `tool_use` (needed for Agent mode) and `image_input`, only if the model really supports them.
- The file holds the key in plain text; keep it out of version control.

The file is in [examples/continue/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/continue).

## What works

Chat with streaming, Agent mode tool calls and images. `useLegacyCompletionsEndpoint: true` switches an entry to [legacy completions](../completions.md).

## Limits

- A model named like `gpt-5` or an o-series model uses the Responses API by default; set `useResponsesApi: false` to keep it on Chat Completions.
