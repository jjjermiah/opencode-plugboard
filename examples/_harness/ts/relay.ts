/**
 * Relay for runners that cannot import the TypeScript helpers (the Go and .NET runners). The runner prints `plan`,
 * `client`, `observation` and `done` lines on stdout, and it marks each scenario itself, the same as the Python and
 * TypeScript helpers. This reads those lines from stdin, applies the checks in examples/_shared/scenarios.json to each
 * observation (ts/harness.ts evaluate), and prints the `result` lines that run.ts reads. The check logic lives here
 * only, so a Go or .NET run cannot drift from the Python and TypeScript runs.
 *
 *   go run ./runner | bun ../_harness/ts/relay.ts
 */
import { emit, evaluate, SCENARIOS, type Observations } from "./harness.ts"

interface ObservationLine {
  readonly kind: "observation"
  readonly scenario: string
  readonly model: string
  readonly observations: Observations
  readonly error: string | null
}

function relay(line: string): void {
  const data = JSON.parse(line) as { kind?: string }
  if (data.kind !== "observation") {
    console.log(line)
    return
  }
  const observed = data as ObservationLine
  const spec = SCENARIOS.find((candidate) => candidate.id === observed.scenario)
  if (!spec) throw new Error(`relay: no scenario ${observed.scenario} in scenarios.json`)
  const checks = observed.error === null ? evaluate(spec.checks, observed.observations) : []
  const status = observed.error === null && checks.every((check) => check.ok) ? "pass" : "fail"
  emit({ kind: "result", scenario: observed.scenario, model: observed.model, status, checks, error: observed.error, note: null, observations: observed.observations })
}

const input = await new Response(Bun.stdin.stream()).text()
for (const raw of input.split("\n")) {
  const line = raw.trim()
  if (!line.startsWith("{")) {
    if (line) console.error(line)
    continue
  }
  relay(line)
}
