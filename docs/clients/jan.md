# Jan

Jan's desktop app and its command-line agent, Jan Agent, both take a custom provider.

## Connect (desktop)

**Settings → Model Providers → Add Provider**:

- **API format:** OpenAI-compatible, or Anthropic-compatible for the [Messages API](../messages.md)
- **Base URL:** `http://127.0.0.1:4010/v1` (OpenAI-compatible) or `http://127.0.0.1:4010` (Anthropic-compatible; Jan adds `/v1/messages`)
- **API key:** your plugboard key
- **Models:** add each name by hand, such as `fast`, if the list doesn't fill on save

Turn on **Tools** and **Vision** per model if you need them; Jan doesn't detect them for custom providers.

## Connect (Jan Agent)

`PLUGBOARD_URL` is `http://127.0.0.1:4010/v1` and `PLUGBOARD_KEY_JAN` is your plugboard key.

<<< @/../examples/jan/setup.sh#snippet

For the Anthropic format use `--api-type anthropic` and the base URL without `/v1`. Per-project settings go in that project's `agent.toml`:

<<< @/../examples/jan/agent.toml.example#snippet{toml}

Both files are in [examples/jan/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/jan).

## What works

Streamed chat and tool calls on both API formats.

## Limits

- An OpenAI-compatible base URL without `/v1` answers 404.
- Jan stores keys in `~/.jan/config.toml`; keep that file private.
