#!/usr/bin/env bun
/**
 * Prints the route x format x mode coverage manifest (#116, test/coverage-manifest.ts) as a table for
 * the CI job summary, and exits 1 when the manifest and the router disagree (the test run already
 * says so; this keeps a summary-only step honest).
 *
 *   bun .github/scripts/coverage-manifest.ts            # stdout
 *   bun .github/scripts/coverage-manifest.ts --summary  # also append to $GITHUB_STEP_SUMMARY
 */
import { appendFileSync } from "node:fs"
import { MANUAL_ROUTES, MODES, ROWS, problems, scanRouteNames, type Cell } from "../../test/coverage-manifest.js"

const cell = (value: Cell): string => ("tests" in value ? `${value.tests.length} test${value.tests.length === 1 ? "" : "s"}` : "na" in value ? "n/a" : "**gap**")
const routes = [...new Set([...(await scanRouteNames()), ...MANUAL_ROUTES])].sort()
const failures = problems(ROWS, routes)

const gaps = ROWS.flatMap((row) => MODES.flatMap((mode) => ("gap" in row.cells[mode] ? [`\`${row.route}\` [${row.format}] ${mode}: ${(row.cells[mode] as { gap: string }).gap}`] : [])))
const all = ROWS.flatMap((row) => MODES.map((mode) => row.cells[mode]))
const counts = `${all.filter((value) => "tests" in value).length} covered, ${all.filter((value) => "na" in value).length} n/a, ${gaps.length} gap${gaps.length === 1 ? "" : "s"} across ${ROWS.length} rows (${routes.length} routes)`

const table = [
  "## Route coverage manifest (#116)",
  "",
  "Every route the router has, per request format, per mode. A count is the tests that cover the cell. Source: `test/coverage-manifest.ts`.",
  "",
  `| Route | Format | ${MODES.join(" | ")} |`,
  `|---|---|${MODES.map(() => "--:").join("|")}|`,
  ...ROWS.map((row) => `| \`${row.route}\` | ${row.format} | ${MODES.map((mode) => cell(row.cells[mode])).join(" | ")} |`),
  "",
  `${counts}.`,
  ...(gaps.length > 0 ? ["", "Known gaps:", "", ...gaps.map((gap) => `- ${gap}`)] : []),
  "",
  failures.length > 0 ? `**The manifest and the router disagree:**\n\n${failures.map((failure) => `- ${failure}`).join("\n")}` : "The manifest matches the router: every route has a row, and every cover resolves.",
  "",
].join("\n")

if (process.argv.includes("--summary") && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table)
console.log(table)
if (failures.length > 0) process.exit(1)
