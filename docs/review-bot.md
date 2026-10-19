# Review bot

`main` can require one approving review, although the repository has one maintainer who cannot approve their own pull requests. A GitHub App named `plugboard-review` (any unique name works) reads each pull request, asks an LLM for a verdict, and posts an approving review, or a request for changes, as itself. This page is the setup, the proof, and the day-to-day behavior. The code is `.github/workflows/review-gate.yml` and `.github/scripts/review-gate.ts`.

Until the owner steps below are done, the workflow runs and prints a notice (`skipped, the App is not set up`). It never fails a pull request. The ruleset keeps requiring no approval until you flip it (step 6), so nothing here blocks a merge before then.

## What it does

1. `CI`, `Commits` or `CodeQL` finishes on a pull request. The workflow runs on `workflow_run`, so it always runs the default branch's copy of the script, never code from the pull request.
2. It acts only when that run succeeded, the pull request is open, not a draft, and its head branch is in this repository. A fork is skipped.
3. It reads the required checks from the `main` ruleset and acts only when every one is green on the commit the run tested. The last of the three workflows to finish finds them all green and reviews; the earlier ones find a check pending and stop. It checks again just before an approval is posted.
4. It reads the diff and the description through the API (no checkout), and `AGENTS.md` from the base branch. A diff over 200 KB gets a COMMENT review that says it is too large, and no approval.
5. It sends them to the Anthropic Messages API (`https://api.anthropic.com/v1/messages`) and expects a JSON verdict: `{"verdict": "approve" | "request_changes", "blockers": [{"file", "line?", "why"}], "notes": []}`. A blocker is a real bug, a security problem, a broken test or doc, or a violation of an `AGENTS.md` rule. Anything else is a note.
6. It posts one review with `commit_id` set to the commit the run tested: APPROVE with the notes, or REQUEST_CHANGES with the blockers. If the head moved since the run (or while the model answered), it posts nothing: the new push runs CI again and the gate starts over.
7. If the model call fails, or the answer does not parse, it posts a COMMENT review that says so. A COMMENT never counts as an approval, and nothing retries by itself. To try again, push a commit, or re-run the failed `Review gate` run from the Actions tab.

It never pushes, so "approval of the last push" stays satisfiable: the approver is never the pusher. The pull request text is untrusted data in the prompt. The bot is a second pair of eyes and a Scorecard `Code-Review` signal, not a security boundary. Only branches of this repository are reviewed, so the author already has write access, and a prompt-injection attempt in a description could at worst win an approval the author could not get alone.

Cost: Claude Sonnet 5.5 is priced at $2 per million input tokens and $10 per million output tokens (checked on the Anthropic models page, 2026-10-17). A 200 KB diff is roughly 55,000 input tokens, so a review costs about 15 cents at the cap and much less for a typical change (estimate, not measured).

## Owner steps

### 1. Create the App

Open `https://github.com/settings/apps/new` (your personal account, not an organization) and fill in:

| Field | Value |
|---|---|
| GitHub App name | `plugboard-review`. Names are unique across GitHub. If it is taken: `plugboard-review-bot`, `jjjermiah-plugboard-review`, or `opencode-plugboard-reviewer`. |
| Description | `Automated review of opencode-plugboard pull requests.` |
| Homepage URL | `https://github.com/jjjermiah/opencode-plugboard` |
| Callback URL | empty |
| Request user authorization (OAuth) during installation | off |
| Webhook, Active | **off** (the workflow polls nothing and needs no events) |

Repository permissions (everything else stays "No access"):

| Permission | Access | Why |
|---|---|---|
| Pull requests | Read and write | read the pull request and its reviews, post the review |
| Contents | Read | read `AGENTS.md` from the base branch, and list the pull requests of a commit |
| Checks | Read | check that every required check is green on the commit |
| Metadata | Read | always on |

`Actions: read` is not needed: the script reads check runs, not workflow runs. `Commit statuses` is not needed: every required check is a check run.

Under "Where can this GitHub App be installed?" choose **Only on this account**. Click "Create GitHub App".

### 2. Install it on this repository only

On the App's page choose "Install App", then your account, then **Only select repositories**, and pick `opencode-plugboard`. Do not choose "All repositories".

### 3. Variables and secrets

On the App's settings page, copy the **Client ID** (it starts with `Iv`). Under "Private keys" click "Generate a private key"; a `.pem` file downloads. Then, in the repository (Settings, Secrets and variables, Actions), or with `gh`:

```sh
gh variable set REVIEW_APP_CLIENT_ID -R jjjermiah/opencode-plugboard --body "<client id>"
gh secret set REVIEW_APP_PRIVATE_KEY -R jjjermiah/opencode-plugboard < path/to/the-key.pem
gh secret set REVIEW_LLM_API_KEY -R jjjermiah/opencode-plugboard        # paste an Anthropic API key at the prompt
```

Optional: `gh variable set REVIEW_LLM_MODEL -R jjjermiah/opencode-plugboard --body claude-sonnet-5-5` pins another Anthropic model id. Unset, the script uses `claude-sonnet-5-5`. Delete the `.pem` from your disk once the secret is set. Use a dedicated Anthropic key with a spending limit, not a key you use elsewhere.

All three are Actions secrets and variables. The workflow needs no `GITHUB_TOKEN` write permission.

**Dependabot pull requests (unverified).** GitHub gives a workflow that a Dependabot pull request triggers the Dependabot secrets, not the Actions secrets, and this applies to `workflow_run` too as far as the docs say. If a Dependabot pull request logs `skipped, the App is not set up`, add the same two secrets under Settings, Secrets and variables, Dependabot.

### 4. Test on a throwaway pull request

