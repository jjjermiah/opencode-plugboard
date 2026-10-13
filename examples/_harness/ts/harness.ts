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
  /**
   * Known incompatibilities, by scenario id, `id|model` or `id|variant`: a failure becomes `gap` with the note and
   * issue. Pass a different set per target when a gap differs (the runner knows the target from PLUGBOARD_TARGET).
   */
  readonly gaps?: Readonly<Record<string, Gap>>
  /** Scenarios the client does not have, by id, with the reason: reported as `n/a`, nothing is sent. */
  readonly na?: Readonly<Record<string, string>>
  /** Scenarios run once per API, by id, e.g. `{ S1: ["chat", "messages"] }`. The function gets the variant as its second argument. */
  readonly variants?: Readonly<Record<string, ReadonlyArray<string>>>
  /**
   * Checks the client cannot observe, by `id` (every model and variant of the scenario) or `id|variant`: check name to the
   * reason. Such a check is left out of its row, and the note names it, so the row passes on what the client does expose.
   * For a permanent client limitation, not a bug (#370).
   */
  readonly unobserved?: Readonly<Record<string, Readonly<Record<string, string>>>>
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
 * Refuses an `unobserved` entry that names no planned scenario, variant or check, or that would drop every check of its row:
 * a renamed check must not leave a stale entry, and a row with no checks must not pass vacuously.
 */
function checkUnobserved(options: RunOptions, planned: ReadonlyArray<Scenario>): void {
  for (const [key, names] of Object.entries(options.unobserved ?? {})) {
    const [id = "", variant] = key.split("|")
    const scenario = planned.find((candidate) => candidate.id === id)
    const variantsOf = options.variants?.[id] ?? []
    if (!scenario || (variant !== undefined && !variantsOf.includes(variant))) {
      throw new Error("unobserved " + key + " names no planned scenario variant")
    }
    for (const name of Object.keys(names)) {
      if (!scenario.checks.some((check) => check.name === name)) throw new Error("unobserved " + key + " names no check \"" + name + "\"")
    }
    if (Object.keys(names).length >= scenario.checks.length) throw new Error("unobserved " + key + " would drop every check of the row")
  }
}

/** The checks a row leaves out, by name, with the reason (RunOptions.unobserved). */
function unobservedFor(options: RunOptions, scenario: string, variant?: string): Readonly<Record<string, string>> {
  return (variant === undefined ? undefined : options.unobserved?.[scenario + "|" + variant]) ?? options.unobserved?.[scenario] ?? {}
}

/**
 * Runs every scenario the runner covers (a function for it, or an n/a reason), on each of its models, in file order.
 * A function gets the model id and returns the observations; the checks decide pass or fail.
 */
export async function runAll(
  functions: Readonly<Record<string, (model: string, variant?: string) => Promise<Observations>>>,
  options: RunOptions = {},
): Promise<void> {
  const planned = SCENARIOS.filter((scenario) => scenario.id in functions || scenario.id in (options.na ?? {}))
  checkUnobserved(options, planned)
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
        const unobserved = unobservedFor(options, scenario.id, variant)
        try {
          observations = await functions[scenario.id]!(model, variant)
          checks = evaluate(scenario.checks.filter((check) => !(check.name in unobserved)), observations)
        } catch (caught) {
          error = errorText(caught)
        }
        let status: "pass" | "fail" | "gap" = error === null && checks.every((check) => check.ok) ? "pass" : "fail"
        let note: string | null = null
        const gap = options.gaps?.[`${scenario.id}|${model}`] ?? (variant === undefined ? undefined : options.gaps?.[`${scenario.id}|${variant}`]) ?? options.gaps?.[scenario.id]
        if (status === "fail" && gap) {
          status = "gap"
          note = `${gap.note} (${gap.issue})`
        }
        if (note === null && Object.keys(unobserved).length > 0) note = Object.entries(unobserved).map(([name, why]) => "not checked, " + name + ": " + why).join("; ")
        emit({ kind: "result", scenario: scenario.id, model, ...tag, status, checks, error, note, observations })
      }
    }
  }
  emit({ kind: "done" })
}
