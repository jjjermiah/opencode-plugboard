#!/usr/bin/env bun
// Cuts a release from CHANGELOG.md: moves [Unreleased] under a version heading, fixes the link
// refs and bumps package.json, commits on a release branch, opens a pull request, waits for every
// check on it to pass, merges it, then tags the merge commit on main. Not shipped in the package.
//
//   bun run release 0.3.0 --title "Short Creative Title" --push [--no-watch]
//   bun run release 0.3.0 --title "Short Creative Title" --dry-run
//   bun run release 0.3.0 --watch-only
//
// Every release needs a title: 2 to 5 words, at most 40 characters, no trailing
// period. It lands in the heading (`## [0.3.0] - <date>: Title`) and names the GitHub release.
//
// main is protected (a ruleset requires a pull request and the CI checks), so the script never
// commits to main or pushes it. --push does this, from a clean main that equals origin/main and whose
// newest CI run passed (docs/releasing.md):
//   1. commits the release on release/vX.Y.Z and pushes that branch,
//   2. opens a pull request into main, with the release notes as its body,
//   3. watches every check on that pull request (the advisory benchmark aside). A check that fails
//      stops the script with the pull request open and nothing merged or tagged. Auto-merge is not used.
//   4. when every check has passed, merges that exact commit (a merge commit, the branch is deleted),
//   5. waits for the ci.yml push run on the merge commit (a new commit, tested only by that run) and tags
//      it only if the run succeeded, then pushes the tag. The tag starts the Publish workflow. A failed or
//      cancelled run stops here with nothing tagged. --resume re-enters step 3 for the open pull request,
//      after a fix is pushed to the release branch. If that pull request is already merged, --resume starts
//      at step 5 on its merge commit; if the tag is already on origin, it only watches the release.
//   6. follows the release to the end (unless --no-watch): it finds the Publish run for the tag,
//      waits for it, then polls npm until the version is visible and the dist-tag points at it.
//      It exits with that result. --watch-only does only that part for an existing tag.
//
// --dry-run prints the diff and the plan and changes nothing. Git state problems (dirty tree,
// wrong branch) and the state of CI on main are reported as warnings there, so you can preview
// while editing.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import semver from "semver"
import { changelogBlock, collectCommits } from "./commit-detail.ts"

const PLACEHOLDER = "Nothing yet."

const USAGE =
  'usage: bun run release <version> --title "Short Creative Title" (--push [--no-watch] [--resume] | --dry-run)\n       bun run release <version> --watch-only'
let title: string | undefined
const flags = new Set<string>()
const positional: string[] = []
const unknown: string[] = []
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === "--title") title = argv[++i] ?? ""
  else if (a.startsWith("--title=")) title = a.slice("--title=".length)
  else if (["--push", "--dry-run", "--watch", "--no-watch", "--watch-only", "--resume"].includes(a)) flags.add(a)
  else if (a.startsWith("--")) unknown.push(a)
  else positional.push(a)
}
if (unknown.length || positional.length !== 1) {
  console.error(USAGE)
  process.exit(2)
}
const dryRun = flags.has("--dry-run")
const push = flags.has("--push")
const resume = flags.has("--resume")
const watchOnly = flags.has("--watch-only")
const watch = !flags.has("--no-watch") && (push || flags.has("--watch"))
const version = positional[0].replace(/^v/, "")
const tag = `v${version}`
const releaseBranch = `release/${tag}`

function fail(message: string): never {
  console.error(`release: ${message}`)
  process.exit(1)
}

function git(...gitArgs: string[]): string {
  const run = Bun.spawnSync(["git", ...gitArgs], { stderr: "pipe" })
  if (run.exitCode !== 0) fail(`git ${gitArgs.join(" ")} failed: ${run.stderr.toString().trim()}`)
  return run.stdout.toString().trim()
}

// Exact form only: semver.valid also accepts a leading "v", surrounding spaces and build metadata,
// and returns them stripped, so comparing the result back to the input rejects those.
function validVersion(v: string): boolean {
  return semver.valid(v) === v
}

