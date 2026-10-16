# Live run on main v0.41.0 (2026-10-16)

- Commit label `v0.41.0-29-g2d6aac1` is `git describe` of this branch (merged with main 0.41.0). The served code is main 0.41.0 (`summary.json`).
- Verdict `pass`: no row fails, and no failure is quota-caused.
- Fallback: the `fast` alias is `[opencode-go/glm-5.3-flash, anthropic/claude-haiku-4-5]`. When the Go provider returns 429, the request falls through to Haiku. The harness does not record the served model, so the `fast` rows were answered by whichever model served them.
