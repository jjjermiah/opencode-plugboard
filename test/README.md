# Tests

`bun test` runs the suite (well under a second). `bun run typecheck` checks `src/` with Node types and then the tests with `test/tsconfig.json`, which adds Bun's types for test files only. Nothing here talks to a real OpenCode server or reads `~/.config/opencode`: `setup.ts` (preloaded by `bunfig.toml`) points `HOME` and every XDG directory at a temporary directory that is removed after the run. Tests are not in the npm package (`files` lists only `index.ts`, `src/`, `README.md`, `LICENSE`).

## Layout

The layers follow docs/architecture.md, from pure code out to the host.

| Directory | What it covers | Fakes |
|---|---|---|
| `unit/` | Pure codecs and policy: `config`, `models`, `openai/sampling`, the Chat Completions, Responses, Anthropic Messages and legacy completions codecs, discovery and status documents, metrics text, the logger, the host catalog | none (the catalog uses the spy context) |
| `http/` | `src/http.ts` primitives and every route over real loopback HTTP: ingress and auth, chat, responses, messages, completions and `n` fan-out, discovery, status, metrics, request ids | `FakeModelCaller`, loopback client |
| `session/` | `src/session/*`: collector, store, caller, context hook, media (SSRF guard), history, prune | `FakeSessionPort`, `FakeHistoryPort`, `bus`, spy context, loopback image server |
| `runtime/` | `src/runtime.ts` generations, listener, `ensureBackend`, and `index.ts` freeze safety | spy plugin context, runtime helpers |
| `live/` | Opt-in suite against an isolated server (not written yet, #99) | none |

## Conventions

- A test name states the behaviour, and starts with the issue it protects when there is one: `"#38 a failure before the first output keeps its HTTP status"`.
- Prefer tables (`test.each`) when the cases differ only in data. Inline the expected wire shape; there are no snapshot files.
- No real sleeps beyond a few milliseconds. Use the injected intervals (`sseWriter`'s keepalive, `beginRequest`'s grace), a `gate()` to hold a fake at a known point, `until()` for socket-driven state, or `jest.useFakeTimers()` for timers that fire without I/O (listener grace, the 15 s backend timeout).
- A known bug gets a `test.failing` with a comment that says what is wrong; flip it to `test` with the fix.
- Tests that touch `src/runtime.ts` call `isolateRuntime()`: no runtime before each test, its listener closed after, and a fresh data root.
- Assert log lines through `captureLogs()`; it also keeps the run quiet.

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
- `parseSse(text)`, `sseData(text)`: SSE frames, and the JSON of the `data:` frames.

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
