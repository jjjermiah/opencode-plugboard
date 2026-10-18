// Turns the commits between two refs into the "full story" of a release: grouped by
// conventional type, one entry per commit with its short hash link and its full body.
// Shared by release.ts (the CHANGELOG.md block) and release-notes.ts (the GitHub release
// notes). Not shipped in the package.
import { CommitParser } from "conventional-commits-parser"

export const DETAIL_START = "<!-- commit-detail:start -->"
export const DETAIL_END = "<!-- commit-detail:end -->"

// Display order. Everything a commit can map to is in this list.
const GROUPS = ["Features", "Fixes", "Security", "Performance", "Refactors", "Tests", "Docs", "CI and tooling", "Dependencies", "Other"] as const
type Group = (typeof GROUPS)[number]

const BY_TYPE: Record<string, Group> = {
  feat: "Features",
  fix: "Fixes",
  security: "Security",
  perf: "Performance",
  refactor: "Refactors",
  style: "Refactors",
  test: "Tests",
  docs: "Docs",
  ci: "CI and tooling",
  build: "CI and tooling",
  chore: "CI and tooling",
  deps: "Dependencies",
}

// Commits from before Conventional Commits was enforced. Only prefixes whose meaning
// is obvious are mapped; the rest stay under "Other".
const LEGACY_PREFIX: Record<string, string> = {
  tests: "test",
  changelog: "docs",
  readme: "docs",
  docs: "docs",
  security: "security",
}

export interface Commit {
  hash: string
  header: string
  group: Group
  body: string
}

// The release commit itself ("chore(release): 0.11.0", or "Release 0.11.0" before the
// convention), and merge commits that git does not see as merges (a squashed "Merge w5/x").
const SKIPPED = /^((chore\(release\): |Release )\d|Merge )/

const parser = new CommitParser()

function groupOf(header: string, type: string | null, scope: string | null): Group {
  if (scope === "deps" || type === "deps") return "Dependencies"
  if (scope === "security") return "Security"
  const t = type?.toLowerCase()
  if (t && BY_TYPE[t]) return BY_TYPE[t]
  // "Tests: ..." parses with type "Tests"; "docs + changelog: ..." and "Security hardening: ..."
  // do not parse at all, so try the first word of whatever precedes the colon.
  const word = t ?? /^([A-Za-z]+)\b[^:]*:\s/.exec(header)?.[1]?.toLowerCase() ?? ""
  const mapped = LEGACY_PREFIX[word]
  return mapped ? BY_TYPE[mapped] : "Other"
}

// Commit bodies are hard-wrapped at 72 columns. GitHub renders single newlines inside a
// paragraph as line breaks, so join wrapped lines back into one line per paragraph.
// Lists, quotes, tables, headings, footers and code fences keep their line structure.
export function unwrap(text: string): string {
  const BLOCK = /^\s*([-*+]\s|\d+[.)]\s|>|\||#{1,6}\s)|^(BREAKING[ -]CHANGE|Co-authored-by|Signed-off-by|Refs?): |^(Fixes|Fix|Closes|Close|Refs|Resolves) .*#\d/
  const out: string[] = []
  let fenced = false
  let joinable = false
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd()
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      out.push(line)
      joinable = false
    } else if (fenced || line === "") {
      out.push(line)
      joinable = false
    } else if (joinable && !BLOCK.test(line)) {
      out[out.length - 1] += ` ${line.trim()}`
    } else {
      out.push(line)
      joinable = !/^\s*(\||#{1,6}\s)/.test(line)
    }
  }
  return out.join("\n").trim()
}

function git(args: string[]): string {
  const run = Bun.spawnSync(["git", ...args], { stderr: "pipe" })
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr.toString().trim()}`)
  return run.stdout.toString()
}

export function refExists(ref: string): boolean {
  return Bun.spawnSync(["git", "rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).exitCode === 0
}

// Commits reachable from `to` but not from `from` (everything up to `to` when `from` is
// undefined), oldest first. Merge commits and the release commit are left out.
export function collectCommits(from: string | undefined, to: string): Commit[] {
  const range = from ? `${from}..${to}` : to
  const raw = git(["log", "--no-merges", "--reverse", "--format=%H%x1f%B%x1e", range])
  const commits: Commit[] = []
  for (const record of raw.split("\x1e")) {
    const [hash, message] = record.trim().split("\x1f")
    if (!hash || !message) continue
    const parsed = parser.parse(message.trim())
    const header = parsed.header ?? message.split("\n")[0]
    if (SKIPPED.test(header)) continue
    // The parser classifies the header. Its body/footer split is not used: it cuts at the
    // first "word: " line, which in prose is not a footer, so the body is the raw text under the header.
    const body = unwrap(message.trim().split("\n").slice(1).join("\n"))
    commits.push({ hash, header, group: groupOf(header, parsed.type ?? null, parsed.scope ?? null), body })
  }
  return commits
}

function grouped(commits: Commit[]): [Group, Commit[]][] {
  return GROUPS.map((g): [Group, Commit[]] => [g, commits.filter((c) => c.group === g)]).filter(([, list]) => list.length > 0)
}

function entry(c: Commit, repoUrl: string): string {
  const title = `**${c.header}** ([\`${c.hash.slice(0, 7)}\`](${repoUrl}/commit/${c.hash}))`
  return c.body ? `${title}\n\n${c.body}` : title
}

const plural = (n: number) => `${n} commit${n === 1 ? "" : "s"}`

// The GitHub release section: one collapsed <details> per group, after the curated notes.
export function fullStory(commits: Commit[], repoUrl: string, previous: string | undefined): string {
  if (!commits.length) return ""
  const since = previous ? ` since v${previous}` : ""
  const parts = ["## The full story", "", `${plural(commits.length)}${since}, grouped by type and oldest first. Each entry is the commit message as written.`]
  for (const [group, list] of grouped(commits)) {
    parts.push("", "<details>", `<summary>${group} (${list.length})</summary>`, "", list.map((c) => entry(c, repoUrl)).join("\n\n"), "", "</details>")
  }
  return parts.join("\n")
}

// The CHANGELOG.md block: one collapsed <details> for the whole release, so the file stays
// scannable. The markers let release-notes.ts cut it out of the curated notes.
export function changelogBlock(commits: Commit[], repoUrl: string): string {
  if (!commits.length) return ""
  const parts = [DETAIL_START, "<details>", `<summary>Commit-level detail (${plural(commits.length)})</summary>`]
  for (const [group, list] of grouped(commits)) {
    parts.push("", `#### ${group}`, "", list.map((c) => entry(c, repoUrl)).join("\n\n"))
  }
  parts.push("", "</details>", DETAIL_END)
  return parts.join("\n")
}
