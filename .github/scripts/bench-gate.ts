#!/usr/bin/env bun
/**
 * Regression gate for the request-path benchmarks (#118, #315). Compares two runs written by
 * `bun run bench -- --json <file>`, the base commit and the PR head, recorded on the same machine
 * in the same job:
 *
 *   bun .github/scripts/bench-gate.ts <base.json> <head.json> [--summary]
 *
 * A benchmark fails when its head median is more than TOLERANCE times its base median, or when a
 * benchmark ran on the base and not on the head (renamed or deleted: say so in the PR). A
 * benchmark only on the head is new and never fails. `--summary` appends the table to
 * $GITHUB_STEP_SUMMARY (stdout when unset). Exits 1 on a failure.
 */
import { appendFileSync, readFileSync } from "node:fs"

const [baseFile, headFile, ...flags] = process.argv.slice(2)
if (!baseFile || !headFile) throw new Error("usage: bench-gate.ts <base.json> <head.json> [--summary]")
const TOLERANCE = 1.5

interface Result {
  readonly name: string
  readonly p50Ns: number
}
const load = (file: string) => new Map((JSON.parse(readFileSync(file, "utf8")) as Result[]).map((result) => [result.name, result.p50Ns]))
const base = load(baseFile)
const head = load(headFile)

const micro = (ns: number) => (ns >= 1e6 ? `${(ns / 1e6).toFixed(2)} ms` : ns >= 1e3 ? `${(ns / 1e3).toFixed(1)} µs` : `${ns.toFixed(0)} ns`)

const rows: string[] = []
const failures: string[] = []
for (const name of [...new Set([...base.keys(), ...head.keys()])].sort()) {
  const was = base.get(name)
  const now = head.get(name)
  if (now === undefined) {
    failures.push(`${name}: ran on the base but not on the PR head (renamed or deleted)`)
    rows.push(`| \`${name}\` | ${micro(was!)} | missing | | **missing** |`)
    continue
  }
  if (was === undefined) {
    rows.push(`| \`${name}\` | new | ${micro(now)} | | new |`)
    continue
  }
  const ratio = now / was
  const verdict = ratio > TOLERANCE ? "**REGRESSED**" : ratio < 1 / TOLERANCE ? "faster" : "ok"
  if (ratio > TOLERANCE) failures.push(`${name}: ${micro(now)} is ${ratio.toFixed(2)}x the base ${micro(was)} (limit ${TOLERANCE}x)`)
  rows.push(`| \`${name}\` | ${micro(was)} | ${micro(now)} | ${ratio.toFixed(2)}x | ${verdict} |`)
}

const report = [
  "## Request-path benchmarks (#118, #315)",
  "",
  `Median per iteration: the PR's base commit against the PR head, both run in this job on the same runner. Fails above ${TOLERANCE}x. Advisory: the runner is shared, so a failure is a prompt to rerun and look, not proof.`,
  "",
  "| Benchmark | Base | PR head | Ratio | |",
  "|---|--:|--:|--:|---|",
  ...rows,
  "",
  failures.length > 0 ? `**Failed:**\n\n${failures.map((failure) => `- ${failure}`).join("\n")}` : "All benchmarks within the tolerance.",
  "",
].join("\n")

if (flags.includes("--summary") && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report)
console.log(report)

if (failures.length > 0) process.exit(1)
