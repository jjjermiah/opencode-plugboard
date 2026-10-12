#!/usr/bin/env bun
/**
 * Regression gate for the request-path benchmarks (#118). Compares a run written by
 * `bun run bench -- --json <file>` with `.github/floors/bench-baseline.json`:
 *
 *   bun .github/scripts/bench-gate.ts <run.json> [--summary] [--update]
 *
 * A benchmark fails when its median is more than TOLERANCE times its baseline, or when a baseline
 * entry did not run (renamed or deleted: update the baseline). The tolerance is generous on
 * purpose: the baseline comes from one machine and CI runners differ, so this catches large
 * regressions, not noise. `--update` rewrites the baseline from this run (commit it with the
 * change that moved the numbers). `--summary` appends the table to $GITHUB_STEP_SUMMARY (stdout
 * when unset). Exits 1 on a failure.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [file, ...flags] = process.argv.slice(2)
if (!file) throw new Error("usage: bench-gate.ts <run.json> [--summary] [--update]")
const TOLERANCE = 2
const BASELINE = join(import.meta.dir, "../floors/bench-baseline.json")

interface Result {
  readonly name: string
  readonly p50Ns: number
}
const run = JSON.parse(readFileSync(file, "utf8")) as Result[]
const current = new Map(run.map((result) => [result.name, result.p50Ns]))
const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, number>

const micro = (ns: number) => (ns >= 1e6 ? `${(ns / 1e6).toFixed(2)} ms` : ns >= 1e3 ? `${(ns / 1e3).toFixed(1)} µs` : `${ns.toFixed(0)} ns`)

const rows: string[] = []
const failures: string[] = []
for (const name of [...new Set([...Object.keys(baseline), ...current.keys()])].sort()) {
  const was = baseline[name]
  const now = current.get(name)
  if (now === undefined) {
    failures.push(`${name}: in the baseline but did not run`)
    rows.push(`| \`${name}\` | ${micro(was!)} | missing | | **missing** |`)
    continue
  }
  if (was === undefined) {
    rows.push(`| \`${name}\` | new | ${micro(now)} | | new |`)
    continue
  }
  const ratio = now / was
  const verdict = ratio > TOLERANCE ? "**REGRESSED**" : ratio < 1 / TOLERANCE ? "faster" : "ok"
  if (ratio > TOLERANCE) failures.push(`${name}: ${micro(now)} is ${ratio.toFixed(2)}x the baseline ${micro(was)} (limit ${TOLERANCE}x)`)
  rows.push(`| \`${name}\` | ${micro(was)} | ${micro(now)} | ${ratio.toFixed(2)}x | ${verdict} |`)
}

const report = [
  "## Request-path benchmarks (#118)",
  "",
  `Median per iteration against \`.github/floors/bench-baseline.json\`. Fails above ${TOLERANCE}x. Advisory: runners differ from the machine that wrote the baseline.`,
  "",
  "| Benchmark | Baseline | This run | Ratio | |",
  "|---|--:|--:|--:|---|",
  ...rows,
  "",
  failures.length > 0 ? `**Failed:**\n\n${failures.map((failure) => `- ${failure}`).join("\n")}` : "All benchmarks within the tolerance.",
  "",
].join("\n")

if (flags.includes("--summary") && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report)
console.log(report)

if (flags.includes("--update")) {
  const next = Object.fromEntries(run.map((result) => [result.name, Math.round(result.p50Ns)]).sort(([a], [b]) => (a as string).localeCompare(b as string)))
  writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`Baseline rewritten from this run: commit .github/floors/bench-baseline.json.`)
} else if (failures.length > 0) process.exit(1)
