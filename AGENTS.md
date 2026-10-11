# AGENTS.md

OpenCode V2 plugin that serves an OpenAI-compatible API (`/v1/chat/completions`, `/v1/models`, `/v1/models/{id}`, `/healthz`) from inside an OpenCode server, using that server's connected providers. Tool calls go back to the caller; OpenCode never runs them. Start with `docs/architecture.md`: it explains the three lifetimes (plugin generation, HTTP request, host execution) that most bugs here come from mixing up.

## Commands

- `bun install`, then `bun run typecheck` and `bun test`. The typecheck checks `src/` with Node types, then the tests (`test/tsconfig.json`); it doubles as the host-compatibility check (`HostContextMatches` in `src/session/host.ts` fails it when the pinned `@opencode/plugin` changes shape).
- Tests: `bun test` only, no other framework or test dependency. Layout, conventions and the shared fakes (`FakeModelCaller`, loopback client, spy plugin context, `FakeSessionPort`, `FakeHistoryPort`, `bus`) are in `test/README.md`. Name each test after the behaviour and the issue it protects (`"#38 ..."`); no real sleeps beyond a few ms (inject the interval, use a `gate()`, or fake timers). Tests never touch a real OpenCode server or `~/.config/opencode` (`test/setup.ts` sandboxes HOME and XDG). A behaviour change comes with a test; a known bug gets a `test.failing`. Live runs on an isolated server are still required for host behaviour the fakes cannot show.
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
- Humans read `CONTRIBUTING.md`; releases are cut with `bun run release <version> --title "Short Creative Title"` (2 to 5 words, required; CHANGELOG headings read `## [X.Y.Z] - date: Title`; see `docs/releasing.md`). CI (`.github/workflows/ci.yml`) runs the typecheck, `bun test` and `bun .github/scripts/check-pack.ts`.
- Semantic versioning; update `CHANGELOG.md` (keep `[Unreleased]` at the top, with context and reasoning, not a commit dump) with every user-visible change.
- Parallel agent lanes use git worktrees under `.agents/worktrees/` (gitignored) with disjoint file sets; merge into `main`.
- Prose (README, docs, issues, changelog): plain and short, no em or en dashes as punctuation. Nothing machine- or homelab-specific in the repo (no private IPs, `/Users/...` paths, keys).
- Tested host: OpenCode 2.0.26 (dev dependency pinned; peer range `>=2.0.26 <2.1`). Host source for reading: a shallow clone of anomalyco/opencode at the `v2.0.26` tag.

## Client checks (`compat/`)

Manual compatibility kit, separate from the package: `compat/py` (uv) and `compat/js` (bun) each have their own lockfile. Scripts read `PLUGBOARD_KEY` and optional `PLUGBOARD_BASE_URL`. `compat/tools/logproxy.py` captures traffic (captures are sensitive), `compat/tools/sessions.py` lists/deletes test history (`--dry-run`). Results in `compat/results/` are dated evidence for a commit; don't edit old observations, add new records.
