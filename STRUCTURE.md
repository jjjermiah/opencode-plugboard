# Structure

Where things live and where new code goes. How the pieces fit together, and why, is in [docs/architecture.md](docs/architecture.md). The rules that must hold in every change are its numbered invariants (I1, I2, ...).

## Top level

| Path | Job |
|---|---|
| `index.ts` | The plugin. Parses options and composes one generation: route, session caller, generation registration, context hook. Registers and returns, nothing else (I1). |
| `src/` | All runtime code. This is what gets published. |
| `docs/` | Architecture, configuration, per-API field lists, history, development and release notes. |
| `test/` | The `bun test` suite, including the automated client matrix (`test/compat`) and SDK wire-type goldens (`test/types`). See [test/README.md](test/README.md). Not published. |
| `examples/` | Runnable client examples, one directory per client, with scripted runs checked in CI and live runs as dated records. Not published. See [examples/README.md](examples/README.md). |
| `compat/` | The Python client checks that have no example yet (aider, DSPy, Instructor, LiteLLM, OpenAI Agents SDK). Not published. |
| `.github/floors/` | Ratcheting CI floors: tests per layer and coverage. Raised with `.github/scripts/test-gates.ts --ratchet`. |
| `.github/` | CI, release scripts, the pack check, the test gates and the compatibility matrix renderer. Not published. |
| `CONTRIBUTING.md`, `AGENTS.md` | Rules for people and for coding agents. |

## `src/` top-level files

