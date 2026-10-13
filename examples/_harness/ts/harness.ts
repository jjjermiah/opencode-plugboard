/**
 * Runner helpers for TypeScript examples. A runner calls `runAll` with one function per scenario id. The helpers
 * mark each scenario on the capture proxy, evaluate the checks in examples/_shared/scenarios.json against the
 * observations, and print one JSON line per result on stdout. They never write files: run.ts does that, so the
 * Python and TypeScript runners cannot drift.
 */
import scenariosFile from "../../_shared/scenarios.json" with { type: "json" }

export interface Check {
  readonly name: string
  readonly path: string
  readonly equals?: unknown
  readonly containsAny?: ReadonlyArray<string>
  readonly present?: boolean
  readonly number?: boolean
}
export interface Scenario {
  readonly id: string
  readonly name: string
  readonly required: boolean
  readonly models: ReadonlyArray<string>
  readonly routes: string
  readonly prompt: string | null
  readonly observes: ReadonlyArray<string>
  readonly checks: ReadonlyArray<Check>
}
export type Observations = Record<string, unknown>
export interface Gap {
  readonly note: string
  readonly issue: string
}
export interface RunOptions {
  /** Known incompatibilities, by scenario id or `id|model`: a failure becomes `gap` with the note and issue. */
  readonly gaps?: Readonly<Record<string, Gap>>
  /** Scenarios the client does not have, by id, with the reason: reported as `n/a`, nothing is sent. */
  readonly na?: Readonly<Record<string, string>>
  /** Scenarios run once per API, by id, e.g. `{ S1: ["chat", "messages"] }`. The function gets the variant as its second argument. */
  readonly variants?: Readonly<Record<string, ReadonlyArray<string>>>
}

/** The scenarios in their file order. */
export const SCENARIOS = (scenariosFile as { scenarios: Scenario[] }).scenarios

/** Dotted-path lookup into observations. */
function pick(observations: Observations, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => (node !== null && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), observations)
}

function passes(check: Check, value: unknown): boolean {
  if ("equals" in check) return JSON.stringify(value) === JSON.stringify(check.equals)
  if (check.containsAny) return typeof value === "string" && check.containsAny.some((text) => value.toLowerCase().includes(text.toLowerCase()))
  if (check.present) return value !== undefined && value !== null && value !== ""
  if (check.number) return typeof value === "number"
  return false
}

/** Each check of a scenario against its observations: name and whether it held. */
export function evaluate(checks: ReadonlyArray<Check>, observations: Observations): Array<{ name: string; ok: boolean }> {
  return checks.map((check) => ({ name: check.name, ok: passes(check, pick(observations, check.path)) }))
}

/** Tells the capture proxy a scenario starts. Waits there until earlier requests have finished. */
export async function mark(scenario: string, model: string, variant?: string): Promise<void> {
  const url = process.env.PLUGBOARD_CAPTURE_URL
  if (!url) throw new Error("PLUGBOARD_CAPTURE_URL is not set: run this through examples/_harness/run.ts")
  const body = JSON.stringify(variant === undefined ? { scenario, model } : { scenario, model, variant })
  const response = await fetch(`${url}/__mark`, { method: "POST", headers: { "content-type": "application/json" }, body })
  if (!response.ok) throw new Error(`capture refused the mark for ${scenario} on ${model}: ${response.status}`)
}

export function emit(line: Record<string, unknown>): void {
  console.log(JSON.stringify(line))
}

/** Reports the client and runtime the summary records. Runtime is the major version only: a scripted run must not depend on the machine's minor. */
export function emitClient(name: string, version: string): void {
  const [major = "0"] = Bun.version.split(".")
  emit({ kind: "client", name, version, runtime: { name: "bun", version: major } })
}

const errorText = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error))

/**
 * Runs every scenario the runner covers (a function for it, or an n/a reason), on each of its models, in file order.
 * A function gets the model id and returns the observations; the checks decide pass or fail.
 */
export async function runAll(
  functions: Readonly<Record<string, (model: string, variant?: string) => Promise<Observations>>>,
  options: RunOptions = {},
): Promise<void> {
  const planned = SCENARIOS.filter((scenario) => scenario.id in functions || scenario.id in (options.na ?? {}))
  emit({ kind: "plan", scenarios: planned.map((scenario) => scenario.id) })
  for (const scenario of planned) {
    for (const model of scenario.models) {
      for (const variant of options.variants?.[scenario.id] ?? [undefined]) {
        const tag = variant === undefined ? {} : { variant }
        const na = options.na?.[scenario.id]
        if (na !== undefined) {
          emit({ kind: "result", scenario: scenario.id, model, ...tag, status: "n/a", checks: [], error: null, note: na })
          continue
        }
        await mark(scenario.id, model, variant)
        let checks: Array<{ name: string; ok: boolean }> = []
        let error: string | null = null
        let observations: Observations = {}
        try {
          observations = await functions[scenario.id]!(model, variant)
          checks = evaluate(scenario.checks, observations)
        } catch (caught) {
          error = errorText(caught)
        }
        let status: "pass" | "fail" | "gap" = error === null && checks.every((check) => check.ok) ? "pass" : "fail"
        let note: string | null = null
        const gap = options.gaps?.[`${scenario.id}|${model}`] ?? options.gaps?.[scenario.id]
        if (status === "fail" && gap) {
          status = "gap"
          note = `${gap.note} (${gap.issue})`
        }
        emit({ kind: "result", scenario: scenario.id, model, ...tag, status, checks, error, note, observations })
      }
    }
  }
  emit({ kind: "done" })
}
