# Live run at b41c376 (2026-10-16)

- Server: the isolated dev server, 127.0.0.1:4010. It reports plugboard 0.37.0 and OpenCode 2.0.29 (`summary.json`).
- Commit label: `b41c376`, which is `git describe` v0.37.0-17-gb41c376. Set with `PLUGBOARD_COMMIT`.
- Verdict `fail` is quota only. Every `fast` row fails with `429 rate_limit_error` (opencode-go out of quota). The `anthropic/claude-haiku-4-5` and `openai/gpt-5.6-luna#low` rows pass. A rerun once `fast` has quota is a new directory.
- S7 is a gap (#399). E1 and E2 check the status only.