| File | Job |
|---|---|
| `contract.ts` | The neutral vocabulary: `PlugRequest`, `PlugEvent`, `PlugError`, `CatalogModel` and the `ModelCaller` seam every front-end calls. |
| `config.ts` | The options type, defaults, `parseOptions`, `authenticate`, `authenticateUsage` (the admin key) and the loopback host check. |
| `models.ts` | Allowlist and alias policy: `resolveModel`, `listAvailableModels`. |
| `limits.ts` | Concurrency caps and requests per minute per app (option `limits`): a `ModelCaller` wrapper outside the fallbacks, with its queues on the runtime. |
| `stop.ts` | Caller stop sequences on the answer text: the tail check of a plain stop and the streamed holdback, shared by every front-end that has `stop` (#145, #149). |
| `budgets.ts` | Per-app budgets (option `budgets`): requests, tokens and cost per UTC day, week or month, read from the usage records. A `ModelCaller` wrapper outside `limits.ts`, with its warning state on the runtime. |
| `forwarded.ts` | Reverse-proxy headers (#266): `listen.trustProxy` parsing, the client address for the log, the forwarded host and origin. Read only from a trusted peer, never for authentication. |
| `http.ts` | Ingress and transport: body limits, Host and Origin checks, disconnect abort, the one deadline, JSON and SSE writers. |
| `keepalive.ts` | The location keep-alive (#310, #350): the loop that creates and removes one dedicated session every 30 minutes so OpenCode's idle eviction does not close the listener. Forked from setup by `index.ts`; the host calls are in `session/host.ts`. |
| `runtime.ts` | The process-wide runtime on `globalThis`: generations, confirmed app directories, `ensureBackend`, the listener, the event pump, the session store, history sweep state, the metrics registry. |
| `discovery.ts` | Pure builders for `GET /`, `GET /v1` and `GET /plugboard/status`, and `sendText`. |
| `version.ts` | `PACKAGE_VERSION`, the package.json version, read once at load. |
| `dashboard/` | The usage dashboard (`GET /plugboard/dashboard`, #141): `page.ts` is the static page, its CSP headers and route names; `assets.ts` serves the page and its files (`app.js`, `app.css`, uPlot from `node_modules`); `app.js` and `app.css` are the browser script and stylesheet, with no build step. |
| `user.ts` | The end user of a request (#57): the sanitizer for `user` and `metadata.user_id`, the dropped header, pure (no node imports). |
| `keys.ts` | Runtime app keys (#55): the store on the host storage (SHA-256 digests under `keys/`), the cache on the runtime, create, list and revoke. |
| `metrics.ts` | The @prometheus-io/client registry and text rendering. No I/O. |
| `log.ts` | The pino logger (text or JSON lines), the ambient request id and redaction. Ids and outcomes only. |
| `usage.ts` | Per-app usage by UTC day: day records, the latency histogram, cost (mirrors OpenCode's `calculateCost`), the recorder with its serialized storage writes and retention, the query, and the `withUsage` model-caller wrapper. |
| `usage-header.ts` | The `x-plugboard-usage` response header (#52): the format and the per-response accumulator behind `CallContext.onUsage`. |
| `rpc.ts` | The usage RPC (`opencode-plugboard.usage`, package entry `./rpc`): the definition and its handler builder. Registered by `index.ts`. |
| `tui.tsx` | The `/plugboard` usage page for OpenCode's TUI (package entry `./tui`, Solid and OpenTUI JSX). Reads the RPC through `context.client`. Not imported by `index.ts`, so the server never loads Solid. Checked by `tsconfig.tui.json`. Compiled to `dist/tui.js` by `build:tui` (`.github/scripts/build-tui.ts`), which the `./tui` export points at. |
| `tui-format.ts` | Pure helpers for that page: range presets, app and model rows, number formats. No OpenTUI imports. |

## `src/` directories

Each API front-end has the same three files: `request.ts` decodes the wire body into a `PlugRequest` (pure), `response.ts` encodes `PlugEvent`s into the wire shape (pure), `route.ts` runs the steps in between.

| Directory | Job |
|---|---|
| `admin/` | The admin routes for runtime keys (`/plugboard/admin/keys`), served only when `adminKey` is set (#55). |
| `openai/` | Chat Completions and `/v1/models`. `route.ts` is also the front door: it checks Host and Origin, authenticates, and hands every other API to its own route. Also holds `fanout.ts` (`n` above 1: one call per choice, merged) and `sampling.ts` (sampling parameters a model rejects). |
| `responses/` | `POST /v1/responses`. Stateless except `store.ts`: the output items of recent answers per app (1000 for an hour, in memory), so an `item_reference` resolves (#147). |
| `anthropic/` | `POST /v1/messages`. Takes the request over early: Anthropic error bodies and `x-api-key` auth. |
| `gemini/` | `generateContent`, `streamGenerateContent` and the Gemini model list. The model is in the URL, errors use Google's body. |
| `completions/` | Legacy `POST /v1/completions`. Always goes through the fan-out. |
| `session/` | The OpenCode back end. `host.ts` adapts the Effect plugin API to a Promise port. `caller.ts` runs one model call as one kept session. `context.ts` holds the context hook, seed tools and agent deny. `events.ts` turns bus events into `PlugEvent`s and host errors into safe `PlugError`s. `state.ts` is the session store shared by generations. `history.ts` has the data root, app directory and transcript. `prune.ts` has the history index and sweep. `media.ts` prepares images, including the remote fetch filter. `seeds.ts` has the seed names and the request permissions. `link.ts` fills the session page link (`historyUrl`, #77). |

## Request flow

1. The shared listener (`runtime.ts`) hands the request to the preferred generation's handler. With no live generation the answer is a 503.
2. `openai/route.ts` creates the request id, the abort and deadline scope (`http.ts`), and picks the route. A Messages path goes straight to `anthropic/route.ts`.
3. The Host and Origin checks run, then authentication. An unauthenticated caller learns nothing about which routes exist.
4. The route reads the JSON body and the front-end's `request.ts` decodes it into a `PlugRequest`.
5. `models.ts` resolves the model against the allowlist and the catalog. `openai/sampling.ts` drops parameters the model rejects.
6. The route calls `ModelCaller.stream`. `session/caller.ts` prepares images, awaits `ensureBackend`, creates a session with deny-all permissions, registers its state in the session store and starts the prompt.
7. The context hook in the app directory swaps in the caller's system prompt, messages and tools. The event pump feeds bus events to the session's collector (`events.ts`), which yields `PlugEvent`s. After a step that ends in tool calls, the caller interrupts the turn.
8. The front-end's `response.ts` encodes the events as JSON or SSE. Before the first output a failure is a real HTTP status. After it, a failure is an error frame. When the response ends, the caller retires the request guard in the session store.

## Where to add new code

**A new API format.** Add `src/<name>/` with `request.ts`, `response.ts` and `route.ts`, modeled on `src/responses/`. Do not change `contract.ts`. Keep wire presentation state in an `Exchange` object owned by your directory (I20). Add the path match and the hand-off in `src/openai/route.ts`, and use the shared steps in `http.ts` and `config.ts`: Host and Origin checks, authentication, the deadline, the SSE writer (I15, I16, I18, I19). Add a `docs/<name>.md` field list.

**A new option.** Add the field to `PlugboardOptions`, the known-key list and the validation in `src/config.ts`. Options are compared across generations as JSON, so a new option needs no extra wiring there. If a new option changes what the runtime holds, bump `VERSION` in `src/runtime.ts` (I6). Document it in `docs/configuration.md`.

**A new metric.** Add the counter or gauge to `createMetrics` in `src/metrics.ts` and record it from the route or caller through the `Metrics` interface. Keep labels to values the server chooses: no model name, key or client text. Record nothing when `metrics` is off.

**New session behaviour.** It goes in `src/session/`. Anything that runs in the app directory goes through `context.ts` and must be a no-op until `confirmed()` (I4). Anything that must outlive a generation goes through `src/runtime.ts` or `state.ts`. Teardown stays synchronous and calls nothing on `ctx` (I2). Host calls and host-shaped casts stay in `host.ts`.

**A new test.** Tests live in `test/`, layered like the code (unit, http, session, runtime), plus the client matrix (`test/compat`) and the SDK wire-type goldens (`test/types`); see [test/README.md](test/README.md) for the layers and shared fakes. Name the behaviour and the issue or invariant it protects, e.g. `I18: a failure before the first output keeps its HTTP status`. Host behaviour still needs a live run on an isolated server, as in [CONTRIBUTING.md](CONTRIBUTING.md).