const PUBLISH_TIMEOUT_MS = 5 * 60_000
const POLL_MS = 10_000
const CHECKS_TIMEOUT_MS = 60 * 60_000
const CHECKS_POLL_MS = 20_000
// How long a required check may take to report on the pull request before the release fails.
const CHECKS_GRACE_MS = 10 * 60_000
// The ci.yml run on the merge commit: its wait, and the poll.
const MERGE_CI_TIMEOUT_MS = 45 * 60_000
const MERGE_CI_POLL_MS = 20_000
// The checks that must have reported before the release can merge: the required checks of the main
// ruleset (docs/releasing.md). A check that never appears is not a pass.
const EXPECTED_CHECKS = ["CI passed", "Lint commit messages", "Analyze (javascript-typescript)"]
// Not waited for and never blocking: the benchmark is advisory (ci.yml).
const ADVISORY_CHECKS = new Set(["Request-path benchmarks (advisory)"])

function gh(...ghArgs: string[]): { ok: boolean; out: string; err: string } {
  const run = Bun.spawnSync(["gh", ...ghArgs], { stderr: "pipe" })
  return { ok: run.exitCode === 0, out: run.stdout.toString().trim(), err: run.stderr.toString().trim() }
}

function npmView(spec: string, field: string): string {
  const run = Bun.spawnSync(["npm", "view", spec, field, "--json", "--prefer-online"], { stderr: "pipe" })
  return run.exitCode === 0 ? run.stdout.toString().trim() : ""
}

// Runs git and returns its stdout, or "" when it fails (the dry run must not fail on it).
function tryGit(...gitArgs: string[]): string {
  const run = Bun.spawnSync(["git", ...gitArgs], { stderr: "pipe" })
  return run.exitCode === 0 ? run.stdout.toString().trim() : ""
}

// Parallel worktrees share one .git, so a fetch can lose a ref-lock race ("cannot lock ref"). Retry it.
const FETCH_ATTEMPTS = 4
const FETCH_BACKOFF_MS = 2_000

// Runs git fetch with retries and returns the last error when every attempt failed.
function fetchOrigin(...fetchArgs: string[]): { ok: boolean; err: string } {
  let err = ""
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    const run = Bun.spawnSync(["git", "fetch", ...fetchArgs], { stderr: "pipe" })
    if (run.exitCode === 0) return { ok: true, err: "" }
    err = run.stderr.toString().trim()
    if (attempt < FETCH_ATTEMPTS) {
      console.log(`git fetch ${fetchArgs.join(" ")} failed (attempt ${attempt} of ${FETCH_ATTEMPTS}), retrying: ${err}`)
      Bun.sleepSync(FETCH_BACKOFF_MS * attempt)
    }
  }
  return { ok: false, err }
}

function fetchOrFail(...fetchArgs: string[]): void {
  const fetched = fetchOrigin(...fetchArgs)
  if (!fetched.ok) fail(`git fetch ${fetchArgs.join(" ")} failed after ${FETCH_ATTEMPTS} attempts: ${fetched.err}. Nothing is tagged.`)
}

type CiRun = { databaseId: number; status: string; conclusion: string; url: string }
type Check = { name: string; bucket: string; link: string }

// The newest ci.yml push run on a commit of main, or the reason there is none (gh failed, or no run yet).
// Highest databaseId: a re-run keeps its id, so this is always the latest attempt, not the first.
function latestCiRun(sha: string): { run?: CiRun; problem?: string } {
  const listed = gh("run", "list", "--workflow", "ci.yml", "--branch", "main", "--commit", sha, "--event", "push", "--limit", "10", "--json", "databaseId,status,conclusion,url")
  if (!listed.ok) return { problem: `gh run list failed (${listed.err || "is gh installed and logged in?"}).` }
  const runs = JSON.parse(listed.out || "[]") as CiRun[]
  if (!runs.length) return { problem: `there is no CI run for ${sha.slice(0, 7)} yet.` }
  return { run: runs.reduce((a, b) => (b.databaseId > a.databaseId ? b : a)) }
}

// The problem with CI on a commit of main, or undefined when its newest CI run is completed and successful.
// No run at all is a problem too: a release is never cut from an unverified commit.
function ciProblemOn(sha: string): string | undefined {
  const { run, problem } = latestCiRun(sha)
  if (!run) return problem
  if (run.status !== "completed") return `the newest CI run for ${sha.slice(0, 7)} is ${run.status} (${run.url}). Wait for it to finish.`
  if (run.conclusion !== "success") return `the newest CI run for ${sha.slice(0, 7)} concluded ${run.conclusion} (${run.url}).`
  return undefined
}

