/**
 * Relay for runners that cannot import the TypeScript helpers (the Go and .NET runners). The runner marks each scenario
 * itself, the same as the Python and TypeScript helpers, and prints `plan`, `client`, `observation` and `done` lines on
 * stdout. This reads them from stdin, scores each observation with the same rule runAll uses (ts/harness.ts scoreRow),
 * and prints the lines run.ts reads. The check logic lives in harness.ts only, so a Go or .NET run cannot drift from the
 * Python and TypeScript runs.
 *
 * The plan line may carry the runner's known gaps, n/a scenarios, unobserved checks and variants, with the same meaning
 * as RunOptions (#370). The relay validates them against the planned scenarios and emits the n/a rows itself.
 *
 * A runner may not print a `result` line: every verdict is the relay's. The plan line may declare the runner's limits (gaps,
 * n/a, unobserved checks), and those are trusted with the same reach as RunOptions in the TypeScript and Python runners, so
 * a verdict is the checks' only within what the plan declares. Any other kind is an error, and the whole input is refused
 * before anything is printed.
 *
 *   go run ./runner | bun ../_harness/ts/relay.ts
 */
import { checkUnobserved, type Observations, type RunOptions, SCENARIOS, type Scenario, scoreRow } from "./harness.ts"

const PASS_THROUGH = new Set(["plan", "client", "done"])

type Line = Record<string, unknown>

function resultLine(scenario: string, model: string, variant: string | undefined, fields: Line): Line {
  return { kind: "result", scenario, model, ...(variant === undefined ? {} : { variant }), ...fields }
}

/** The n/a rows the plan declares, one per model and variant of each planned scenario (as runAll emits them). */
function naRows(options: RunOptions, planned: ReadonlyArray<Scenario>): Line[] {
  return planned.flatMap((scenario) => {
    const reason = options.na?.[scenario.id]
    if (reason === undefined) return []
    return scenario.models.flatMap((model) =>
      (options.variants?.[scenario.id] ?? [undefined]).map((variant) => resultLine(scenario.id, model, variant, { status: "n/a", checks: [], error: null, note: reason })),
    )
  })
}

function relayAll(text: string): string[] {
  const lines: Line[] = []
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line.startsWith("{")) {
      if (line) console.error(line)
      continue
    }
    lines.push(JSON.parse(line) as Line)
  }
  for (const data of lines) {
    if (data.kind !== "observation" && !(typeof data.kind === "string" && PASS_THROUGH.has(data.kind))) {
      throw new Error(`relay: a runner may print only plan, client, done and observation lines, not ${JSON.stringify(data.kind)}`)
    }
  }

  const plan = lines.find((data) => data.kind === "plan") as (Line & { scenarios?: string[] } & RunOptions) | undefined
  const options: RunOptions = plan ? { gaps: plan.gaps, na: plan.na, unobserved: plan.unobserved, variants: plan.variants } : {}
  const planIds = new Set(plan?.scenarios ?? lines.filter((data) => data.kind === "observation").map((data) => String(data.scenario)))
  const planned = SCENARIOS.filter((scenario) => planIds.has(scenario.id))
  checkUnobserved(options, planned)

  const out: string[] = []
  for (const data of lines) {
    if (data.kind === "observation") {
      const scenario = SCENARIOS.find((candidate) => candidate.id === data.scenario)
      if (!scenario) throw new Error(`relay: no scenario ${String(data.scenario)} in scenarios.json`)
      // With a plan, an observation must be a scenario the plan runs: not an n/a one, and not one it leaves out (#370).
      if (plan && (!plan.scenarios?.includes(scenario.id) || options.na?.[scenario.id] !== undefined)) {
        throw new Error(`relay: the plan does not run ${scenario.id}, so an observation for it is refused`)
      }
      const variant = typeof data.variant === "string" ? data.variant : undefined
      const observations = (data.observations ?? {}) as Observations
      // A runner's error is text or absent. Anything else is malformed, and is refused rather than scored as a success.
      if (data.error !== undefined && data.error !== null && typeof data.error !== "string") {
        throw new Error(`relay: the error of ${scenario.id} is not text`)
      }
      const error = typeof data.error === "string" ? data.error : null
      const row = scoreRow(scenario, String(data.model), variant, options, { observations, error })
      out.push(JSON.stringify(resultLine(scenario.id, String(data.model), variant, { status: row.status, checks: row.checks, error, note: row.note, observations })))
    } else if (data.kind === "plan") {
      out.push(JSON.stringify(data))
      for (const row of naRows(options, planned)) out.push(JSON.stringify(row))
    } else {
      out.push(JSON.stringify(data))
    }
  }
  return out
}

if (import.meta.main) {
  const input = await new Response(Bun.stdin.stream()).text()
  for (const line of relayAll(input)) console.log(line)
}

export { relayAll }
