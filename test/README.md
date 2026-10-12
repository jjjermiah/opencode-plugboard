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
| `live/` | Opt-in suite against an isolated server (not written yet, #99) | none |

The top-level `compat/` directory is a different thing: the manual kit run against a real server.

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
- **Compatibility matrix** (`compat/`, #101): `compat/clients.ts` lists each client (package, endpoint) and its cases per scenario in `compat/scenarios.ts`. A case the endpoint cannot have is left out (n/a); a known incompatibility is `{ gap, run }` and runs as `test.failing`. To add a client, add a `Client`; to add a scenario, add it to `SCENARIOS`, script the fake model's answer in `script()`, and give every client a case or leave it out. `docs/compatibility.md` is generated from the results (`.github/scripts/compat-matrix.ts`); CI fails when it is stale.

## Gates (`.ci/`)

CI runs the suite once more with JUnit and lcov output and `.github/scripts/test-gates.ts` checks two ratcheting floors (#110, #100): the tests that ran per layer (`.ci/test-count-floors.json`) and line and function coverage of `index.ts` and `src/` (`.ci/coverage-floor.json`). The job summary shows both tables. Floors only go up: after adding tests, run

```sh
bun test --coverage --coverage-reporter=lcov --coverage-dir=.coverage --reporter=junit --reporter-outfile=.coverage/junit.xml
bun .github/scripts/test-gates.ts .coverage --ratchet
```

and commit `.ci/` with the tests. Lowering a floor is a deliberate edit that the PR must explain.

## Benchmarks (#118)

`bun run bench` runs `test/bench/request.bench.ts` with mitata (exact-pinned): each front-end over loopback HTTP with a replayed model, a 2,000-delta stream, `n=3` fan-out, the pure decode and model resolution with a 1,000-model allowlist. It is not part of `bun test`. Connections are kept alive, because a new TCP connection per request made the medians swing by two orders of magnitude on loopback.

```sh
bun run bench -- --json run.json
bun .github/scripts/bench-gate.ts run.json --summary
```

`.ci/bench-baseline.json` holds the median per benchmark (ns) from one machine. The gate fails when a median is more than 2x its baseline, or when a baseline entry did not run. Runners differ from that machine, so the CI job is advisory. To move the baseline after an intended change, run the bench on the same kind of machine, `bun .github/scripts/bench-gate.ts run.json --update`, and commit it with the change.

## Mutation catalogue (#111)

`test/mutations/catalogue.ts` lists the guards that must never break silently, each as one exact text in one source file, the replacement that breaks it, and the test files that must fail. Invariant numbers cite `docs/architecture.md`. `bun run mutations` copies the source and tests to a temporary directory, checks that the named tests pass unmodified, then applies each entry there and requires a failing test. The working tree is never touched. A surviving entry is a gap in the tests: add the test, never delete the entry. The weekly workflow `.github/workflows/mutations.yml` runs it; it is not part of `bun test`.

Adding a guard: pick a snippet that occurs once, make sure a test names the behaviour, and run `bun run mutations -- --only <id>`.

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
