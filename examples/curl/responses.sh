#!/usr/bin/env bash
# Responses (POST /v1/responses): S1 plain chat.
#
# Run one scenario on its own:   bash responses.sh S1 fast
# Needs curl and jq. PLUGBOARD_BASE_URL ends in /v1; PLUGBOARD_KEY is an app key.
set -u -o pipefail

# region snippet
post() { # $1 = JSON body
  curl -sS -f "$PLUGBOARD_BASE_URL/responses" -H "Authorization: Bearer $PLUGBOARD_KEY" -H "Content-Type: application/json" -d "$1"
}
# endregion snippet

s1() { # plain chat
  local out
  # region snippet-s1
  out=$(post "$(jq -cn --arg m "$1" '{model: $m, input: "Reply with exactly: pong"}')")
  # endregion snippet-s1
  jq -c '{text: ([.output[]? | select(.type == "message") | .content[]? | select(.type == "output_text") | .text] | join("")), finish_reason: (if .status == "completed" then "stop" else (.status // "") end), usage: .usage}' <<<"$out"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  scenario=${1:?usage: responses.sh <scenario> <model>}
  model=${2:?usage: responses.sh <scenario> <model>}
  case "$scenario" in
    S1) s1 "$model" ;;
    *) echo "responses.sh does not cover $scenario" >&2; exit 2 ;;
  esac
fi
