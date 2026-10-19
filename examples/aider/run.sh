#!/usr/bin/env bash
# Runner for the Aider example. Started by examples/_harness/run.ts, which captures the traffic and writes the run.
# This script writes nothing: it prints JSON lines (plan, client, one result per model, done) like the Python runners.
#
#   uv run --isolated --project examples/aider aider --version      # the pinned Aider (pyproject.toml; no lockfile)
#   bash examples/aider/run.sh                                      # through the harness, with the env run.ts sets
#
# Aider is a terminal tool that edits files, so it is a scripted check, not a harness client: it sends one message in a
# throwaway git repo and reads the result. It cannot see the wire finish_reason or usage, so S1 checks "answer contains pong".
# S8 asks for a file edit in the edit format Aider picks for the model (`whole` for fast and gpt, `diff` for claude) and
# reads the file back. The captured transcripts still hold the wire fields.
set -euo pipefail

# Aider picks its edit format and prompts from model metadata, which the host can change (a fetched price map differs
# between machines). Pin both so the prompts in the transcripts are the same on every host.
export LITELLM_LOCAL_MODEL_COST_MAP=True
# Aider adds a "Reply in <language>" line from the locale. C.UTF-8 adds none, which is what the committed run and CI show, so the
# pin reproduces CI's prompt. en_US.UTF-8 adds the line and would change the transcript. CI is the reference: if a host has no
# C.UTF-8, its run will differ from the committed one and the drift check fails, which is the intended signal.
export LANG=C.UTF-8 LC_ALL=C.UTF-8
# Every run uses a fresh environment, so Aider treats it as a first run and offers to open its release notes in a browser;
# --yes-always accepts that offer. --no-show-release-notes stops the offer, and BROWSER=true makes any other
# webbrowser.open a no-op, so a run never opens a page on the machine running it.
export BROWSER=true

# Aider keeps state under $HOME/.aider (installs.json, caches), shared by every run on the machine, and a second run in
# another worktree would read and rewrite it at the same time. Each aider process gets its own HOME. uv finds its cache and its
# Python under HOME, so those two are pinned to the real ones first, or every run would download them again.
UV_CACHE_DIR="${UV_CACHE_DIR:-$(uv cache dir)}"
UV_PYTHON_INSTALL_DIR="${UV_PYTHON_INSTALL_DIR:-$(uv python dir)}"
export UV_CACHE_DIR UV_PYTHON_INSTALL_DIR
# There is no uv.lock. --isolated resolves into a temporary environment on every call and writes no lockfile into the tree.

HERE="$(cd "$(dirname "$0")" && pwd)"
: "${PLUGBOARD_BASE_URL:?run through examples/_harness/run.ts}"
: "${PLUGBOARD_KEY:?run through examples/_harness/run.ts}"
: "${PLUGBOARD_CAPTURE_URL:?run through examples/_harness/run.ts}"

VERSION="$(uv run --isolated --project "$HERE" python -c 'import importlib.metadata as m; print(m.version("aider-chat"))')"
printf '{"kind":"client","name":"aider-chat","version":"%s","runtime":{"name":"bash","version":"%s"}}\n' "$VERSION" "${BASH_VERSINFO[0]}"
printf '{"kind":"plan","scenarios":["S1","S8"]}\n'

# A throwaway git repo with one committed file, `hello.py`. Prints its path.
make_repo() {
  local dir
  dir="$(mktemp -d)"
  (
    cd "$dir"
    git init -q .
    git config user.email check@example.invalid
    git config user.name check
    printf 'print("hi")\n' > hello.py
    git add hello.py
    git commit -qm init
  )
  echo "$dir"
}

