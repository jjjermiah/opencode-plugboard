#!/usr/bin/env bun
// Prints the CHANGELOG.md section for one version, for `gh release create --notes-file`.
// Usage: bun .github/scripts/release-notes.ts 0.3.0          prints the notes
//        bun .github/scripts/release-notes.ts 0.3.0 --title   prints the heading title
// Both fail when the heading has no title (`## [0.3.0] - <date>: Title`).
import { readFileSync } from "node:fs"

const args = process.argv.slice(2)
const titleOnly = args.includes("--title")
const version = (args.find((a) => !a.startsWith("--")) ?? "").replace(/^v/, "")
if (!version) {
  console.error("usage: bun .github/scripts/release-notes.ts <version> [--title]")
  process.exit(2)
}

const lines = readFileSync("CHANGELOG.md", "utf8").split("\n")
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`))
if (start < 0) {
  console.error(`no "## [${version}]" section in CHANGELOG.md`)
  process.exit(1)
}
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const title = new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}: (\\S.*)$`).exec(lines[start])?.[1].trim()
if (!title) {
  console.error(`the CHANGELOG.md heading for ${version} has no title, expected "## [${version}] - YYYY-MM-DD: Title"`)
  process.exit(1)
}
if (titleOnly) {
  console.log(title)
  process.exit(0)
}
let end = lines.findIndex((l, i) => i > start && /^(## \[|\[[^\]]+\]: )/.test(l))
if (end < 0) end = lines.length
// The section carries its own "**Full diff:**" line (release.ts writes it); it is
// dropped here and re-appended at the end, so it appears once, last.
const notes = lines
  .slice(start + 1, end)
  .filter((l) => !l.startsWith("**Full diff:**"))
  .join("\n")
  .trim()
if (!notes) {
  console.error(`the CHANGELOG.md section for ${version} is empty`)
  process.exit(1)
}

const repoUrl = /^\[Unreleased\]: (.+)\/compare\//m.exec(lines.join("\n"))?.[1]
if (!repoUrl) {
  console.error('CHANGELOG.md needs a "[Unreleased]: <repo url>/compare/..." link ref at the bottom')
  process.exit(1)
}
// The previous release is the next version heading down (the changelog is newest first).
const previous = /^## \[([^\]]+)\]/.exec(lines[end] ?? "")?.[1]
const diff = previous
  ? `[v${previous}...v${version}](${repoUrl}/compare/v${previous}...v${version})`
  : `[v${version}](${repoUrl}/tree/v${version})`
console.log(`${notes}\n\n---\n\n**Full diff:** ${diff}`)
