# Releasing

Releases are driven by `CHANGELOG.md` and by the commit messages since the last tag. One script (`.github/scripts/release.ts`, run as `bun run release`) does the version bump, the changelog heading and the release commit, opens the release pull request, waits for every check on it, merges it, and tags the merge commit. GitHub Actions does the rest.

## Two layers of notes

- **The curated notes** are the `[Unreleased]` text you write for users: short, with the reasoning. They open the release.
- **The full story** is generated from the commits between the previous tag and this one. `.github/scripts/commit-detail.ts` (using [`conventional-commits-parser`](https://github.com/conventional-changelog/conventional-changelog)) drops merge commits and the release commit, groups the rest by type (Features, Fixes, Security, Performance, Refactors, Tests, Docs, CI and tooling, Dependencies, Other) and prints each one with its short-hash link and full body, with wrapped lines joined so GitHub renders paragraphs cleanly. Commits from before the convention have no type; an obvious prefix (`Tests:`, `changelog:`) is mapped, the rest land in Other.

The release script writes the full story into `CHANGELOG.md` as a collapsed `<details>` block (between `<!-- commit-detail:start -->` and `<!-- commit-detail:end -->`) at the end of the release section. The publish workflow does not read that block. `release-notes.ts` cuts it out of the section and rebuilds the story from git, so the GitHub release shows the curated notes, then `## The full story` (one collapsed group per type), then the Full diff link. That is why the commit bodies must be good: see [CONTRIBUTING.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/CONTRIBUTING.md#commits). Preview any release with `bun .github/scripts/release-notes.ts 0.10.0`, or just the CHANGELOG block with `--changelog-detail`.

## Everyday flow

1. Keep `[Unreleased]` in `CHANGELOG.md` current. The release notes are that text, so write it for users. Fill in `examples/_release/release-candidate.md` (see [development.md](development.md)). Update the pinned version (`opencode-plugboard@x.y.z`) in `README.md` and `docs/clients/any-app.md`; the release script does not touch them.
2. Pick a title: short and creative, 2 to 5 words, at most 40 characters, no trailing period ("No Awkward Silences", "Claude Code, Any Brain"). Every release has one.
3. From a clean `main` that equals `origin/main`: `bun run release 0.3.0 --title "Your Title" --push`. Add `--dry-run` first to see the diff and the plan; it changes nothing and only warns about git state.
4. The script opens a pull request for the release, watches every check on it, and merges it once they all pass. It waits for CI on the merge commit and tags it only when that CI passes. The tag starts the "Publish" run, which checks the gates, publishes to npm, attests the tarball and creates the GitHub release. The script then watches the release for you (see below); add `--no-watch` to skip that. If a check fails, the script stops with the pull request open and nothing merged or tagged.

The script refuses when the working tree is dirty, the branch is not `main`, local `main` differs from `origin/main`, `[Unreleased]` is empty, the version is not valid semver or does not increase on the last release, the tag or the branch `release/v0.3.0` already exists, or `--title` is missing or invalid. It moves the `[Unreleased]` text under `## [0.3.0] - <today>: Your Title`, appends the commit-level detail block, leaves an empty `[Unreleased]` behind, fixes the compare links, bumps `package.json` and commits `chore(release): 0.3.0` on `release/v0.3.0`. The annotated tag `v0.3.0` is made on the merge commit, not on the release branch. Without `--push` the script refuses, because a release now always goes through a pull request; use `--dry-run` to preview.

### The release rule

- A release is cut only from a fully green `main`. `--push` refuses before it commits anything unless the newest CI run on `origin/main`'s commit has completed and passed. A run that is still queued or in progress is waited for in the foreground, up to 40 minutes, then judged the same way. A commit with no run listed yet gets two minutes for one. A failing `gh` call is retried: three consecutive failures stop the release.
- The release pull request merges only when every check on it is green. `--push` watches all of them (the advisory benchmark aside) and merges nothing while one fails, is pending, or has not reported.
- The tag goes only on a commit whose own CI run passed. The checks on the pull request ran on the pull request head. The merge commit is a new commit, so the script waits for the `ci.yml` push run on it and tags only when that run succeeds.
- The GitHub release appears only after npm has the version. The `release` job of the Publish run needs the `publish` and `attest` jobs, so a publish that fails leaves no release.

### The release pull request

`main` is protected by a repository ruleset: a change lands only through a pull request whose required checks pass. A release follows the same rule:

1. `release/v0.3.0` is created from `main` and pushed.
2. A pull request into `main` is opened, with the release notes as its body. Auto-merge is not used: it would merge on the required checks alone, and a red job outside them would still ship.
3. The script watches every check on the pull request. A failing, cancelled or skipped check stops it (see [When a check fails](#when-a-check-fails)). It keeps waiting while checks are pending, while no check has reported, and while `gh` returns nothing usable (a transient error). A required check that has not reported after 10 minutes fails the release, because its name changed or its workflow does not run on pull requests. The whole wait is capped at 60 minutes.
4. When every check has passed, the script merges that exact commit (`--match-head-commit`) with a merge commit, and the branch is deleted.
5. It waits for the `ci.yml` push run on the merge commit (up to 45 minutes). It tags the merge commit and pushes the tag only when that run concluded `success`. Tags are not part of a branch ruleset, so the tag push is not blocked by it. Check that on the first release.

**Which checks gate.** Every check on the pull request gates, except `Request-path benchmarks (advisory)`. That includes CodeQL (`Analyze (javascript-typescript)`) and external checks such as CodeRabbit. A skipped check counts as not passed. A future path-filtered workflow that skips on some pull requests would therefore block releases. If a check must never block, add it to `ADVISORY_CHECKS` in `.github/scripts/release.ts` in a reviewed change.

The required status checks are the names GitHub shows on a pull request:

- `CI passed` (`ci.yml`): one aggregate job. It needs every gating CI job (typecheck, tests and pack, host versions, the OpenCode host matrix, examples) and passes only when each one succeeded. A new gating job goes into its `needs:`, not into the ruleset.
- `Lint commit messages` (`commits.yml`).
- `Analyze (javascript-typescript)` (`codeql.yml`). CodeQL is not in `ci.yml`, so `CI passed` cannot stand in for it.

Not required: `Request-path benchmarks (advisory)` (it never blocks), the individual CI jobs (`CI passed` reports them), the nightly and flake-hunt jobs, and Scorecard. `Build the site` is not a pull request check: the docs build is a step of `Typecheck, test and pack`.

The repository needs two settings for this: "Allow auto-merge" (General), which `host-bump.yml` uses for its pull requests, and a ruleset that requires no approving review. A solo maintainer cannot approve their own pull request, so a required approval would block every release.

### Changing the ruleset

The `main` ruleset is changed by hand, in the repository settings, and only after the change that adds `CI passed` is on `main`. Until then the check does not exist on `main`'s workflows. Replace the required checks (`Typecheck, test and pack`, `Host versions`, `Examples (scripted runs are current)`, and `Lint commit messages` and `Analyze (javascript-typescript)`, the last two of which stay) with exactly: `CI passed`, `Lint commit messages`, `Analyze (javascript-typescript)`.

A pull request opened before the change ran the old `ci.yml`, so it has no `CI passed` check. After the ruleset change it shows that check as expected and cannot merge until its workflows run again on the new file. Push an empty commit to it (`git commit --allow-empty -m "ci: rerun checks"`), or close and reopen it.

### When a check fails

The script exits non-zero with the pull request open. Nothing is merged or tagged, and that stays true until you act.

1. Open the failing check (its link is printed). Decide whether it is a real failure or a flake.
2. A real failure: check out `release/v0.3.0`, commit the fix (a Conventional Commit) and push it. The pull request takes the new head.
3. A flake: re-run the failed jobs (`gh run rerun <run-id> --failed`, the run id is in the check link). Nothing else changes.
4. Then, from a clean `main` that equals `origin/main`, run the same command with `--resume`: `bun run release 0.3.0 --title "Your Title" --push --resume`. It waits until the pull request's head is the commit the release branch points at (GitHub can still show the previous head for a moment after a push), then watches the checks for that commit, merges that exact head and tags the merge commit only after its CI run succeeds. Running it without `--resume` fails, because the release branch exists.

Do not merge the pull request, tag, or push a tag by hand. The gate is the point: a merge made by hand skips the CI run on the merge commit.

### Watching a release

After the tag is pushed, `bun run release` finds the Publish run for the tag, follows it with `gh run watch --exit-status`, then polls `npm view` until `opencode-plugboard@0.3.0` is visible and the dist-tag points at it (`latest`, or `next` for a prerelease). npm can acknowledge a publish and keep it staged for a minute, so it waits up to 5 minutes. The exit code is the result: 0 only when the run succeeded and npm serves the version. It needs `gh` logged in.

To follow or re-check an existing tag without releasing anything: `bun run release 0.3.0 --watch-only`.

A prerelease such as `0.3.0-rc.1` publishes with the `next` dist-tag and a GitHub prerelease.

## What the workflow does

`.github/workflows/publish.yml` runs on a `v*` tag push, with one run per ref and no cancelling. In order:

1. The CI jobs from `ci.yml` (typecheck, tests, pack check, pack smoke test, host matrix, examples) run through `workflow_call`, so a release has exactly the same gates as CI. The `CI passed` job must succeed for `publish` to run.
2. It checks that the tag equals `v<package.json version>` and that the commit is on `main`.
3. It builds the release notes from the changelog section and the git history with `.github/scripts/release-notes.ts`. A missing or empty section, a heading without a title, or a previous tag missing from the clone fails here, before anything is published. The checkout uses `fetch-depth: 0` so the tag range is available.
4. It runs `npm publish --access public` (plus `--tag next` for a prerelease). npm authenticates the run through GitHub's OIDC identity (trusted publishing, no token), which needs npm 11.5.1 or newer; the workflow installs it. If the version is already on npm, it skips the publish.
5. The `publish` job packs the tarball once, publishes that exact file, and writes its SBOM. The `attest` job checks that the file's sha256 matches the one the publish job packed, then that its sha512 matches the integrity npm serves for that version, and only then attests it with GitHub build provenance. The `release` job creates the GitHub release, named `v0.3.0: Your Title` (marked as a prerelease when the version has a `-`), with the notes, the tarball, the SBOM and the attestation bundle attached. If the release exists, it attaches the files to it with `--clobber` and leaves the notes alone.

Both writes are safe to retry: re-run the failed run, or "Run workflow" on the tag with `dry_run` unticked.

Provenance: npm cannot generate provenance attestations for a private repository, so the workflow passes `--provenance` only when the repository is public. Trusted publishing itself works from a private repository. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) and [provenance](https://docs.npmjs.com/generating-provenance-statements).

## If a release fails

Every check on the release pull request passed before the merge, and the merge commit's own `ci.yml` run passed before the tag. A failure after that is rare, and it is usually a runner or npm problem. Either way, never move a pushed tag. Recovery depends on where the run stopped:

- **Merge commit CI failed** (the tag was not pushed): nothing is tagged and npm has nothing. `main` now carries the release commit. Fix forward through a pull request, and cut the next patch. Do not tag that commit.
- **Merge commit CI cancelled** (the tag was not pushed): someone cancelled that run by hand. Each push to `main` has its own concurrency group, keyed by its commit SHA, so a later push never cancels it. Re-run it with `gh run rerun <run-id>`. Once it concludes `success`, run `bun run release 0.3.0 --title "Your Title" --push --resume`: it tags the merge commit only after that run passes. If the re-run fails, fix forward and cut the next patch.
- **`git fetch` fails** (for example `cannot lock ref`, when another worktree of the same repository fetches at the same moment): the script retries each fetch 4 times with a short backoff. If every attempt fails before the merge, the release stops with nothing pushed; run it again. If it fails after the merge, the script stops with nothing tagged and prints the next step.
- **Merged, not tagged** (the pull request is merged and its branch is gone, but the tag was not pushed): once `git fetch` works, run `bun run release 0.3.0 --title "Your Title" --push --resume`. It finds the merged pull request, waits for the CI run on its merge commit, and tags that commit only if the run succeeded. A failed or cancelled run tags nothing: follow the recovery for that case above. Do not tag by hand. It refuses (and tags nothing) unless the pull request was merged into `main`, its merge commit is on `origin/main`, and that commit's `package.json` says `0.3.0`. A local `v0.3.0` already at the merge commit (an earlier push failed) is pushed, not created again; a local `v0.3.0` anywhere else stops the run. From a clean `main`, the run also fast-forwards local `main` to `origin/main`.
- **Tag already on origin**: `--resume` on an already-merged release says so and exits 0 without moving the tag. It follows the Publish run and npm, unless `--no-watch` is given. If the tag points at another commit, it stops and tags nothing.
- **Before `npm publish`** (the gates, the release notes or the ref checks failed): nothing is on npm and no GitHub release exists. If the cause was outside the code (a runner or registry outage), re-run the failed run; the same tag and commit publish. If the code is wrong, fix it on `main` through a pull request and cut the next patch. The broken tag stays where it is.
- **After `npm publish`** (the attestation or the GitHub release failed): npm may already serve the version, and a version on npm cannot be published again. If npm serves the tarball, re-run the failed jobs: the `release` job creates the release, or attaches the files to it if it exists. If the tarball is wrong, fix it on `main` and cut the next patch.
- The GitHub release exists only after npm has the version. If a tag's Publish run is red and no release is listed on the Releases page, the release has not been made; do not make one by hand.

## Release files and how to verify them

Each GitHub release has three files:

- `opencode-plugboard-X.Y.Z.tgz`: the npm tarball, the same file npm serves.
- `opencode-plugboard-X.Y.Z.cdx.json`: a CycloneDX SBOM of the production dependencies (`npm sbom --sbom-format cyclonedx --omit dev`).
- `opencode-plugboard-X.Y.Z.tgz.sigstore.json`: the GitHub build-provenance attestation bundle for the tarball.

To check a downloaded tarball was built by this repository's Publish workflow:

```sh
gh attestation verify opencode-plugboard-X.Y.Z.tgz --repo jjjermiah/opencode-plugboard
```

## Other checks around releases

- **Pack smoke test** (`bun run smoke:pack`, in `ci.yml` and `nightly.yml`): `.github/scripts/smoke-pack.ts` packs the tarball, installs it into a throwaway project with npm (so the peer dependencies resolve like a user's install), imports the entry, runs the plugin effect against a spy context and checks that setup registers its hooks and returns synchronously, and that `effect` and `@opencode/plugin` each resolve to one copy.
- **Host matrix** (`host` job in `ci.yml`): typecheck and tests against the published `@opencode/plugin` versions inside the peer range (oldest, middle and newest, picked by `.github/scripts/host-versions.ts` from the npm registry). While only one version is in range, it is a single job.
- **Nightly** (`nightly.yml`, 03:17 UTC, also "Run workflow"): a fresh install without `bun.lock` or the package cache, then typecheck, tests, pack check and the smoke test. It catches drift in unpinned dependencies. Not required.
- **Host bump** (`host-bump.yml`, daily at 06:23 UTC, also "Run workflow"): when a newer 2.0.x is published, opens a PR that bumps the pinned `@opencode/plugin` and `effect` dev dependencies, with the typecheck and test result in the body (a draft when either failed). Not required. The repository setting "Allow GitHub Actions to create and approve pull requests" must be on. A PR made with the default token starts no workflow, so `host-bump.yml` starts `ci.yml`, `commits.yml` and `codeql.yml` on its branch (`gh workflow run`, which `GITHUB_TOKEN` allows with `actions: write`). If one of those starts fails, the run warns and the PR has no required checks: start it by hand with `gh workflow run <file> --ref deps/opencode-<v>`.

## OpenCode releases

Two daily jobs watch for a new OpenCode, so a host release reaches a pull request within a day, not a week.

- **`host-bump.yml`** (06:23 UTC). When `@opencode/plugin` has a newer version inside the peer range than the pinned one, it opens or updates `build(deps): support opencode <v>` (branch `deps/opencode-<v>`). The pull request pins that version and the `effect` it pins, widens the peers only where the new version needs it, and runs typecheck, tests, the TUI build, check-pack and smoke-pack. The `effect` peer gets the new version appended to its `||` list. The `@opencode/plugin` upper bound moves only when the new version is 2.1 or later, and the pull request says so. The host matrix (`.github/scripts/host-versions.ts`) reads the peer range, so the new version joins the `host` job without any list edit.
- **`opencode-release.yml`** (05:41 UTC). Installs the newest `@opencode/cli-linux-x64` in CI, starts `opencode serve` with its own HOME and plugboard loaded from the checkout as a local plugin, and checks that `/api/plugin` lists plugboard as active and `/healthz` answers 200. No provider credentials, so no model call. The same check runs by hand: `bun .github/scripts/opencode-load-check.ts --bin <opencode>`.

What happens:

- **All gates green.** The pull request is labelled `dependencies` and set to auto-merge. Its `CI passed`, `Lint commit messages` and `Analyze (javascript-typescript)` checks come from the dispatched runs on its branch (see above), so the merge waits for them and lands on its own. `commits.yml` lints the commits the branch adds to the default branch, because a dispatch has no pull request base.
- **A gate red.** The pull request is a draft with the failing log tails, and the issue `OpenCode <v> breaks plugboard` links the run. A host type change usually shows in `src/session/host.ts` (`HostContextMatches`). Fix it on the branch, or close the pull request and keep the issue.
- **The load check red** (`opencode-release.yml`). No pull request, only the issue. Plugboard does not load in that host: reproduce with the command above.
- **A new major of `@opencode/plugin`.** `host-bump.ts` stops, because the peer range for a new major is a decision. The run fails and the issue is filed.
- **The pong gate stays manual.** CI has no provider credentials, so a host change still needs a real prompt on an isolated server (`docs/development.md`) before the change counts.

The jobs read the default branch. A new script or workflow only starts running after it merges to `main`.

## Prove the pipeline without releasing

Actions tab, "Publish", "Run workflow" on `main` with `dry_run` ticked (the default), or:

```sh
gh workflow run publish.yml -f dry_run=true
```

It runs the gates, checks the changelog notes, runs `npm publish --dry-run` and packs the tarball and its SBOM. It does not publish, attest or create a release: the attestation and the release are writes, so those steps only print what they would do.

## One-time npm setup (owner)

1. Open `https://www.npmjs.com/package/opencode-plugboard/access` (package, Settings).
2. Under "Trusted Publisher", choose GitHub Actions.
3. Fill in: organization or user `jjjermiah`, repository `opencode-plugboard`, workflow filename `publish.yml`. Leave the environment empty.
4. If npm asks for "Allowed actions", allow `npm publish`.
5. Save. Then optionally set "Publishing access" to "Require two-factor authentication and disallow tokens". Trusted publishing keeps working.

npm does not check the configuration when you save it. A new configuration expires if it has no successful publish within 2 days.

If it is not configured or a field is wrong, the "Publish to npm" step fails (typically `ENEEDAUTH` or a 404/403 from the registry) and nothing is released. The workflow filename must match exactly, including `.yml`. Fix the setting, then re-run the failed run.
