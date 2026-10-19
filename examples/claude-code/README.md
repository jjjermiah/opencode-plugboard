# Claude Code with plugboard

Claude Code (`@anthropic-ai/claude-code` 2.1.303) through plugboard's Anthropic Messages route, headless with `claude -p`. The client guide is [docs/clients/claude-code.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/claude-code.md), which also has the plugboard options (app `claude-code`, aliases `fast` and `smart`).

- `env.sh`: exports for the current shell. Source it, then run `claude`.
- `settings.json`: the same variables under `env`, for `~/.claude/settings.json`. Replace the key placeholder. Keep the file readable by your user only.
- `run.ts`, `cli.ts`, `chat.ts`, `tools.ts`, `compact.ts`: the harness runner. `cli.ts` holds the headless call the docs page imports. A scripted run is committed in `runs/scripted/` and CI checks it.

Check the connection before you start Claude Code:

```sh
claude -p "reply with exactly: pong"
```

## What the scripted run shows

`bun examples/_harness/run.ts claude-code --target scripted` runs the pinned CLI with no login and no browser. The key and base URL come from the environment. Each run gets its own `HOME`, `CLAUDE_CONFIG_DIR` and an empty workspace under the temp dir, so `~/.claude`, any `CLAUDE.md` and the machine's git state never reach the prompt. A scripted model answers each request; the run checks what the CLI did with the answers.

| Scenario | Result |
| --- | --- |
| S1 chat and S3 stream, on `fast`, `anthropic/claude-haiku-4-5` and `openai/gpt-5.6-luna#low` | pass. Claude Code streams every call, so S1 and S3 are one call |
| S12 several tool calls in one run | pass. The model asks for `Write`, then `Read`, then answers: three `/v1/messages` requests with the tool results sent back. The run checks that `notes.txt` exists in the workspace |
| S13 a sub-agent | pass. The model calls the `Agent` tool. Claude Code sends the sub-agent's own request (its prompt, 18 tools) to plugboard, and the model's answer comes back to the main agent as a tool result |
| S14 compaction | pass. First turn, then `/compact` on the same session (`--resume`), then a turn on the compacted session. Claude Code sends the whole session with its summary instruction, and the next request holds the summary and no old turns |
| S2, S4, S5, S6, S7, E1, E2 | n/a: the CLI runs its own tools and has no data-URL image, JSON-schema output, model list or status in its events |

Every request carries Claude Code's 20 tools (18 for a sub-agent), well under the default `maxTools` of 64.

## Gotchas

- Without `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING` and `DISABLE_AUTOUPDATER`, the CLI also connects to `api.anthropic.com`. With them set, a run through a proxy that records connections sees none.
- `--allowedTools` is needed: a headless run cannot answer a permission prompt, so an unlisted tool is denied.
- `/compact` needs a session with history, so it runs with `--resume <session id>` on a session an earlier call created. A bare `claude -p "/compact"` fails with `No messages to compact`.
- The run keeps its request the same on every machine with `CLAUDE_CODE_DISABLE_CLAUDE_MDS`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS`, `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS`, `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` and `CLAUDE_CODE_ATTRIBUTION_HEADER=0`. A real run sends all of that. The platform, shell, OS version, paths and sub-agent id in the request are replaced by `examples/_harness/normalise.ts`.
- For a model name Claude Code does not know (`fast`), it prints `claude-code:unrecognized_model` and assumes a 200k context window.
- Claude Code sends a `system` role message inside `messages` for such a model. Plugboard lifts it into the system prompt.
