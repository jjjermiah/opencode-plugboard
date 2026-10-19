# Codex CLI

OpenAI's terminal coding agent. It uses only the [Responses API](../responses.md).

## Plugboard options

```jsonc
"options": {
  "keys": { "codex-cli": "{env:PLUGBOARD_KEY_CODEX_CLI}" },
  "models": ["openai/gpt-5.6-luna#low"],
  "aliases": { "fast": "openai/gpt-5.6-luna#low" }
}
```

Use any model your OpenCode server is signed in to. ChatGPT models need a variant such as `#low`.

## Connect

In `~/.codex/config.toml`:

```toml
model = "fast"
model_provider = "plugboard"
web_search = "disabled"

[features]
multi_agent = false

[model_providers.plugboard]
name = "Plugboard"
base_url = "http://127.0.0.1:4010/v1"
env_key = "PLUGBOARD_KEY_CODEX_CLI"
wire_api = "responses"
```

Then export the key and run `codex` or `codex exec "..."`. `base_url` ends in `/v1`; `env_key` names the variable Codex reads the key from. Use an alias such as `fast` as the model: for model names Codex knows, it sends its tools in a form plugboard refuses. Codex warns that it has no metadata for `fast`; the warning is harmless. A `--profile` only needs to set `model` or `model_provider` on top of this file. A copy is in [examples/codex-cli/](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/codex-cli).

## What works

Chat and streaming, and both ways to continue a conversation: resending it whole, or `previous_response_id`.

## Limits

- Codex sends its web search tool, its multi-agent tools and every MCP server's tools in forms plugboard refuses with 400. The two settings above turn off the first two; MCP tools can't be used through plugboard yet.
- Reasoning text is returned only when the hub sets `reasoningOutput: true`.
- A 400 `previous_response_not_found` means the earlier answer is gone: expired, deleted, sent with `store: false`, or made with another app's key.
