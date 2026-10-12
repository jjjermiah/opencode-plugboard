# Packaging

What the npm tarball contains, and why it ships TypeScript source with no build step. Checked against OpenCode 2.0.26 (`~/.cache/opencode-explorer/opencode`). Re-check when the peer range moves.

## Decision: ship the `.ts` source

The package publishes `index.ts` and `src/` as they are. There is no `dist/` and no prepack build. The `files` allowlist is the list `check-pack.ts` enforces.

Evidence from the OpenCode source:

- **The host loads the entry with Bun.** `packages/plugin/src/host.ts:17-44` (`resolve`) resolves the `server`, `tui` and `rpc` subpaths of a registry plugin, and `packages/plugin/src/host.ts:46-48` (`load`) imports the result. `packages/util/src/runtime/import.bun.ts:3-9` is `import(specifier)` plus `Bun.resolveSync`, so a `.ts` file runs without a compile step.
- **The host installs without scripts.** `packages/util/src/npm.ts:225` sets `ignoreScripts: true` on the Arborist reify. A build hook (`prepare`, `prepack`) therefore never runs on a user's machine. A `dist/` would have to be built before `npm publish`, and the publish workflow would need a build step that the CI gates do not test today.
- **The host does not read `engines`.** No `engines` check exists in `packages/plugin/src` or `packages/util/src`. The field is declarative for readers and tooling.
- **Bun floor.** OpenCode 2.0.26 pins Bun 1.4.2: `package.json:8` (`"packageManager": "bun@1.4.2"`) and `package.json:165` (`"bun-types": "1.4.2"`). `engines.bun` is `>=1.4.2`, the version the host runs and CI uses (`.github/workflows/ci.yml`, `bun-version: 1.4.2`).
- **Our proof.** `bun .github/scripts/smoke-pack.ts` packs the tarball, installs it with `--ignore-scripts` into a clean project, and runs the setup probe under Bun.

## Types

`types` points at the source, because there is no `.d.ts` output:

- Top level: `"types": "./index.ts"`.
- `exports`: each entry is an object with `types` first, then `default`. `"."` maps to `./index.ts` and `"./rpc"` to `./src/rpc.ts`. Bun does not use the `types` condition at runtime, so it falls through to `default`.
- `./tui` is not exported on main. When it is added, give it the same `types` / `default` pair.

A consumer that typechecks the package reads the `.ts` source, and `src/discovery.ts` imports `escape-html`. Its types, `@types/escape-html`, are a runtime dependency (pinned exactly, types only, no install script), so the consumer gets them with the package and sees no `TS7016: Could not find a declaration file for module 'escape-html'`. This does not affect Bun at runtime.

## Engines

`engines` declares only `bun`. npm enforces only the `node` key, so `engines.bun` is advisory. OpenCode is a peer (`@opencode/plugin` `>=2.0.26 <2.1`), and that range is the real compatibility contract, so it is not repeated under `engines`.
