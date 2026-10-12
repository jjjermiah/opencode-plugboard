#!/usr/bin/env bun
// Fails unless `npm pack` would ship exactly what package.json `files` names
// (plus package.json itself, which npm always adds). Not shipped in the package.
import { Glob } from "bun"
import { existsSync, readFileSync } from "node:fs"

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { files?: string[] }
if (!pkg.files?.length) throw new Error("package.json has no `files` list")
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
