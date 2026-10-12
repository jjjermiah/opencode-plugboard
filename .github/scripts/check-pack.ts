#!/usr/bin/env bun
// Fails unless `npm pack` would ship exactly what package.json `files` names
// (plus package.json itself, which npm always adds). Not shipped in the package.
import { Glob } from "bun"
import { existsSync, readFileSync } from "node:fs"

type Deps = Record<string, string> | undefined
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  files?: string[]
  dependencies?: Deps
  peerDependencies?: Deps
  peerDependenciesMeta?: Record<string, unknown>
}
if (!pkg.files?.length) throw new Error("package.json has no `files` list")
// npm-shrinkwrap.json pins the runtime tree (#165). It must ship, and it must describe the current
// runtime dependencies, so a dependency bump without `npm shrinkwrap` fails here.
const shrinkProblems: string[] = []
if (!pkg.files.includes("npm-shrinkwrap.json")) shrinkProblems.push('npm-shrinkwrap.json is not listed in package.json "files"')
if (!existsSync("npm-shrinkwrap.json")) shrinkProblems.push("npm-shrinkwrap.json is missing: regenerate it (see docs/packaging.md)")
else {
  const sorted = (d: unknown) => JSON.stringify(d ?? {}, Object.keys((d ?? {}) as object).sort())
  const lock = JSON.parse(readFileSync("npm-shrinkwrap.json", "utf8")) as {
    packages: Record<string, { dependencies?: Deps; peerDependencies?: Deps; peerDependenciesMeta?: unknown }>
  }
  const root = lock.packages[""] ?? {}
  if (sorted(root.dependencies) !== sorted(pkg.dependencies)) shrinkProblems.push("npm-shrinkwrap.json dependencies differ from package.json: regenerate it")
  if (sorted(root.peerDependencies) !== sorted(pkg.peerDependencies)) shrinkProblems.push("npm-shrinkwrap.json peerDependencies differ from package.json: regenerate it")
  for (const key of Object.keys(lock.packages)) {
    if (/(^|\/)(effect|@opencode\/plugin)$/.test(key)) shrinkProblems.push(`npm-shrinkwrap.json pins ${key}, an optional peer that must not ship`)
  }
}
if (shrinkProblems.length) {
  for (const p of shrinkProblems) console.error(p)
  process.exit(1)
}
// `npm pack --ignore-scripts` below skips prepack, so the compiled TUI entry must already exist.
if (!existsSync("dist/tui.js")) throw new Error("dist/tui.js is missing: run `bun run build:tui` before packing")

const expected = new Set<string>(["package.json"])
for (const entry of pkg.files) {
  const pattern = entry.endsWith("/") ? `${entry}**` : entry
  for (const path of new Glob(pattern).scanSync({ dot: false })) expected.add(path)
}

const run = Bun.spawnSync(["npm", "pack", "--dry-run", "--json", "--ignore-scripts"], {
  stderr: "inherit",
})
if (run.exitCode !== 0) throw new Error(`npm pack failed with exit code ${run.exitCode}`)
const packed = new Set<string>(
  (JSON.parse(run.stdout.toString()) as [{ files: { path: string }[] }])[0].files.map((f) => f.path),
)

const unexpected = [...packed].filter((p) => !expected.has(p)).sort()
const missing = [...expected].filter((p) => !packed.has(p)).sort()
if (unexpected.length || missing.length) {
  for (const p of unexpected) console.error(`unexpected in package: ${p}`)
  for (const p of missing) console.error(`missing from package: ${p}`)
  process.exit(1)
}
console.log(`pack ok: ${packed.size} files, all matched by package.json "files"`)
