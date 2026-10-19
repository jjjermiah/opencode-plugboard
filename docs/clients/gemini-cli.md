# Gemini CLI

Google's terminal agent, on plugboard's [Gemini API](../gemini.md).

## Connect

```sh
export GEMINI_API_KEY="$PLUGBOARD_KEY"
export GOOGLE_GEMINI_BASE_URL="http://127.0.0.1:4010"   # the origin, without /v1
```

and in `~/.gemini/settings.json`:

```json
{ "security": { "auth": { "selectedType": "gemini-api-key" } } }
```

Then `gemini -m fast`. For headless runs add `--skip-trust` (or set `GEMINI_CLI_TRUST_WORKSPACE=true`); otherwise the CLI exits with code 55 before calling the API.

## Headless output

`gemini -p "<prompt>" -m <model> --output-format json`:

<<< @/../examples/gemini-cli/chat.ts#snippet

`--output-format stream-json` prints one event per line; text arrives as assistant deltas and the `result` event has the stats:

<<< @/../examples/gemini-cli/stream.ts#snippet

## What works

Chat, streaming and the CLI's own tools, which it runs itself.

## Limits

- A `#` in a model name must be sent as `%23` (`-m openai/gpt-5.6-luna%23low`). Aliases avoid it.
