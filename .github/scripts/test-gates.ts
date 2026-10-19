#!/usr/bin/env bun
/**
 * Ratcheting gates on one test run (#110 test counts per layer, #100 coverage):
 *
 *   bun test --coverage --coverage-reporter=lcov --coverage-dir=<dir> --reporter=junit --reporter-outfile=<dir>/junit.xml
 *   bun .github/scripts/test-gates.ts <dir> [--summary] [--ratchet]
 *
 * - Test counts: each layer (a directory under test/) must keep at least the tests recorded in
 *   .github/floors/test-count-floors.json, so deleting or skipping tests fails CI instead of passing quietly.
 * - Coverage: line and function coverage of index.ts and src/ must stay at or above
 *   .github/floors/coverage-floor.json.
 *
 * Floors only go up. `--ratchet` raises them to the current values (never lowers them); commit the
 * result with the tests that earned it. `--summary` appends the tables to $GITHUB_STEP_SUMMARY
 * (stdout when unset). Exits 1 when a floor is not met.
 */
import { XMLParser } from "fast-xml-parser"
import parseLcov, { type LcovFile } from "lcov-parse"
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const [dir, ...flags] = process.argv.slice(2)
if (!dir) throw new Error("usage: test-gates.ts <dir with junit.xml and lcov.info> [--summary] [--ratchet]")
const root = join(import.meta.dir, "../..")
const COUNT_FLOORS = join(root, ".github/floors/test-count-floors.json")
const COVERAGE_FLOOR = join(root, ".github/floors/coverage-floor.json")

interface Coverage {
  readonly lines: number
  readonly functions: number
}

// ---------------------------------------------------------------- test counts per layer

interface Suite {
  readonly file?: string
  readonly tests?: number
  readonly skipped?: number
}
const junit = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", parseAttributeValue: true, isArray: (name) => name === "testsuite" }).parse(
  readFileSync(join(dir, "junit.xml"), "utf8"),
) as {
  testsuites: { testsuite?: Suite[] }
}
/** Tests that ran per layer: top-level suites are files; skipped and todo tests do not count. */
const counts: Record<string, number> = {}
for (const suite of junit.testsuites.testsuite ?? []) {
  const layer = /^test\/([^/]+)\//.exec(suite.file ?? "")?.[1]
  if (layer) counts[layer] = (counts[layer] ?? 0) + (suite.tests ?? 0) - (suite.skipped ?? 0)
}
const countFloors = JSON.parse(readFileSync(COUNT_FLOORS, "utf8")) as Record<string, number>

// ---------------------------------------------------------------- coverage

const files = await new Promise<LcovFile[]>((resolve, reject) => parseLcov(join(dir, "lcov.info"), (error, data) => (error ? reject(new Error(String(error))) : resolve(data ?? []))))
const relative = (file: string) => (file.startsWith(root) ? file.slice(root.length + 1) : file)
const percent = (hit: number, found: number) => (found === 0 ? 100 : Math.floor((hit / found) * 1000) / 10)
const measure = (group: LcovFile[]): Coverage => ({
  lines: percent(
    group.reduce((sum, file) => sum + file.lines.hit, 0),
    group.reduce((sum, file) => sum + file.lines.found, 0),
  ),
  functions: percent(
    group.reduce((sum, file) => sum + file.functions.hit, 0),
    group.reduce((sum, file) => sum + file.functions.found, 0),
  ),
})
const packaged = files.filter((file) => /^(index\.ts|src\/)/.test(relative(file.file)))
const total = measure(packaged)
/** Per area of src/ (`src/session`, `src` for top-level files), for the summary. */
const areas = new Map<string, LcovFile[]>()
for (const file of packaged) {
  const area = dirname(relative(file.file))
  areas.set(area, [...(areas.get(area) ?? []), file])
}
const coverageFloor = JSON.parse(readFileSync(COVERAGE_FLOOR, "utf8")) as Coverage

// ---------------------------------------------------------------- verdicts

const failures: string[] = []
const layers = [...new Set([...Object.keys(countFloors), ...Object.keys(counts)])].sort()
for (const layer of layers) {
  const floor = countFloors[layer] ?? 0
  if ((counts[layer] ?? 0) < floor) failures.push(`test/${layer}: ${counts[layer] ?? 0} tests ran, the floor is ${floor}`)
}
for (const metric of ["lines", "functions"] as const) if (total[metric] < coverageFloor[metric]) failures.push(`${metric} coverage ${total[metric]}% is below the floor of ${coverageFloor[metric]}%`)

const mark = (value: number, floor: number) => (value < floor ? "below" : value > floor ? "raise" : "at")
const report = [
  "## Test gates",
  "",
  "Tests that ran per layer (#110):",
  "",
  "| Layer | Tests | Floor | |",
  "|---|--:|--:|---|",
  ...layers.map((layer) => `| \`test/${layer}\` | ${counts[layer] ?? 0} | ${countFloors[layer] ?? 0} | ${mark(counts[layer] ?? 0, countFloors[layer] ?? 0)} |`),
  `| **total** | **${Object.values(counts).reduce((a, b) => a + b, 0)}** | ${Object.values(countFloors).reduce((a, b) => a + b, 0)} | |`,
  "",
  "Coverage of `index.ts` and `src/` (#100):",
  "",
  "| Area | Lines | Functions |",
  "|---|--:|--:|",
  ...[...areas.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([area, group]) => {
      const coverage = measure(group)
      return `| \`${area === "." ? "index.ts" : area}\` | ${coverage.lines}% | ${coverage.functions}% |`
    }),
  `| **total** | **${total.lines}%** (floor ${coverageFloor.lines}%) | **${total.functions}%** (floor ${coverageFloor.functions}%) |`,
  "",
  failures.length > 0
    ? `**Failed:**\n\n${failures.map((failure) => `- ${failure}`).join("\n")}`
    : "All floors met. Rows marked `raise` are above their floor: run `--ratchet` and commit the new floors with the tests.",
  "",
].join("\n")

if (flags.includes("--summary") && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report)
console.log(report)

if (flags.includes("--ratchet")) {
  const raised = Object.fromEntries(layers.map((layer) => [layer, Math.max(countFloors[layer] ?? 0, counts[layer] ?? 0)]))
  writeFileSync(COUNT_FLOORS, `${JSON.stringify(raised, null, 2)}\n`)
  writeFileSync(COVERAGE_FLOOR, `${JSON.stringify({ lines: Math.max(coverageFloor.lines, total.lines), functions: Math.max(coverageFloor.functions, total.functions) }, null, 2)}\n`)
  console.log("Floors raised to the current values (never lowered): commit .github/floors/.")
}
if (failures.length > 0) process.exit(1)
