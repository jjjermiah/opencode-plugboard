#!/usr/bin/env bun
// Cuts a release from CHANGELOG.md: moves [Unreleased] under a version heading,
// fixes the link refs, bumps package.json, commits and tags. Not shipped in the package.
//
//   bun run release 0.3.0 [--push] [--dry-run]
//
// --dry-run prints the diff and changes nothing. Git state problems (dirty tree,
// wrong branch) are reported as warnings there, so you can preview while editing.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const PLACEHOLDER = "Nothing yet."
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith("--")))
const unknown = [...flags].filter((f) => f !== "--push" && f !== "--dry-run")
const positional = args.filter((a) => !a.startsWith("--"))
if (unknown.length || positional.length !== 1) {
  console.error("usage: bun run release <version> [--push] [--dry-run]")
  process.exit(2)
}
const dryRun = flags.has("--dry-run")
const push = flags.has("--push")
const version = positional[0].replace(/^v/, "")
const tag = `v${version}`

function fail(message: string): never {
  console.error(`release: ${message}`)
  process.exit(1)
}

function git(...gitArgs: string[]): string {
  const run = Bun.spawnSync(["git", ...gitArgs], { stderr: "pipe" })
  if (run.exitCode !== 0) fail(`git ${gitArgs.join(" ")} failed: ${run.stderr.toString().trim()}`)
  return run.stdout.toString().trim()
}

function parse(v: string) {
  const m = SEMVER.exec(v)
  if (!m) return undefined
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4]?.split(".") }
}

// Standard semver precedence: core first, a prerelease sorts before its release.
function compare(a: string, b: string): number {
  const x = parse(a)!
  const y = parse(b)!
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1
  if (!x.pre && !y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1
    if (pn) return -1
    if (qn) return 1
    return p < q ? -1 : 1
  }
  return 0
}

const problems: string[] = []
if (!parse(version)) fail(`"${version}" is not a valid semver version (expected x.y.z)`)

const pkgText = readFileSync("package.json", "utf8")
const current = (JSON.parse(pkgText) as { version: string }).version
if (compare(version, current) <= 0) fail(`${version} does not increase on package.json version ${current}`)

if (git("status", "--porcelain")) problems.push("working tree is not clean")
const branch = git("branch", "--show-current")
if (branch !== "main") problems.push(`on branch "${branch}", releases are cut from main`)
if (git("tag", "--list", tag)) fail(`tag ${tag} already exists`)

const changelog = readFileSync("CHANGELOG.md", "utf8")
const lines = changelog.split("\n")
const unreleasedAt = lines.findIndex((l) => l.startsWith("## [Unreleased]"))
if (unreleasedAt < 0) fail('CHANGELOG.md has no "## [Unreleased]" heading')
let sectionEnd = lines.findIndex((l, i) => i > unreleasedAt && /^(## \[|\[[^\]]+\]: )/.test(l))
if (sectionEnd < 0) sectionEnd = lines.length
const body = lines.slice(unreleasedAt + 1, sectionEnd).join("\n").trim()
if (!body || body === PLACEHOLDER) fail("[Unreleased] in CHANGELOG.md is empty, nothing to release")

const linkAt = lines.findIndex((l) => l.startsWith("[Unreleased]: "))
const link = /^\[Unreleased\]: (.+)\/compare\/v(.+)\.\.\.HEAD$/.exec(lines[linkAt] ?? "")
if (!link) fail('CHANGELOG.md needs a "[Unreleased]: <repo url>/compare/v<previous>...HEAD" link ref at the bottom')
const [, repoUrl, previous] = link
if (compare(version, previous) <= 0) fail(`${version} does not increase on the last released version ${previous}`)

const d = new Date()
const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

const next = [
  ...lines.slice(0, unreleasedAt),
  "## [Unreleased]",
  "",
  PLACEHOLDER,
  "",
  `## [${version}] - ${date}`,
  "",
  body,
  "",
  ...lines.slice(sectionEnd, linkAt),
  `[Unreleased]: ${repoUrl}/compare/${tag}...HEAD`,
  `[${version}]: ${repoUrl}/compare/v${previous}...${tag}`,
  ...lines.slice(linkAt + 1),
].join("\n")

const nextPkg = pkgText.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`)
if (nextPkg === pkgText) fail("could not find the version field in package.json")

if (dryRun) {
  for (const p of problems) console.log(`warning (would refuse without --dry-run): ${p}`)
  const dir = mkdtempSync(join(tmpdir(), "plugboard-release-"))
  try {
    for (const side of ["a", "b"]) mkdirSync(join(dir, side))
    writeFileSync(join(dir, "a/CHANGELOG.md"), changelog)
    writeFileSync(join(dir, "a/package.json"), pkgText)
    writeFileSync(join(dir, "b/CHANGELOG.md"), next)
    writeFileSync(join(dir, "b/package.json"), nextPkg)
    const diff = Bun.spawnSync(["git", "diff", "--no-index", "--no-color", "a", "b"], { cwd: dir })
    console.log(diff.stdout.toString())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(`dry run: would commit "Release ${version}" and tag ${tag}${push ? ", then push" : ""}`)
  process.exit(0)
}

if (problems.length) fail(problems.join("; "))
if (!existsSync(".git")) fail("run this from the repository root")

writeFileSync("CHANGELOG.md", next)
writeFileSync("package.json", nextPkg)
git("add", "CHANGELOG.md", "package.json")
git("commit", "-m", `Release ${version}`)
git("tag", "-a", tag, "-m", `Release ${version}`)
console.log(`committed "Release ${version}" and tagged ${tag}`)

if (push) {
  git("push", "--atomic", "origin", "main", tag)
  console.log(`pushed main and ${tag}`)
} else {
  console.log(`next: git push --atomic origin main ${tag}`)
}
