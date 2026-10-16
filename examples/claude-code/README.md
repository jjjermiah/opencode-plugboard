# Claude Code with plugboard

Claude Code settings for plugboard's Anthropic Messages route. The client guide is [docs/clients/claude-code.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/claude-code.md), which also has the plugboard options (app `claude-code`, aliases `fast` and `smart`).

- `env.sh`: exports for the current shell. Source it, then run `claude`.
- `settings.json`: the same variables under `env`, for `~/.claude/settings.json`. Replace the key placeholder. Keep the file readable by your user only.

Check the connection before you start Claude Code:

```sh
claude -p "reply with exactly: pong"
```

Manual probe, 2026-10-16, not an example run and not recorded under `runs/`. `claude -p` with `ANTHROPIC_BASE_URL` at the isolated dev server (plugboard v0.37.0) and `ANTHROPIC_MODEL=fast` printed `pong`, with `stop_reason` `end_turn` and one turn. Its stderr warned `unrecognized_model` for `fast`. The probe used the `fast` alias, which has since run out of quota on that server.
