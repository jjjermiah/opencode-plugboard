# Claude Code with plugboard

Claude Code settings for plugboard's Anthropic Messages route. The client guide is [docs/clients/claude-code.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/claude-code.md), which also has the plugboard options (app `claude-code`, aliases `fast` and `smart`).

- `env.sh`: exports for the current shell. Source it, then run `claude`.
- `settings.json`: the same variables under `env`, for `~/.claude/settings.json`. Replace the key placeholder. Keep the file readable by your user only.

Check the connection before you start Claude Code:

```sh
claude -p "reply with exactly: pong"
```

Not run against plugboard yet. This is the check that should print `pong`.
