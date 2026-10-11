# Releasing

Releases are driven by `CHANGELOG.md`. The version bump, the changelog heading, the commit and the tag come from one script. Publishing to npm happens in CI once the repository is public.

## Normal flow

1. While you work, keep `[Unreleased]` in `CHANGELOG.md` current. The release notes are that text, so write it for users.
2. Run the pre-release client checks and fill in `compat/results/release-candidate.md` against the commit you will tag (see [development.md](development.md)).
3. From a clean `main`:

   ```sh
   bun run release 0.3.0 --push
   ```

   Add `--dry-run` first to see the diff. A dry run changes nothing and only warns about git state.

The script refuses when the working tree is dirty, the branch is not `main`, `[Unreleased]` is empty, the version is not valid semver or does not increase on the last release, or the tag exists. It moves the `[Unreleased]` text under `## [0.3.0] - <today>`, leaves an empty `[Unreleased]` behind, fixes the compare links at the bottom, bumps `package.json`, commits "Release 0.3.0" and creates the annotated tag `v0.3.0`. With `--push` it pushes `main` and the tag in one go. Without it, it prints the push command.

For a prerelease such as `0.3.0-rc.1`, the workflow publishes with the `next` dist-tag and marks the GitHub release as a prerelease.

## What CI does

Pushing a `v*` tag starts `.github/workflows/publish.yml`. It checks that the tag matches the `package.json` version and is on `main`, runs the typecheck and the pack check, runs `npm publish --provenance --access public`, then creates the GitHub release from the changelog section if one does not exist yet. There is no npm token: npm authenticates the workflow through GitHub's OIDC identity (trusted publishing), which needs npm 11.5.1 or newer. The workflow installs it.

The workflow fails on purpose while the repository is private, because npm provenance is only available for public repositories. Use the manual path below until then.

## One-time npm setup (owner)

Do this once, after the repository is public and the package exists on npm:

1. Open the package settings: `https://www.npmjs.com/package/opencode-plugboard/access`.
2. Under "Trusted Publisher", choose GitHub Actions.
3. Fill in: organization or user `jjjermiah`, repository `opencode-plugboard`, workflow filename `publish.yml`. Leave the environment empty.
4. Save. Optionally set "Publishing access" to "Require two-factor authentication and disallow tokens", so only trusted publishing can publish.

The workflow filename must match exactly, or npm rejects the OIDC token with a 404 or 403 on publish.

## Manual publish (until the repository is public)

Run the script as above, but push the tag yourself after you publish. From the tagged commit:

```sh
bun run release 0.3.0
git push --atomic origin main v0.3.0
npm publish --auth-type=web
bun scripts/release-notes.ts v0.3.0 > /tmp/notes.md
gh release create v0.3.0 --verify-tag --title v0.3.0 --notes-file /tmp/notes.md
```

`--auth-type=web` opens a browser login, so it works with two-factor authentication. This publish has no provenance attestation. The publish workflow will fail on the pushed tag while the repository is private. That is expected, ignore it.

Check the result with `npm view opencode-plugboard version` and `npm pack --dry-run --json --ignore-scripts`.
