#!/usr/bin/env sh
# Register plugboard as a Jan Agent provider (OpenAI-compatible route).
# Usage: PLUGBOARD_KEY_JAN=<app key> sh setup.sh
# The key is written to ~/.jan/config.toml; `jan config list` shows it redacted.
set -eu
: "${PLUGBOARD_KEY_JAN:?set PLUGBOARD_KEY_JAN to a plugboard app key}"
PLUGBOARD_URL="${PLUGBOARD_URL:-http://127.0.0.1:4010/v1}"

# region snippet
jan config set \
  --provider plugboard \
  --base-url "$PLUGBOARD_URL" \
  --api-type openai \
  --model fast \
  --api-key "$PLUGBOARD_KEY_JAN"
# endregion snippet

jan config list
