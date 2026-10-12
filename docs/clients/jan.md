# Jan

Verified: docs only, 2026-10-12. The desktop path (**Settings > Model Providers > Add Provider**, API format, Base URL with `/v1` for OpenAI-compatible, placeholder key) and the `jan config set` flags (`--provider`, `--base-url`, `--api-type` `openai` or `anthropic`, `--model`, `--api-key`) were checked against Jan's custom endpoint page and Jan Agent provider page. Per-project `agent.toml` placement was checked there too. Not run: the desktop app is a GUI, and the dev server at `127.0.0.1:4010` was not listening, so no live chat or tool call was made.

Jan is a desktop AI app with a local server and a command-line agent, Jan Agent. Both accept any OpenAI-compatible or Anthropic-compatible endpoint as a custom provider.

## Plugboard options

```jsonc
"options": {
  "keys": { "jan": "{env:PLUGBOARD_KEY_JAN}" },
  "models": ["anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-4-6"],
  "aliases": {
    "fast": "anthropic/claude-haiku-4-5",
    "smart": "anthropic/claude-sonnet-4-6"
  }
}
```

Every alias target must also be in `models`.

## Jan desktop

**Settings > Model Providers > Add Provider**. In the Add Custom Provider dialog:

- **API format**: OpenAI-compatible (default) for `/v1/chat/completions`, or Anthropic-compatible for `/v1/messages`.
- **Base URL**: `http://127.0.0.1:4010/v1` for OpenAI-compatible. For Anthropic-compatible, use `http://127.0.0.1:4010` with no `/v1`, because Jan adds `/v1/messages` itself.
- **API key**: a plugboard app key. Jan requires a non-empty value; plugboard rejects a placeholder with 401, so use the real app key.
- **Models**: add each model id by hand (for example `fast`). Jan tries `GET {base_url}/models` on save; add manually if the listing is empty.

Jan does not detect capabilities for custom providers. Open the model and turn on **Tools** and **Vision** per model if you need them.

## Jan Agent CLI

```sh
jan config set --provider plugboard --base-url http://127.0.0.1:4010/v1 --api-type openai --model fast --api-key "$PLUGBOARD_KEY_JAN"
```

For the Anthropic-compatible route, use `--api-type anthropic` and a base URL without `/v1`. `--model` repeats and replaces the existing list.

Per-project overrides go in the project's `agent.toml`. Jan stores that file under `~/.jan/projects/`, outside the repository, so it is not committed. A copyable version is in [examples/jan/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/jan).

## Features exercised

- OpenAI-compatible: Chat Completions with streaming and tool calls, when the model has **Tools** enabled.
- Anthropic-compatible: Messages with streaming and tool calls, through `POST /v1/messages`.

## Quirks

- For OpenAI-compatible endpoints, a base URL without `/v1` gives 404 on every request.
- Key fallbacks retry only on 401, 403 and 429. Other errors, such as a 404 for a missing model, do not retry.
- Custom providers are not capability-detected; tools and vision stay off until set per model.
- Jan Agent's `jan config list` redacts keys. Keys are stored in `~/.jan/config.toml`, so keep that file readable only by your user.

## Not verified

- A chat and a tool call through the desktop app for either API format. This needs the GUI and a live plugboard.
