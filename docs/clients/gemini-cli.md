# Gemini CLI

<ExampleResult example="gemini-cli" />

Tested: `@google/gemini-cli` 0.64.0, live run [`2026-10-16-987338b`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/gemini-cli/runs/live/2026-10-16-987338b) at plugboard 0.37.0 (`987338b`): pass. Headless only: no login, no browser. The code below is the example's snippets.

## Setup

The CLI reads its key and base URL from the environment. Its auth type comes from a settings file, which the example writes into a fresh home for each run, so your `~/.gemini` is not touched:

```sh
export GEMINI_API_KEY="$PLUGBOARD_KEY"
export GOOGLE_GEMINI_BASE_URL="http://127.0.0.1:4010"   # the origin, without /v1
```

```json
{ "security": { "auth": { "selectedType": "gemini-api-key" } } }
```

Headless runs need `--skip-trust` (or `GEMINI_CLI_TRUST_WORKSPACE=true`), or the CLI exits with code 55 before it calls the API.

## Chat

The example runs `gemini -p "<prompt>" -m <model> --output-format json`:

<<< @/../examples/gemini-cli/chat.ts#snippet

## Streaming

`--output-format stream-json` prints one JSON event per line. Text arrives as assistant deltas, and the `result` event carries the stats:

<<< @/../examples/gemini-cli/stream.ts#snippet

## What is not run through the CLI

- The CLI runs its own built-in tools. A custom `get_weather` tool cannot be added to a headless run, so the tool scenarios are not applicable.
- The CLI has no JSON-schema output option, no image data-URL input (it takes a file reference), and no model list.
- The CLI's `countTokens` calls did not occur in a headless one-shot run, so this example does not exercise them. The route is served; see [Gemini API](../gemini.md).

## Gotchas

- The stream-json events carry no finish reason, so the example's `finish_reason` checks are not applied to the CLI.
- A `#variant` model id goes as `%23`, which the example does for `-m`.
