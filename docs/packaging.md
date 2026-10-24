# Packaging

What the npm tarball contains, and why it ships TypeScript source with no build step. Checked against OpenCode 2.0.26 and 2.0.27, and against `@opencode/plugin` 2.1.4 (`dist/host.js`, `dist/source.bun.js`, `dist/source.node.js` and `dist/runtime*.js` are byte-identical to 2.0.32). Re-check when the peer range moves.

## Decision: ship the `.ts` source

The package publishes `index.ts` and `src/` as they are. The one exception is the TUI page, which ships compiled to `dist/tui.js` (see the TUI section). The runtime lockfile `npm-shrinkwrap.json` ships too (see Lockfile below). There is no other build step. The `files` allowlist is the list `check-pack.ts` enforces.

Evidence from the OpenCode source:

- **The host loads the entry with Bun.** `packages/plugin/src/host.ts:17-44` (`resolve`) resolves the `server`, `tui` and `rpc` subpaths of a registry plugin, and `packages/plugin/src/host.ts:46-48` (`load`) imports the result. `packages/util/src/runtime/import.bun.ts:3-9` is `import(specifier)` plus `Bun.resolveSync`, so a `.ts` file runs without a compile step.
- **The host installs without scripts.** `packages/util/src/npm.ts:225` sets `ignoreScripts: true` on the Arborist reify. A build hook (`prepare`, `prepack`) therefore never runs on a user's machine. A `dist/` would have to be built before `npm publish`, and the publish workflow would need a build step that the CI gates do not test today.
- **The host does not read `engines`.** No `engines` check exists in `packages/plugin/src` or `packages/util/src`. The field is declarative for readers and tooling.
- **Bun floor.** OpenCode 2.0.26 pins Bun 1.4.2: `package.json:8` (`"packageManager": "bun@1.4.2"`) and `package.json:165` (`"bun-types": "1.4.2"`). `engines.bun` is `>=1.4.2`, the version the host runs and CI uses (`.github/workflows/ci.yml`, `bun-version: 1.4.2`).
- **Our proof.** `bun .github/scripts/smoke-pack.ts` packs the tarball, installs it with `--ignore-scripts` into a clean project, and runs the setup probe under Bun.

## Types

`types` points at the source, because there is no `.d.ts` output:

- Top level: `"types": "./index.ts"`.
- `exports`: each entry is an object with `types` first, then `default`. `"."` maps to `./index.ts` and `"./rpc"` to `./rpc.ts`. Bun does not use the `types` condition at runtime, so it falls through to `default`.
- `./tui` maps to `types: ./tui.ts` and `default: ./dist/tui.js` (see the TUI section below). `./rpc` and `./tui` sit at the package root, next to `index.ts`.

A consumer that typechecks the package reads the `.ts` source, and `src/discovery.ts` imports `escape-html`. Its types, `@types/escape-html`, are a runtime dependency (pinned exactly, types only, no install script), so the consumer gets them with the package and sees no `TS7016: Could not find a declaration file for module 'escape-html'`. This does not affect Bun at runtime.

## The TUI entry is compiled (`dist/tui.js`)

The `./tui` export points at `dist/tui.js`, which `bun run build:tui` (`.github/scripts/build-tui.ts`) compiles from `src/tui.tsx`. The source is JSX, and the host does not compile it on an npm install.

Evidence from OpenCode 2.0.26 (`~/.cache/opencode-explorer/opencode`):

