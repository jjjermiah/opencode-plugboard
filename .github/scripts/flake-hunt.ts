#!/usr/bin/env bun
/**
 * Flake hunt (#115): finds tests whose outcome depends on order, on other files, or on luck.
 *
 *   bun run flake-hunt                                  # full suite: serial, shuffled, parallel, each file alone
 *   bun run flake-hunt -- --runs 3 --seed 100           # 3 shuffles, seeds 101..103
 *   bun run flake-hunt -- --file test/runtime/plugin.test.ts --runs 20   # repeat one file, shuffled
 *   bun run flake-hunt -- --summary                     # also append the report to $GITHUB_STEP_SUMMARY
 *
 * Runs `bun test` in several modes and reads the `(pass)` / `(fail)` lines it prints:
 *   - serial: the default order, the reference run;
 *   - shuffled: `--randomize --seed=N` (Bun's own shuffle), N = base + i;
 *   - parallel: `--parallel`, the files in worker processes;
 *   - alone: each test file by itself (the isolation probe: a test that needs another file's leftover
 *     state fails alone; a test that another file breaks passes alone).
 *
 * A test is flagged when its outcome differs between runs of the full suite (order-dependent), when
 * it fails in every run (a broken test, reported here too), or when its alone outcome differs from
 * its outcome with the suite. Exits 1 when anything is flagged, and 2 when a run prints no results
 * (a broken run must not look green). The shuffle seeds are printed, so a failing order can be
 * replayed with `bun test --randomize --seed=<n>`.
 */
import { appendFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "../..")
const args = process.argv.slice(2)
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const runs = Number(flag("--runs") ?? 10)
const base = Number(flag("--seed") ?? 0)
const only = flag("--file")
const summary = args.includes("--summary")
if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer")
if (!Number.isInteger(base)) throw new Error("--seed must be an integer")

interface Run {
  readonly label: string
  readonly passed: Set<string>
  readonly failed: Set<string>
  readonly ran: number
}

/** One `bun test` run. Throws when the run printed no results (a compile error or a crash). */
async function run(label: string, extra: readonly string[], files: readonly string[]): Promise<Run> {
  const proc = Bun.spawn(["bun", "test", ...extra, ...files], { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, FORCE_COLOR: "0" } })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  await proc.exited
  const output = `${stdout}\n${stderr}`
  const passed = new Set<string>()
  const failed = new Set<string>()
  // Skipped and todo tests are results too: a file whose tests are all skipped (the live suite without PLUGBOARD_LIVE) ran fine.
  let results = 0
  for (const line of output.split("\n")) {
    const match = /^\((pass|fail|skip|todo)\) (.+?)(?: \[[\d.]+m?s\])?$/.exec(line.trim())
    if (!match) continue
    results++
    if (match[1] === "pass") passed.add(match[2]!)
    else if (match[1] === "fail") failed.add(match[2]!)
  }
  const ranLine = /Ran (\d+) tests? across/.exec(output)
  if (!ranLine || results === 0) throw new Error(`${label}: no test results in the output\n${output.slice(-2000)}`)
  return { label, passed, failed, ran: Number(ranLine[1]) }
}

const allFiles = only ? [only] : (await Array.fromAsync(new Bun.Glob("test/**/*.test.ts").scan({ cwd: root }))).sort()
if (allFiles.length === 0) throw new Error("no test files found")

const scope = only ? [only] : allFiles
const full: Run[] = [await run("serial", [], scope)]
for (let i = 1; i <= runs; i++) {
  const seed = base + i
  full.push(await run(`shuffle seed=${seed}`, ["--randomize", `--seed=${seed}`], scope))
}
// Parallel and isolation are for the whole suite: one file has no other file to interact with.
if (!only) full.push(await run("parallel", ["--parallel"], allFiles))

const alone: Run[] = []
if (!only) for (const file of allFiles) alone.push(await run(`alone ${file}`, [], [file]))

// Outcome of each name in the runs of the whole suite: a name failing in some runs and passing in others.
const outcomes = new Map<string, { fails: string[]; passes: string[] }>()
for (const result of full)
  for (const name of new Set([...result.passed, ...result.failed])) {
    const entry = outcomes.get(name) ?? { fails: [], passes: [] }
    ;(result.failed.has(name) ? entry.fails : entry.passes).push(result.label)
    outcomes.set(name, entry)
  }

interface Flag {
  readonly test: string
  readonly kind: string
  readonly detail: string
}
const flags: Flag[] = []
for (const [name, { fails, passes }] of outcomes) {
  if (fails.length > 0 && passes.length > 0)
    flags.push({ test: name, kind: "order-dependent", detail: `fails in ${fails.length} of ${fails.length + passes.length} runs (${fails.slice(0, 3).join(", ")}${fails.length > 3 ? ", ..." : ""})` })
  else if (fails.length > 0) flags.push({ test: name, kind: "fails every run", detail: `fails in all ${fails.length} runs` })
}
// Isolation: a test whose outcome alone differs from its outcome with the suite.
for (const result of alone) {
  const file = result.label.replace(/^alone /, "")
  for (const name of new Set([...result.passed, ...result.failed])) {
    const suite = outcomes.get(name)
    if (!suite) continue
    const aloneFails = result.failed.has(name)
    const suiteFails = suite.fails.length > 0
    if (aloneFails && !suiteFails) flags.push({ test: name, kind: "isolation: fails alone", detail: `${file}: fails alone, passes with the suite` })
    if (!aloneFails && suiteFails) flags.push({ test: name, kind: "isolation: fails only with others", detail: `${file}: passes alone, fails with the suite` })
  }
}

const table = [
  "## Flake hunt (#115)",
  "",
  only ? `Repeated ${only} with shuffled orders.` : `Full suite: 1 serial, ${runs} shuffled, 1 parallel run; each of ${allFiles.length} files alone.`,
  "",
  "| Run | Tests | Failing |",
  "|---|--:|--:|",
  ...full.map((result) => `| ${result.label} | ${result.ran} | ${result.failed.size} |`),
  "",
  flags.length === 0 ? "No test depends on order, on other files, or fails every run." : `**${flags.length} flagged:**`,
  ...(flags.length === 0 ? [] : ["", "| Test | Finding | Detail |", "|---|---|---|", ...flags.map((flag) => `| \`${flag.test}\` | ${flag.kind} | ${flag.detail} |`)]),
  "",
].join("\n")
if (summary && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table)
console.log(table)
if (flags.length > 0) process.exit(1)
