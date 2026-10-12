#!/usr/bin/env bash
# Aider (#215) against plugboard: one request through the OpenAI-compatible endpoint, in a throwaway
# git repo. A scripted check, not a harness: Aider is a terminal tool with its own file edits, and its
# package is heavy, so it runs from PyPI with uv each time (aider-chat 0.86.2, Python 3.12).
#
#   PLUGBOARD_URL=http://127.0.0.1:4010 PLUGBOARD_KEY=<app key> bash compat/py/clients/aider_check.sh
#
# Prints one JSON line like the Python harnesses and exits 1 if Aider failed or did not answer.
set -euo pipefail

: "${PLUGBOARD_URL:?set PLUGBOARD_URL to the server root, e.g. http://127.0.0.1:4010}"
: "${PLUGBOARD_KEY:?set PLUGBOARD_KEY to an app key of that server}"
ROOT="${PLUGBOARD_URL%/}"
MODEL="${PLUGBOARD_MODEL:-fast}"
AIDER="aider-chat==0.86.2"

DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT
cd "$DIR"
git init -q .
git config user.email check@example.invalid
git config user.name check
printf 'print("hi")\n' > hello.py
git add hello.py
git commit -qm init

set +e
OUT="$(OPENAI_API_BASE="$ROOT/v1" OPENAI_API_KEY="$PLUGBOARD_KEY" uv tool run --python 3.12 --from "$AIDER" aider \
  --model "openai/$MODEL" --weak-model "openai/$MODEL" --yes-always --no-auto-commits --no-analytics \
  --no-check-update --no-show-model-warnings --message 'Change hello.py so it prints pong.' hello.py 2>&1)"
RC=$?
set -e

if [ "$RC" -ne 0 ]; then
  echo "$OUT" | tail -20 >&2
  printf '{"client":"aider","scenario":"chat","status":"fail","detail":"aider exited %s"}\n' "$RC"
  exit 1
fi
if echo "$OUT" | grep -qi "pong"; then
  printf '{"client":"aider","scenario":"chat","status":"pass","detail":"aider %s answered through plugboard model openai/%s"}\n' "$AIDER" "$MODEL"
else
  echo "$OUT" | tail -20 >&2
  printf '{"client":"aider","scenario":"chat","status":"fail","detail":"no pong in the answer"}\n'
  exit 1
fi
