# Codex CLI with plugboard

Codex CLI (`@openai/codex` 0.163.0) through plugboard's Responses route, headless with `codex exec`. The client guide is [docs/clients/codex-cli.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/codex-cli.md), which has the plugboard options (app `codex-cli`, alias `fast`).

- `config.toml`: copy to `~/.codex/config.toml`. It defines the `plugboard` provider with `wire_api = "responses"`, selects the `fast` alias and turns off two tools plugboard refuses (below).
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
| S1 on `openai/gpt-5.6-luna#low` | gap ([#498](https://github.com/jjjermiah/opencode-plugboard/issues/498)): Codex knows the slug and sends an `additional_tools` input item |
| S2 and S4, a tool call | gap (#498): Codex has no flag to add a function tool, so the run loads an MCP server with one `get_weather` tool, and Codex sends an MCP server's tools as a `namespace` tool |
| S5, S6, S7, E1, E2 | n/a: the CLI has no data-URL image, JSON-schema output, model list or status in its JSON events |

## Gotchas

- A stock config fails with a 400 before the model is called. `web_search = "disabled"` and `[features] multi_agent = false` are both needed (#498).
- `Model metadata for 'fast' not found` is a warning from Codex for any alias it does not know. It does not stop the run.
- The request carries Codex's 17 KB of built-in instructions, the working directory, the date and the skill list. The runner replaces the instructions (`model_instructions_file`) and switches the other parts off so the committed run is the same on every machine. A real run sends all of it.
- Use `--ephemeral` for a throwaway run, so no session is written to `CODEX_HOME`.
