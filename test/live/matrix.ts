#!/usr/bin/env bun
/**
 * `bun run live-matrix` (#108): every logged-in model x endpoint x scenario, one real call per cell,
 * written to docs/live-matrix.md (for people) and docs/live-matrix.json (for tools). The report is
 * evidence for the server it ran against: a failing cell is a finding, so the exit code stays 0
 * unless the run itself could not start.
 *
 *   bun run live-matrix                                # all models in PLUGBOARD_LIVE_MODELS or the defaults
 *   bun run live-matrix -- --models opencode-go/glm-5.3-flash --keep-sessions
 *   bun run live-matrix -- --docs /tmp/m.md --json /tmp/m.json
 *
 * Environment: PLUGBOARD_LIVE_KEY (required), PLUGBOARD_LIVE_URL, PLUGBOARD_LIVE_MODELS,
 * PLUGBOARD_LIVE_OC (the wrapper, see env.ts). Sessions the run created are deleted at the end
 * unless --keep-sessions is given.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { cleanup, created, listedModels, status } from "./client.js"
import { ENDPOINTS, SCENARIOS, naReason, runCell, type Cell } from "./cells.js"
import { CHECKOUT, LIVE_KEY, LIVE_MODELS, LIVE_URL, MAX_TOKENS } from "./env.js"

const root = join(import.meta.dir, "../..")
const args = process.argv.slice(2)
const flag = (name: string) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const docsPath = join(root, flag("--docs") ?? "docs/live-matrix.md")
const jsonPath = join(root, flag("--json") ?? "docs/live-matrix.json")
const models = flag("--models")?.split(",").map((model) => model.trim()).filter(Boolean) ?? LIVE_MODELS
const keepSessions = args.includes("--keep-sessions")

if (!LIVE_KEY) {
  console.error("live-matrix: PLUGBOARD_LIVE_KEY is not set (the app key of the isolated server).")
  process.exit(2)
}

// The version and commit of the checkout the server loads (not necessarily this worktree).
const pkg = JSON.parse(readFileSync(join(CHECKOUT, "package.json"), "utf8")) as { version: string }
const commit = execFileSync("git", ["-C", CHECKOUT, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim()
const health = await fetch(new URL("/healthz", LIVE_URL)).catch(() => undefined)
if (!health?.ok) {
  console.error(`live-matrix: ${LIVE_URL}/healthz is not answering; start the isolated server first (docs/development.md).`)
  process.exit(2)
}
const listed = new Set(await listedModels())
const missing = models.filter((model) => !listed.has(model))

// Models run side by side; the cells of one model run one after another, so each provider sees one call at a time.
const started = Date.now()
let cells: Cell[] = []
let deleted = 0
let guards: number | string = "unknown"
try {
  const results: Cell[][] = await Promise.all(
    models.map(async (model) => {
      const row: Cell[] = []
      for (const endpoint of ENDPOINTS)
        for (const scenario of SCENARIOS) {
          if (missing.includes(model) && naReason(endpoint, scenario) === null) {
            row.push({ model, endpoint, scenario, status: "fail", detail: "model not listed by GET /v1/models", sessions: [], ms: 0 })
            continue
          }
          try {
            row.push(await runCell(model, endpoint, scenario))
          } catch (error) {
            row.push({ model, endpoint, scenario, status: "fail", detail: `call error: ${(error as Error).message}`, sessions: [], ms: 0 })
          }
        }
      return row
    }),
  )
  cells = results.flat()
} finally {
  // Sessions this run created are deleted even when the run stops early.
  guards = (await status().catch(() => undefined))?.sessionGuards ?? guards
  deleted = keepSessions ? 0 : await cleanup()
}
const sessionsCreated = keepSessions ? created.size : deleted

const date = new Date().toISOString().slice(0, 10)
const count = (status_: string) => cells.filter((cell) => cell.status === status_).length
const summary = { pass: count("pass"), fail: count("fail"), "n-a": count("n-a"), total: cells.length }

// ---------------------------------------------------------------- markdown

const esc = (text: string) => text.replace(/\|/g, "\\|")
/** The table shows the provider's reason when there is one, else the start of the detail; the full detail is in Failures. */
const short = (detail: string) => {
  const provider = detail.split(" | provider: ")[1]
  const text = provider ?? detail
  return text.length > 90 ? `${text.slice(0, 89)}…` : text
}
const cellText = (cell: Cell | undefined) => {
  if (!cell) return "not run"
  if (cell.status === "pass") return "pass"
  if (cell.status === "n-a") return "n/a"
  return `**FAIL** ${esc(short(cell.detail))}`
}
const at = (model: string, endpoint: string, scenario: string) => cells.find((cell) => cell.model === model && cell.endpoint === endpoint && cell.scenario === scenario)

