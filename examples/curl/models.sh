#!/usr/bin/env bash
# Models (GET /v1/models): S7 lists the ids the key may use.
#
# Run one scenario on its own:   bash models.sh S7 -
# Needs curl and jq. PLUGBOARD_BASE_URL ends in /v1; PLUGBOARD_KEY is an app key.
set -u -o pipefail

# region snippet
list() {
  curl -sS -f "$PLUGBOARD_BASE_URL/models" -H "Authorization: Bearer $PLUGBOARD_KEY"
}
# endregion snippet

s7() { # every id on the allowlist, with the three the examples rely on
  local out
  out=$(list)
  jq -c '[.data[].id] as $ids | {
    model_ids: $ids,
    has_fast: ($ids | index("fast") != null),
    has_claude: ($ids | any(startswith("anthropic/claude"))),
    has_gpt_low: ($ids | any(endswith("#low")))
  }' <<<"$out"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  scenario=${1:?usage: models.sh <scenario> <model>}
  case "$scenario" in
    S7) s7 ;;
    *) echo "models.sh does not cover $scenario" >&2; exit 2 ;;
  esac
fi
