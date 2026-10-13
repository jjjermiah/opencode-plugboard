#!/usr/bin/env bun
/**
 * Checks the snippet regions of every tracked file under examples/. The rule (examples/_harness/README.md): a region is
 * named `snippet` or `snippet-<name>`, and each name appears once per file, so `<<< file#name` always means one region.
 * Fails on a duplicate name.
 *
 *   bun examples/_harness/check-regions.ts
 */
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")
// `# region name` (Python, shell) or `// #region name` (TypeScript), alone on its line. `endregion` does not match.
const START = /^\s*(?:\/\/\s*)?#\s*region\s+(\S+)\s*$/

const proc = Bun.spawn(["git", "-C", ROOT, "ls-files", "-z", "examples"], { stdout: "pipe", stderr: "pipe" })
const [listing] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
if ((await proc.exited) !== 0) throw new Error("git ls-files failed: run this from a git checkout")

const problems: string[] = []
for (const file of listing.split("\0").filter(Boolean)) {
  const lines = (await Bun.file(resolve(ROOT, file)).text()).split("\n")
  const seen = new Map<string, number[]>()
  lines.forEach((line, index) => {
    const match = START.exec(line)
    if (match) seen.set(match[1]!, [...(seen.get(match[1]!) ?? []), index + 1])
  })
  for (const [name, at] of seen) {
    if (at.length > 1) problems.push(`${file}: region "${name}" is declared on lines ${at.join(", ")}; each name must appear once per file`)
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem)
  process.exit(1)
}
console.log("snippet regions: no duplicate names in examples/")