// Returns the pull request URL once its head is `sha`, the commit this run fetched or pushed. Right after a push
// GitHub can still report the previous head, and the checks for that head are not the ones this release needs.
// A pull request that is no longer open stops the release.
async function waitForHead(branch: string, sha: string): Promise<string> {
  const start = Date.now()
  for (;;) {
    const view = gh("pr", "view", branch, "--json", "state,headRefOid,url")
    if (view.ok) {
      const pr = JSON.parse(view.out) as { state: string; headRefOid: string; url: string }
      if (pr.state !== "OPEN") fail(`${pr.url} is ${pr.state}, not open. Nothing is merged or tagged.`)
      if (pr.headRefOid === sha) return pr.url
      console.log(`waiting: ${pr.url} is at ${pr.headRefOid.slice(0, 7)}, expected ${sha.slice(0, 7)}`)
    } else {
      console.log(`waiting: gh pr view ${branch} failed (${view.err || "no output"})`)
    }
    if (Date.now() - start > CHECKS_TIMEOUT_MS) fail(`${branch}'s pull request did not reach ${sha.slice(0, 7)} within 60 minutes. Nothing is merged or tagged.`)
    await Bun.sleep(CHECKS_POLL_MS)
  }
}

// Watches every check on the release pull request until all of them have passed. The advisory benchmark is
// ignored. A failing, cancelled or skipped check stops at once: the pull request stays open, nothing is merged
// or tagged, and the script exits non-zero. Only a parsed check list is judged. Empty output, "no checks
// reported yet" and transient gh errors keep the watch going, bounded by CHECKS_TIMEOUT_MS. A required check
// (EXPECTED_CHECKS) that has not reported after CHECKS_GRACE_MS fails the release, because its name changed or it
// does not run on pull requests.
async function waitForChecks(branch: string, url: string): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < CHECKS_TIMEOUT_MS) {
    const listed = gh("pr", "checks", branch, "--json", "name,bucket,link")
    // gh prints "no checks reported" on stderr with nothing on stdout, and a failed or pending check still exits
    // non-zero with the JSON on stdout. The exit code is not used: only the parsed list is.
    const checks = listed.out.startsWith("[") ? (JSON.parse(listed.out) as Check[]) : undefined
    if (!checks) {
      console.log(`waiting: no usable check list yet (${listed.err || "empty output"})`)
      await Bun.sleep(CHECKS_POLL_MS)
      continue
    }
    const gating = checks.filter((c) => !ADVISORY_CHECKS.has(c.name))
    const failing = gating.filter((c) => c.bucket === "fail" || c.bucket === "cancel" || c.bucket === "skipping")
    if (failing.length) {
      console.error(`release: ${failing.length} check(s) did not pass on ${url}. Nothing is merged or tagged; the pull request stays open.`)
      for (const c of failing) console.error(`  ${c.bucket}: ${c.name} ${c.link}`)
      console.error(`Fix it on the release branch and push (git switch ${branch}, commit, git push), then run bun run release ${version} --title "..." --push --resume from main. See docs/releasing.md, "When a check fails".`)
      process.exit(1)
    }
    const pending = gating.filter((c) => c.bucket === "pending")
    const unreported = EXPECTED_CHECKS.filter((name) => !gating.some((c) => c.name === name))
    if (unreported.length && Date.now() - start > CHECKS_GRACE_MS) {
      fail(`required check(s) never reported on ${url}: ${unreported.join(", ")}. Their names changed, or the workflow does not run on pull requests. Nothing is merged or tagged.`)
    }
    if (!pending.length && !unreported.length) {
      console.log(`all ${gating.length} checks passed on ${url}`)
      return
    }
    console.log(`waiting: ${pending.length} pending${unreported.length ? `, not reported yet: ${unreported.join(", ")}` : ""}`)
    await Bun.sleep(CHECKS_POLL_MS)
  }
  fail(`the checks on ${url} did not all pass within 60 minutes. Nothing is merged or tagged. Fix the pull request, or close it and cut the release again.`)
}

// The merge commit of the merged release pull request: on main, with the release's package.json version.
async function mergedCommit(branch: string): Promise<string> {
  const deadline = Date.now() + 2 * 60_000
  for (;;) {
    const view = gh("pr", "view", branch, "--json", "state,mergeCommit,url")
    if (!view.ok) fail(`gh pr view ${branch} failed: ${view.err}`)
    const pr = JSON.parse(view.out) as { state: string; mergeCommit: { oid: string } | null; url: string }
    if (pr.state === "MERGED" && pr.mergeCommit) return pr.mergeCommit.oid
    if (Date.now() > deadline) fail(`${pr.url} is ${pr.state}, not merged. Nothing is tagged.`)
    await Bun.sleep(5_000)
  }
}

