# Codex CLI with plugboard

Codex CLI (`@openai/codex` 0.163.0) through plugboard's Responses route, headless with `codex exec`. The client guide is [docs/clients/codex-cli.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/codex-cli.md), which has the plugboard options (app `codex-cli`, alias `fast`).

- `config.toml`: copy to `~/.codex/config.toml`. It defines the `plugboard` provider with `wire_api = "responses"` and selects the `fast` alias. Nothing else is needed: Codex's default tools work as they are.
- `run.ts`, `cli.ts`, `chat.ts`, `stream.ts`, `tools.ts`, `weather-mcp.ts`: the harness runner. A scripted run is committed in `runs/scripted/` and CI checks it.

Check the connection with a one-shot run before a real task:

```sh
export PLUGBOARD_KEY_CODEX_CLI="<your app key>"
codex exec "reply with exactly: pong"
```

## What the scripted run shows

`bun examples/_harness/run.ts codex-cli --target scripted` runs the pinned CLI with no login and no browser. The key comes from `env_key`. Each run gets its own `HOME` and `CODEX_HOME` under the temp dir and an empty workspace, so `~/.codex`, `~/.agents` and any `AGENTS.md` on the machine never reach the prompt.

| Scenario | Result |
| --- | --- |
| S1 chat and S3 stream, on `fast` and `anthropic/claude-haiku-4-5` | pass. Codex streams `/v1/responses` on every call, so S1 and S3 are one call |
| S1 on `openai/gpt-5.6-luna#low` | pass. Codex knows the slug and sends its tools in an `additional_tools` input item, with no `tools` field |
| S2 and S4, a tool call | pass. Codex has no flag to add a function tool, so the run loads an MCP server with one `get_weather` tool. Codex sends it as a `namespace` tool and expects the call back as `get_weather` in the `mcp__weather` namespace |
| S2 on `openai/gpt-5.6-luna#low`, a tool call | pass, through code mode: a model Codex knows calls MCP tools from JavaScript run by its freeform `exec` tool, so the round trip is a `custom_tool_call` and its output |
| S5, S6, S7, E1, E2 | n/a: the CLI has no data-URL image, JSON-schema output, model list or status in its JSON events |

## Gotchas

- Codex sends its `web_search` tool by default. Plugboard leaves it out and says so in the `x-plugboard-dropped-tools` response header; the model has no web search.
- `Model metadata for 'fast' not found` is a warning from Codex for any model id it does not know, an alias or a canonical id. It does not stop the run.
- The request carries Codex's 17 KB of built-in instructions, the working directory, the date and the skill list. The runner replaces the instructions (`model_instructions_file`) and switches the other parts off so the committed run is the same on every machine. A real run sends all of it.
- Use `--ephemeral` for a throwaway run, so no session is written to `CODEX_HOME`.