const sections = ENDPOINTS.map((endpoint) => {
  const header = `| Model | ${SCENARIOS.join(" | ")} |`
  const rule = `|---|${SCENARIOS.map(() => "---").join("|")}|`
  const rows = models.map((model) => `| \`${model}\` | ${SCENARIOS.map((scenario) => cellText(at(model, endpoint, scenario))).join(" | ")} |`)
  return [`## ${endpoint}`, "", header, rule, ...rows, ""].join("\n")
})

const reasons = ENDPOINTS.flatMap((endpoint) =>
  SCENARIOS.flatMap((scenario) => {
    const reason = naReason(endpoint, scenario)
    return reason ? [`- \`${endpoint}\` / \`${scenario}\`: ${reason}`] : []
  }),
)

const failures = cells.filter((cell) => cell.status === "fail")
const markdown = [
  "# Live matrix",
  "",
  `Generated by \`bun run live-matrix\` on ${date} against plugboard ${pkg.version} (${commit}) loaded by an isolated OpenCode server. Each cell is one real call with a cheap model, a short prompt and \`max_tokens\` ${MAX_TOKENS}. Not run by \`bun test\`; the opt-in suite in \`test/live/\` runs the same cells (#99).`,
  "",
  `Totals: ${summary.pass} pass, ${summary.fail} fail, ${summary["n-a"]} n/a, of ${summary.total} cells.`,
  "",
  "Cells: `pass` (the answer checks out), `**FAIL**` followed by the reason and a snippet of what came back, `n/a` (the endpoint does not carry the scenario; reasons below). Scenarios: `text` (\"reply with exactly: pong\"), `stream` (the same, streamed to its terminator), `tool-call` (the model returns the call unexecuted), `tool-result` (a history with the tool result, one call), `image` (a 16x16 red PNG), `json` (JSON Schema output), `tools-json` (a tool offered together with a JSON Schema).",
  "",
  ...sections,
  "## Not applicable",
  "",
  ...reasons,
  "",
  "## Failures",
  "",
  failures.length === 0 ? "None." : failures.map((cell) => `- \`${cell.model}\` ${cell.endpoint} / ${cell.scenario}: ${esc(cell.detail)}`).join("\n"),
  "",
].join("\n")

mkdirSync(dirname(docsPath), { recursive: true })
writeFileSync(docsPath, markdown)
writeFileSync(
  jsonPath,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), plugboard: { version: pkg.version, commit }, models, summary, sessions: { created: sessionsCreated, deleted, guardsAfterRun: guards }, cells }, null, 2)}\n`,
)

console.log(`live-matrix: ${summary.pass} pass, ${summary.fail} fail, ${summary["n-a"]} n/a of ${summary.total} cells in ${((Date.now() - started) / 1000).toFixed(0)}s`)
console.log(`live-matrix: sessions created ${sessionsCreated}, deleted ${deleted}${keepSessions ? " (kept)" : ""}; sessionGuards after run ${guards}`)
console.log(`live-matrix: wrote ${docsPath.replace(root + "/", "")} and ${jsonPath.replace(root + "/", "")}`)
for (const cell of failures) console.log(`FAIL ${cell.model} ${cell.endpoint}/${cell.scenario}: ${cell.detail}`)