for MODEL in fast anthropic/claude-haiku-4-5 openai/gpt-5.6-luna#low; do
  # The capture proxy tags the next exchanges with this scenario and model, and waits until the last one has finished.
  curl -fsS -X POST "$PLUGBOARD_CAPTURE_URL/__mark" -H 'content-type: application/json' \
    -d "{\"scenario\":\"S1\",\"model\":\"$MODEL\"}" -o /dev/null

  DIR="$(make_repo)"
  AIDER_HOME="$(mktemp -d)"

  set +e
  OUT="$(cd "$DIR" && HOME="$AIDER_HOME" OPENAI_API_BASE="$PLUGBOARD_BASE_URL" OPENAI_API_KEY="$PLUGBOARD_KEY" uv run --isolated --project "$HERE" aider \
    --model "openai/$MODEL" --weak-model "openai/$MODEL" --edit-format whole --yes-always --no-auto-commits --no-analytics \
    --no-check-update --no-show-model-warnings --no-show-release-notes --message 'Reply with exactly: pong' hello.py 2>&1)"
  RC=$?
  set -e
  rm -rf "$DIR" "$AIDER_HOME"

  if [ "$RC" -ne 0 ]; then
    echo "$OUT" | tail -20 >&2
    printf '{"kind":"result","scenario":"S1","model":"%s","status":"fail","checks":[],"error":"aider exited %s","note":null}\n' "$MODEL" "$RC"
  elif echo "$OUT" | grep -qi "pong"; then
    printf '{"kind":"result","scenario":"S1","model":"%s","status":"pass","checks":[{"name":"answer contains pong","ok":true}],"error":null,"note":null}\n' "$MODEL"
  else
    echo "$OUT" | tail -20 >&2
    printf '{"kind":"result","scenario":"S1","model":"%s","status":"fail","checks":[{"name":"answer contains pong","ok":false}],"error":null,"note":null}\n' "$MODEL"
  fi
done

for MODEL in fast anthropic/claude-haiku-4-5 openai/gpt-5.6-luna#low; do
  curl -fsS -X POST "$PLUGBOARD_CAPTURE_URL/__mark" -H 'content-type: application/json' \
    -d "{\"scenario\":\"S8\",\"model\":\"$MODEL\"}" -o /dev/null

  DIR="$(make_repo)"
  AIDER_HOME="$(mktemp -d)"

  # No --edit-format: Aider picks the format for the model.
  set +e
  OUT="$(cd "$DIR" && HOME="$AIDER_HOME" OPENAI_API_BASE="$PLUGBOARD_BASE_URL" OPENAI_API_KEY="$PLUGBOARD_KEY" uv run --isolated --project "$HERE" aider \
    --model "openai/$MODEL" --weak-model "openai/$MODEL" --yes-always --no-auto-commits --no-analytics \
    --no-check-update --no-show-model-warnings --no-show-release-notes --message 'Change hello.py to print: hello from plugboard' hello.py 2>&1)"
  RC=$?
  set -e
  TEXT="$(cat "$DIR/hello.py")"
  rm -rf "$DIR" "$AIDER_HOME"

  NEW=false
  KEPT=false
  case "$TEXT" in *"hello from plugboard"*) NEW=true ;; esac
  case "$TEXT" in *'print("hi")'*) KEPT=true ;; esac
  if [ "$RC" -ne 0 ]; then
    echo "$OUT" | tail -20 >&2
    printf '{"kind":"result","scenario":"S8","model":"%s","status":"fail","checks":[],"error":"aider exited %s","note":null}\n' "$MODEL" "$RC"
  elif [ "$NEW" = true ] && [ "$KEPT" = false ]; then
    printf '{"kind":"result","scenario":"S8","model":"%s","status":"pass","checks":[{"name":"file has the new line","ok":true},{"name":"old line is gone","ok":true}],"error":null,"note":null}\n' "$MODEL"
  else
    echo "$OUT" | tail -20 >&2
    printf '{"kind":"result","scenario":"S8","model":"%s","status":"fail","checks":[{"name":"file has the new line","ok":%s},{"name":"old line is gone","ok":%s}],"error":null,"note":null}\n' "$MODEL" "$NEW" "$([ "$KEPT" = true ] && echo false || echo true)"
  fi
done

printf '{"kind":"done"}\n'
