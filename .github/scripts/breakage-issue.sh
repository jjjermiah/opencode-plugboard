#!/usr/bin/env bash
# Opens or updates the issue "OpenCode <version> breaks plugboard" (label bug) when a daily check
# fails. One issue per version: a later failing run comments on it instead of opening another.
# Used by host-bump.yml (a failed bump or gate) and opencode-release.yml (the load check).
#
#   GH_TOKEN=... bash .github/scripts/breakage-issue.sh <version> <run-url> [<log-file>]
#
# The caller needs `issues: write`. A log file, when given, adds its last 60 lines to the body.
set -euo pipefail

version=${1:?usage: breakage-issue.sh <version> <run-url> [<log-file>]}
run_url=${2:?usage: breakage-issue.sh <version> <run-url> [<log-file>]}
log=${3:-}

title="OpenCode ${version} breaks plugboard"
body=$(mktemp)
trap 'rm -f "$body"' EXIT

{
  echo "A daily check failed on OpenCode \`${version}\`. Run: ${run_url}"
  echo
  echo "Reproduce the load check with \`bun .github/scripts/opencode-load-check.ts --bin <opencode>\`. Release handling: docs/releasing.md#opencode-releases."
  if [ -n "$log" ] && [ -s "$log" ]; then
    echo
    echo '```text'
    tail -n 60 "$log"
    echo '```'
  fi
} > "$body"

number=$(gh issue list --state open --search "\"$title\" in:title" --limit 50 --json number,title \
  | jq -r --arg t "$title" '.[] | select(.title == $t) | .number' | head -n 1)

if [ -n "$number" ]; then
  gh issue comment "$number" --body-file "$body"
  echo "Commented on issue #$number: $title"
else
  gh issue create --title "$title" --label bug --body-file "$body"
fi
