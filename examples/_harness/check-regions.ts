#!/usr/bin/env bun
/**
 * Checks the snippet regions of the tracked files under examples/ (not Markdown: its prose quotes the markers). The rule
 * (examples/_harness/README.md, Snippet regions): a region is named `snippet` or `snippet-<name>`, with a kebab-case
 * name; each name appears once per file; regions do not nest; every `endregion` closes the region it names. So
 * `<<< file#name` always means one region, and VitePress never includes a whole file by mistake.
 *
 *   bun examples/_harness/check-regions.ts
 */
import { resolve } from "node:path"

// `# region name` (Python, shell) or `// #region name` (TypeScript), alone on its line. `endregion` does not match START.
const START = /^\s*(?:\/\/\s*)?#\s*region\s+(\S+)\s*$/
const END = /^\s*(?:\/\/\s*)?#\s*endregion\s+(\S+)\s*$/
const NAME = /^snippet(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/

/** The rule violations in one file's text, each with its file and line. Empty when the file is fine. */
export function regionProblems(file: string, text: string): string[] {
  const problems: string[] = []
  const firstLine = new Map<string, number>()
  const open: Array<{ name: string; line: number }> = []
  text.split("\n").forEach((line, index) => {
    const at = `${file}:${index + 1}`
    const start = START.exec(line)
    const end = END.exec(line)
    if (start) {
      const name = start[1]!
      if (!NAME.test(name)) problems.push(`${at}: region "${name}" must be "snippet" or "snippet-<name>" in kebab-case`)
      const outer = open.at(-1)
      if (outer) problems.push(`${at}: region "${name}" starts inside region "${outer.name}" (line ${outer.line}); regions do not nest`)
      const first = firstLine.get(name)
      if (first === undefined) firstLine.set(name, index + 1)
      else problems.push(`${at}: region "${name}" is also declared on line ${first}; each name must appear once per file`)
      open.push({ name, line: index + 1 })
    } else if (end) {
      const name = end[1]!
      const top = open.pop()
      if (!top) problems.push(`${at}: endregion "${name}" has no region open`)
      else if (top.name !== name) problems.push(`${at}: endregion "${name}" closes region "${top.name}" (line ${top.line})`)
    }
  })
  for (const left of open) problems.push(`${file}:${left.line}: region "${left.name}" is never closed`)
  return problems
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dir, "../..")
  const proc = Bun.spawn(["git", "-C", root, "ls-files", "-z", "examples"], { stdout: "pipe", stderr: "pipe" })
  const [listing] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  if ((await proc.exited) !== 0) throw new Error("git ls-files failed: run this from a git checkout")

  const problems: string[] = []
  for (const file of listing.split("\0").filter((name) => name && !name.endsWith(".md"))) {
    problems.push(...regionProblems(file, await Bun.file(resolve(root, file)).text()))
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem)
    process.exit(1)
  }
  console.log("snippet regions: names, pairing and nesting pass in examples/")
}

if (import.meta.main) await main()
