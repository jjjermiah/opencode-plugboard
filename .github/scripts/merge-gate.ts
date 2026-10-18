// The part of the main ruleset that pr-wait.ts and release.ts wait for besides the checks: the approving review and the
// up-to-date branch (docs/review-bot.md). Pure functions over `gh` JSON, so a test can feed them. Not shipped in the package.

export interface MergeRules {
  /** required_approving_review_count of the pull request rule; 0 when there is none. */
  readonly approvals: number
  /** strict_required_status_checks_policy: the branch must be up to date with main before it merges. */
  readonly strict: boolean
  /** The contexts of the required status checks. */
  readonly checks: readonly string[]
}

interface Rule {
  readonly type: string
  readonly parameters?: {
    readonly required_approving_review_count?: number
    readonly strict_required_status_checks_policy?: boolean
    readonly required_status_checks?: readonly { readonly context: string }[]
  }
}

/** The rules `gh api repos/{o}/{r}/rules/branches/main` returns, reduced to what a merge waits for. */
export const mergeRules = (rules: readonly Rule[]): MergeRules => ({
  approvals: Math.max(0, ...rules.filter((rule) => rule.type === "pull_request").map((rule) => rule.parameters?.required_approving_review_count ?? 0)),
  strict: rules.some((rule) => rule.type === "required_status_checks" && rule.parameters?.strict_required_status_checks_policy === true),
  checks: rules.flatMap((rule) => (rule.type === "required_status_checks" ? (rule.parameters?.required_status_checks ?? []).map((check) => check.context) : [])),
})

export interface GhReview {
  readonly state: string
  readonly author: { readonly login: string } | null
  readonly commit: { readonly oid: string } | null
}
export type Approval = { readonly state: "approved" } | { readonly state: "waiting"; readonly have: number } | { readonly state: "changes-requested"; readonly by: readonly string[] }

/**
 * Each reviewer's latest approving or blocking review counts; a comment does not replace it, a dismissal clears it.
 * An approval counts only on the commit that is the head now: a push can leave an approval for the old head until
 * GitHub dismisses it, and the ruleset would not count it either.
 */
export const approvalState = (reviews: readonly GhReview[], head: string, needed: number): Approval => {
  const latest = new Map<string, GhReview>()
  for (const review of reviews) {
    if (!["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) continue
    latest.set(review.author?.login ?? "(deleted user)", review)
  }
  const blocking = [...latest].filter(([, review]) => review.state === "CHANGES_REQUESTED").map(([login]) => login)
  if (blocking.length > 0) return { state: "changes-requested", by: blocking }
  const have = [...latest.values()].filter((review) => review.state === "APPROVED" && review.commit?.oid === head).length
  return have >= needed ? { state: "approved" } : { state: "waiting", have }
}
