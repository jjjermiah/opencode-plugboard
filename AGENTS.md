# AGENTS.md

OpenCode V2 plugin that serves an OpenAI-compatible API (`/v1/chat/completions`, `/v1/models`, `/v1/models/{id}`, `/healthz`) from inside an OpenCode server, using that server's connected providers. Tool calls go back to the caller; OpenCode never runs them. Start with `docs/architecture.md`: it explains the three lifetimes (plugin generation, HTTP request, host execution) that most bugs here come from mixing up.

`STRUCTURE.md` maps every directory and says where new code goes. The numbered invariants (I1 to I24) in `docs/architecture.md` are the rules a change must not break; cite them by number in commits and reviews.

## Tools

Use the dedicated tools, not bash, for code and files: `aft_search`, `aft_outline`, `aft_zoom`, `aft_inspect`, `aft_safety`, `ast_grep_search`/`ast_grep_replace`, `read`, `write`, `edit`, `glob`, `grep`. Never `grep`/`rg`/`find`/`cat`/`sed`/`awk`/heredocs or python scripts in bash to find, read or change files. Bash is for running things: `bun test`, `bun run …`, git, gh. Lanes work in worktrees under `.agents/worktrees/`: always pass absolute paths to read/write/edit, because relative paths resolve against the session's project root, not the worktree. Write a commit message to a file with `write`, then `git commit -F <file>`.
## Commands

- `bun install`, then `bun run lint`, `bun run format` (check only; `bun run format:write` fixes it), `bun run typecheck` and `bun test`. Biome settings are in `biome.jsonc`. The typecheck checks `src/` with Node types, then the tests (`test/tsconfig.json`); it doubles as the host-compatibility check (`HostContextMatches` in `src/session/host.ts` fails it when the pinned `@opencode/plugin` changes shape).
- Tests: `bun test` is the runner. Prefer popular, maintained packages (exact-pinned devDependencies) to hand-rolled test code: `eventsource-parser` for SSE, `fast-check` for properties, the official SDKs for wire types (`test/types`) and the client matrix (`test/compat`). Layout, conventions and the shared fakes (`FakeModelCaller`, loopback client, spy plugin context, `FakeSessionPort`, `FakeHistoryPort`, `bus`) are in `test/README.md`. Name each test after the behaviour and the issue it protects (`"#38 ..."`); no real sleeps beyond a few ms (inject the interval, use a `gate()`, or fake timers). Tests never touch a real OpenCode server or `~/.config/opencode` (`test/setup.ts` sandboxes HOME and XDG). A behaviour change comes with a test; a known bug gets a `test.failing`. Live runs on an isolated server are still required for host behaviour the fakes cannot show.
- `npm pack --dry-run --json --ignore-scripts` must list only `files` (index.ts, src/, README.md, LICENSE).

## Never develop against a real OpenCode server

A plugin effect that blocked once froze every prompt in the project that loaded it. Live runs only on an isolated server with its own HOME/XDG dirs, port and throwaway project (recipe: `docs/development.md`). Never edit `~/.config/opencode` or a real project's `.opencode/` to load a work-in-progress plugin. After every plugin change, the pong gate (a normal prompt in the same server still answers) must pass before any adapter result counts. Only one agent edits the plugin and uses the dev server at a time.

## Freeze-safety rules (break these and you break users' OpenCode)

- Plugin setup only registers and returns: no awaits, no `ctx` calls that wait for Location readiness, no sync filesystem work, no inline `Effect.never`. OpenCode runs plugin effects inline under its activation lock and every prompt waits on it.
- Finalizers are synchronous and call nothing on `ctx`; never await `session.interrupt` or any host call in teardown. Cleanup belongs to request code or `src/runtime.ts`.
- Outside the plugboard data root the plugin registers nothing but the shared listener (no hooks, seed tools or agent changes).
- Plugins load once per Location, so anything that outlives a generation (listener, generation list, session store, event pump) lives on `globalThis` in `src/runtime.ts`. If you change that runtime's shape, bump its `VERSION`: a different version stays inert, and hot reload then needs a server restart.

## Code rules

- Dependencies: prefer a popular, industry-accepted npm package over hand-rolled code. Runtime packages go in `dependencies`, pinned to an exact version (the host installs them unattended); types go in `devDependencies`. OpenCode installs a registry plugin's `dependencies` with install scripts disabled (`ignoreScripts: true`), so a dependency must be pure JS with no install script and no native build. Check `npm view <pkg> scripts` and `dependencies` first, and prefer packages with no dependencies of their own. `effect` and `@opencode/plugin` (`Schema` comes from `effect`) stay host-provided peers: the host serves them to a Bun plugin and throws on a plugin-local copy, so never list them in `dependencies`. A plugin loaded from a local path gets no install at all, so a checkout used that way needs `bun install` first. Never import `@opencode/ai` or OpenCode core at runtime.
- Import specifiers end in `.js`.
- `src/contract.ts` is the neutral seam: `ModelCaller.stream(PlugRequest, { app, signal, onRecord })` yields `PlugEvent`s. OpenAI presentation (stream, include_usage, structured unwrapping, wire error `type`) stays in `src/openai/` (`OpenAiExchange`); errors carry a neutral `kind` mapped to the wire in `encodeError`. New API formats (Responses, Anthropic Messages, Gemini) are new front-ends beside `src/openai/`, not changes to the contract.
- `PlugUsage` totals are inclusive (output includes reasoning, input includes cache); OpenCode reports a non-overlapping breakdown, mapped in `src/session/events.ts`.
- Seed tools: the context hook re-keys pre-registered `plugboard_seed_*` descriptors to the caller's tool names. Mutate the descriptor objects in place; never copy them (the host maps them back by object identity).
- Request sessions are kept as history and carry `deny *` + `allow plugboard_seed_*` permissions; keep that backstop.

