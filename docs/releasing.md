# Releasing

Releases are driven by `CHANGELOG.md`. One script does the version bump, the changelog heading, the commit and the tag. GitHub Actions does the rest.

## Everyday flow

1. Keep `[Unreleased]` in `CHANGELOG.md` current. The release notes are that text, so write it for users. Fill in `compat/results/release-candidate.md` (see [development.md](development.md)).
2. From a clean `main`: `bun run release 0.3.0 --push`. Add `--dry-run` first to see the diff; it changes nothing and only warns about git state.
3. Watch the "Publish" run. It checks the gates, publishes to npm and creates the GitHub release.

The script refuses when the working tree is dirty, the branch is not `main`, `[Unreleased]` is empty, the version is not valid semver or does not increase on the last release, or the tag exists. It moves the `[Unreleased]` text under `## [0.3.0] - <today>`, leaves an empty `[Unreleased]` behind, fixes the compare links, bumps `package.json`, commits "Release 0.3.0" and creates the annotated tag `v0.3.0`. Without `--push` it prints the push command instead.

A prerelease such as `0.3.0-rc.1` publishes with the `next` dist-tag and a GitHub prerelease.

## What the workflow does

`.github/workflows/publish.yml` runs on a `v*` tag push, with one run per ref and no cancelling. In order:

1. The CI jobs from `ci.yml` (typecheck, pack check, compat checks) run through `workflow_call`, so a release has exactly the same gates as CI.
2. It checks that the tag equals `v<package.json version>` and that the commit is on `main`.
3. It builds the release notes from the changelog section. A missing or empty section fails here, before anything is published.
4. It runs `npm publish --access public` (plus `--tag next` for a prerelease). npm authenticates the run through GitHub's OIDC identity (trusted publishing, no token), which needs npm 11.5.1 or newer; the workflow installs it. If the version is already on npm, it skips the publish.
5. It creates the GitHub release (marked as a prerelease when the version has a `-`). If the release exists, it leaves it alone.

Both writes are safe to retry: re-run the failed run, or "Run workflow" on the tag with `dry_run` unticked.

Provenance: npm cannot generate provenance attestations for a private repository, so the workflow passes `--provenance` only when the repository is public. Trusted publishing itself works from a private repository. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) and [provenance](https://docs.npmjs.com/generating-provenance-statements).

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
