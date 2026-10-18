#!/usr/bin/env bun
/**
 * The `(since next)` placeholder. Parallel lanes cannot know which version their change ships in, so they write
 * `(since next)` (or `Since next` at the start of a sentence) in CHANGELOG.md and docs/**\/*.md. The release script
 * replaces it with the version being released, in the release commit (release.ts).
 *
 *   bun .github/scripts/since-next.ts --check   fail when a placeholder sits in a released CHANGELOG section
 *
 * Text inside inline code or a fenced code block is left alone, so a doc can show the placeholder (docs/releasing.md).
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/** Fenced blocks and inline code spans: kept as they are. */
const CODE = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2[^\n]*(?=\n|$)|`[^`\n]*`/g
/** `(since next)` anywhere, and `Since next` only where a sentence starts, so "Since next week" mid-sentence is prose. */
const PLACEHOLDER = /\(since next\)|(?<=^|[.!?:]\s+|^[-*>]\s+)Since next\b/gm

/** Applies `edit` to the prose of a markdown text only: code blocks and code spans pass through untouched. */
function inProse(text: string, edit: (prose: string) => string): string {
  let out = ""
  let at = 0
  for (const match of text.matchAll(CODE)) {
    out += edit(text.slice(at, match.index))
    out += match[0]
    at = match.index + match[0].length
  }
  return out + edit(text.slice(at))
}

/** The text with `(since next)` as `(since <version>)` and `Since next` as `Since <version>`. */
export function replaceSinceNext(text: string, version: string): string {
  return inProse(text, (prose) => prose.replace(PLACEHOLDER, (found) => (found.startsWith("(") ? `(since ${version})` : `Since ${version}`)))
}

/** Whether the text holds a placeholder outside code. */
export function hasSinceNext(text: string): boolean {
  let found = false
  inProse(text, (prose) => {
    if (new RegExp(PLACEHOLDER.source, "m").test(prose)) found = true
    return prose
  })
  return found
}

/**
 * The 1-based lines of a CHANGELOG that carry a placeholder inside a released section: any section whose heading is not
 * `## [Unreleased]`. Link references at the bottom belong to the last section, which is released too.
 */
export function placeholdersInReleased(changelog: string): number[] {
  const lines = changelog.split("\n")
  const released = new Set<number>()
  let inReleased = false
  lines.forEach((line, index) => {
    if (line.startsWith("## ")) inReleased = !line.startsWith("## [Unreleased]")
    if (inReleased) released.add(index)
  })
  // Judged on the whole text, so a fenced block spanning lines is read as code. Masking keeps the line count.
  const masked = inProse(changelog, (prose) => prose.replace(PLACEHOLDER, (found) => "\u0000".repeat(found.length)))
  const bad: number[] = []
  masked.split("\n").forEach((line, index) => {
    if (released.has(index) && line.includes("\u0000")) bad.push(index + 1)
  })
  return bad
}

if (import.meta.main) {
  if (!process.argv.includes("--check")) {
    console.error("usage: bun .github/scripts/since-next.ts --check")
    process.exit(2)
  }
  const file = resolve(import.meta.dir, "../../CHANGELOG.md")
  const bad = placeholdersInReleased(readFileSync(file, "utf8"))
  if (bad.length > 0) {
    console.error(`CHANGELOG.md has "(since next)" in a released section (lines ${bad.join(", ")}). The release script replaces the placeholder in [Unreleased] only; a lane that merged it after the release must write the real version.`)
    process.exit(1)
  }
  console.log("since-next: no placeholder in a released CHANGELOG section")
}
