#!/usr/bin/env bash
# The harness runner for this example (examples/_harness/run.ts starts it with PLUGBOARD_BASE_URL, PLUGBOARD_KEY and
# PLUGBOARD_CAPTURE_URL set). The Rust runner prints raw observations; the relay applies the scenario checks.
set -euo pipefail
cd "$(dirname "$0")"
cargo run --quiet --bin runner | bun ../_harness/ts/relay.ts
