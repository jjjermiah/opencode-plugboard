# Codex CLI with plugboard

A Codex CLI config for plugboard's Responses route. The client guide is [docs/clients/codex-cli.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/clients/codex-cli.md), which has the plugboard options (app `codex-cli`, alias `fast`).

- `config.toml`: copy to `~/.codex/config.toml`. It defines the `plugboard` provider and selects the `fast` alias.

Check the connection with a one-shot run before a real task:

```sh
export PLUGBOARD_KEY_CODEX_CLI="<your app key>"
codex exec "reply with exactly: pong"
```

Not run against plugboard yet: Codex CLI is not installed, so `codex exec` has not run. The config targets plugboard's `/v1/responses` with `wire_api = "responses"`, the only value Codex accepts; that is documented, not tested. Until a live `codex exec` run is committed, Codex is a gap for [#104](https://github.com/jjjermiah/opencode-plugboard/issues/104).