// Waits for the ci.yml push run on the merge commit: the run that tests the exact commit the tag will point at.
// Gh errors and a run that has not appeared yet keep the wait going, up to MERGE_CI_TIMEOUT_MS.
async function waitForMergeCi(sha: string): Promise<CiRun> {
  const deadline = Date.now() + MERGE_CI_TIMEOUT_MS
  for (;;) {
    const { run, problem } = latestCiRun(sha)
    if (run?.status === "completed") return run
    console.log(run ? `waiting for ${run.url}: ${run.status}` : `waiting for the CI run on ${sha.slice(0, 7)}: ${problem}`)
    if (Date.now() > deadline) fail(`no completed CI run on the merge commit ${sha.slice(0, 7)} within 45 minutes. Nothing is tagged. Check the Actions tab for ci.yml on ${sha.slice(0, 7)}.`)
    await Bun.sleep(MERGE_CI_POLL_MS)
  }
}

// The tag goes only on the commit whose own CI run passed. The checks before the merge ran on the pull request
// head, and a merge commit is a new commit: nobody has tested it until its ci.yml push run finishes. Each push to
// main has its own concurrency group in ci.yml (keyed by its SHA), so a later push cannot cancel this run.
async function tagAfterMergeCi(mergeSha: string): Promise<void> {
  const short = mergeSha.slice(0, 7)
  const mergeRun = await waitForMergeCi(mergeSha)
  if (mergeRun.conclusion === "cancelled") {
    fail(`CI on the merge commit ${short} was cancelled (${mergeRun.url}). Nothing is tagged and npm has nothing. Re-run it with gh run rerun ${mergeRun.databaseId}. Once that run concludes success, run bun run release ${version} --title "..." --push --resume: it tags ${short} after the re-run passes. If the re-run fails, fix forward on main and cut the next patch.`)
  }
  if (mergeRun.conclusion !== "success") {
    fail(`CI on the merge commit ${short} concluded ${mergeRun.conclusion} (${mergeRun.url}). Nothing is tagged and npm has nothing. main now carries the release commit: fix forward through a pull request and cut the next patch. Do not tag ${short}.`)
  }
  // A local tag at this commit is left from an earlier run whose push failed: push it, do not create it again.
  if (tryGit("rev-list", "-n1", tag) !== mergeSha) git("tag", "-a", tag, mergeSha, "-m", `Release ${version}`)
  git("push", "origin", tag)
  console.log(`CI passed on ${short}, tagged ${tag} and pushed the tag`)
}

