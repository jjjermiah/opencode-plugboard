/**
 * Relay for runners that cannot import the TypeScript helpers (the Go and .NET runners). The runner marks each scenario
 * itself, the same as the Python and TypeScript helpers, and prints `plan`, `client`, `observation` and `done` lines on
 * stdout. This reads them from stdin, applies the checks in examples/_shared/scenarios.json to each observation
 * (ts/harness.ts evaluate), and prints the lines run.ts reads. The check logic lives here only, so a Go or .NET run cannot
 * drift from the Python and TypeScript runs.
 *
 * A runner may not print a `result` line: the verdict is the relay's, so a runner cannot claim a pass the checks did not
 * make. Any other kind is an error, and the whole input is refused before anything is printed.
 *
 *   go run ./runner | bun ../_harness/ts/relay.ts
 */
import { evaluate, SCENARIOS, type Observations } from "./harness.ts"

const PASS_THROUGH = new Set(["plan", "client", "done"])

interface ObservationLine {
  readonly kind: "observation"
  readonly scenario: string
  readonly model: string
  readonly observations: Observations
  readonly error: string | null
}

function scored(observed: ObservationLine): Record<string, unknown> {
  const spec = SCENARIOS.find((candidate) => candidate.id === observed.scenario)
  if (!spec) throw new Error(`relay: no scenario ${observed.scenario} in scenarios.json`)
  const checks = observed.error === null ? evaluate(spec.checks, observed.observations) : []
  const status = observed.error === null && checks.every((check) => check.ok) ? "pass" : "fail"
  return { kind: "result", scenario: observed.scenario, model: observed.model, status, checks, error: observed.error, note: null, observations: observed.observations }
}

/** Every output line for the input, or an error. Nothing is printed until the whole input has been accepted. */
function relayAll(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line.startsWith("{")) {
      if (line) console.error(line)
      continue
    }
    const data = JSON.parse(line) as { kind?: unknown }
    if (data.kind === "observation") out.push(JSON.stringify(scored(data as ObservationLine)))
    else if (typeof data.kind === "string" && PASS_THROUGH.has(data.kind)) out.push(line)
    else throw new Error(`relay: a runner may print only plan, client, done and observation lines, not ${JSON.stringify(data.kind)}`)
  }
  return out
}

if (import.meta.main) {
  const input = await new Response(Bun.stdin.stream()).text()
  for (const line of relayAll(input)) console.log(line)
}
