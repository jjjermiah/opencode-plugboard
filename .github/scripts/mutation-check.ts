#!/usr/bin/env bun
/**
 * Mutation check (#111): applies each entry of test/mutations/catalogue.ts to a copy of the source
 * and requires the named test files to fail. The working tree is never touched.
 *
 *   bun run mutations                      # every entry
 *   bun run mutations -- --only <id>       # one entry
 *   bun .github/scripts/mutation-check.ts --summary   # also append the table to $GITHUB_STEP_SUMMARY
 *
 * For each entry: the `find` text must occur exactly once in the copy, the named tests must pass
 * before the mutation (otherwise the run proves nothing and the check stops), and after the mutation
 * they must fail (`bun test` exits nonzero and prints at least one `(fail)` line). Anything else is
 * reported as SURVIVED, a real gap in the tests. Exits 1 when any entry survives or cannot be
 * applied.
 */
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MUTATIONS, type Mutation } from "../../test/mutations/catalogue.js"

const root = join(import.meta.dir, "../..")
const args = process.argv.slice(2)
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined
const entries = only ? MUTATIONS.filter((mutation) => mutation.id === only) : [...MUTATIONS]
if (only && entries.length === 0) throw new Error(`no mutation named ${only}`)

interface Run {
  readonly ok: boolean
  readonly failing: number
  readonly output: string
}

/** One `bun test` in `cwd`, over the given files. Failing tests are the `(fail)` lines bun prints. */
async function runTests(cwd: string, files: readonly string[]): Promise<Run> {
  const proc = Bun.spawn(["bun", "test", ...files], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, FORCE_COLOR: "0" } })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const exitCode = await proc.exited
  const output = `${stdout}\n${stderr}`
  return { ok: exitCode === 0, failing: (output.match(/\(fail\)/g) ?? []).length, output }
}

type Verdict = "killed" | "SURVIVED" | "anchor" | "baseline"
interface Row {
  readonly mutation: Mutation
  readonly verdict: Verdict
  readonly detail: string
}

const work = mkdtempSync(join(tmpdir(), "plugboard-mutants-"))
const rows: Row[] = []
try {
  // The suite needs the source, the tests and the preload config. node_modules is linked, not copied.
  for (const path of ["index.ts", "src", "test", "bunfig.toml", "package.json", "tsconfig.json"]) cpSync(join(root, path), join(work, path), { recursive: true })
  symlinkSync(join(root, "node_modules"), join(work, "node_modules"), "dir")

  const files = [...new Set(entries.flatMap((mutation) => mutation.tests))]
  const before = await runTests(work, files)
  if (!before.ok) {
    console.error(before.output)
    throw new Error("the named tests fail before any mutation: fix them first, a kill proves nothing here")
  }

  for (const mutation of entries) {
    const path = join(work, mutation.file)
    const original = readFileSync(path, "utf8")
    const occurrences = original.split(mutation.find).length - 1
    if (occurrences !== 1) {
      rows.push({ mutation, verdict: "anchor", detail: `find text occurs ${occurrences} times in ${mutation.file}, expected 1` })
      continue
    }
    writeFileSync(path, original.replace(mutation.find, () => mutation.replace))
    try {
      const run = await runTests(work, mutation.tests)
      const killed = !run.ok && run.failing > 0
      rows.push({
        mutation,
        verdict: killed ? "killed" : "SURVIVED",
        detail: killed ? `${run.failing} failing test line${run.failing === 1 ? "" : "s"}` : "every named test still passed",
      })
    } finally {
      writeFileSync(path, original)
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}

const table = [
  "## Mutation catalogue (#111)",
  "",
  "Each row breaks one guard in a copy of the source; the named tests must fail. Source: `test/mutations/catalogue.ts`.",
  "",
  "| Entry | Invariant | File | Tests | Result |",
  "|---|---|---|---|---|",
  ...rows.map(({ mutation, verdict, detail }) => `| \`${mutation.id}\` | ${mutation.invariant} | \`${mutation.file}\` | ${mutation.tests.map((t) => `\`${t.replace("test/", "")}\``).join(", ")} | ${verdict === "killed" ? "killed" : `**${verdict}**`}: ${detail} |`),
  "",
  `${rows.filter((row) => row.verdict === "killed").length} of ${rows.length} killed.`,
  "",
].join("\n")
if (args.includes("--summary") && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table)
console.log(table)

const survivors = rows.filter((row) => row.verdict !== "killed")
if (survivors.length > 0) {
  for (const row of survivors) console.error(`not killed: ${row.mutation.id} (${row.verdict}): ${row.detail}`)
  process.exit(1)
}