- **The Solid transform skips `node_modules`.** `packages/tui` loads `@opentui/solid`'s runtime plugin support (`node_modules/@opentui/solid/scripts/runtime-plugin-support-configure.js`), which registers two Bun plugins. `solid-plugin.js` (`createSolidTransformPlugin`) compiles JSX with a `sourceFilter` that excludes any path containing `node_modules`, so a file there is never Solid-compiled. `@opentui/core/runtime-plugin.js` only rewrites literal `from "…"` specifiers under `node_modules` and leaves the file as Bun's React-style JSX.
- **The pragma is not enough.** `src/tui.tsx` has `/** @jsxImportSource @opentui/solid */`, which Bun turns into a `@opentui/solid/jsx-runtime` import after the text rewrite. That import is not rewritten, so it fails: `Cannot find package '@opentui/solid' imported from …/node_modules/opencode-plugboard/src/tui.tsx`. With the peers installed, it resolves the plugin's own copy of the JSX runtime, which calls components eagerly and crashes the page (`props.report.totals`).
- **Local paths work only outside `node_modules`.** A local-path plugin skips the install, so a checkout runs the Solid transform and the page loads.
- **The build reproduces the host's transform.** `build-tui.ts` runs the same pipeline as the host (`babel-preset-solid`, `generate: "universal"`, `moduleName: "@opentui/solid"`, then `@babel/preset-typescript`), with the versions OpenCode 2.0.26's `@opentui/solid` uses (`babel-preset-solid` 1.9.12, `@babel/core` 7.29.7, `@babel/preset-typescript` 7.27.1, all pinned exactly). The output keeps literal `from "solid-js"`, `from "@opentui/solid"` and `from "@opencode/plugin/tui"` imports, which the host rewrites to its own copies.

So the peers stay **optional**. The host provides `@opentui/*` and `solid-js` at runtime, and the compiled file never loads an installed copy.

`dist/` is gitignored and built in `prepack`, so `npm publish` builds it. `npm pack --ignore-scripts` (the pack check and the smoke test) skips prepack, so CI runs `bun run build:tui` before them. The local-path entry `tui.ts` re-exports `dist/tui.js` too, so a local checkout loads the same file; typecheck does not need the build.

## Effect and `@opencode/plugin` come from the host

A plugin never loads its own copy of `effect` or `@opencode/plugin`. `ensurePluginRuntime` (`packages/plugin/src/runtime.ts`) registers a Bun module plugin that serves the host's modules for every `effect` and `@opencode/plugin` specifier, and any file under a plugin `node_modules` that imports them throws (`Cannot load "effect/..." from plugin node_modules`). So at runtime plugboard runs on the host's `effect`: 4.0.0-rc.112 on OpenCode 2.0.26 and 4.0.1 on 2.0.27. The peer `effect` range matters for types and for the install check (one copy in `npm ls`), not for which copy runs. The runtime files are identical at both tags (`runtime.ts`, `runtime-modules.ts`, `source.bun.ts`).

CI therefore installs each host's own `effect` pin next to its `@opencode/plugin` (`.github/workflows/ci.yml`, host job). Read the pin with `npm view @opencode/plugin@<host> dependencies.effect`.

## Engines

`engines` declares only `bun`. npm enforces only the `node` key, so `engines.bun` is advisory. OpenCode is a peer (`@opencode/plugin` `>=2.0.26 <2.2`), and that range is the real compatibility contract, so it is not repeated under `engines`.

## Optional peers and install size (#190)

`effect` and `@opencode/plugin` are optional peers (`peerDependenciesMeta`), like the three TUI peers. OpenCode's installer does not install them. `packages/util/src/npm.ts` runs Arborist `reify` with `ignoreScripts: true` and the user's npm config, and sets neither `omit` nor `legacyPeerDeps`, so a non-optional peer is installed with the plugin. An optional peer is not.

The host supplies both modules at runtime, so the plugin never needs its own copy:

- `packages/plugin/src/runtime.ts` `ensurePluginRuntime()` registers a Bun plugin with `build.module` for `effect` and every `@opencode/plugin/*` subpath. The override applies to every importer, so `import "effect"` from the plugin resolves to the host's instance whether or not `node_modules/effect` exists.
- `packages/plugin/src/runtime.ts` `createForeignPackageFilter` throws when a file under a plugin's `node_modules/effect` or `node_modules/@opencode/plugin` is loaded, so a copy is refused rather than used.
- A live OpenCode 2.0.26 run loaded the plugin from the registry install with no `effect` or `@opencode/plugin` anywhere in its install (the 25 dependencies only).

