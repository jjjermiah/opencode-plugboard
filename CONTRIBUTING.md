# Contributing

Thanks for looking. Plugboard runs inside people's OpenCode servers, so the bar is "does not break the host", and a few rules follow from that. [AGENTS.md](AGENTS.md) is the same material written for coding agents. Start with [docs/architecture.md](docs/architecture.md), which explains the three lifetimes (plugin generation, HTTP request, host execution) that most bugs here come from mixing up.

Work is tracked in [GitHub issues](https://github.com/jjjermiah/opencode-plugboard/issues), not in markdown files. For anything bigger than a small fix, open or comment on an issue first so we agree on the shape before you write code. Reference it in your commit (`Fixes #N`). Report security problems privately, see [SECURITY.md](SECURITY.md).

## Set up

```sh
bun install
bun run typecheck
bun test
```

The type check also checks host compatibility: it fails when the pinned `@opencode/plugin` changes shape. CI runs the type check and the tests on every push and pull request.

## Tests

The suite uses `bun test` and nothing else. It is fast and never talks to a real OpenCode server: HOME and the XDG directories point at a temporary directory for the run. [test/README.md](test/README.md) explains the layout (`unit`, `http`, `session`, `runtime`, `live`) and the shared fakes.

- Add or change a test with every behaviour change. Name it after the behaviour, and the issue it protects: `"#38 a failure before the first output keeps its HTTP status"`.
- Use the shared fakes instead of new ones, and tables when cases differ only in data.
- No real waits beyond a few milliseconds: inject the interval, hold a fake with a `gate()`, or use fake timers.
- A known bug gets a `test.failing` with a comment. Never weaken a test to make it pass.

The tests do not replace a live run for host behaviour: run the change on an isolated server too.

## Never try a change on your real OpenCode

A plugin effect that blocked once froze every prompt in the project that loaded it. Run work in progress only on an isolated server with its own `HOME`, XDG dirs, port and a throwaway project. [docs/development.md](docs/development.md) has the recipe. Never edit `~/.config/opencode` or a real project's `.opencode/` to load a work-in-progress plugin.

After every plugin change, run the pong gate from that document: a normal prompt on the same server must still answer. Say in your pull request that it passed.

## Freeze-safety rules

- Plugin setup only registers and returns. No awaits, no `ctx` calls that wait for Location readiness, no sync filesystem work, no inline `Effect.never`. OpenCode runs plugin effects inline under its activation lock, and every prompt waits on it.
- Finalizers are synchronous and call nothing on `ctx`. Never await `session.interrupt` or any host call in teardown. Cleanup belongs in request code or `src/runtime.ts`.
- Outside the plugboard data root the plugin registers nothing but the shared listener.
- Plugins load once per Location, so anything that outlives a plugin generation lives on `globalThis` in `src/runtime.ts`. If you change that runtime's shape, bump its `VERSION`.

## Code rules

- Prefer a popular, industry-accepted npm package over hand-rolled code. Runtime packages go in `dependencies`, pinned to an exact version (the host installs them unattended); types go in `devDependencies`. OpenCode installs a registry plugin's `dependencies` with install scripts disabled, so a dependency must be pure JS with no install script and no native build; check `npm view <pkg> scripts` and `dependencies` first, and prefer packages with no dependencies of their own.
- `effect` and `@opencode/plugin` (and `/effect`) stay host-provided peers. The host serves them to a Bun plugin and throws on a plugin-local copy, so never list them in `dependencies`. `Schema` comes from `effect`.
- A plugin loaded from a local path gets no install, so run `bun install` in that checkout first.
- Never import `@opencode/ai` or OpenCode core at runtime.
- Import specifiers end in `.js`.
- `src/contract.ts` is the neutral seam between the OpenAI front-end and the OpenCode back-end. OpenAI wire details stay in `src/openai/`. A new API format is a new front-end beside it, not a change to the contract.
- Request sessions keep `deny *` plus `allow plugboard_seed_*` permissions. Keep that backstop.

## Package contents

`npm pack --dry-run --json --ignore-scripts` must list only the `files` from `package.json` (`index.ts`, `src/`, `README.md`, `LICENSE`). CI checks this with `bun .github/scripts/check-pack.ts`; run it yourself if you add files. `.github/scripts/` holds the release and CI tooling and is not published.

## Client checks

The [`compat/`](compat/README.md) kit runs real OpenAI clients against a plugboard server. Use it when a change touches the wire format. Results there are dated evidence for a commit, so add a new record instead of editing an old one.

## Changelog

Every user-visible change adds an entry under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md). Explain why the change was made and what it cost, not just what changed. Don't paste a commit list. Maintainers cut releases from that section, and every release needs a short creative title (2 to 5 words, `bun run release X.Y.Z --title "..."`), see [docs/releasing.md](docs/releasing.md).

## Writing style

Prose in the README, docs, issues and changelog is plain and short. No em or en dashes as punctuation. Keep machine-specific details out of the repo: no private IPs, home-directory paths or keys.

## Pull requests

- One change per pull request, with the issue linked.
- `bun run typecheck` and `bun test` pass.
- The pong gate passed on an isolated server, if you touched `src/` or `index.ts`.
- `[Unreleased]` in the changelog is updated.
