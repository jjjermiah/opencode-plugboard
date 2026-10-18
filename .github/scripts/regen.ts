#!/usr/bin/env bun
/**
 * Rebuilds the generated files after a merge, so two lanes that both touched them never resolve them by hand.
 *
 *   bun run regen
 *
 * One foreground command, no flags. In order:
 *   1. The floors files (.github/floors/*.json): a file with conflict markers becomes the per-key maximum of both sides
 *      (floors only go up); a file without markers is left as it is.
 *   2. The test run `bun run validate --only test` does (tests, coverage, then the floor ratchet), with
 *      PLUGBOARD_COMPAT_RESULTS set, so the same run records the client compatibility results.
 *   3. docs/compatibility.md from those results (see its header).
 *   4. The table in examples/README.md (.github/scripts/examples-index.ts), the file CI checks.
 *
 * It prints which of the generated files changed. It does not stage or commit anything: review `git diff`, then commit.
 * Takes about as long as the `test` step of `bun run validate`.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

export const FLOOR_FILES = [".github/floors/test-count-floors.json", ".github/floors/coverage-floor.json"] as const
const GENERATED = ["docs/compatibility.md", "examples/README.md", ...FLOOR_FILES] as const

/** Whether the text has a git conflict marker line. */
export function hasConflict(text: string): boolean {
  return /^<{7}( |$)/m.test(text) && /^={7}$/m.test(text) && /^>{7}( |$)/m.test(text)
}

/** Both sides of a conflicted text: each conflict hunk contributes its "ours" part to one side and its "theirs" part to the other. The diff3 base part is dropped. */
export function conflictSides(text: string): { ours: string; theirs: string } {
  const ours: string[] = []
  const theirs: string[] = []
  let part: "both" | "ours" | "base" | "theirs" = "both"
  for (const line of text.split("\n")) {
    if (/^<{7}( |$)/.test(line)) part = "ours"
    else if (part === "ours" && /^\|{7}( |$)/.test(line)) part = "base"
    else if ((part === "ours" || part === "base") && /^={7}$/.test(line)) part = "theirs"
    else if (part === "theirs" && /^>{7}( |$)/.test(line)) part = "both"
    else {
      if (part === "both" || part === "ours") ours.push(line)
      if (part === "both" || part === "theirs") theirs.push(line)
    }
  }
  return { ours: ours.join("\n"), theirs: theirs.join("\n") }
}

/**
 * The floors file text with each key at the higher value of both sides, or undefined when the text has no conflict markers
 * (nothing to resolve). A side that is not a JSON object of numbers throws: that conflict needs a person.
 */
export function resolveFloors(text: string): string | undefined {
  if (!hasConflict(text)) return undefined
  const { ours, theirs } = conflictSides(text)
  const parse = (side: string, name: string): Record<string, number> => {
    const value: unknown = JSON.parse(side)
    if (typeof value !== "object" || value === null || Object.values(value).some((entry) => typeof entry !== "number")) throw new Error(`the ${name} side is not a JSON object of numbers`)
    return value as Record<string, number>
  }
  const [a, b] = [parse(ours, "ours"), parse(theirs, "theirs")]
  const merged: Record<string, number> = {}
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) merged[key] = Math.max(a[key] ?? 0, b[key] ?? 0)
  return `${JSON.stringify(merged, null, 2)}\n`
}

function run(label: string, cmd: string[], env: Record<string, string> = {}): void {
  console.log(`regen: ${label}`)
  const proc = Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit", env: { ...process.env, ...env } })
  if (proc.exitCode !== 0) {
    console.error(`regen: "${cmd.join(" ")}" failed (exit ${proc.exitCode}). The generated files were not all rebuilt: fix that and run \`bun run regen\` again.`)
    process.exit(1)
  }
}

if (import.meta.main) {
  process.chdir(resolve(import.meta.dir, "../.."))
  const read = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "")
  const before = new Map<string, string>(GENERATED.map((file) => [file, read(file)]))

  for (const file of FLOOR_FILES) {
    let resolved: string | undefined
    try {
      resolved = resolveFloors(read(file))
    } catch (error) {
      console.error(`regen: ${file} has a conflict regen cannot resolve (${(error as Error).message}). Resolve it by hand.`)
      process.exit(1)
    }
    if (resolved !== undefined) {
      writeFileSync(file, resolved)
      console.log(`regen: ${file} had conflict markers, now the per-key maximum of both sides`)
    }
  }

  const dir = mkdtempSync(join(tmpdir(), "plugboard-regen-"))
  try {
    const results = join(dir, "compat.json")
    run("tests, coverage and floor ratchet (bun run validate --only test)", ["bun", ".github/scripts/validate.ts", "--only", "test"], { PLUGBOARD_COMPAT_RESULTS: results })
    run("docs/compatibility.md", ["bun", ".github/scripts/compat-matrix.ts", results, "--docs", "docs/compatibility.md"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  run("examples/README.md", ["bun", ".github/scripts/examples-index.ts"])

  console.log("regen: result")
  let changed = 0
  for (const file of GENERATED) {
    const same = read(file) === before.get(file)
    if (!same) changed++
    console.log(`  ${same ? "unchanged" : "changed  "}  ${file}`)
  }
  // docs/compatibility.md keeps its hand-written Python section and examples/README.md keeps its text around the table, so a
  // conflict there survives the rebuild: name it instead of calling the merge done.
  const stillConflicted = GENERATED.filter((file) => hasConflict(read(file)))
  if (stillConflicted.length > 0) {
    console.error(`regen: conflict markers remain in ${stillConflicted.join(", ")}, in the hand-written text the generator keeps. Resolve them by hand.`)
    process.exit(1)
  }
  console.log(changed === 0 ? "regen: nothing to commit" : "regen: review `git diff`, then commit the changed files")
}
