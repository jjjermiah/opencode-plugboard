# Live run 1, curl, plugboard a38860b: superseded

Failed `S1 (messages) on fast` and `S3 (messages) on fast`. Cause: `messages.sh` sent `max_tokens: 64`. `fast` routes to `opencode-go/glm-5.3-flash`, a reasoning model. The 64 tokens went to reasoning (`output_tokens: 64`), the reply had no text, and `stop_reason` was `max_tokens`. Plugboard returned that faithfully; the example's budget was too small.

Fixed in `messages.sh` (1024 tokens). The re-run is `../2026-10-12-a38860b-2/`. This run is kept as the record of the budget failure.