// After a merged resume, brings a clean local main up to origin/main, as the normal run does. Anything else is left alone.
function fastForwardMain(): void {
  if (tryGit("branch", "--show-current") !== "main" || tryGit("status", "--porcelain")) return
  const ff = Bun.spawnSync(["git", "merge", "--ff-only", "origin/main"], { stderr: "pipe" })
  if (ff.exitCode !== 0) console.log(`main not fast-forwarded to origin/main: ${ff.stderr.toString().trim()}`)
  else console.log("local main fast-forwarded to origin/main")
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
  if (!validVersion(version)) fail(`"${version}" is not a valid semver version (expected x.y.z)`)
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

// --resume on a release whose pull request is already merged (the merge deleted its branch). Nothing is cut again:
// the merge commit's CI is waited for, and that commit is tagged, as the normal run does. This runs before the version
// and changelog checks below, which a merged release has already moved past. A merged pull request is tagged only when
// it was merged into main, its merge commit is on origin/main, and that commit is the release of this version.
// An open or closed pull request falls through to the normal resume, which judges it.
if (resume && push) {
  const view = gh("pr", "view", releaseBranch, "--json", "state,mergeCommit,baseRefName,url")
  if (!view.ok) fail(`gh pr view ${releaseBranch} failed: ${view.err || "no output"}. Nothing is tagged. Check that gh is logged in and that the release pull request exists.`)
  const pr = JSON.parse(view.out) as { state: string; mergeCommit: { oid: string } | null; baseRefName: string; url: string }
  if (pr.state === "MERGED") {
    if (!pr.mergeCommit) fail(`${pr.url} is merged, but gh reports no merge commit. Nothing is tagged.`)
    if (pr.baseRefName !== "main") fail(`${pr.url} was merged into ${pr.baseRefName}, not main. Nothing is tagged.`)
    const mergeSha = pr.mergeCommit.oid
    const short = mergeSha.slice(0, 7)
    console.log(`${pr.url} is already merged at ${short}`)
    fetchOrFail("origin", "main")
    if (Bun.spawnSync(["git", "merge-base", "--is-ancestor", mergeSha, "origin/main"], { stderr: "pipe" }).exitCode !== 0) {
      fail(`merge commit ${short} of ${pr.url} is not on origin/main. Nothing is tagged.`)
    }
    const pkgVersion = (JSON.parse(git("show", `${mergeSha}:package.json`)) as { version: string }).version
    if (pkgVersion !== version) fail(`package.json at merge commit ${short} says ${pkgVersion}, not ${version}. Nothing is tagged.`)
    fastForwardMain()
    const localAt = tryGit("rev-list", "-n1", tag)
    if (localAt && localAt !== mergeSha) fail(`local tag ${tag} is at ${localAt.slice(0, 7)}, not at the merge commit ${short}. Nothing is tagged or pushed. Check it, and delete the local tag if it is wrong.`)
    if (tryGit("ls-remote", "--tags", "origin", `refs/tags/${tag}`)) {
      fetchOrFail("origin", `refs/tags/${tag}:refs/tags/${tag}`)
      const tagAt = git("rev-list", "-n1", tag)
      if (tagAt !== mergeSha) fail(`${tag} already exists on origin at ${tagAt.slice(0, 7)}, not at the merge commit ${short}. Nothing is tagged. Check the tag by hand.`)
      console.log(`${tag} already exists on origin at ${short}, so nothing is tagged again.`)
      process.exit(watch ? await watchRelease() : 0)
    }
    await tagAfterMergeCi(mergeSha)
    process.exit(watch ? await watchRelease() : 0)
  }
}

const problems: string[] = []
if (!validVersion(version)) fail(`"${version}" is not a valid semver version (expected x.y.z)`)

const pkgText = readFileSync("package.json", "utf8")
const current = (JSON.parse(pkgText) as { version: string }).version
if (!semver.gt(version, current)) fail(`${version} does not increase on package.json version ${current}`)

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
if (!semver.gt(version, previous)) fail(`${version} does not increase on the last released version ${previous}`)

// The commit-level detail: every commit since the previous tag, grouped by type, in a
// collapsed block under the curated notes. release-notes.ts rebuilds it for the GitHub release.
const detail = changelogBlock(collectCommits(`v${previous}`, "HEAD"), repoUrl)

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
  ...(detail ? [detail, ""] : []),
  ...lines.slice(sectionEnd, linkAt),
  `[Unreleased]: ${repoUrl}/compare/${tag}...HEAD`,
  `[${version}]: ${repoUrl}/compare/v${previous}...${tag}`,
  ...lines.slice(linkAt + 1),
].join("\n")