Measured with OpenCode's installer (Arborist 9.4.0, the version pinned in OpenCode 2.0.26's root catalog, run under Bun 1.4.2 with `ignoreScripts`, npm config at defaults). Sizes are `du -sk` of `node_modules`:

| Build | Packages (incl. plugin) | `node_modules` | Tarball |
| --- | --- | --- | --- |
| 0.23.0 (peers required) | 313 | 457,848 KiB | 188,080 bytes |
| 0.23.0 + optional peers (file install) | 26 | 12,964 KiB | not measured |
| 0.23.0 + optional peers + shrinkwrap (registry install) | 26 | 12,976 KiB | 191,413 bytes |

Before, the tree held seven `effect` or `@opencode/plugin` directories (the top-level pair plus five nested `effect` copies). After, it holds none. The plugin's 25 runtime dependencies are the whole install. The second row is the install `smoke-pack.ts` runs; the third is the registry install OpenCode runs. The 12 KiB gap between them was not investigated; the file install of the shrinkwrapped tarball also measured 12,976 KiB, so the shrinkwrap is not the cause.

`smoke-pack.ts` guards this. It fails if a plain install puts `effect` or `@opencode/plugin` in `node_modules`. It also installs the host's pinned copies into `./host` and loads the plugin through them (`smoke-probe.ts`), so the probe checks the host-provided path rather than the project's `node_modules`.

## Lockfile (#165)

`npm-shrinkwrap.json` pins the runtime tree. It ships in `files` and `check-pack.ts` fails when it is missing or when its root `dependencies` or `peerDependencies` differ from `package.json`, so a dependency bump that skips the regeneration is caught.

Evidence for whether OpenCode honours it:

- Arborist uses a dependency's shrinkwrap only when the node's `hasShrinkwrap` is set (`@npmcli/arborist` `lib/node.js`), and that comes from the registry manifest's `_hasShrinkwrap`. Reify then loads the shrinkwrap for that subtree (`lib/arborist/reify.js` `_loadShrinkwrapsAndUpdateTrees`).
- A file tarball has no manifest flag, so `npm install <tgz>` ignores the shrinkwrap. `smoke-pack.ts` and `check-pack.ts` therefore do not exercise the pinned path, and the shrinkwrap is checked by content, not by install.
- Probe, with a scratch registry (verdaccio 6) and the same Arborist: a package `^2.1.0` with a shrinkwrap pinning `ms` 2.1.1 installed `ms` 2.1.1 nested under itself when the registry flag was set, and 2.1.3 (latest) without it. The flag was set by hand in the scratch registry, because verdaccio does not compute it.
- The npmjs registry sets `_hasShrinkwrap` on publish: real packuments carry the key with `false` on packages that ship no shrinkwrap (`npm@11.19.1`, `ms@2.1.3`). A positive npmjs case was not checked, because that would mean publishing.
- The plugboard shrinkwrap resolves to the same versions as the latest registry today (`thread-stream` 4.2.0, `pino` 10.4.0, with and without the flag). It adds no change now. It stops the next install from taking a newer transitive release that a range would allow.

Regenerate after any runtime dependency change:

```sh
# runtime fields only: devDependencies make npm resolve dev conflicts
T=$(mktemp -d) && node -e 'const p=require("./package.json");const {name,version,type,dependencies,peerDependencies,peerDependenciesMeta}=p;require("fs").writeFileSync(process.argv[1]+"/package.json",JSON.stringify({name,version,type,dependencies,peerDependencies,peerDependenciesMeta},null,2))' "$T"
(cd "$T" && npm install --omit=dev --omit=peer --ignore-scripts && npm shrinkwrap)
cp "$T/npm-shrinkwrap.json" ./npm-shrinkwrap.json
```

Residual risks: the shrinkwrap pins only OpenCode registry installs, not `npm install <tgz>` or git installs. It depends on the registry honouring `_hasShrinkwrap`; without it, OpenCode installs resolve as before. No SBOM is generated per release; the shrinkwrap is the list of exact transitive versions.
