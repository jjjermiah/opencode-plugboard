# Codex CLI

OpenAI's terminal coding agent. It uses only the [Responses API](../responses.md).

## Plugboard options

```jsonc plugboard-options
"options": {
  "keys": { "codex-cli": "{env:PLUGBOARD_KEY_CODEX_CLI}" },
  "models": ["openai/gpt-5.6-luna#low", "anthropic/claude-haiku-4-5"],
  "aliases": { "fast": "anthropic/claude-haiku-4-5" },
  "maxTools": 128
}
```

Use any model your OpenCode server is signed in to. ChatGPT models need a variant such as `#low`. Codex's own tools plus one MCP server can go past the default `maxTools` of 64, so raise it if you add MCP servers.

## Connect

In `~/.codex/config.toml`:

<<< @/../examples/codex-cli/config.toml#snippet

Then export the key and run `codex` or `codex exec "..."`. `base_url` ends in `/v1`; `env_key` names the variable Codex reads the key from. For an alias such as `fast`, Codex warns that it has no model metadata; the warning is harmless. The file is in [examples/codex-cli/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/codex-cli).

For MCP servers in headless `codex exec`, set `default_tools_approval_mode = "approve"` on the server, or each tool call comes back as an approval error.

## What works

- Chat and streaming.
- Codex's tools, including its multi-agent tools and MCP server tools.
- Model names Codex knows (such as `openai/gpt-5.6-luna#low`), where Codex runs tools through its code mode.
- Continuing a conversation by resending it, or with `previous_response_id`.

## Limits

- The model has no web search. Codex sends its web search tool by default; plugboard leaves it out and names it in the `x-plugboard-dropped-tools` header.
- `local_shell` and `tool_search` tools are refused with 400.
- Reasoning text is returned only when the hub sets `reasoningOutput: true`.
- A 400 `previous_response_not_found` means the earlier answer is gone: expired, deleted, sent with `store: false`, or made with another app's key.
