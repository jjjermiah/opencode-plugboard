# Contributing

Thanks for looking. Plugboard runs inside people's OpenCode servers, so the bar is "does not break the host", and a few rules follow from that. [AGENTS.md](AGENTS.md) is the same material written for coding agents. Start with [docs/architecture.md](docs/architecture.md), which explains the three lifetimes (plugin generation, HTTP request, host execution) that most bugs here come from mixing up.

[STRUCTURE.md](STRUCTURE.md) maps the source and says where new code goes. The numbered invariants in [docs/architecture.md](docs/architecture.md#invariants) are the rules a change must not break.

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

`npm pack --dry-run --json --ignore-scripts` must list only the `files` from `package.json` (`index.ts`, `src/`, `README.md`, `LICENSE`). CI checks this with `bun .github/scripts/check-pack.ts`; run it yourself if you add files. `.github/scripts/` holds the release and CI tooling and is not published. `bun run smoke:pack` installs the packed tarball into a throwaway project and loads the plugin from it; CI runs it too.

## Client checks

The [`compat/`](compat/README.md) kit runs real OpenAI clients against a plugboard server. Use it when a change touches the wire format. Results there are dated evidence for a commit, so add a new record instead of editing an old one.

## Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and carry a detailed body. The bodies are not decoration: at release time `.github/scripts/release-notes.ts` collects every commit since the previous tag, groups them by type and publishes them in the GitHub release under "The full story" (and in a collapsed block in `CHANGELOG.md`). Whatever you write in the body is what a reader of the release sees.

```text
type(scope): subject in the imperative, lower case, no full stop

Body: what changed, why, what you decided and what you rejected, how you
checked it. Wrap at 72 columns; paragraphs are joined when the notes render.

Fixes #N
```

- **Types:** `feat`, `fix`, `security`, `perf`, `refactor`, `test`, `docs`, `ci`, `build`, `chore`, `style`, `revert`. Use `(deps)` as the scope for dependency bumps (`build(deps): ...`). Mark a breaking change with `!` after the scope and a `BREAKING CHANGE:` footer.
- **Scopes** are optional. Suggested: `openai`, `responses`, `anthropic`, `gemini`, `completions`, `session`, `runtime`, `http`, `config`, `metrics`, `discovery`, `cache`, `fallback`, `tests`, `ci`, `docs`, `changelog`, `deps`. An unknown scope only warns.
- **Subject** at most 100 characters, imperative, not capitalised, no full stop.
- **Body** required on every commit. For `feat`, `fix`, `perf`, `refactor` and `security` it needs at least 150 characters, and in practice should run to several paragraphs. Cover what changed, why, which alternatives you rejected and why, how you checked it (command and result), and the invariant (`I7`) or issue it touches.
- **Footer** with `Fixes #N` or `Refs #N`.

Merge commits and `chore(release): X.Y.Z` (written by the release script) are exempt.

Example:

```text
fix(responses): end a stream with response.failed after reasoning

A model that reasoned first and then failed before writing any text made
/v1/responses send a 200 stream with no events. A client could not tell
that failure from an empty answer. The encoder now tracks whether
reasoning has already committed the stream and, if the model then fails,
emits response.failed with the neutral error kind mapped to the wire.

I first tried sending a keepalive comment until the model produced text,
but that hides the failure for as long as the model keeps reasoning.
The status code cannot change once the 200 is committed, so an in-band
event is the only honest signal.

Checked with a new loopback test that scripts reasoning then failure
(fails before the change, passes after), `bun run typecheck`, `bun test`,
and a live run on an isolated server where the pong gate still answered.

Fixes #N
```

### Enforcement

`commitlint` (config in `commitlint.config.mjs`) checks the format in two places:

- Locally, a [lefthook](https://lefthook.dev) `commit-msg` hook. Install it once per clone with `bunx lefthook install`. Worktrees share the clone's hooks, but each needs its own `bun install`. Check a draft with `bunx commitlint --edit <file>` or `echo "..." | bunx commitlint`.
- In CI, the "Commits" workflow lints every commit in a push or pull request. Commits up to `a54a703` (Release 0.11.0, the last one before the convention) are never checked.

There is no `prepare` script on purpose. npm runs `prepare` on `npm publish`, and the publish job installs no dev dependencies, so the hook would break the release.

## Changelog

Every user-visible change adds an entry under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md). Explain why the change was made and what it cost, not just what changed. Don't paste a commit list. Maintainers cut releases from that section, and every release needs a short creative title (2 to 5 words, `bun run release X.Y.Z --title "..."`), see [docs/releasing.md](docs/releasing.md).

## Writing style

Prose in the README, docs, issues and changelog is plain and short. No em or en dashes as punctuation. Keep machine-specific details out of the repo: no private IPs, home-directory paths or keys.

## Pull requests

- One change per pull request, with the issue linked.
- Every commit passes `commitlint` and has a detailed body (see [Commits](#commits)).
- `bun run typecheck` and `bun test` pass.
- The pong gate passed on an isolated server, if you touched `src/` or `index.ts`.
- `[Unreleased]` in the changelog is updated.