The workflow only exists for `workflow_run` once it is on `main`, so merge the pull request that adds it first. Then prove the approval counts toward a required review without touching `main`'s ruleset:

1. Make a branch `review-gate-test` from `main` and push it. Add a repository ruleset named `review-gate-test` that targets only that branch (`refs/heads/review-gate-test`), with: require a pull request (1 approving review, dismiss stale approvals on push, require approval of the most recent push) and require status checks (`CI passed`, `Lint commit messages`, `Analyze (javascript-typescript)`, up to date before merging). The gate reads the required checks from the base branch's rules, so this ruleset must list them, or the gate finds nothing to verify and skips.
2. Branch `review-gate-test-pr` from `review-gate-test`, change one doc line, push, and open a pull request into `review-gate-test`. Do not enable auto-merge.
3. Before the review: `gh pr view <n> --json mergeStateStatus` says `BLOCKED`.
4. When CI, commit lint and CodeQL are green, the `Review gate` run starts (Actions tab, workflow "Review gate"). It should end with an `APPROVED` review by `plugboard-review[bot]` and the step summary `approved`.
5. `gh pr view <n> --json mergeStateStatus,reviews` should now say `CLEAN` (not `BLOCKED`) with the bot's review. That is the proof that the App's approval counts toward the ruleset.
6. Push another commit to `review-gate-test-pr`. The approval is dismissed as stale (`BLOCKED` again). CI runs, and the gate approves the new head. That proves the re-review loop and "approval of the last push".
7. Also try an oversize diff (add a file over 200 KB): expect a COMMENT review that says it is too large, and `BLOCKED`. And push a change that leaves a plain bug: expect REQUEST_CHANGES with a blocker.
8. Close the pull request and delete both branches and the `review-gate-test` ruleset.

If step 5 stays `BLOCKED` after an `APPROVED` bot review, do not flip `main`. The inference that an App approval counts is wrong for this setup, and a different reviewer identity is needed (for example a second GitHub account with write access).

### 5. Scorecard

OpenSSF Scorecard `Code-Review` counts a pull request as reviewed when an approving review comes from an account other than the author. The bot's approval fits that. `Branch-Protection` tier 2 needs one required approval, up-to-date checks, approval of the last push, and dismissal of stale reviews: the four fields in step 6. The workflow does not check out pull request code, so `Dangerous-Workflow` is unaffected (the only checkout is the default branch, and only the script is fetched).

### 6. Flip the ruleset (after the test passes)

Settings, Rules, Rulesets, `main`. This is the owner's step; nothing in the repository changes it. In the "Require a pull request before merging" rule:

| Field | New value | Today |
|---|---|---|
| `required_approving_review_count` | `1` | `0` |
| `dismiss_stale_reviews_on_push` | `true` | `false` |
| `require_last_push_approval` | `true` | `false` |

In the "Require status checks to pass" rule: `strict_required_status_checks_policy` (require branches to be up to date before merging) `true`, today `false`. Keep the required checks as they are. Do not add a bypass for the maintainer.

Effects to expect afterwards:

- Every pull request, including Dependabot's and `host-bump.yml`'s, waits for the bot's approval. Auto-merge still works: it merges when the approval lands.
- A pull request behind `main` cannot merge until its branch is updated, and the update starts CI and the review again. Merging several pull requests in a row therefore costs one update and one re-run for each that is still open.
- The bot does not approve a pull request whose required check is red, whose diff is over 200 KB, or when the model call fails. For the last two you need a break-glass: set the review count back to `0`, merge, and set it to `1` again. A bot outage or an expired `REVIEW_LLM_API_KEY` blocks all merges in the same way, so watch for the Actions run failing or the pull request sitting without a review.

## `pr-wait` and `release` with a required approval

Both scripts read the `main` ruleset (`.github/scripts/merge-gate.ts`), so they need no edit when you flip it:

- **`bun run pr-wait <n>`** waits for the checks as before. When the ruleset requires approvals it then waits up to 15 minutes for an approving review on the current head and prints `pr-wait: approved on <sha>` before `--merge` merges. Changes requested, or no approval after 15 minutes, is `pr-wait: red`. With "up to date before merging" on, a pull request that is behind `main` is red at once with the command to update it; `bun run pr-wait <n> --merge` runs `gh pr update-branch` itself and then waits for the new head's checks and review.
- **`bun run release X.Y.Z --push`** waits for the checks, then (after the new `waitForMergeGate` step) for the review on the release pull request, then merges that exact commit. If `main` moved while the checks ran and the branch is behind, it stops before merging, with nothing merged or tagged, and prints the fix: `gh pr update-branch release/vX.Y.Z`, then `bun run release X.Y.Z --title "..." --push --resume`. `--resume` reads the updated branch head and waits for its checks and review. Release the project with nothing else merging to `main` during the ten or so minutes of the run and this never happens.

Both read the ruleset with the logged-in `gh` user, who can read a public repository's rules.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Run says `skipped, the App is not set up` | A variable or secret is missing, or (Dependabot) is not a Dependabot secret. |
| `create-github-app-token` fails | Wrong client ID or key, or the App is not installed on this repository. |
| `review-gate: ... skipped: required check "X" has not reported` | Expected for the first two of the three workflows to finish. The last one reviews. |
| `GitHub POST ... returned 422` when posting | The commit is no longer the head, or the App lacks `Pull requests: write`. |
| No review, run shows `the base branch ruleset lists no required checks` | The rules endpoint returned no `required_status_checks` for the base branch. |
| COMMENT "The automatic review failed: ... HTTP 401" | `REVIEW_LLM_API_KEY` is wrong or revoked. |
| COMMENT "... HTTP 404" | `REVIEW_LLM_MODEL` is not an Anthropic model id. |
