# Live run on main v0.41.0 (2026-10-16)

- Commit label `v0.41.0-13-g7e1fdcb` is `git describe` of main HEAD (7e1fdcb). The server reports plugboard 0.41.0 and OpenCode 2.0.29 (`summary.json`).
- Verdict `partial` is the S7 gap only (#399). No row fails.
- Fallback: the `fast` alias is `[opencode-go/glm-5.3-flash, anthropic/claude-haiku-4-5]`. A Go 429 falls through to Haiku. The harness does not record the served model, so the `fast` rows were answered by whichever model served them.
- E1 and E2 check the status only (the error code is not on the Messages wire).
