#!/usr/bin/env bun
/**
 * Generates the table in examples/README.md between its markers, from the run records (docs/.vitepress/examples-model.ts),
 * and checks that every `<<<` snippet import in docs/ names a file and a region that exist.
 *
 *   bun .github/scripts/examples-index.ts          write the table
 *   bun .github/scripts/examples-index.ts --check  fail when the table is stale, an example has no Shows text, or an import is dead
 *
 * The Shows text is examples/_harness/index.json (one line per example). Everything else comes from runs/.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { type ExampleEntry, type ExampleRun, readExamples, verdictCell } from "../../docs/.vitepress/examples-model.ts"

const ROOT = resolve(import.meta.dir, "../..")
const EXAMPLES = join(ROOT, "examples")
const README = join(EXAMPLES, "README.md")
const DOCS = join(ROOT, "docs")
const START = "<!-- examples-index:start -->"
const END = "<!-- examples-index:end -->"

/** The Shows text per example, from examples/_harness/index.json (keys starting with `_` are comments). */
function showsText(): Record<string, string> {
  const raw = JSON.parse(readFileSync(join(EXAMPLES, "_harness/index.json"), "utf8")) as Record<string, string>
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !key.startsWith("_")))
}

function liveCell(name: string, run: ExampleRun | null): string {
  if (!run) return "not run"
  const dir = run.path.split("/").pop()!
  const status = run.kind === "historical" ? "historical record" : run.verdict!
  return `[\`${dir}\`](${name}/${run.path}/), ${status}`
}

/** The generated table, without its markers. Rows follow the example directory names. */
export function renderTable(entries: ExampleEntry[], shows: Record<string, string>): string {
  const rows = entries.map(
    (entry) =>
      `| [${entry.name}/](${entry.name}/) | ${shows[entry.name] ?? "(no Shows text in examples/_harness/index.json)"} | ${verdictCell(entry.scripted)} | ${liveCell(entry.name, entry.newestLive)} |`,
  )
  return ["| Example | Shows | Scripted | Newest live run |", "| --- | --- | --- | --- |", ...rows].join("\n")
}

/** Every `<<< @/../examples/<file>#<region>` in docs/, with the file it names and whether that region exists there. */
export function snippetProblems(docsDir: string, examplesDir: string): string[] {
  const problems: string[] = []
  const pattern = /<<< @\/\.\.\/examples\/([^\s#]+)#(\S+)/g
  for (const file of markdownFiles(docsDir)) {
    const text = readFileSync(file, "utf8")
    for (const match of text.matchAll(pattern)) {
      const [, path, region] = match
      const where = `${relative(ROOT, file)}: <<< ${path}#${region}`
      const target = join(examplesDir, path!)
      if (!existsFile(target)) {
        problems.push(`${where}: the file does not exist`)
        continue
      }
      const marker = new RegExp(`^\\s*(?:\\/\\/\\s*)?#\\s*region\\s+${escapeRegExp(region!)}\\s*$`, "m")
      if (!marker.test(readFileSync(target, "utf8"))) problems.push(`${where}: no region "${region}" in that file`)
    }
  }
  return problems
}

function existsFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) return []
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return markdownFiles(path)
    return entry.name.endsWith(".md") ? [path] : []
  })
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check")
  const entries = readExamples(EXAMPLES)
  // `--json <path>`: the docs build's copy of the run records (docs/.vitepress/examples.json), read by the example components.
  const jsonAt = process.argv.indexOf("--json")
  if (jsonAt !== -1) {
    writeFileSync(resolve(ROOT, process.argv[jsonAt + 1]!), `${JSON.stringify(entries, null, 2)}\n`)
    return
  }
  const shows = showsText()
  const problems: string[] = []

  for (const entry of entries) {
    if (!(entry.name in shows)) problems.push(`examples/${entry.name}: no Shows text in examples/_harness/index.json`)
  }
  const table = renderTable(entries, shows)
  const readme = readFileSync(README, "utf8")
  const start = readme.indexOf(START)
  const end = readme.indexOf(END)
  if (start === -1 || end === -1 || end < start) {
    problems.push(`examples/README.md has no ${START} ... ${END} block`)
  } else {
    const next = `${readme.slice(0, start + START.length)}\n${table}\n${readme.slice(end)}`
    if (check) {
      if (next !== readme) problems.push("examples/README.md is stale: run bun .github/scripts/examples-index.ts")
    } else {
      writeFileSync(README, next)
      console.log(`examples/README.md: ${entries.length} examples`)
    }
  }
  problems.push(...snippetProblems(DOCS, EXAMPLES))

  if (problems.length > 0) {
    for (const problem of problems) console.error(problem)
    if (check) process.exit(1)
  }
  if (check) console.log(`examples index is current; ${entries.length} examples; all <<< imports in docs/ resolve`)
}

if (import.meta.main) await main()
