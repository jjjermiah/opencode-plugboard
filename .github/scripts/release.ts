#!/usr/bin/env bun
// Cuts a release from CHANGELOG.md: moves [Unreleased] under a version heading,
// fixes the link refs, bumps package.json, commits and tags. Not shipped in the package.
//
//   bun run release 0.3.0 --title "Short Creative Title" [--push [--no-watch]] [--dry-run]
//   bun run release 0.3.0 --watch-only
//
// Every release needs a title: 2 to 5 words, at most 40 characters, no trailing
// period. It lands in the heading (`## [0.3.0] - <date>: Title`) and names the GitHub release.
//
// --push also follows the release to the end (unless --no-watch): it finds the Publish run for
// the tag, waits for it, then polls npm until the version is visible and the dist-tag points at
// it. It exits with that result. --watch-only does only that part for an existing tag, e.g. to
// follow a run that is already going or to check a finished one.
//
// --dry-run prints the diff and changes nothing. Git state problems (dirty tree,
// wrong branch) are reported as warnings there, so you can preview while editing.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const PLACEHOLDER = "Nothing yet."
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

const USAGE =
  'usage: bun run release <version> --title "Short Creative Title" [--push [--no-watch]] [--dry-run]\n       bun run release <version> --watch-only'
let title: string | undefined
const flags = new Set<string>()
const positional: string[] = []
const unknown: string[] = []
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === "--title") title = argv[++i] ?? ""
  else if (a.startsWith("--title=")) title = a.slice("--title=".length)
  else if (["--push", "--dry-run", "--watch", "--no-watch", "--watch-only"].includes(a)) flags.add(a)
  else if (a.startsWith("--")) unknown.push(a)
  else positional.push(a)
}
if (unknown.length || positional.length !== 1) {
  console.error(USAGE)
  process.exit(2)
}
const dryRun = flags.has("--dry-run")
const push = flags.has("--push")
const watchOnly = flags.has("--watch-only")
const watch = !flags.has("--no-watch") && (push || flags.has("--watch"))
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

const PUBLISH_TIMEOUT_MS = 5 * 60_000
const POLL_MS = 10_000

function gh(...ghArgs: string[]): { ok: boolean; out: string } {
  const run = Bun.spawnSync(["gh", ...ghArgs], { stderr: "pipe" })
  return { ok: run.exitCode === 0, out: run.stdout.toString().trim() }
}

function npmView(spec: string, field: string): string {
  const run = Bun.spawnSync(["npm", "view", spec, field, "--json", "--prefer-online"], { stderr: "pipe" })
  return run.exitCode === 0 ? run.stdout.toString().trim() : ""
}

// Follows the Publish run for the tag, then the npm registry, and returns the exit code:
// 0 only when the run succeeded and npm serves the version under the expected dist-tag.
async function watchRelease(): Promise<number> {
  const name = (JSON.parse(readFileSync("package.json", "utf8")) as { name: string }).name
  const expectedTag = version.includes("-") ? "next" : "latest"
  const sha = git("rev-list", "-n1", tag)

  console.log(`watch: looking for the Publish run for ${tag} (${sha.slice(0, 7)})`)
  let run: { databaseId: number; url: string } | undefined
  for (const deadline = Date.now() + 90_000; !run && Date.now() < deadline; ) {
    const listed = gh("run", "list", "--workflow", "publish.yml", "--branch", tag, "--limit", "20", "--json", "databaseId,headSha,url,event")
    if (!listed.ok) {
      console.error("watch: `gh run list` failed (is gh installed and logged in?)")
      return 1
    }
    const runs = JSON.parse(listed.out || "[]") as { databaseId: number; headSha: string; url: string; event: string }[]
    run = runs.find((r) => r.headSha === sha && r.event === "push")
    if (!run) await Bun.sleep(5_000)
  }
  if (!run) {
    console.error(`watch: no Publish run for ${tag} appeared within 90s. Check the Actions tab, then re-run with --watch-only.`)
    return 1
  }
  console.log(`watch: following ${run.url}`)
  const followed = Bun.spawnSync(["gh", "run", "watch", String(run.databaseId), "--exit-status", "--interval", "10"], {
    stdout: "inherit",
    stderr: "inherit",
  })
  if (followed.exitCode !== 0) {
    console.error(`watch: the Publish run did not succeed. Logs: ${run.url}. Check \`npm view ${name} versions\` before re-running it, the failure may have come after the npm publish.`)
    return 1
  }
  console.log("watch: the Publish run succeeded, waiting for npm to serve it")

  const start = Date.now()
  let seen = false
  while (Date.now() - start < PUBLISH_TIMEOUT_MS) {
    if (!seen && npmView(`${name}@${version}`, "version") === JSON.stringify(version)) {
      seen = true
      console.log(`watch: ${name}@${version} is visible on npm`)
    }
    if (seen) {
      const tags = npmView(name, "dist-tags")
      const current = tags ? (JSON.parse(tags) as Record<string, string>)[expectedTag] : undefined
      if (current === version) {
        console.log(`watch: dist-tag ${expectedTag} points at ${version}. Released.`)
        return 0
      }
    }
    await Bun.sleep(POLL_MS)
  }
  const waited = Math.round(PUBLISH_TIMEOUT_MS / 60_000)
  console.error(
    seen
      ? `watch: ${name}@${version} is on npm but dist-tag ${expectedTag} still does not point at it after ${waited} minutes.`
      : `watch: the Publish run succeeded but ${name}@${version} is not visible on npm after ${waited} minutes (the registry can lag).`,
  )
  console.error(`watch: check with \`npm view ${name} dist-tags\`, then re-run \`bun run release ${version} --watch-only\`.`)
  return 1
}

if (watchOnly) {
  if (push || flags.has("--watch") || flags.has("--no-watch") || dryRun || title !== undefined) fail(`--watch-only takes only a version. ${USAGE}`)
  if (!parse(version)) fail(`"${version}" is not a valid semver version (expected x.y.z)`)
  if (!git("tag", "--list", tag)) fail(`tag ${tag} does not exist locally; fetch it or run the release first`)
  process.exit(await watchRelease())
}
if (flags.has("--watch") && !push) fail("--watch needs --push; to follow an existing tag use --watch-only")
if (flags.has("--watch") && flags.has("--no-watch")) fail("--watch and --no-watch conflict")

if (title === undefined) fail(`--title is required. ${USAGE}`)
title = title.trim()
if (title.length > 40) fail(`title "${title}" is ${title.length} characters, the limit is 40`)
if (title.endsWith(".")) fail(`title "${title}" must not end with a period`)
const words = title.split(/\s+/).filter(Boolean)
if (words.length < 2 || words.length > 5) fail(`title "${title}" has ${words.length} word(s), it needs 2 to 5`)
if (title.replace(/^v/i, "") === version) fail("title must be more than the version number")

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
  `## [${version}] - ${date}: ${title}`,
  "",
  `**Full diff:** [v${previous}...${tag}](${repoUrl}/compare/v${previous}...${tag})`,
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
  console.log(`dry run: would commit "Release ${version}" and tag ${tag}${push ? ", then push" : ""}${watch ? " and watch the release" : ""}`)
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
  if (watch) process.exit(await watchRelease())
  console.log(`next: bun run release ${version} --watch-only`)
} else {
  console.log(`next: git push --atomic origin main ${tag}`)
}
