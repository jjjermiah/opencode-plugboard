#!/usr/bin/env bun
// The local validation chain in one foreground command, with a short summary at the end.
//
//   bun run validate                  lint and format check, typecheck, tests + coverage gates (ratchet), manifest, pack, docs, scripted examples
//   bun run validate --mutations      the same, then the mutation run
//   bun run validate --only test,docs run only the named steps
//   bun run validate --skip examples  leave out the named steps (examples is the slow one, about 6 minutes)
//   bun run validate --keep-going     run every step even after one fails
//
// The docs step also runs the examples index check (every <<< import resolves, every example is used by a docs page).
// Each step's full output goes to .agents/validate/<step>.log (ignored by git); the console shows one line per
// step and, for a failed step, the tail of its log. Exit code 0 only when every step that ran passed.
// It is meant to be run once, in the foreground, and waited for: no polling of logs.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

interface Step {
  readonly name: string
  readonly cmd: string
  readonly optional?: boolean
}

const STEPS: readonly Step[] = [
  { name: "lint", cmd: "bun run lint && bun run format" },
  { name: "typecheck", cmd: "bun run typecheck" },
  {
    name: "test",
    cmd: "bun test --coverage --coverage-reporter=lcov --coverage-dir=.coverage --reporter=junit --reporter-outfile=.coverage/junit.xml" + " && bun .github/scripts/test-gates.ts .coverage --ratchet",
  },
  { name: "manifest", cmd: "bun run coverage-manifest" },
  { name: "pack", cmd: "bun .github/scripts/check-pack.ts && bun .github/scripts/smoke-pack.ts" },
  { name: "docs", cmd: "bun .github/scripts/since-next.ts --check && bun .github/scripts/examples-index.ts --check && bun run docs:build" },
  { name: "examples", cmd: "BROWSER=true bun examples/_harness/run.ts all --target scripted && git diff --exit-code examples/" },
  { name: "mutations", cmd: "bun run mutations", optional: true },
]

const TAIL_LINES = 30

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const flagValue = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const known = new Set(STEPS.map((step) => step.name))
const only = flagValue("--only")
  ?.split(",")
  .map((name) => name.trim())
  .filter(Boolean)
for (const name of only ?? []) if (!known.has(name)) throw new Error(`unknown step "${name}"; steps: ${[...known].join(", ")}`)

const skip =
  flagValue("--skip")
    ?.split(",")
    .map((name) => name.trim())
    .filter(Boolean) ?? []
for (const name of skip) if (!known.has(name)) throw new Error(`unknown step "${name}"; steps: ${[...known].join(", ")}`)

const selected = STEPS.filter((step) => !skip.includes(step.name) && (only ? only.includes(step.name) : !step.optional || flag(`--${step.name}`)))
if (selected.length === 0) throw new Error("no steps selected")
const keepGoing = flag("--keep-going")
const logDir = join(".agents", "validate")
mkdirSync(logDir, { recursive: true })

const seconds = (ms: number) => `${(ms / 1000).toFixed(0)}s`
const results: { name: string; ok: boolean | undefined; ms: number }[] = []

for (const step of selected) {
  const started = Date.now()
  const log = join(logDir, `${step.name}.log`)
  const proc = Bun.spawn(["bash", "-c", step.cmd], { stdout: "pipe", stderr: "pipe", env: { ...process.env, FORCE_COLOR: "0" } })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const code = await proc.exited
  writeFileSync(log, `$ ${step.cmd}\n${out}${err}\nexit ${code}\n`)
  const ok = code === 0
  const ms = Date.now() - started
  results.push({ name: step.name, ok, ms })
  console.log(`${ok ? "pass" : "FAIL"}  ${step.name.padEnd(10)} ${seconds(ms).padStart(5)}  ${log}`)
  if (!ok) {
    const lines = readFileSync(log, "utf8").trimEnd().split("\n")
    console.log(
      lines
        .slice(-TAIL_LINES)
        .map((line) => `      | ${line}`)
        .join("\n"),
    )
    if (!keepGoing) break
  }
}

for (const step of selected) if (!results.some((r) => r.name === step.name)) results.push({ name: step.name, ok: undefined, ms: 0 })

const failed = results.filter((r) => r.ok === false).map((r) => r.name)
const skipped = results.filter((r) => r.ok === undefined).map((r) => r.name)
const total = results.reduce((sum, r) => sum + r.ms, 0)
console.log(
  failed.length === 0
    ? `validate: all ${results.length} steps passed in ${seconds(total)}`
    : `validate: FAILED ${failed.join(", ")}${skipped.length ? ` (not run: ${skipped.join(", ")})` : ""} after ${seconds(total)}`,
)
process.exit(failed.length === 0 ? 0 : 1)
