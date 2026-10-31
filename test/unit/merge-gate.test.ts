/**
 * What pr-wait and release wait for besides the checks (.github/scripts/merge-gate.ts, docs/review-bot.md): the ruleset's
 * approval count and up-to-date rule, and whether the reviews on the pull request head meet them.
 */
import { describe, expect, test } from "bun:test"
import { ADVISORY_CHECKS, approvalState, judgeChecks, mergeRules, type CheckRow, type GhReview } from "../../.github/scripts/merge-gate.ts"

const HEAD = "a".repeat(40)
const OLD = "b".repeat(40)
const review = (login: string, state: string, oid = HEAD): GhReview => ({ state, author: { login }, commit: { oid } })

const row = (name: string, bucket: string): CheckRow => ({ name, bucket, link: `https://example.test/${encodeURIComponent(name)}` })

describe("#591 the release gate's check judgement", () => {
  test("a skipped check that is not advisory stops the release, like a failed or cancelled one", () => {
    const verdict = judgeChecks([row("CI passed", "pass"), row("CodeQL", "skipping"), row("Host versions", "fail"), row("Examples", "cancel")])
    expect(verdict.failing.map((check) => check.name)).toEqual(["CodeQL", "Host versions", "Examples"])
  })

  test("the skipped Dependabot Auto-merge job and the advisory benchmark are ignored, whatever their bucket", () => {
    for (const bucket of ["skipping", "fail", "cancel", "pending"]) {
      const verdict = judgeChecks([row("CI passed", "pass"), row("Auto-merge", bucket), row("Request-path benchmarks (advisory)", bucket)])
      expect(verdict.failing).toEqual([])
      expect(verdict.pending).toEqual([])
      expect(verdict.gating.map((check) => check.name)).toEqual(["CI passed"])
    }
  })

  test("a release pull request with only passing checks and the skipped Auto-merge job passes the gate", () => {
    const verdict = judgeChecks([row("Analyze (javascript-typescript)", "pass"), row("CI passed", "pass"), row("Lint commit messages", "pass"), row("Auto-merge", "skipping")])
    expect(verdict.failing).toEqual([])
    expect(verdict.pending).toEqual([])
  })

  test("a pending check that is not advisory keeps the gate waiting", () => {
    const verdict = judgeChecks([row("CI passed", "pending"), row("Auto-merge", "skipping")])
    expect(verdict.pending.map((check) => check.name)).toEqual(["CI passed"])
  })

  test("the advisory set is exactly the benchmark and Auto-merge", () => {
    expect([...ADVISORY_CHECKS].sort()).toEqual(["Auto-merge", "Request-path benchmarks (advisory)"])
  })
})

describe("merge gate: the ruleset", () => {
  test("approvals, strict checks and the required contexts are read from the branch rules", () => {
    const rules = mergeRules([
      { type: "deletion" },
      { type: "pull_request", parameters: { required_approving_review_count: 1 } },
      { type: "required_status_checks", parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: "CI passed" }] } },
    ])
    expect(rules).toEqual({ approvals: 1, strict: true, checks: ["CI passed"] })
  })

  test("today's ruleset (0 approvals, not strict) asks for no review and no update", () => {
    const rules = mergeRules([
      { type: "pull_request", parameters: { required_approving_review_count: 0 } },
      { type: "required_status_checks", parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: "CI passed" }] } },
    ])
    expect(rules).toEqual({ approvals: 0, strict: false, checks: ["CI passed"] })
    expect(mergeRules([])).toEqual({ approvals: 0, strict: false, checks: [] })
  })
})

describe("merge gate: the approving review", () => {
  test("an approval on the head counts; none, or one on an older commit, keeps waiting", () => {
    expect(approvalState([review("bot", "APPROVED")], HEAD, 1)).toEqual({ state: "approved" })
    expect(approvalState([], HEAD, 1)).toEqual({ state: "waiting", have: 0 })
    expect(approvalState([review("bot", "APPROVED", OLD)], HEAD, 1)).toEqual({ state: "waiting", have: 0 })
    expect(approvalState([review("bot", "APPROVED"), review("person", "COMMENTED")], HEAD, 2)).toEqual({ state: "waiting", have: 1 })
  })

  test("a reviewer's latest verdict wins: a later approval clears a request for changes, a dismissal clears an approval", () => {
    expect(approvalState([review("bot", "CHANGES_REQUESTED"), review("bot", "APPROVED")], HEAD, 1)).toEqual({ state: "approved" })
    expect(approvalState([review("bot", "APPROVED"), review("bot", "DISMISSED")], HEAD, 1)).toEqual({ state: "waiting", have: 0 })
  })

  test("a comment after a request for changes does not clear it", () => {
    expect(approvalState([review("bot", "CHANGES_REQUESTED"), review("bot", "COMMENTED")], HEAD, 1)).toEqual({ state: "changes-requested", by: ["bot"] })
  })

  test("a request for changes blocks even when the approval count is met by someone else", () => {
    expect(approvalState([review("a", "APPROVED"), review("b", "CHANGES_REQUESTED")], HEAD, 1)).toEqual({ state: "changes-requested", by: ["b"] })
  })
})
