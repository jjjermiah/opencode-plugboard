#!/usr/bin/env bash
# The harness runner for this example (examples/_harness/run.ts starts it with PLUGBOARD_BASE_URL, PLUGBOARD_KEY and
# PLUGBOARD_CAPTURE_URL set). The Java program prints raw observations; the relay applies the scenario checks.
# Needs a JDK 21 on PATH (JAVA_HOME works too); the Maven wrapper downloads Maven.
set -euo pipefail
cd "$(dirname "$0")"
./mvnw -q -B -ntp package dependency:copy-dependencies -DskipTests -DoutputDirectory=target/lib >&2
java -cp "target/classes:target/lib/*" example.plugboard.langchain4j.Runner | bun ../_harness/ts/relay.ts
