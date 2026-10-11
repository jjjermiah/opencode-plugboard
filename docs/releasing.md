# Releasing

Releases are driven by `CHANGELOG.md` and by the commit messages since the last tag. One script (`.github/scripts/release.ts`, run as `bun run release`) does the version bump, the changelog heading, the commit and the tag. GitHub Actions does the rest.

## Two layers of notes

- **The curated notes** are the `[Unreleased]` text you write for users: short, with the reasoning. They open the release.
- **The full story** is generated from the commits between the previous tag and this one. `.github/scripts/commit-detail.ts` (using [`conventional-commits-parser`](https://github.com/conventional-changelog/conventional-changelog)) drops merge commits and the release commit, groups the rest by type (Features, Fixes, Security, Performance, Refactors, Tests, Docs, CI and tooling, Dependencies, Other) and prints each one with its short-hash link and full body, with wrapped lines joined so GitHub renders paragraphs cleanly. Commits from before the convention have no type; an obvious prefix (`Tests:`, `changelog:`) is mapped, the rest land in Other.

The release script writes the full story into `CHANGELOG.md` as a collapsed `<details>` block (between `<!-- commit-detail:start -->` and `<!-- commit-detail:end -->`) at the end of the release section. The publish workflow does not read that block. `release-notes.ts` cuts it out of the section and rebuilds the story from git, so the GitHub release shows the curated notes, then `## The full story` (one collapsed group per type), then the Full diff link. That is why the commit bodies must be good: see [CONTRIBUTING.md](../CONTRIBUTING.md#commits). Preview any release with `bun .github/scripts/release-notes.ts 0.10.0`, or just the CHANGELOG block with `--changelog-detail`.

## Everyday flow

1. Keep `[Unreleased]` in `CHANGELOG.md` current. The release notes are that text, so write it for users. Fill in `compat/results/release-candidate.md` (see [development.md](development.md)). Update the pinned version (`opencode-plugboard@x.y.z`) in `README.md` and `docs/clients/any-app.md`; the release script does not touch them.
2. Pick a title: short and creative, 2 to 5 words, at most 40 characters, no trailing period ("No Awkward Silences", "Claude Code, Any Brain"). Every release has one.
3. From a clean `main`: `bun run release 0.3.0 --title "Your Title" --push`. Add `--dry-run` first to see the diff; it changes nothing and only warns about git state.
4. With `--push` the script then watches the release for you (see below). Add `--no-watch` to skip that. The "Publish" run checks the gates, publishes to npm and creates the GitHub release.

The script refuses when the working tree is dirty, the branch is not `main`, `[Unreleased]` is empty, the version is not valid semver or does not increase on the last release, the tag exists, or `--title` is missing or invalid. It moves the `[Unreleased]` text under `## [0.3.0] - <today>: Your Title`, appends the commit-level detail block, leaves an empty `[Unreleased]` behind, fixes the compare links, bumps `package.json`, commits `chore(release): 0.3.0` and creates the annotated tag `v0.3.0`. Without `--push` it prints the push command instead.

### Watching a release

After the push, `bun run release` finds the Publish run for the tag, follows it with `gh run watch --exit-status`, then polls `npm view` until `opencode-plugboard@0.3.0` is visible and the dist-tag points at it (`latest`, or `next` for a prerelease). npm can acknowledge a publish and keep it staged for a minute, so it waits up to 5 minutes. The exit code is the result: 0 only when the run succeeded and npm serves the version. It needs `gh` logged in.

To follow or re-check an existing tag without releasing anything: `bun run release 0.3.0 --watch-only`.

A prerelease such as `0.3.0-rc.1` publishes with the `next` dist-tag and a GitHub prerelease.

## What the workflow does

`.github/workflows/publish.yml` runs on a `v*` tag push, with one run per ref and no cancelling. In order:

1. The CI jobs from `ci.yml` (typecheck, tests, pack check, pack smoke test, host matrix, compat checks) run through `workflow_call`, so a release has exactly the same gates as CI.
2. It checks that the tag equals `v<package.json version>` and that the commit is on `main`.
3. It builds the release notes from the changelog section and the git history with `.github/scripts/release-notes.ts`. A missing or empty section, a heading without a title, or a previous tag missing from the clone fails here, before anything is published. The checkout uses `fetch-depth: 0` so the tag range is available.
4. It runs `npm publish --access public` (plus `--tag next` for a prerelease). npm authenticates the run through GitHub's OIDC identity (trusted publishing, no token), which needs npm 11.5.1 or newer; the workflow installs it. If the version is already on npm, it skips the publish.
5. It creates the GitHub release, named `v0.3.0: Your Title` (marked as a prerelease when the version has a `-`). If the release exists, it leaves it alone.

Both writes are safe to retry: re-run the failed run, or "Run workflow" on the tag with `dry_run` unticked.

Provenance: npm cannot generate provenance attestations for a private repository, so the workflow passes `--provenance` only when the repository is public. Trusted publishing itself works from a private repository. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) and [provenance](https://docs.npmjs.com/generating-provenance-statements).

## Other checks around releases

- **Pack smoke test** (`bun run smoke:pack`, in `ci.yml` and `nightly.yml`): `.github/scripts/smoke-pack.ts` packs the tarball, installs it into a throwaway project with npm (so the peer dependencies resolve like a user's install), imports the entry, runs the plugin effect against a spy context and checks that setup registers its hooks and returns synchronously, and that `effect` and `@opencode/plugin` each resolve to one copy.
- **Host matrix** (`host` job in `ci.yml`): typecheck and tests against the published `@opencode/plugin` versions inside the peer range (oldest, middle and newest, picked by `.github/scripts/host-versions.ts` from the npm registry). While only one version is in range, it is a single job.
- **Nightly** (`nightly.yml`, 03:17 UTC, also "Run workflow"): a fresh install without `bun.lock` or the package cache, then typecheck, tests, pack check and the smoke test. It catches drift in unpinned dependencies. Not required.
- **Host bump** (`host-bump.yml`, Mondays, also "Run workflow"): when a newer 2.0.x is published, opens a PR that bumps the pinned `@opencode/plugin` and `effect` dev dependencies, with the typecheck and test result in the body (a draft when either failed). Not required. The repository setting "Allow GitHub Actions to create and approve pull requests" must be on, and a PR made with the default token does not start CI by itself, so push an empty commit to it or close and reopen it.

## Prove the pipeline without releasing

Actions tab, "Publish", "Run workflow" on `main` with `dry_run` ticked (the default), or:

```sh
gh workflow run publish.yml -f dry_run=true
```

It runs the gates, checks the changelog notes and runs `npm publish --dry-run`. It does not publish or create a release.

## One-time npm setup (owner)

1. Open `https://www.npmjs.com/package/opencode-plugboard/access` (package, Settings).
2. Under "Trusted Publisher", choose GitHub Actions.
3. Fill in: organization or user `jjjermiah`, repository `opencode-plugboard`, workflow filename `publish.yml`. Leave the environment empty.
4. If npm asks for "Allowed actions", allow `npm publish`.
5. Save. Then optionally set "Publishing access" to "Require two-factor authentication and disallow tokens". Trusted publishing keeps working.

npm does not check the configuration when you save it. A new configuration expires if it has no successful publish within 2 days.

If it is not configured or a field is wrong, the "Publish to npm" step fails (typically `ENEEDAUTH` or a 404/403 from the registry) and nothing is released. The workflow filename must match exactly, including `.yml`. Fix the setting, then re-run the failed run.