const nextPkg = pkgText.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`)
if (nextPkg === pkgText) fail("could not find the version field in package.json")

const commitSubject = `chore(release): ${version}`
const commitBody = `${title}. Moves [Unreleased] under ${version} in CHANGELOG.md and bumps package.json.`

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
  // The remote-tracking ref only: the working tree and the remote are untouched. Without it the CI line can be stale.
  fetchOrigin("-q", "origin", "main")
  const mainSha = tryGit("rev-parse", "--verify", "-q", "origin/main")
  const ci = mainSha ? ciProblemOn(mainSha) : "origin/main is not known locally (git fetch origin main)."
  console.log(ci ? `warning (would refuse with --push): ${ci}` : `CI on origin/main ${mainSha.slice(0, 7)} is green`)
  if (push) {
    console.log(`dry run: would create ${releaseBranch} and commit "${commitSubject}", push it, open a pull request into main, wait until every check on it passes (the advisory benchmark aside; a failure stops there with the pull request open), merge that exact commit, wait for the CI run on the merge commit, and tag the merge commit as ${tag} only if that run succeeded, then push the tag${watch ? ", then watch the release" : ""}`)
  } else {
    console.log(`dry run: a real run needs --push (releases go through a pull request). It would commit "${commitSubject}" on ${releaseBranch} and open the pull request`)
  }
  process.exit(0)
}

if (!push) fail(`releases go through a pull request now: add --push (or --dry-run to preview). ${USAGE}`)
if (resume && !push) fail("--resume needs --push")
if (problems.length) fail(problems.join("; "))
if (!existsSync(".git")) fail("run this from the repository root")

// main is the base of the release pull request. A local main that differs from origin/main would
// ride along in it, so refuse until the two agree.
fetchOrFail("origin", "main")
if (git("rev-parse", "main") !== git("rev-parse", "origin/main")) fail("local main differs from origin/main. Pull or push it first, so the release pull request carries only the release.")
// A release is cut only from a green main: the newest CI run on origin/main's commit must have passed.
const mainCiProblem = ciProblemOn(git("rev-parse", "origin/main"))
if (mainCiProblem) fail(`${mainCiProblem} Nothing was committed or pushed.`)

let prUrl: string
let headSha: string
if (resume) {
  // A check failed earlier and its fix is pushed to the release branch: watch that same pull request again.
  if (!tryGit("ls-remote", "--heads", "origin", releaseBranch)) fail(`${releaseBranch} is not on origin, so there is nothing to resume. Run it without --resume.`)
  fetchOrFail("origin", releaseBranch)
  headSha = git("rev-parse", `origin/${releaseBranch}`)
  console.log(`resuming ${releaseBranch} at ${headSha.slice(0, 7)}`)
} else {
  if (git("branch", "--list", releaseBranch)) fail(`branch ${releaseBranch} already exists locally; delete it first`)
  if (tryGit("ls-remote", "--heads", "origin", releaseBranch)) fail(`branch ${releaseBranch} already exists on origin. If its pull request is open and failed a check, fix it there and run with --resume.`)

  git("switch", "-c", releaseBranch)
  writeFileSync("CHANGELOG.md", next)
  writeFileSync("package.json", nextPkg)
  git("add", "CHANGELOG.md", "package.json")
  git("commit", "-m", commitSubject, "-m", commitBody)
  console.log(`committed "${commitSubject}" on ${releaseBranch}`)
  git("push", "-u", "origin", releaseBranch)
  console.log(`pushed ${releaseBranch}`)
  headSha = git("rev-parse", "HEAD")

  const bodyDir = mkdtempSync(join(tmpdir(), "plugboard-release-"))
  const bodyFile = join(bodyDir, "pr-body.md")
  try {
    writeFileSync(bodyFile, [`Release ${tag}: ${title}`, "", body, ...(detail ? ["", detail] : []), ""].join("\n"))
    const created = gh("pr", "create", "--base", "main", "--head", releaseBranch, "--title", commitSubject, "--body-file", bodyFile)
    if (!created.ok) fail(`gh pr create failed: ${created.err}. ${releaseBranch} is pushed; open the pull request by hand, then merge it and tag its merge commit.`)
    prUrl = created.out
    console.log(`opened ${prUrl}`)
  } finally {
    rmSync(bodyDir, { recursive: true, force: true })
  }
}

// Nothing merges unless every check passes. Auto-merge is not used: it would merge on the required
// checks alone, and a red job outside them would still ship.
// The checks judged below are the ones for headSha: waitForHead returns only once the pull request is at that commit.
prUrl = await waitForHead(releaseBranch, headSha)
await waitForChecks(releaseBranch, prUrl)

// Merge only the commit that passed. The switch to main is needed because --delete-branch removes the
// local release branch, which must not be the one checked out.
git("switch", "main")
const merged = gh("pr", "merge", releaseBranch, "--merge", "--delete-branch", "--match-head-commit", headSha)
if (!merged.ok) fail(`could not merge ${prUrl}: ${merged.err}. Every check passed, nothing is tagged. Merge it by hand, then tag its merge commit.`)
const mergeSha = await mergedCommit(releaseBranch)
const short = mergeSha.slice(0, 7)
const fetched = fetchOrigin("origin", "main")
if (!fetched.ok) {
  fail(`merged to main at ${short}, but git fetch origin main failed after ${FETCH_ATTEMPTS} attempts: ${fetched.err}. Nothing is tagged. Once the fetch works, run bun run release ${version} --title "..." --push --resume: it finds the merged pull request and tags its merge commit after that commit's CI passes.`)
}
// Back on main, fast-forwarded to the merge, and the local release branch removed (it is merged).
git("merge", "--ff-only", "origin/main")
Bun.spawnSync(["git", "branch", "-d", releaseBranch], { stderr: "pipe" })
console.log(`merged to main at ${short}`)

await tagAfterMergeCi(mergeSha)

if (watch) process.exit(await watchRelease())
console.log(`next: bun run release ${version} --watch-only`)