## Repo conventions

- Work items are GitHub issues in `jjjermiah/opencode-plugboard` (milestones `v0.1`, `later`), not markdown files in the repo. Reference them in commits (`Fixes #N`).
- Humans read `CONTRIBUTING.md`; releases are cut with `bun run release <version> --title "Short Creative Title"` (2 to 5 words, required; CHANGELOG headings read `## [X.Y.Z] - date: Title`; see `docs/releasing.md`). CI (`.github/workflows/ci.yml`) runs the typecheck, `bun test`, the test gates (per-layer test-count and coverage floors in `.github/floors/`, raised with `.github/scripts/test-gates.ts --ratchet`, never lowered silently), the client compatibility matrix (regenerates `docs/compatibility.md`, which must be committed up to date) and `bun .github/scripts/check-pack.ts`.
- Every agent commit is a Conventional Commit with a detailed body (what, why, rejected alternatives, validation evidence, `Fixes #N`); `commitlint` enforces it and the bodies become the GitHub release notes (`CONTRIBUTING.md#commits`). Write the message to a file and check it with `bunx commitlint --edit <file>` before `git commit -F`.
- Semantic versioning; update `CHANGELOG.md` (keep `[Unreleased]` at the top, with context and reasoning, not a commit dump) with every user-visible change.
- Parallel agent lanes use git worktrees under `.agents/worktrees/` (gitignored) with disjoint file sets; merge into `main`.
- Prose (README, docs, issues, changelog): plain and short, no em or en dashes as punctuation. Nothing machine- or homelab-specific in the repo (no private IPs, `/Users/...` paths, keys).
- Host versions: the peer range is `>=2.0.26 <2.1`; the dev pin is in `package.json`; CI tests three hosts picked by `.github/scripts/host-versions.ts`. Host source for reading: a shallow clone of anomalyco/opencode at the matching `v2.0.x` tag.

## User docs (`README.md`, the site under `docs/`)

The site is for people using plugboard. It describes the project as it is now, as if it had always been this way.

- **No history.** No "(since X.Y.Z)" or "(since next)" markers, no "before 0.N", "used to", "no longer", "now", "was refused", "was added after". History lives only in `CHANGELOG.md` and release notes.
- **No test reports.** Client pages are setup guides, not records: no pass/fail lines, tested versions, live-run links, scenario ids (S1..S7), harness or fake-server details, "worked on every model tested". Test evidence stays in `examples/` and `test/`.
- **Client page shape:** one line on what the client is; Connect (base URL, key, model, the smallest working config or code, imported from the example with `<<<` when one exists); What works (short bullets: streaming, tools, structured output, images, files); Limits (only what is true today, each with the workaround). Nothing else.
- **Config snippets:** a snippet that is part of the plugboard config is tagged, so the site adds a Full config tab with the whole `opencode.jsonc` around it. ` ```jsonc plugboard ` holds members of `options` (or `options` itself in braces), ` ```jsonc plugboard-options ` holds an `"options"` member (or the entry in braces). Do not tag other apps' configs, responses, or a snippet that is already a whole `opencode.jsonc`. The wrapper is `docs/.vitepress/full-config.ts`; it adds `keys` and `models` when the snippet has none, and an invalid snippet fails `bun run docs:build`.
- **Install pins** are written `opencode-plugboard@X.Y.Z` inside a quoted `"package"` value; `bun run release` moves them to the released version. In site pages `__PLUGBOARD_VERSION__` also expands to the latest release.
- **Voice:** second person, present tense, short sentences, the answer first. No filler ("note that", "simply", "it is worth"), no hedging lists of what was or was not checked, no repeating a fact the linked reference page already states.
- **Maintainer pages** (`architecture.md`, `development.md`, `releasing.md`, `packaging.md`, `review-bot.md`, `red-team.md`, `best-practices.md`, `security-reviews.md`, and the generated `compatibility.md`, `live-matrix.md`, `examples.md`) stay in `docs/` but are excluded from the site (`srcExclude` in `docs/.vitepress/config.ts`). Link to them from user pages only with a GitHub URL.

## Client checks (`examples/`)

Each client has a runnable example in `examples/<client>/` with its own lockfile. An SDK bump or a wire-format change in `src/` leaves the scripted runs stale until `bun examples/_harness/run.ts all --target scripted` is rerun and the diff is committed (CI fails on a stale run). Live runs are dated records under `examples/<client>/runs/live/`; add a new directory, don't rewrite an old one. `examples/_tools/sessions.py` lists/deletes test history (`--dry-run`).
