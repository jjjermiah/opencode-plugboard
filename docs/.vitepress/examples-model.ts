/**
 * Reads the run records under examples/ for the docs (the data loader and the overview) and for the generated index
 * (.github/scripts/examples-index.ts). One reader, so the README table and the site show the same verdicts.
 *
 * A live directory is `runs/live/<date>-<sha>[-n]/`: a summary.json (a harness run), or only a REPORT.md (a historical
 * record copied from the old kit). A scripted run is `runs/scripted/summary.json`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

export interface ScenarioLite {
  readonly id: string
  readonly model: string
  readonly variant: string | null
  readonly status: string
  readonly required: boolean
}

export interface ExampleRun {
  /** `scripted`: the committed deterministic run. `live`: a run against a real provider with a summary. `historical`: a REPORT.md only. */
  readonly kind: "scripted" | "live" | "historical"
  /** The run directory's name relative to the example, e.g. `runs/live/2026-10-13-50219b1`. */
  readonly path: string
  readonly date: string | null
  readonly commit: string | null
  readonly verdict: string | null
  readonly client: { readonly name: string; readonly version: string } | null
  readonly plugboard: { readonly version: string; readonly commit: string } | null
  readonly scenarios: ReadonlyArray<ScenarioLite>
}

export interface ExampleEntry {
  readonly name: string
  readonly scripted: ExampleRun | null
  /** The newest live directory (a summary or a historical record), by date and then name. */
  readonly newestLive: ExampleRun | null
}

const DATE_IN_NAME = /^(\d{4}-\d{2}-\d{2})-([0-9a-f]+)/

interface SummaryFile {
  date?: string
  verdict?: string
  client?: { name: string; version: string }
  plugboard?: { version: string; commit: string }
  scenarios?: Array<{ id: string; model: string; variant?: string; status: string; required: boolean }>
}

function runFrom(kind: ExampleRun["kind"], path: string, dir: string): ExampleRun | null {
  const name = path.split("/").pop()!
  const named = DATE_IN_NAME.exec(name)
  const summaryFile = join(dir, path, "summary.json")
  if (!existsSync(summaryFile)) {
    if (kind !== "historical") return null
    return { kind, path, date: named?.[1] ?? null, commit: named?.[2] ?? null, verdict: null, client: null, plugboard: null, scenarios: [] }
  }
  const summary = JSON.parse(readFileSync(summaryFile, "utf8")) as SummaryFile
  return {
    kind,
    path,
    date: summary.date ?? named?.[1] ?? null,
    commit: summary.plugboard?.commit ?? named?.[2] ?? null,
    verdict: summary.verdict ?? null,
    client: summary.client ?? null,
    plugboard: summary.plugboard ?? null,
    scenarios: (summary.scenarios ?? []).map((row) => ({ id: row.id, model: row.model, variant: row.variant ?? null, status: row.status, required: row.required })),
  }
}

/** Every example directory under `examples/` (not `_`-prefixed), sorted by name. */
export function readExamples(examplesDir: string): ExampleEntry[] {
  return readdirSync(examplesDir)
    .filter((name) => !name.startsWith("_") && statSync(join(examplesDir, name)).isDirectory())
    .sort()
    .map((name) => {
      const dir = join(examplesDir, name)
      const scriptedPath = "runs/scripted"
      const scripted = existsSync(join(dir, scriptedPath, "summary.json")) ? runFrom("scripted", scriptedPath, dir) : null
      const liveRoot = join(dir, "runs/live")
      const live: ExampleRun[] = []
      if (existsSync(liveRoot)) {
        for (const entry of readdirSync(liveRoot).sort()) {
          const path = `runs/live/${entry}`
          const hasSummary = existsSync(join(dir, path, "summary.json"))
          const hasReport = existsSync(join(dir, path, "REPORT.md"))
          if (!hasSummary && !hasReport) continue
          const run = runFrom(hasSummary ? "live" : "historical", path, dir)
          if (run) live.push(run)
        }
      }
      // Newest first: date, then the plugboard version (the same-day runs of two commits), then directory name (a `-2`
      // suffix sorts after its base name).
      live.sort((a, b) => compareRuns(b, a))
      return { name, scripted, newestLive: live[0] ?? null }
    })
}

/** Ordering for `Array.sort`: a run after another when its date is later, then its plugboard version is higher, then its name. */
function compareRuns(a: ExampleRun, b: ExampleRun): number {
  const byDate = (a.date ?? "").localeCompare(b.date ?? "")
  if (byDate !== 0) return byDate
  const byVersion = compareVersions(a.plugboard?.version ?? "0", b.plugboard?.version ?? "0")
  if (byVersion !== 0) return byVersion
  return a.path.localeCompare(b.path)
}

function compareVersions(a: string, b: string): number {
  const parts = (text: string) => text.split(".").map((part) => Number.parseInt(part, 10) || 0)
  const left = parts(a)
  const right = parts(b)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** The verdict as the tables print it: a word, or `not run`. */
export function verdictCell(run: ExampleRun | null): string {
  if (!run) return "not run"
  return run.verdict ?? "historical record"
}
