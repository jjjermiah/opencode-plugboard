#!/usr/bin/env bun
// Prints the CHANGELOG.md section for one version, for `gh release create --notes-file`.
// Usage: bun scripts/release-notes.ts 0.3.0
import { readFileSync } from "node:fs"

const version = (process.argv[2] ?? "").replace(/^v/, "")
if (!version) {
  console.error("usage: bun scripts/release-notes.ts <version>")
  process.exit(2)
}

const lines = readFileSync("CHANGELOG.md", "utf8").split("\n")
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`))
if (start < 0) {
  console.error(`no "## [${version}]" section in CHANGELOG.md`)
  process.exit(1)
}
let end = lines.findIndex((l, i) => i > start && /^(## \[|\[[^\]]+\]: )/.test(l))
if (end < 0) end = lines.length
const notes = lines.slice(start + 1, end).join("\n").trim()
if (!notes) {
  console.error(`the CHANGELOG.md section for ${version} is empty`)
  process.exit(1)
}
console.log(notes)
