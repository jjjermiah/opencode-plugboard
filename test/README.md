# Tests

`bun test` runs the suite (well under a second). `bun run typecheck` checks `src/` with Node types and then the tests with `test/tsconfig.json`, which adds Bun's types for test files only. Nothing here talks to a real OpenCode server or reads `~/.config/opencode`: `setup.ts` (preloaded by `bunfig.toml`) points `HOME` and every XDG directory at a temporary directory that is removed after the run. Tests are not in the npm package (`files` lists only `index.ts`, `src/`, `README.md`, `LICENSE`).

## Layout

The layers follow docs/architecture.md, from pure code out to the host.

| Directory | What it covers | Fakes |
|---|---|---|
| `unit/` | Pure codecs and policy: `config`, `models`, `openai/sampling`, the Chat Completions, Responses, Anthropic Messages, legacy completions and Gemini codecs, discovery and status documents, metrics text, the logger, the host catalog. Also the decoder properties (`properties.test.ts`) and the SDK wire goldens (`wire.test.ts`) | none (the catalog uses the spy context) |
| `http/` | `src/http.ts` primitives and every route over real loopback HTTP: ingress and auth, chat, responses, messages, completions and `n` fan-out, Gemini, discovery, status, metrics, request ids | `FakeModelCaller`, loopback client |
| `session/` | `src/session/*`: collector, store, caller, context hook, media (SSRF guard), history, prune | `FakeSessionPort`, `FakeHistoryPort`, `bus`, spy context, loopback image server |
| `runtime/` | `src/runtime.ts` generations, listener, `ensureBackend`, and `index.ts` freeze safety | spy plugin context, runtime helpers |
| `compat/` | The client compatibility matrix (#101): official SDKs run a shared scenario set against a real route | `FakeModelCaller` scripted by `compat/scenarios.ts` |
| `types/` | No tests: the SDK-typed wire goldens checked by `bun run typecheck` (#132) | none |
| `live/` | Opt-in suite against an isolated server, and the provider x endpoint matrix (#99, #108). Skipped unless `PLUGBOARD_LIVE=1` | none: real models |


## Conventions

- A test name states the behaviour, and starts with the issue it protects when there is one: `"#38 a failure before the first output keeps its HTTP status"`.
- Prefer tables (`test.each`) when the cases differ only in data. Inline the expected wire shape; there are no snapshot files.
- No real sleeps beyond a few milliseconds. Use the injected intervals (`sseWriter`'s keepalive, `beginRequest`'s grace), a `gate()` to hold a fake at a known point, `until()` for socket-driven state, or `jest.useFakeTimers()` for timers that fire without I/O (listener grace, the 15 s backend timeout).
- A known bug gets a `test.failing` with a comment that says what is wrong; flip it to `test` with the fix.
- Tests that touch `src/runtime.ts` call `isolateRuntime()`: no runtime before each test, its listener closed after, and a fresh data root.
- Assert log lines through `captureLogs()`; it also keeps the run quiet.
- Prefer a popular, maintained package to hand-rolled test plumbing (`eventsource-parser`, `fast-check`, the official SDKs). Test-only packages are exact-pinned devDependencies and never ship.

## Beyond example tests

- **Properties** (`unit/properties.test.ts`, fast-check, #130): every request decoder returns a 400 `PlugError` or a well-formed request for any input, never a throw. Each decoder has an arbitrary of any value and a request-shaped one (`often(valid)` is usually valid, sometimes a wrong type), which must decode at least now and then. On a failure fast-check prints the seed and the shrunk counterexample; rerun one with `fc.assert(..., { seed, path })`.
- **SDK wire types** (`types/`, #132): `types/wire.ts` holds one golden per wire shape, generated from the encoders by `bun test/types/generate.ts`. Each golden `satisfies Wire<SdkType>` (every field we send exists in `openai`, `@anthropic-ai/sdk` or `@google/genai` with a compatible type) and goes through `exact<SdkType>()` (required fields we leave out). Known gaps have a `@ts-expect-error` naming them, listed in `GAPS` in `generate.ts`; when one closes, the unused directive fails the type check. `unit/wire.test.ts` checks the encoders still produce the goldens. After an intended wire change: regenerate, then `bun run typecheck`.
- **Compatibility matrix** (`compat/`, #101): `compat/clients.ts` lists each client (package, endpoint) and its cases per scenario in `compat/scenarios.ts`; `compat/langchain.ts` holds the LangChain JS clients (#102-#106). A scenario a client does not apply to is `na` with its reason in `na` (#148); a scenario with neither a case nor an `na` is a **todo**, which the CI summary counts. A known incompatibility is `{ gap, run }` and runs as `test.failing`. To add a client, add a `Client`; to add a scenario, add it to `SCENARIOS`, script the fake model's answer in `script()`, and give every client a case or an `na` reason. `docs/compatibility.md` is generated from the results (`.github/scripts/compat-matrix.ts`); CI fails when it is stale. `compat/abort.ts` checks the server saw a client's abort (cancellation).
- **Conformance** (`compat/conformance.test.ts`, #107): responses are validated with `ajv` against the response schemas vendored in `fixtures/specs/` (OpenAI's OpenAPI 3.1 document and Gemini's discovery document). Unknown fields and missing required fields fail; a known deviation is a `test.failing` that waives only the named field. `fixtures/specs/vendor.ts` regenerates the fixtures (run by hand; the output is committed, with its source URL and date). No public Anthropic Messages spec was found, so Anthropic is covered by the SDK types (`types/`). `compat/model-ids.test.ts` pins the `/` and `#` rules for model ids (#103).

## Live layer (#99, #108)

The only layer that calls real models. Opt-in: `bun test` skips it, and it never runs in CI. It drives an isolated OpenCode server (its own HOME, XDG dirs, port and throwaway project, see `docs/development.md`), through the wrapper the maintainer set up. Nothing in it edits that server's config.

```sh
# the matrix: one call per cell, writes docs/live-matrix.md and docs/live-matrix.json
PLUGBOARD_LIVE_KEY=... bun run live-matrix

# the suite: the same cells as tests, plus lifecycle checks
PLUGBOARD_LIVE=1 PLUGBOARD_LIVE_KEY=... bun test test/live
```

| Variable | Default | Meaning |
|---|---|---|
| `PLUGBOARD_LIVE` | unset | `1` turns the suite on (`bun test test/live` is skipped otherwise) |
| `PLUGBOARD_LIVE_KEY` | required | An app key of the isolated server. Read from the environment only; never written to a file or a report |
| `PLUGBOARD_LIVE_URL` | `http://127.0.0.1:4010` | Plugboard's listener on the isolated server |
| `PLUGBOARD_LIVE_MODELS` | one per provider: `opencode-go/glm-5.3-flash`, `anthropic/claude-haiku-4-5`, `openai/gpt-5.6-luna#low`, `github-copilot/gpt-5.5` | Comma list. Each id must appear in `GET /v1/models` |
| `PLUGBOARD_LIVE_OC` | `$REAL_HOME/.cache/opencode-adapter-dev/oc` | The wrapper that runs `oc api` against the isolated server |
| `PLUGBOARD_LIVE_CHECKOUT` | `$REAL_HOME/projects/repos/open-source/opencode-plugboard` | The checkout the server loads plugboard from; the report names its version and commit |

`test/setup.ts` moves HOME into a sandbox for `bun test`, so it records the real home first (`PLUGBOARD_REAL_HOME`); the suite needs it to reach the wrapper. The matrix runs outside `bun test` and uses HOME as it is.

**Cells.** `test/live/cells.ts` is the table both use: endpoints `chat`, `responses`, `messages`, `gemini`, `completions` against scenarios `text`, `stream`, `tool-call` (returned unexecuted), `tool-result` (one call with the result in the history), `image` (a 16x16 red PNG), `json` (JSON Schema output) and `tools-json` (a tool and a schema together). A scenario an endpoint does not carry is `n-a` with its reason (`naReason`). Each cell is one call with `max_tokens` 512. Failing cells read the provider's own error from the session, because plugboard answers a provider failure with a generic 502.

**Cost.** Every run spends real tokens: the matrix is 4 models x 30 applicable cells, about 120 calls, plus the suite's lifecycle calls. Each call is short, on a cheap model. Sessions the run creates are deleted at the end (`cleanup`, or `--keep-sessions` for the matrix).

**Known failures.** `test/live/known.ts` lists the cells that fail today, with what was observed. Each runs as `test.failing`: it must keep failing. A fix (or a provider that works again) turns it red, and the entry is removed in the same change. A cell that fails most runs is listed with its rate. A cell that fails only now and then (one failure in about 25 calls, `glm-5.3-flash` on `responses stream` in this log) is not listed: it runs as a plain test, and a failing run is the signal.

**Lifecycle.** Covered: a client disconnect mid-stream interrupts the request's session (`sessionGuards` drains, the host records `interrupted`); a tool-call turn and a tool-result turn are one clean assistant message each. Not covered: the request deadline (`requestTimeoutMs` needs a server started with a short one) and reloading the plugin during a request (needs the server restarted or its plugin edited). Both need a separate, dedicated server and are left out on purpose.

## Gates (`.github/floors/`)

CI runs the suite once more with JUnit and lcov output and `.github/scripts/test-gates.ts` checks two ratcheting floors (#110, #100): the tests that ran per layer (`.github/floors/test-count-floors.json`) and line and function coverage of `index.ts` and `src/` (`.github/floors/coverage-floor.json`). The job summary shows both tables. Floors only go up: after adding tests, run

```sh
bun test --coverage --coverage-reporter=lcov --coverage-dir=.coverage --reporter=junit --reporter-outfile=.coverage/junit.xml
bun .github/scripts/test-gates.ts .coverage --ratchet
```

and commit `.github/floors/` with the tests. Lowering a floor is a deliberate edit that the PR must explain.

## Benchmarks (#118)

`bun run bench` runs `test/bench/request.bench.ts` with mitata (exact-pinned): each front-end over loopback HTTP with a replayed model, a 2,000-delta stream, `n=3` fan-out, the pure decode and model resolution with a 1,000-model allowlist. It is not part of `bun test`. Connections are kept alive, because a new TCP connection per request made the medians swing by two orders of magnitude on loopback.

The gate compares the PR head with its base commit, both run in the same CI job on the same runner (#315). A committed baseline recorded on a laptop never matched a CI runner, so there is none. The `bench` job in `.github/workflows/ci.yml` checks out `github.event.pull_request.base.sha` into `base/`, runs `test/bench/request.bench.ts --json` in both trees, and runs `bun .github/scripts/bench-gate.ts base.json head.json --summary`. It fails when a head median is more than 1.5x its base median, or when a benchmark ran on the base and not on the head (renamed or deleted). A benchmark only on the head is new and never fails. The job is advisory (`continue-on-error`), and it runs on pull requests only. Each bench run takes about 15 seconds, so running both sides costs little.

To compare locally, record both sides on the same machine and do not mix machines:

```sh
git worktree add <base-dir> origin/main   # or any base commit
(cd <base-dir> && bun install --frozen-lockfile && bun test/bench/request.bench.ts --json <base.json>)
bun run bench -- --json <head.json>
bun .github/scripts/bench-gate.ts <base.json> <head.json>
```

Single-run medians on a shared machine move by tens of percent, so a 1.5x failure is a prompt to rerun and look, not proof of a regression.

## Mutation catalogue (#111)

`test/mutations/catalogue.ts` lists the guards that must never break silently, each as one exact text in one source file, the replacement that breaks it, and the test files that must fail. Invariant numbers cite `docs/architecture.md`. `bun run mutations` copies the source and tests to a temporary directory, checks that the named tests pass unmodified, then applies each entry there and requires a failing test. The working tree is never touched. A surviving entry is a gap in the tests: add the test, never delete the entry. The weekly workflow `.github/workflows/mutations.yml` runs it; it is not part of `bun test`.

Adding a guard: pick a snippet that occurs once, make sure a test names the behaviour, and run `bun run mutations -- --only <id>`.

## Route coverage manifest (#116)

`test/coverage-manifest.ts` is a table of every route the router serves, per request format (openai-chat, openai-responses, openai-completions, anthropic, gemini), with one cell per mode: json, stream, tools, images, structured output, n > 1 and errors. A cell names the tests that cover it (a file and a literal from a test title), says `n/a` with a reason, or is a `gap` that names its issue. `test/http/coverage-manifest.test.ts` fails when the router has a route with no row, a row names a route the router lacks, a cell is empty, or a cover does not resolve. The router's route names come from the quoted `METHOD /path` literals in `src/**/route.ts`; the few spelled by a template or constant are listed in `MANUAL_ROUTES` and probed on the live router. CI prints the table in the job summary (`bun run coverage-manifest`).

A new route needs its rows in the same change. A new route written as a template fails the probe until it is listed in `MANUAL_ROUTES`.

## Flake hunting (#115)

`bun run flake-hunt` runs the suite several ways and reports tests whose outcome depends on how they are run: Bun's shuffle (`--randomize --seed=N`, N printed), `--parallel`, and each test file alone. A test that fails in some runs and passes in others, fails in every run, or differs between a file alone and the suite is flagged, and the script exits 1. Runtime tests share `globalThis` and the data root, so this is where leaks show up. Options: `--runs N` (shuffles, default 10), `--seed S` (base seed), `--file <path>` (repeat one file, shuffled), `--summary`. Nightly in `.github/workflows/nightly.yml`, not on every push. A failing seed replays with `bun test --randomize --seed=N`.

## Shared fakes (`support/`)

### `fixtures.ts`

- `testOptions(raw?)`: `parseOptions` with `models: ["test/*"]` and no keys.
- `CATALOG`, `model(provider, id, extra?)`: catalog models (`test/echo` with variants `low` and `high`, `test/vision`, `other/model`).
- `ev.text | reasoning | call | finish | error`: `PlugEvent` builders. `events(...list)` makes a stream, `collect(iterable)` drains one.
- `plugRequest(overrides?)`: a resolved `PlugRequest`.
- `gate<T>()`: a promise opened from outside. `tick()`, `until(check, ms?, what?)`.

### `model-caller.ts`: `FakeModelCaller`

```ts
const caller = new FakeModelCaller([{ record: "ses_1" }, ev.text("Hi"), ev.finish()])
const caller = new FakeModelCaller((request, n) => (n === 0 ? [ev.error()] : [ev.finish()]))
```

Script steps: a `PlugEvent`; `{ record: id }` calls `onRecord`; `{ wait: promise }`; `"hang"` (until the request aborts); `{ throw: error }`. Like the real caller, the stream ends once `context.signal` aborts. `caller.calls[i]` (or `caller.call` when there must be exactly one) records `request`, `context`, `yielded`, `closed` and `aborted` (a promise of the abort reason).

### `loopback.ts`

- `startRoute({ caller, options?, catalog?, status? })`: the real `createOpenAiRoute` on 127.0.0.1 with an ephemeral port; `listen.port` is set to that port so the Host check passes. It gets a fresh metrics registry (`server.metrics`) and fixed runtime facts (`TEST_STATUS`), so route tests never create the process runtime.
- `listen(handler, host?)`: a bare loopback server (127.0.0.1, or e.g. `::1`) for transport tests and the image server.
- On either: `send(init)` resolves with `{ status, headers, text, json() }`; `open(init)` reads a response incrementally (`received`, `waitFor`, `ended`, `pause`, `destroy`); `raw(init)` returns the client request, to hang up before any response.
- `parseSse(text)`, `sseData(text)`: events and comments in order, parsed by `eventsource-parser` as real clients do (#129), and the JSON of the `data:` events. For exact bytes (keepalive timing) read `open(...).received`.

### `logs.ts`: `captureLogs()`

Call at the top of a file. `logs.of("request")` gives the parsed lines of one event, each `{ level, event, fields, raw }`.

### `plugin-context.ts`: `spyContext({ options, directory, respond? })`

A stand-in `Plugin.Context` that records every domain call (`session.hook`, `agent.list`, `storage.scan`, ...) with the current phase. `mark(phase)` starts a phase, `during(phase)` lists its calls, `registered(path)` returns the callback a registration received (the context hook, a transform). Methods return `Effect.void` unless `respond` answers them.

### `runtime.ts`

`isolateRuntime()`, `resetRuntime()`, `installForeignRuntime(version)`, `freePort()`, `generation(name, { port, ...overrides })` (a `GenerationInput` whose handler answers with its name), `NO_HISTORY`.

### `session.ts`

- `FakeSessionPort`: records `created`, `prompted`, `interrupted`; `script.create | prompt | interrupt` override an answer (fail, hold, custom IDs). Default IDs are `ses_1`, `ses_2`, ...
- `FakeHistoryPort`: `ctx.storage` and `session.remove` in memory. `entries` (sorted scans with `after` and `limit`), `sessions` the host still has, `failing` sessions whose delete rejects, `removed`.
- `bus(sessionID)`: host bus envelopes for `SessionStore.dispatch`: `textDelta`, `textEnded`, `reasoningDelta`, `toolInputStarted`, `toolCalled`, `usage`, `stepEnded`, `stepFailed`, `executionSucceeded | Failed | Interrupted`. Token records use the host's non-overlapping breakdown (`HostTokens`); errors are the host's `SessionError` (`HostError`, with the provider's raw `response.body`).

A session test usually registers a real `RequestCollector` in a real `createSessionStore()` and drives it with `store.dispatch(bus(id).…)`, exactly as the event pump does; the caller tests make `FakeSessionPort.script.prompt` dispatch the host's answer.
