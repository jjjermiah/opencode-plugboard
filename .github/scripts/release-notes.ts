#!/usr/bin/env bun
// Prints the release notes for one version, for `gh release create --notes-file`: the
// curated CHANGELOG.md section, then "The full story" built from the git commits between
// the previous tag and this one (see commit-detail.ts), then the Full diff link.
// Usage: bun .github/scripts/release-notes.ts 0.3.0          prints the notes
//        bun .github/scripts/release-notes.ts 0.3.0 --title   prints the heading title
//        bun .github/scripts/release-notes.ts 0.3.0 --changelog-detail
//                                                            prints the CHANGELOG.md detail block
// All fail when the heading has no title (`## [0.3.0] - <date>: Title`).
import { readFileSync } from "node:fs"
import { changelogBlock, collectCommits, DETAIL_END, DETAIL_START, fullStory, refExists } from "./commit-detail.ts"

const args = process.argv.slice(2)
const titleOnly = args.includes("--title")
const changelogDetail = args.includes("--changelog-detail")
const version = (args.find((a) => !a.startsWith("--")) ?? "").replace(/^v/, "")
if (!version) {
  console.error("usage: bun .github/scripts/release-notes.ts <version> [--title | --changelog-detail]")
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
// The section carries its own "**Full diff:**" line (release.ts writes it) and, since the
// commit convention, a generated commit-detail block. Both are dropped here: the diff link
// is re-appended at the end so it appears once, last, and the detail is rebuilt from git.
const section = lines
  .slice(start + 1, end)
  .filter((l) => !l.startsWith("**Full diff:**"))
  .join("\n")
const notes = section.replace(new RegExp(`${DETAIL_START}[\\s\\S]*?${DETAIL_END}`), "").trim()
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

// Before the tag exists (a dry run from main) the commits are the ones on HEAD.
const tag = `v${version}`
const from = previous && refExists(`v${previous}`) ? `v${previous}` : undefined
if (previous && !from) {
  console.error(`tag v${previous} is not in this clone, so the commit range is unknown (fetch tags, use fetch-depth: 0)`)
  process.exit(1)
}
const commits = collectCommits(from, refExists(tag) ? tag : "HEAD")

if (changelogDetail) {
  console.log(changelogBlock(commits, repoUrl))
  process.exit(0)
}

const diff = previous ? `[v${previous}...v${version}](${repoUrl}/compare/v${previous}...v${version})` : `[v${version}](${repoUrl}/tree/v${version})`
const story = fullStory(commits, repoUrl, previous)
console.log(`${notes}\n\n${story ? `${story}\n\n` : ""}---\n\n**Full diff:** ${diff}`)
