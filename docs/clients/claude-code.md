# Claude Code

Verified: docs only. The environment variables, the `settings.json` `env` key, the model tier variables and the gateway notes were checked against code.claude.com. Not run: the dev server at `127.0.0.1:4010` was down, so `claude -p` against plugboard is still to do.

Claude Code is Anthropic's terminal coding agent. It speaks the Anthropic Messages API, so it calls plugboard's `POST /v1/messages` route, as the Anthropic SDKs do ([Anthropic Messages](../messages.md)).

## Plugboard options

One app for Claude Code, and two aliases for the tiers it uses:

```jsonc
"options": {
  "keys": { "claude-code": "{env:PLUGBOARD_KEY_CLAUDE_CODE}" },
  "models": ["anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-4-6"],
  "aliases": {
    "fast": "anthropic/claude-haiku-4-5",
    "smart": "anthropic/claude-sonnet-4-6"
  }
}
```

Every alias target must also be in `models`. Swap the ids for models your OpenCode server is signed in to. `fast` and `smart` are names this page uses, not names plugboard requires.

## Claude Code config

```sh
export ANTHROPIC_BASE_URL="http://127.0.0.1:4010"
export ANTHROPIC_AUTH_TOKEN="$PLUGBOARD_KEY_CLAUDE_CODE"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="fast"
export ANTHROPIC_DEFAULT_SONNET_MODEL="smart"
export ANTHROPIC_DEFAULT_OPUS_MODEL="smart"
claude
```

- The base URL is the API root, with no `/v1`. Claude Code adds `/v1/messages` itself.
- `ANTHROPIC_AUTH_TOKEN` is sent as `Authorization: Bearer`. Plugboard accepts that header, and `x-api-key` too.
- The `ANTHROPIC_DEFAULT_*_MODEL` variables set what the `haiku`, `sonnet` and `opus` tiers resolve to. Set all three to ids or aliases plugboard serves. The haiku tier also runs background calls such as titles and summaries. An id plugboard does not serve fails those calls with 404 `not_found_error`.

To keep the settings, put the same variables under `env` in `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:4010",
    "ANTHROPIC_AUTH_TOKEN": "<your app key>",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "fast",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "smart",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "smart"
  }
}
```

That file then holds the key in plain text, so keep it readable by your user only (`chmod 600`).

Copyable versions are in [examples/claude-code/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/claude-code).

## Features exercised

- Streaming, and custom tools. Claude Code's own tools come back to it as `tool_use` blocks. Plugboard runs none of them.
- Extended thinking, when the model has a variant for the requested budget (see [Anthropic Messages](../messages.md)).
- Token counting. Plugboard serves `POST /v1/messages/count_tokens` as an estimate. The docs read for this page do not say whether Claude Code calls it.

## Gateway notes

- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` turns off optional telemetry and other non-essential traffic. It is listed on Claude Code's environment variables page.
- Two checks still reach `api.anthropic.com` with `ANTHROPIC_BASE_URL` set: the WebFetch domain safety check, and the fast mode availability check. Set `skipWebFetchPreflight: true` in settings to turn the first one off. If a firewall blocks `api.anthropic.com`, those two checks fail, and chat through plugboard still works.

## Quirks

- Plugboard refuses `output_config.format` (structured outputs) with 400 `invalid_request_error`. Claude Code's own requests were not checked for it.
- Anthropic server tools (`web_search`, `code_execution` and the like) are refused with 400. Custom tools work.
- A request that names a model not in `models`, or an alias that is not defined, gets 404 `not_found_error`.
