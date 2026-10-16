# Live run 2026-10-16 at 95261a4

Plugboard 0.41.0 at main `95261a4` (`git describe`: `v0.41.0-4-g95261a4`), on the shared dev server.

`fast` was served through the dev server's fallback chain (`opencode-go/glm-5.3-flash`, then `anthropic/claude-haiku-4-5`). When the Go quota returns 429, the request falls through to Haiku (`x-plugboard-model: anthropic/claude-haiku-4-5`, `x-plugboard-fallbacks: 1`). The harness does not record the served model, so a `fast` row here is not attributed to Go or Haiku. Rows that did not fall back were served by Go.

Gaps: S2 `responses-previous-id` on all three models. plugboard refuses `previous_response_id` by design (400 `unsupported_parameter`); see docs/responses.md.
