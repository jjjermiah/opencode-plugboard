# Claude Code

Anthropic's terminal coding agent. It speaks the [Messages API](../messages.md), and runs its own tools.

## Plugboard options

One app for Claude Code, and aliases for the tiers it uses:

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

Any model works, not only Claude: point the aliases at whatever your OpenCode server is signed in to.

## Connect

```sh
export ANTHROPIC_BASE_URL="http://127.0.0.1:4010"
export ANTHROPIC_AUTH_TOKEN="$PLUGBOARD_KEY_CLAUDE_CODE"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="fast"
export ANTHROPIC_DEFAULT_SONNET_MODEL="smart"
export ANTHROPIC_DEFAULT_OPUS_MODEL="smart"
claude
```

- The base URL has no `/v1`; Claude Code adds `/v1/messages`.
- Set all three `ANTHROPIC_DEFAULT_*_MODEL` variables. The haiku tier also runs background calls (titles, summaries), and a name plugboard doesn't serve fails them with 404.

To keep the settings, put the same variables under `env` in `~/.claude/settings.json` and `chmod 600` the file, since it then holds the key. Copyable versions are in [examples/claude-code/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/claude-code).

## What works

Streaming, Claude Code's tools (returned to it as `tool_use` blocks), extended thinking on models with a matching variant, structured outputs and token counting.

## Limits

- Claude Code sends about 36 tools, more with MCP servers. Requests over `maxTools` (default 64) are refused with 400; raise `maxTools` if you add many MCP servers.
- For a non-Claude model, Claude Code prints `claude-code:unrecognized_model` and assumes a 200k context. Set `CLAUDE_CODE_MAX_CONTEXT_TOKENS` to the real window.
- Anthropic server tools (`web_search`, `code_execution`) are refused with 400.
- Two checks still go to `api.anthropic.com`: WebFetch's domain check (turn it off with `skipWebFetchPreflight: true`) and the fast-mode check. Chat through plugboard works when they fail. `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` turns off other optional traffic.
