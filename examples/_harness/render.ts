/**
 * The one writer for `runs/`. It validates the summary against run.schema.json, refuses to write any file that
 * contains the app key literal, renders summary.md, and only then writes. Nothing else in the harness touches
 * the run directories.
 */
import { existsSync, readdirSync } from "node:fs"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import Ajv2020 from "ajv/dist/2020"
import { canonicalJson, type Transcript } from "./normalise.ts"

export type Status = "pass" | "fail" | "gap" | "n/a"

export interface ScenarioRow {
  readonly id: string
  readonly model: string
  /** The API, for a scenario an example runs once per API. */
  readonly variant?: string
  readonly required: boolean
  readonly status: Status
  readonly checks: ReadonlyArray<{ readonly name: string; readonly ok: boolean }>
  readonly note: string | null
  readonly error: string | null
  readonly transcript: string | null
  readonly duration_ms?: number
}

export interface RunSummary {
  readonly schema: 1
  readonly example: string
  readonly target: "scripted" | "live"
  readonly client: { readonly name: string; readonly version: string; readonly runtime: { readonly name: string; readonly version: string } }
  readonly models: ReadonlyArray<string>
  readonly verdict: "pass" | "partial" | "fail"
  readonly date?: string
  readonly plugboard?: { readonly version: string; readonly commit: string }
  /** The OpenCode version of the server under test; null when the server does not expose it (#335). */
  readonly opencode?: string | null
  readonly scenarios: ReadonlyArray<ScenarioRow>
}

const SCHEMA_URL = new URL("./run.schema.json", import.meta.url)
let compiled: ReturnType<Ajv2020["compile"]> | undefined

/** The verdict: fail when a required scenario failed; partial when a scenario is a gap or an optional one failed; else pass. */
export function verdictOf(rows: ReadonlyArray<ScenarioRow>): RunSummary["verdict"] {
  if (rows.some((row) => row.required && row.status === "fail")) return "fail"
  if (rows.some((row) => row.status === "gap" || row.status === "fail")) return "partial"
  return "pass"
}

export async function validateSummary(summary: unknown): Promise<void> {
  if (!compiled) compiled = new Ajv2020({ allErrors: true }).compile(await Bun.file(SCHEMA_URL).json())
  if (!compiled(summary)) throw new Error(`summary.json does not match run.schema.json: ${JSON.stringify(compiled.errors)}`)
}

/** Markdown for one run: header, scenario table, then every failure and gap with its exact error text. */
export function renderSummaryMd(summary: RunSummary): string {
  const lines: string[] = []
  const client = summary.client
  lines.push(`# ${summary.example} · ${summary.target}`, "")
  lines.push(`Verdict: **${summary.verdict}** · ${client.name} ${client.version} on ${client.runtime.name} ${client.runtime.version} · models: ${summary.models.join(", ")}`)
  if (summary.date)
    lines.push(
      `Date: ${summary.date}${summary.plugboard ? ` · plugboard ${summary.plugboard.version} (${summary.plugboard.commit})` : ""}${summary.opencode ? ` · OpenCode ${summary.opencode}` : summary.opencode === null ? " · OpenCode version not recorded (the server does not expose it)" : ""}`,
    )
  lines.push("", "| Scenario | Model | Required | Status | Checks |", "| --- | --- | --- | --- | --- |")
  for (const row of summary.scenarios) {
    const ok = row.checks.filter((check) => check.ok).length
    const label = row.variant === undefined ? row.id : `${row.id} (${row.variant})`
    lines.push(`| ${label} | ${row.model} | ${row.required ? "yes" : "no"} | ${row.status} | ${row.checks.length === 0 ? "" : `${ok}/${row.checks.length}`} |`)
  }
  const notable = summary.scenarios.filter((row) => row.status === "fail" || row.status === "gap" || (row.status === "pass" && row.note))
  if (notable.length > 0) {
    lines.push("", "## Failures and gaps", "")
    for (const row of notable) {
      lines.push(`### ${row.variant === undefined ? row.id : `${row.id} (${row.variant})`} on ${row.model}: ${row.status}`, "")
      if (row.note) lines.push(row.note, "")
      const failed = row.checks.filter((check) => !check.ok).map((check) => check.name)
      if (failed.length > 0) lines.push(`Failed checks: ${failed.join("; ")}`, "")
      if (row.error) lines.push("```text", row.error, "```", "")
    }
  }
  return `${lines.join("\n")}\n`
}

/** `run` for a directory with a summary, `historical record` for a dated REPORT.md alone, `none` otherwise. */
export function runKind(dir: string): "run" | "historical record" | "none" {
  if (existsSync(join(dir, "summary.json"))) return "run"
  return existsSync(join(dir, "REPORT.md")) ? "historical record" : "none"
}

export interface RunOutput {
  readonly dir: string
  readonly summary: RunSummary
  /** File name under `transcripts/` (without the directory) to transcript. */
  readonly transcripts: Readonly<Record<string, Transcript>>
  /** The app key that must never be written. */
  readonly secret: string
  /** Scripted runs replace their transcripts; live runs never reuse a directory, so this is always a new one. */
  readonly replaceTranscripts: boolean
}

/** Validates and renders everything first, refuses if the key literal appears, then writes. */
export async function writeRun(output: RunOutput): Promise<void> {
  await validateSummary(output.summary)
  const files = new Map<string, string>()
  files.set("summary.json", canonicalJson(output.summary))
  files.set("summary.md", renderSummaryMd(output.summary))
  for (const [name, transcript] of Object.entries(output.transcripts)) files.set(`transcripts/${name}`, canonicalJson(transcript))
  if (output.secret.length > 0) {
    for (const [name, text] of files) {
      if (text.includes(output.secret)) throw new Error(`refusing to write ${name}: the app key appears in it`)
    }
  }
  if (output.replaceTranscripts) await rm(join(output.dir, "transcripts"), { recursive: true, force: true })
  for (const [name, text] of files) {
    const path = join(output.dir, name)
    await mkdir(join(path, ".."), { recursive: true })
    await writeFile(path, text)
  }
}

/** Lists the transcript files a run directory holds, for tests and the index. */
export function transcriptFiles(dir: string): string[] {
  const folder = join(dir, "transcripts")
  return existsSync(folder) ? readdirSync(folder).sort() : []
}
