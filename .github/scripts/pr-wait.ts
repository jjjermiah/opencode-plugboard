#!/usr/bin/env bun
// Wait for a pull request's required checks, in the foreground, and print one verdict.
//
//   bun run pr-wait 445            wait until every check on the PR head has finished (max 50 minutes)
//   bun run pr-wait 445 --merge    then merge it with a merge commit when every check passed
//
// Waits until every check the main ruleset requires is present on the head and every listed check has finished.
// Prints the PR head, then a single line per failed check with its link, then `pr-wait: green` or
// `pr-wait: red`. A conflicting PR (GitHub runs no checks) is reported at once instead of waited on.
// Exit 0 only when every non-skipped check succeeded (and the merge, when asked, went through).
//
// When the main ruleset requires an approving review (docs/review-bot.md), a green PR also waits for it: the review gate
// posts it about a minute after the last check finishes. With the up-to-date rule on, a PR behind main is red at once;
// `--merge` updates the branch itself (`gh pr update-branch`) and waits for the new head's checks and review.
import { approvalState, mergeRules, type GhReview } from "./merge-gate.ts"

const REPO = "jjjermiah/opencode-plugboard"
const MAX_MS = 50 * 60_000
const POLL_MS = 20_000
// How long after the checks pass the approving review may take to appear.
const APPROVAL_MS = 15 * 60_000

const [number, ...rest] = process.argv.slice(2)
if (!number || !/^\d+$/.test(number)) throw new Error("usage: bun run pr-wait <pr-number> [--merge]")
const merge = rest.includes("--merge")

const gh = async (args: string[]): Promise<string> => {
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  if ((await proc.exited) !== 0) throw new Error(`gh ${args.join(" ")}: ${err.trim()}`)
  return out
}

interface Check {
  readonly name: string
  readonly state: string
  readonly link: string
}

const view = async () =>
  JSON.parse(await gh(["pr", "view", number, "-R", REPO, "--json", "headRefOid,mergeable,mergeStateStatus,state,reviews"])) as {
    headRefOid: string
    mergeable: string
    mergeStateStatus: string
    state: string
    reviews: GhReview[]
  }

const checks = async (): Promise<Check[]> => {
  // `gh pr checks` exits 8 while checks are pending and 1 when one failed; read the JSON either way.
  const proc = Bun.spawn(["gh", "pr", "checks", number, "-R", REPO, "--json", "name,state,link"], { stdout: "pipe", stderr: "pipe" })
  const out = await new Response(proc.stdout).text()
  await proc.exited
  return out.trim() ? (JSON.parse(out) as Check[]) : []
}

const started = Date.now()
let pr = await view()
console.log(`pr-wait: #${number} head ${pr.headRefOid.slice(0, 7)} (${pr.state})`)
if (pr.state !== "OPEN") throw new Error(`#${number} is ${pr.state}`)

// The checks the main branch ruleset requires. Right after a push only some checks are registered, and those may
// all be done already; waiting until every required check is present and done avoids a green verdict on a partial set.
const rules = mergeRules(JSON.parse(await gh(["api", `repos/${REPO}/rules/branches/main`])))
const requiredNames = [...rules.checks]

const DONE = new Set(["SUCCESS", "FAILURE", "CANCELLED", "SKIPPED", "NEUTRAL", "ERROR", "TIMED_OUT", "ACTION_REQUIRED", "STALE"])
let list: Check[] = []
for (;;) {
  pr = await view()
  if (pr.mergeable === "CONFLICTING") {
    console.log("pr-wait: red: the PR conflicts with main, so GitHub runs no checks. Merge origin/main, resolve, push.")
    process.exit(1)
  }
  if (rules.strict && pr.mergeStateStatus === "BEHIND") {
    if (!merge) {
      console.log(
        `pr-wait: red: the PR is behind main and the ruleset requires an up-to-date branch. Run \`gh pr update-branch ${number} -R ${REPO}\` (or merge origin/main and push), or use --merge, which does it.`,
      )
      process.exit(1)
    }
    await gh(["pr", "update-branch", number, "-R", REPO])
    console.log("pr-wait: the PR was behind main, updated its branch; waiting for the checks and the review on the new head")
    await Bun.sleep(POLL_MS)
    continue
  }
  list = await checks()
  const missing = requiredNames.filter((name) => !list.some((check) => check.name === name))
  if (missing.length === 0 && list.length > 0 && list.every((check) => DONE.has(check.state))) break
  if (Date.now() - started > MAX_MS) {
    const pending = [...missing, ...list.filter((c) => !DONE.has(c.state)).map((c) => c.name)]
    console.log(`pr-wait: red: checks still pending or missing after 50 minutes: ${pending.join(", ")}`)
    process.exit(1)
  }
  await Bun.sleep(POLL_MS)
}

const failed = list.filter((check) => !["SUCCESS", "SKIPPED", "NEUTRAL"].includes(check.state))
for (const check of failed) console.log(`  ${check.state.toLowerCase()}: ${check.name}  ${check.link}`)
if (failed.length > 0) {
  console.log(`pr-wait: red: ${failed.length} of ${list.length} checks did not pass`)
  process.exit(1)
}
console.log(`pr-wait: green: ${list.length} checks passed in ${Math.round((Date.now() - started) / 1000)}s`)

// An approving review on this head, when the ruleset asks for one. A new push dismisses a stale approval, so the head is read again each round.
if (rules.approvals > 0) {
  const approvalStart = Date.now()
  for (;;) {
    pr = await view()
    const approval = approvalState(pr.reviews, pr.headRefOid, rules.approvals)
    if (approval.state === "approved") break
    if (approval.state === "changes-requested") {
      console.log(`pr-wait: red: changes requested by ${approval.by.join(", ")}`)
      process.exit(1)
    }
    if (Date.now() - approvalStart > APPROVAL_MS) {
      console.log(`pr-wait: red: no approving review on ${pr.headRefOid.slice(0, 7)} after 15 minutes (${approval.have} of ${rules.approvals}). Is the review gate set up? See docs/review-bot.md.`)
      process.exit(1)
    }
    console.log(`pr-wait: waiting for ${rules.approvals} approving review(s) on ${pr.headRefOid.slice(0, 7)} (have ${approval.have})`)
    await Bun.sleep(POLL_MS)
  }
  console.log(`pr-wait: approved on ${pr.headRefOid.slice(0, 7)}`)
}
if (merge) {
  await gh(["pr", "merge", number, "-R", REPO, "--merge", "--delete-branch"])
  console.log(`pr-wait: merged #${number}`)
}
