# Contributing

Thanks for looking. Plugboard runs inside people's OpenCode servers, so the bar is "does not break the host", and a few rules follow from that. [AGENTS.md](AGENTS.md) is the same material written for coding agents. Start with [docs/architecture.md](docs/architecture.md), which explains the three lifetimes (plugin generation, HTTP request, host execution) that most bugs here come from mixing up.

Work is tracked in [GitHub issues](https://github.com/jjjermiah/opencode-plugboard/issues), not in markdown files. For anything bigger than a small fix, open or comment on an issue first so we agree on the shape before you write code. Reference it in your commit (`Fixes #N`). Report security problems privately, see [SECURITY.md](SECURITY.md).

## Set up

```sh
bun install
bun run typecheck
```

The type check is the only automated gate. It also checks host compatibility: it fails when the pinned `@opencode/plugin` changes shape. CI runs it on every push and pull request.

There is no test suite, on purpose. Please don't add one or a test framework. Prove behaviour with a throwaway `bun -e` script (a fake `ModelCaller` or `SessionPort`, real loopback HTTP), delete it afterwards, and run the change live on an isolated server.

## Never try a change on your real OpenCode

A plugin effect that blocked once froze every prompt in the project that loaded it. Run work in progress only on an isolated server with its own `HOME`, XDG dirs, port and a throwaway project. [docs/development.md](docs/development.md) has the recipe. Never edit `~/.config/opencode` or a real project's `.opencode/` to load a work-in-progress plugin.

After every plugin change, run the pong gate from that document: a normal prompt on the same server must still answer. Say in your pull request that it passed.

## Freeze-safety rules

- Plugin setup only registers and returns. No awaits, no `ctx` calls that wait for Location readiness, no sync filesystem work, no inline `Effect.never`. OpenCode runs plugin effects inline under its activation lock, and every prompt waits on it.
- Finalizers are synchronous and call nothing on `ctx`. Never await `session.interrupt` or any host call in teardown. Cleanup belongs in request code or `src/runtime.ts`.
- Outside the plugboard data root the plugin registers nothing but the shared listener.
- Plugins load once per Location, so anything that outlives a plugin generation lives on `globalThis` in `src/runtime.ts`. If you change that runtime's shape, bump its `VERSION`.

## Code rules

- Runtime imports are only `effect`, `@opencode/plugin` (and `/effect`) and `node:*`. The host provides the first two, and a bundled second copy breaks things. Everything else is `import type`. Never import `@opencode/ai` or OpenCode core at runtime.
- Import specifiers end in `.js`.
- `src/contract.ts` is the neutral seam between the OpenAI front-end and the OpenCode back-end. OpenAI wire details stay in `src/openai/`. A new API format is a new front-end beside it, not a change to the contract.
- Request sessions keep `deny *` plus `allow plugboard_seed_*` permissions. Keep that backstop.

## Package contents

`npm pack --dry-run --json --ignore-scripts` must list only the `files` from `package.json` (`index.ts`, `src/`, `README.md`, `LICENSE`). CI checks this with `bun .github/scripts/check-pack.ts`; run it yourself if you add files. `.github/scripts/` holds the release and CI tooling and is not published.

## Client checks

The [`compat/`](compat/README.md) kit runs real OpenAI clients against a plugboard server. Use it when a change touches the wire format. Results there are dated evidence for a commit, so add a new record instead of editing an old one.

## Changelog

Every user-visible change adds an entry under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md). Explain why the change was made and what it cost, not just what changed. Don't paste a commit list. Maintainers cut releases from that section, see [docs/releasing.md](docs/releasing.md).

## Writing style

Prose in the README, docs, issues and changelog is plain and short. No em or en dashes as punctuation. Keep machine-specific details out of the repo: no private IPs, home-directory paths or keys.

## Pull requests

- One change per pull request, with the issue linked.
- `bun run typecheck` passes.
- The pong gate passed on an isolated server, if you touched `src/` or `index.ts`.
- `[Unreleased]` in the changelog is updated.
