#!/usr/bin/env bash
# Legacy completions (POST /v1/completions): S1 plain prompt.
#
# Run one scenario on its own:   bash completions.sh S1 fast
# Needs curl and jq. PLUGBOARD_BASE_URL ends in /v1; PLUGBOARD_KEY is an app key.
set -u -o pipefail

# region snippet
post() { # $1 = JSON body
  curl -sS -f "$PLUGBOARD_BASE_URL/completions" -H "Authorization: Bearer $PLUGBOARD_KEY" -H "Content-Type: application/json" -d "$1"
}
# endregion snippet

s1() { # plain prompt
  local out
  # region snippet-s1
  out=$(post "$(jq -cn --arg m "$1" '{model: $m, prompt: "Reply with exactly: pong", max_tokens: 16}')")
  # endregion snippet-s1
  jq -c '{text: (.choices[0].text // ""), finish_reason: .choices[0].finish_reason, usage: .usage}' <<<"$out"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  scenario=${1:?usage: completions.sh <scenario> <model>}
  model=${2:?usage: completions.sh <scenario> <model>}
  case "$scenario" in
    S1) s1 "$model" ;;
    *) echo "completions.sh does not cover $scenario" >&2; exit 2 ;;
  esac
fi
