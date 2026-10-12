# Changelog

Everything notable about `opencode-plugboard` lands here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with one liberty: entries explain why a change was made, not just what changed. If a decision cost something, the cost is written down next to it.

## Versioning

The project follows [Semantic Versioning](https://semver.org/). While the major version is 0:

- A minor bump (0.1 to 0.2) may break things: an option renamed, a default changed, an error code moved.
- A patch bump (0.1.0 to 0.1.1) is for fixes only.
- The peer range on OpenCode is part of the contract. Plugboard talks to an unstable host API, so a change to the supported OpenCode range is at least a minor bump.

Work is tracked in [GitHub issues](https://github.com/jjjermiah/opencode-plugboard/issues). The [v0.1 milestone](https://github.com/jjjermiah/opencode-plugboard/milestone/1) is what had to be true before the first release. The [later milestone](https://github.com/jjjermiah/opencode-plugboard/milestone/2) holds everything that was deliberately left out.

## [Unreleased]

### Added

- **Manage app keys without touching the config** ([#55](https://github.com/jjjermiah/opencode-plugboard/issues/55)). With `adminKey` set:

  ```sh
  curl -X POST http://127.0.0.1:4010/v1/admin/keys -H "Authorization: Bearer $ADMIN" -d '{"app":"n8n"}'
  # {"id":"057fcda3","app":"n8n","key":"kxwn...","createdAt":"..."}   the key is shown once
  curl http://127.0.0.1:4010/v1/admin/keys -H "Authorization: Bearer $ADMIN"
  curl -X DELETE http://127.0.0.1:4010/v1/admin/keys/057fcda3 -H "Authorization: Bearer $ADMIN"
  ```

  Runtime keys are stored as SHA-256 digests in plugboard's storage, survive restarts, and stop working on the next request after a delete. Config keys can't be deleted this way (409).
- **Know who is talking** ([#57](https://github.com/jjjermiah/opencode-plugboard/issues/57)). The OpenAI `user` field and Anthropic `metadata.user_id` now prefix the session title (`[alice] ...`), appear in the request log, and get their own counts in `GET /v1/usage` (`users` per app, `?user=` to filter). A value that can't be kept safely (over 64 characters, or characters outside letters, digits and `. _ @ : -`) is dropped and the answer says `x-plugboard-user-dropped: 1`.
- **Click through to the session** ([#77](https://github.com/jjjermiah/opencode-plugboard/issues/77)). Set `"historyUrl": "http://aihub:4096/session/{id}"` and every answer carries `x-plugboard-session-url`, also logged as `session_url`.
- **Skills as models** ([#79](https://github.com/jjjermiah/opencode-plugboard/issues/79)). Bind an OpenCode skill to a model with an alias, and a client calls it by name without knowing the instructions:

  ```jsonc
  "aliases": { "invoice-parser": "skill:invoice-parser@anthropic/claude-sonnet-4-6" }
  ```
- **Agents as models** ([#6](https://github.com/jjjermiah/opencode-plugboard/issues/6), first part). `"agents": [{ "name": "review", "model": "anthropic/claude-sonnet-4-6" }]` lists `agent/review`, which answers with that OpenCode agent's system prompt. It never runs a tool on the server: OpenCode merges agent rules before the session's deny-all and the last match wins.

### Changed

- Internal runtime version 14. Restart OpenCode after upgrading.

## [0.19.0] - 2026-10-11: Spend Within Your Means

**Full diff:** [v0.18.0...v0.19.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.18.0...v0.19.0)

### Added

- **Per-app budgets** ([#60](https://github.com/jjjermiah/opencode-plugboard/issues/60)). Cap what each app may use per UTC day, ISO week or calendar month, by requests, tokens or estimated cost:

  ```jsonc
  "budgets": {
    "perApp": { "tokens": { "day": 2000000 } },
    "apps": { "discord-bot": { "costUsd": { "month": 20 } } }
  }
  ```

  Once an app has used a ceiling, its next call gets 429 `budget_exceeded` with `Retry-After` set to the window reset, before any session is created. Crossing 80% logs `budget.warning` once per window, and `GET /v1/usage` shows each app's budget state. Budgets read the usage records, so they need `usage` on; calls already in flight are not counted yet, so a burst can overshoot by what it started at once.
- **`x-plugboard-usage` header** ([#52](https://github.com/jjjermiah/opencode-plugboard/issues/52)). Non-streaming answers carry `x-plugboard-usage: input=812; output=64; cache_read=640; cost_usd=0.000412`, so a client can log its own spend without asking the usage API.
- **Vercel AI SDK default multi-turn works** ([#147](https://github.com/jjjermiah/opencode-plugboard/issues/147)). `/v1/responses` resolves `item_reference` items for answers plugboard returned in the last hour (per app, in memory), so `store: true` clients no longer need `store: false`. An unknown reference is a 400 that suggests `store: false`.

### Fixed

- **Stop sequences are stripped everywhere** ([#149](https://github.com/jjjermiah/opencode-plugboard/issues/149)). Chat Completions, legacy completions and Gemini now remove a caller stop sequence the model stopped on, as Anthropic Messages already did; streams hold back the last few characters so the sequence never reaches the client.
- **Unknown Gemini paths say what they expected** ([#150](https://github.com/jjjermiah/opencode-plugboard/issues/150)). An authenticated request to a `/v1beta` path that matches nothing gets a 404 naming `/v1beta/models/{model}:generateContent`, not a 401 that looked like a bad key.
- Gemini non-streaming tool calls and structured output are now covered by tests ([#151](https://github.com/jjjermiah/opencode-plugboard/issues/151)).

### Changed

- Internal runtime version 13. Restart OpenCode after upgrading.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (11 commits)</summary>

#### Features

**feat(responses): resolve item_reference to recent answer output** ([`a316172`](https://github.com/jjjermiah/opencode-plugboard/commit/a316172936773165e319c686568edaa99fcf73fa))

The Vercel AI SDK keeps `store: true` by default. On a multi-turn chat it replays the earlier assistant turn as an `item_reference` to the output item plugboard returned, and plugboard refused it with a 400. The default AI SDK chat therefore failed on its second turn.

plugboard now keeps the output items of recent answers in a bounded, per-app, in-memory store (src/responses/store.ts): up to 1000 answers for an hour, held on globalThis under a versioned key so a plugin generation can be replaced without losing it. Items are filled from completed and incomplete answers, streamed or not; failed answers have nothing to replay. The decoder takes a resolver, so the codec stays pure, and a resolved item decodes as the item it was: a message as the assistant turn, a function_call as a tool call that its output pairs with.

A reference the store does not hold (restart, expiry, eviction, or another app's item) is a 400 `item_not_found` whose message suggests `store: false`. `previous_response_id` and `conversation` stay refused: the store keeps outputs, not the inputs a previous response needs, so resolving them would be a guess. Nothing is written to disk.

The matrix flips the AI SDK multi-turn gap. Tests cover the codec resolution and rejection, the JSON and streamed store fill, the unknown-id 400, and per-app isolation. The docs for Responses, the Vercel AI SDK page and the architecture note describe the store.

Fixes #147

**feat(config): parse the budgets option** ([`8d47a0b`](https://github.com/jjjermiah/opencode-plugboard/commit/8d47a0b47d11aa81233f84f79f97694192f4e849))

Option budgets holds { perApp?, apps? }. Each budget sets ceilings on requests, tokens and costUsd, and each metric maps the windows day, week and month to a limit. Counts must be positive integers; costUsd takes any positive number of USD. An apps entry replaces perApp metric by metric, so an app's requests ceiling replaces perApp's requests while its tokens ceiling still comes from perApp. Unknown keys and apps entries with no configured app are refused, with the same error style as limits.

Budgets are counted from the usage records, so a config with usage off is refused at load. Retention must also cover the windows in use: a month needs 31 days and a week 7. Otherwise pruned days would drop out of the count and a budget would undercount. The check sits in parseOptions next to the usage check, so the message names both options.

Rejected: one option per window (more keys, no gain), and budgets keyed by API key (the issue asks for per app, and each key already names one). Nothing enforces the budgets in this commit. The wrapper follows in the runtime commit.

Checked with the table and shape tests in test/unit/config.test.ts, run with bun test on that file.

Refs #60

**feat(http): report each answer's tokens and cost in x-plugboard-usage** ([`129af27`](https://github.com/jjjermiah/opencode-plugboard/commit/129af27f668fbde2f225701457ef7dede47c49ec))

Usage is recorded per app (#52), but a caller had no way to see what one request cost without asking GET /v1/usage. With usage recording on, each non-streaming model answer now carries x-plugboard-usage: input=<n>; output=<n>; cache_read=<n>; cost_usd=<x.xxxxxx>.

input and output are the totals the response body already reports (cache reads inside input, reasoning inside output), and cost_usd is priced from the same tokens with the catalog price, as the usage report does. The header is left without cost_usd when the model has no price. A request with n > 1 sums its choices into one value.

withUsage is the only place that sees the finish usage with the model that answered, so it calls a new CallContext.onUsage once per answered call, before the finish event. Each front-end sets the header through reportUsage (src/usage-header.ts) while its headers are open. Streams get no callback: their headers go out with the first event, before the usage is known, so a streamed answer has no header. The recorder gains a price method that wraps the existing catalog lookup, and priceCall is unchanged.

Tests cover the format, the sum over choices, the unpriced and the streamed cases, the Responses, Messages, Gemini and legacy completions JSON answers, and withUsage's totals before the finish. The configuration and architecture docs describe the header.

Fixes #52

**feat(runtime): refuse an app's calls once its budget is used up** ([`de61120`](https://github.com/jjjermiah/opencode-plugboard/commit/de611204a4b7c07c3bf880a5906b9bd17770ab0a))

A call over a ceiling gets one error event: 429, kind rate_limit, code budget_exceeded, with Retry-After set to the latest reset among the exceeded ceilings. src/budgets.ts holds the wrapper. For each ceiling it reads the app's days for the window through UsageRecorder.spent, which reads memory first and then storage for days not yet held, and never writes. Requests count as the day's requests less its refusals, so a refused call does not use up the budget that refused it. Tokens are the answered calls' tokens and cost is their price at list prices.

index.ts puts the wrapper inside withUsage and outside withLimits. A budget refusal therefore takes no concurrency slot and spends no requests-per-minute count, while the request log still counts it and usage records it as limited. Rejected: checking inside withLimits, where the slot is taken before the budget is read. Rejected: counting calls in flight, which would hold each request until its records settle. A burst can pass a ceiling by the calls it already admitted, and the docs say so.

A failed read refuses the call with 503 budget_unavailable rather than letting it through. Crossing 80% of a ceiling logs budget.warning once per app, budget and window, and again in the next window. That state is a map on the runtime, so the runtime VERSION goes to 13 (I6). Each refusal is counted under plugboard_limited_total with reason budget.

Checked with test/unit/budgets.test.ts on an injected clock: window boundaries, override precedence, Retry-After, the reset, tokens, cost, warnings once, a refusal that takes no slot, the 503 path and the metric label. The mutation entry budget-refuses-at-the-ceiling is killed by nine failing test lines. bun run typecheck passes.

Refs #60

**feat(http): show each app's budget state in GET /v1/usage** ([`25ff308`](https://github.com/jjjermiah/opencode-plugboard/commit/25ff30875e7fd7dbf4b6bccd78a2dc0fbc424f5c))

Each app in the usage report gets a budgets list when option budgets sets a budget for it: one entry per ceiling with metric, window, limit, used (the current window's count) and resetsAt (when that window ends). The state is read from the current window, not from the report's range, so a report for last week still shows this month's spend.

serveUsage calls budgetStatus on the same recorder that counts the requests, and only when budgets are configured, so a report without budgets keeps its old shape. Rejected: adding the state to the usage RPC as well. The issue asks for GET /v1/usage, and the RPC's output is open ended, so it can take the field later without a change here. Limitation: an unfiltered admin report lists budgets only for apps that have records in its range. Asking with app=<name> always shows them.

Checked with test/http/budgets.test.ts over loopback HTTP: a chat call over its ceiling gets 429 budget_exceeded with a Retry-After between 1 and 86400 seconds, the other app is still served, the usage report counts the refused call as limited and not as used, and a report with no budgets has no budgets field.

Refs #60

#### Fixes

**fix(openai): remove caller stop sequences from plain answers** ([`47ec695`](https://github.com/jjjermiah/opencode-plugboard/commit/47ec69597b051eae459bf31f7d7e9349335d053a))

Chat Completions, legacy completions and Gemini return a stop sequence in the answer text when the provider leaves it there, so a client that set `stop` got the sequence back. Anthropic Messages already removed the matched sequence and reported it (#145). The check moves to a shared helper (src/stop.ts) and each front-end uses it.

A plain stop (finish `stop`, no tool call, no structured output) whose text ends with a caller sequence drops the sequence. Streamed text keeps its last characters back, the length of the longest sequence, until the finish decides them, so a sequence split across deltas never reaches the client. Tool calls release the held text unchanged, and a length finish keeps its text. The Anthropic encoder now uses the same holdback with its behaviour unchanged.

The compat matrix flips the nine stop-sequence gaps (SDK and LangChain rows on chat, completions and Gemini). The request decoders pass the sequences to each exchange. New unit tests cover the helper and each encoder, JSON and streamed.

Fixes #149

**fix(openai): answer unknown /v1beta paths with a Google 404** ([`98e594c`](https://github.com/jjjermiah/opencode-plugboard/commit/98e594c63a232e2a88b3c35d19fcee245b730dbc))

The AI SDK and LangChain send a Gemini model id that contains a slash without the models/ prefix, so the request path is /v1beta/<id>: generateContent. That path matches no Gemini route. It fell through to the generic check, and an authenticated caller got 401 "Missing or invalid API key" even with a valid key, which looked like a bad key.

Every /v1beta path now uses Google's error body. The credential is read the Gemini way (Bearer, x-goog-api-key or ?key=). An authenticated request to a path that matches no route gets a 404 NOT_FOUND that names the expected shape, POST /v1beta/models/{model}:generateContent. An unauthenticated request still gets 401 first, so the route table stays hidden from callers without a key (#91, #137).

The matrix rows for the AI SDK and LangChain Google clients stay gaps, because the request still misses the route. Their notes now say 404. Tests cover the authenticated and unauthenticated cases for the key sources, and a keyless loopback endpoint.

Fixes #150

#### Tests

**test(gemini): cover generateContent JSON tool calls and structured output** ([`2d28bbb`](https://github.com/jjjermiah/opencode-plugboard/commit/2d28bbb5eaeb0f29a9363c73ccd54ab53cf56bab))

The coverage manifest (#116) had two gap cells for Gemini generateContent (non-streaming): a tool call and a structured answer. Only the streamed encoder had tests, so the JSON path was unproven for both.

Three http tests now cover the JSON path over loopback. A tool call is a candidate with a functionCall part and no id, finishReason STOP, and the tool is offered to the model. A structured answer (responseSchema with responseMimeType application/json) is the respond call's input as JSON text. A structured answer with no respond call is a 502 in Google's body, not an empty 200.

The two manifest cells now name these tests, and the unused gap helper is removed. The test-count floor for the http layer is raised with them.

The event-queue memory benchmark and the bench baseline regeneration from #118 are not part of this change.

Fixes #151

**test(tests): ratchet the test floors for per-app budgets** ([`03b4035`](https://github.com/jjjermiah/opencode-plugboard/commit/03b4035c1ed54b3b46979b2b9d90a110238b9876))

The budget tests cover the window table, budget precedence, refusals, the reset, tokens, cost, the 80% warning, the limits ordering, the storage failure, the budget state, the metric label and config validation (unit), and the 429 and usage report over loopback (http). The floors in .github/floors only go up, so the layer counts move to the new totals: unit 798 to 835, http 257 to 261. Coverage floors move to 97.6% lines and 92% functions of index.ts and src/, the level the code now meets.

Checked with bun test --coverage and bun .github/scripts/test-gates.ts .coverage --ratchet: 1588 tests pass, every floor is met, and the floor files are the only change in this commit.

Fixes #60

#### Docs

**docs(docs): describe per-app budgets in configuration and architecture** ([`54d078d`](https://github.com/jjjermiah/opencode-plugboard/commit/54d078db8d7d1a98432fa410961719a32e7abff2))

configuration.md gets the budgets option row and a Budgets section: the ceilings and the windows, what each metric counts, the apps override, the 429 and its Retry-After, the 503 when records cannot be read, the 80% warning, the budgets list in the usage report, and the retention rule (a month needs 31 days, a week 7). It also gets the budget_exceeded and budget_unavailable error rows, and the limited counter and the metric label now name budgets. architecture.md gets a Budgets section covering placement, reading, counts, refusal, warnings, status and config, plus a module-map line. STRUCTURE.md lists budgets.ts beside limits.ts.

Rejected: a numbered invariant for budgets. Its guards are in the mutation catalogue under the budgets label, the same way limits is kept.

Checked by reading each new sentence against the code it describes, and by a search of the changed prose for em and en dashes, which none has.

Refs #60

**docs(changelog): notes for budgets, the usage header and the compat fixes** ([`7e94af4`](https://github.com/jjjermiah/opencode-plugboard/commit/7e94af4885df6b8d80994ee20763bd2d310612db))

Curated [Unreleased] entries for #60 (per-app budgets), #52 (x-plugboard-usage), #147 (item_reference for store: true clients), #149 (stop sequences on every API), #150 (Gemini 404 for unknown paths), #151 (Gemini JSON tests) and runtime version 13. Pinned install examples bumped to 0.19.0.

</details>
<!-- commit-detail:end -->

## [0.18.0] - 2026-10-11: A Window Into Usage

**Full diff:** [v0.17.0...v0.18.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.17.0...v0.18.0)

### Added

- **Usage dashboard** ([#141](https://github.com/jjjermiah/opencode-plugboard/issues/141)). Open `http://<host>:4010/dashboard`, paste a key, and see requests, tokens, estimated cost, errors, cache hits, fallbacks, 429s and p95 latency for today, 7, 30 or 90 days, with a per-app table, daily charts and a models table. The admin key sees every app; an app key sees only its own. The page loads nothing from other sites (charts are uPlot, served by plugboard itself) and keeps the key in the tab's session storage only.
- **`/plugboard` in the OpenCode TUI** ([#142](https://github.com/jjjermiah/opencode-plugboard/issues/142)). Type `/plugboard` (or pick "Plugboard usage" in the command palette) and the TUI shows the same numbers for the server it is connected to, with `t`/`w`/`m`/`q` for today, 7, 30 and 90 days. It reads the usage RPC through OpenCode's own authenticated API, so no key is needed. OpenTUI and Solid are optional peers, so server-only installs don't pull them.
- **Copyable examples** ([#71](https://github.com/jjjermiah/opencode-plugboard/issues/71)): an Open WebUI compose file, a 50-line tool-calling bot and curl one-liners for every API, in `examples/`.
- **Docs site** ([#72](https://github.com/jjjermiah/opencode-plugboard/issues/72)): the docs now build into a searchable site at https://jjjermiah.github.io/opencode-plugboard/, and the repository is public with Discussions open.

### Changed

- **The README is rewritten around real usage**: the endpoints are a table, and every feature has its own heading with a config snippet you can paste.
- **Packaging** ([#69](https://github.com/jjjermiah/opencode-plugboard/issues/69)): the package declares `engines.bun >=1.4.2` and `types`, exports `./tui` and `./rpc` from root files (so local-path installs find them too), and keeps shipping TypeScript source; `docs/packaging.md` explains why.
- **Test tooling** ([#111](https://github.com/jjjermiah/opencode-plugboard/issues/111), [#115](https://github.com/jjjermiah/opencode-plugboard/issues/115), [#116](https://github.com/jjjermiah/opencode-plugboard/issues/116), [#118](https://github.com/jjjermiah/opencode-plugboard/issues/118), [#124](https://github.com/jjjermiah/opencode-plugboard/issues/124)): request-path benchmarks with an advisory CI gate, a 19-guard mutation catalogue (all caught) run weekly, a nightly flake hunt, a route x format coverage manifest, and the release script on the `semver` package.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (21 commits)</summary>

#### Features

**feat(runtime): add the /plugboard usage page to OpenCode's TUI** ([`040705d`](https://github.com/jjjermiah/opencode-plugboard/commit/040705da442a88f6cbe2b1166e466376358c024c))

Plugboard's usage statistics were only reachable over HTTP. The TUI now has a /plugboard command (and a palette entry) that opens a page with the per-app numbers for the connected server: requests, tokens, estimated cost, errors, cache hit rate, fallbacks, 429s and p95, a row per app with a cost bar, and the top models.

The page reads the usage RPC (opencode-plugboard.usage) through context.client.rpc, so it uses OpenCode's authenticated API and sees every app without the admin key. The entry is src/tui.tsx under the ./tui export. The server entry never imports it, so server installs keep no Solid.

Keys: t, w, m, q pick today, 7, 30 or 90 UTC days; r reloads; esc goes back. When the RPC is unavailable (plugboard not loaded there, or usage off), the page and a toast say so instead of failing.

Rejected: a chart library (a text bar per app does the job); a second HTTP route for the TUI (the RPC already carries the report and the auth).

Pure shaping (ranges, rows, formats) is in src/tui-format.ts with 30 unit tests. No render test: OpenCode exports no TUI test harness to a plugin. Floors raised to the new test counts.

Validation: bun run typecheck, bun test (1566 pass), check-pack, smoke-pack. No live TUI run in this session: the isolated wrapper pins its project directory, so a scratch project's plugin config was never read.

Fixes #142

**feat(http): usage dashboard at /dashboard** ([`9e42516`](https://github.com/jjjermiah/opencode-plugboard/commit/9e42516fbda66dc54fb49e89dc6685753c775332))

GET /dashboard serves one page on plugboard's listener: totals for today, 7, 30 or 90 days, a per-app table sortable by requests, tokens or cost, daily charts per app (requests, cost, tokens), the models by cost, and the last request per app. It works on a phone and follows light or dark mode.

The page holds no data. It asks for a key, keeps it in sessionStorage only, and reads GET /v1/usage from the same origin with it, so the admin key sees every app and an app key only its own (I24). The page, app.js, app.css and uPlot's browser build are keyless, like the discovery pages (I15), and only while option usage is on. With usage off they are unknown routes: no key gets 401, a valid key gets 404.

Responses carry Content-Security-Policy default-src 'none', with script and style from 'self' only and form-action and frame-ancestors none. The page has no inline script or style. Assets send no-cache and an ETag, so a 304 costs nothing. All values reach the DOM through textContent. uPlot is read from node_modules when first requested, never at setup (I3). Discovery lists /dashboard and links it.

Checked: test/http/dashboard.test.ts, the #136 probe for /dashboard, the full suite, and a headless Chromium run at 390 px and in dark mode against 90 days of fake usage for three apps (admin and app keys, sorting, ranges, sign-out, a stale key).

Fixes #141

#### Fixes

**fix(runtime): root tui.ts and rpc.ts entries so local-path installs load the TUI** ([`cba4b0b`](https://github.com/jjjermiah/opencode-plugboard/commit/cba4b0b1778eb39f05eadf97d3befd86982b5a5c))

OpenCode resolves a package's ./tui and ./rpc entries through package.json exports only when the plugin comes from npm. A plugin configured by local path is resolved as <directory>/tui and <directory>/rpc with no exports lookup (packages/plugin/src/host.ts:17-43 in OpenCode 2.0.26), so the dev server listed plugboard with features { server } only and /plugboard was "No matching commands". Two small re-export files at the package root fix both paths; exports and files point at them.

Checked live on the isolated dev server: /api/plugin now reports features { server, tui, rpc }, and /plugboard in the TUI opens the usage page with the compat app's requests, tokens, cost, p95 and top models. Also added a .github/scripts/merge-floors.ts helper that resolves floor-file merge conflicts by taking the higher value per key.

#### Tests

**test(tests): benchmark the request path and gate regressions** ([`477cb8b`](https://github.com/jjjermiah/opencode-plugboard/commit/477cb8b76cc2b7f8ae3fa238278f1ac78ceb146b))

Plugboard is a gateway, so latency per request is part of its contract, and nothing measured it. This adds a benchmark of every front-end over real loopback HTTP, with a replayed model, and a gate that fails CI when a median regresses by more than 2x against a committed baseline.

What is measured (test/bench/request.bench.ts, `bun run bench`): chat completion (json, n=3 fan-out, time to first byte, total, a 2,000-delta stream), responses, messages, gemini generateContent, and the pure decode and model resolution (with a 1,000-model allowlist). mitata is the runner: it is popular, pure JS, has no dependencies and no install script, which the host requires for registry plugins. It is pinned exactly and lives in devDependencies, so it never ships.

Decisions:
- Not FakeModelCaller for the model. It keeps a record of every call, so across mitata's iterations it would grow the heap and measure that. The bench uses a replay that keeps nothing.
- Keep-alive connections. The support client opens a TCP connection per request. On this machine that moved the medians between 0.2 ms and 150 ms from one run to the next (the time to first byte and responses swung hardest). With a kept-alive agent, three runs stayed within about 15% of each other. Time to first byte still opens a fresh connection, because it must hang up mid-stream.
- The gate compares medians (p50), not means: means move with GC pauses, and p99 is in milliseconds on a shared runner.
- Tolerance 2x, generous on purpose. The baseline comes from one laptop and CI runners are not that machine. The CI job is advisory (continue-on-error), so it never blocks a merge.
- A baseline entry that does not run fails the gate, so a renamed benchmark cannot silently drop out of the check.
- Memory of the event queue is not measured here; the issue asks for it and it needs its own bench with heap sampling. Follow-up.

Files: test/bench/request.bench.ts, .github/scripts/bench-gate.ts (`--summary` writes the job summary, `--update` rewrites the baseline), .ci/bench-baseline.json, an advisory `bench` job in ci.yml, bun run bench in package.json, and short notes in test/README.md and CONTRIBUTING.md.

Checked: bun run typecheck (exit 0), bun test (1276 pass, unchanged runtime, the bench file does not match the test glob), bun run bench (three runs, all within 1.25x of the committed baseline), the gate on a fresh run (passes), check-pack (43 files, no bench or gate file shipped). actionlint is not installed here; the workflow was parsed as YAML instead.

Fixes #118

**test(tests): add a mutation catalogue for the guards that must not break** ([`cd6390f`](https://github.com/jjjermiah/opencode-plugboard/commit/cd6390fca8408d158c3cfbd2a27989eba28614e7))

Some guards fail silently and expensively: a request session that can run a real tool, a Host check that stops rebinding protection, a remote image fetch that reaches a private address, a finalizer that starts awaiting the host. The suite asserts them, but nothing proved that a deliberate break turns a test red. This adds that proof.

test/mutations/catalogue.ts lists 19 entries, one per guard (invariants I2 to I22, plus the cache, limits, fallback and duplicate-tool rules). Each entry is one exact text that occurs once in one source file, the replacement that breaks the guard, and the test files that must fail.

.github/scripts/mutation-check.ts (`bun run mutations`) copies index.ts, src/, test/ and the bun config to a temporary directory and links node_modules. It never edits the working tree. It first requires the named tests to pass unmodified (otherwise a kill proves nothing), then applies each entry there and requires `bun test` to exit nonzero with at least one (fail) line. A missing anchor, a green run or a crash that is not a test failure is reported. The table goes to the job summary with --summary.

Runs weekly and on demand (.github/workflows/mutations.yml), not on every push, since the full catalogue takes about two minutes locally.

Decisions:
- The entries are edits a careless refactor makes, not random operators: they stay plausible so a survivor means a real gap.
- The first run had three survivors. Each is a real finding, handled differently:
  - I8, permissions. The caller test compares the session permissions with the REQUEST_PERMISSIONS constant itself, so flipping the entry to `allow *` changed nothing. Added a test that pins the literal list (deny *, then allow plugboard_seed_*).
  - I22, request id. The mutant read x-request-id, a header nothing sends. The threat is a client-chosen x-plugboard-request-id, which the existing test already covers, so the mutant was corrected to read that header. This was a bad mutant, not a weak test.
  - I19, abandoned requests. The first mutant removed the abort check after the catalog await. That line is unreachable: scope.race already throws when the request aborts during the await, and nothing awaits between the two, so the mutant cannot change behaviour (an equivalent mutant). Replaced with the disconnect abort in beginRequest, which the chat and transport tests exercise.
- A surviving entry is never deleted to get a green run. The check exits 1 and names it.
- Not run in `bun test`, so the suite's runtime does not change.

Also: a session test count of 194 in .ci/test-count-floors.json (from 193, for the new I8 test). The ratchet would also raise http, runtime, unit and the coverage floors, but those rise from earlier commits, so they stay for a separate change.

Checked: bun run mutations (19 of 19 killed on the final run, exit 0), bun run typecheck (exit 0), bun test (1277 pass, 0 fail), test-gates (all floors met), check-pack (43 files, the catalogue and the script are not shipped), the workflow parsed as YAML. actionlint is not installed here.

Fixes #111

**test(tests): hunt for order-dependent and leaky tests** ([`f893ec9`](https://github.com/jjjermiah/opencode-plugboard/commit/f893ec93c7345bc33462606459c2bf3f6a9fd83f))

The runtime tests touch globalThis and the data root, the classic shape of a flake that passes on every local run and fails on one CI run in twenty. Nothing checked whether the suite depends on its own order or on which files ran before a test. This adds that check.

.github/scripts/flake-hunt.ts (`bun run flake-hunt`) runs the suite in several modes and reads the (pass) and (fail) lines bun prints:
- serial, the reference order;
- N shuffles with Bun's own `--randomize --seed=S`, seeds printed, so a failing order can be replayed with `bun test --randomize --seed=S`;
- one `--parallel` run, the files in worker processes;
- each test file alone, the isolation probe.

A test is flagged when it fails in some runs and passes in others (order-dependent), when it fails in every run, when it fails alone but passes with the suite (it needs another file's leftovers), or when it passes alone but fails with the suite (another file breaks it). The script exits 1 on any flag. It also exits 2 when a run prints no results, so a compile error or a crash cannot look like a clean run.

`--file <path>` repeats one file with shuffled orders (the repeat-runner for a suspect file). Nightly, in a new flake-hunt job in nightly.yml with 10 shuffles, not on every push.

Decisions:
- Bun's shuffle instead of shuffling the file list by hand. Bun 1.4.2 shuffles the tests and keeps the file order fixed, so file-order effects are covered by the alone probe and the parallel run, not by the shuffle.
- Bun's --parallel is used as the second mode. Files then run in their own processes, which exposes state that only the single shared process hides.
- The flagged names are matched by test name. Two tests with one name in different files would be compared as one. The suite has none today; the report notes it in the code, and a duplicate would show as a mismatch to look at, not a silent pass.

Checked:
- bun run flake-hunt -- --runs 3: 1277 tests in every mode, 0 failing, all 46 files probed alone, exit 0.
- A planted fault (a test that needs an earlier test's state, a test that always fails, temporary file under test/, removed afterwards): flagged as order-dependent (3 of 8 runs), fails every run, and an isolation mismatch; exit 1.
- bun run flake-hunt -- --file test/runtime/plugin.test.ts --runs 4: exit 0.
- bun run typecheck (exit 0), bun test (1277 pass, 0 fail), check-pack (43 files), nightly.yml parsed as YAML. actionlint is not installed here.

Fixes #115

**test(tests): add a route x format x mode coverage manifest** ([`2647c0d`](https://github.com/jjjermiah/opencode-plugboard/commit/2647c0d89e577e142684b1c9ce440d7a0f34921c))

Plugboard now serves five request formats over one model caller: Chat Completions, Responses, legacy completions, Anthropic Messages and Gemini, plus the read routes. A route could ship with no test for one of its modes, and nothing would say so. This commits the table of what is covered and fails the build when the table and the router disagree.

test/coverage-manifest.ts has one row per route and request format, with one cell per mode: json, stream, tools, images, structured output, n > 1 and errors. A cell names its covering tests (a file and a literal from a test title or table row), says n/a with a reason, or is a gap that names its issue. There are 16 rows: 6 generation rows (Gemini split into generateContent and streamGenerateContent), 9 read routes, and count_tokens, which answers 404 by design.

test/http/coverage-manifest.test.ts fails when:
- the router has a route with no row, or a row names a route it lacks;
- a cell is empty, a covering file is missing, or a title is not in it;
- a gap does not name an issue, or a row is duplicated. It also probes the five routes that are spelled by a template or constant in src/ (MANUAL_ROUTES) on the live router: each must answer, not the unknown-route 404. A second test checks that an unknown path does get that 404, so the probe means something.

The rest of the routes are read from the quoted METHOD /path literals in src/**/route.ts. The source cannot be edited to export its route table (src/ is out of scope for this change), so the scan is the inventory.

Decisions:
- A route written as a template is listed by hand and probed. A new one in that style fails the probe until it is listed; a new route written as a literal is found by the scan and fails until it has a row.
- Cells name tests by file and a literal of the title, not by test id. The check proves the text exists, not that the test asserts the mode, so a row is a claim a reviewer reads, backed by the check that it resolves.
- Two gaps are recorded, not hidden: the JSON answer of generateContent has no tool-call or structured-output test. Its unit tests run the streamed encoder. They fail nothing today, and the summary lists them under #116.
- The job summary prints the table (bun run coverage-manifest --summary in the package job) and exits 1 when the manifest disagrees with the router.

Checked:
- bun run coverage-manifest: 51 covered cells, 59 n/a, 2 gaps across 16 rows and 16 routes; the manifest matches the router, exit 0.
- The new tests: 10 pass (problem detection for an empty selection, a missing file, a missing title, an unexplained gap, a missing and an extra route; the five manual routes served; the unknown-path 404).
- bun run typecheck (exit 0), bun test (1287 pass, 0 fail), check-pack (43 files), ci.yml parsed as YAML. actionlint is not installed here.
- Not done here: the test-count floor for test/http (187) is below the current count, as it was before this change; raising it is left to the ratchet in its own commit.

Fixes #116

#### Docs

**docs(docs): rewrite README around usage examples** ([`fb45aa4`](https://github.com/jjjermiah/opencode-plugboard/commit/fb45aa4d6708bacb67f7b0113e10d98bce79dd0f))

Owner feedback: show more features as real config, and split the intro, which listed every endpoint in one run-on sentence.

What changed:
- Intro is two short paragraphs. Endpoints are a table (API, endpoint, typical clients). "OpenCode never runs your tools" is its own line.
- Quick start: pinned install, minimal config, one curl, one OpenAI Python SDK call.
- Features section: one heading per feature, a sentence on why, a minimal jsonc snippet, and the request or response header where it helps. Covers apps and keys, model allowlist, per-app policy, aliases, fallback chains, UI-safe model ids, limits with Retry-After, the response cache, streaming, tools, structured output, images, n, token counting, dropped sampling params, usage, history, metrics.
- Full example config, client table, known gaps, security notes and reference links.

Removed the LiteLLM comparison, and the roadmap list that still named the Anthropic and Gemini front-ends as future work (both ship now).

package.json description now names the Anthropic and Gemini APIs. It listed only the OpenAI endpoints.

**docs(docs): correct Retry-After and token counting after 0.16 and 0.17** ([`769dabc`](https://github.com/jjjermiah/opencode-plugboard/commit/769dabc7a0929fe48ff314c34095d67640699fc0))

docs/configuration.md still said the limits 429 carries no Retry-After header; since 0.16.0 it does (1 second for a full concurrency cap, the seconds left in the window for rate_limit_exceeded, src/limits.ts). docs/messages.md and docs/gemini.md still said count_tokens and countTokens answer 404; since 0.17.0 they return an estimate. Found by the README lane and the aihub deploy check.

**docs(docs): describe the /plugboard usage page in the TUI** ([`ce588ca`](https://github.com/jjjermiah/opencode-plugboard/commit/ce588ca5833867bc01905dcdc95b56a830b2f467))

docs/tui.md covers opening the page, what it shows, the keys, what happens when the server has no usage, and that the page reads the usage RPC rather than GET /v1/usage. STRUCTURE.md lists tui.tsx and tui-format.ts.

Refs #142

**docs(docs): describe the usage dashboard and its CSP** ([`b083c4f`](https://github.com/jjjermiah/opencode-plugboard/commit/b083c4fbc659f0ab4690b4ad51d2503e0d5fe8d5))

configuration.md gets a Dashboard subsection under Usage statistics: what the page shows, where the key is kept, the uPlot dependency and the CSP, UTC days, and what usage enabled false removes. architecture.md adds the Dashboard bullet to Usage statistics, lists the dashboard files in the module map, and names the dashboard page and its files in I15. STRUCTURE.md maps src/dashboard/. Refs #141.

**docs(docs): build docs/ as a VitePress site** ([`5d13cb3`](https://github.com/jjjermiah/opencode-plugboard/commit/5d13cb354d1f9879ba7d31d50f579b7d57eb9734))

The docs are good but only reachable as GitHub blob links. The site adds a nav, a sidebar and local search. docs/index.md includes README.md as the Guide page, so the quick start and feature list keep one source.

Five links in docs/ pointed outside docs/ (STRUCTURE.md, CONTRIBUTING.md, compat/). They do not resolve in the built site, so they now point at the GitHub blob URL. No other page text changed.

The nav covers Configuration, Architecture, Clients, the API endpoints, Community (Discussions, Issues, Contributing) and the Changelog. Discussions returns a 404 until the repository enables it. base is /opencode-plugboard/ for GitHub Pages. docs/.vitepress/cache and dist are ignored.

Checked: bun run docs:build renders 22 pages with no dead links. A script over README.md and docs/ finds no broken heading anchors. check-pack still lists only the package files, because docs/ is not in files.

Refs #72

**docs(docs): add examples for Open WebUI and a tool-calling bot** ([`cf1b442`](https://github.com/jjjermiah/opencode-plugboard/commit/cf1b442af3f7e7fd28321e26ae0ec568c2e1a3c2))

The examples asked for in #71 are two folders and an index, kept out of the npm package (check-pack still lists only files) and out of compat/, which holds the test harnesses.

open-webui/ is a compose file that runs Open WebUI 0.12.0 against plugboard on the host, plus the plugboard options it needs: a non-loopback bind (a container cannot reach a loopback listener), a key for the app, and the fast alias. DEFAULT_MODELS=fast is not verified against 0.12.0.

tool-bot/ is about 50 lines of TypeScript on the openai SDK, pinned to 7.32.0 to match the repo's devDependency, run with bun. It shows the round trip. Plugboard returns tool_calls and never runs them, so the bot runs the tool, sends a tool message with the same tool_call_id, and asks again until the model answers in text. The weather tool is a stub.

examples/README.md is the index. It also has curl one-liners for chat, responses, messages, Gemini, models and usage.

Checked: tool-bot passes tsc --noEmit (strict, bun types). Against a local stub that returns tool_calls and then text, the second request carried the tool message with the matching id, and the bot printed the answer. Each curl line ran against the same stub and sent the method, path and key header its API uses. The compose file parses as YAML. docker compose config was not run: the local Docker has no compose plugin. Neither example was run against a live plugboard or a real Open WebUI.

Fixes #71

**docs(docs): draft the awesome-opencode listing for submission** ([`2620389`](https://github.com/jjjermiah/opencode-plugboard/commit/26203893d1bc73de4ae836132d7ef3c07f0fa0a8))

awesome-opencode takes one YAML file per entry under data/plugins/. This is the entry for opencode-plugboard, checked against that repo's data/schema.json at commit bcc5c03 (2026-07-03) with ajv: it validates. The tagline is 96 characters against the 120 limit.

Not submitted. The maintainer opens the pull request. The installation snippet pins 0.17.0, so bump it with each release.

Refs #72

**docs(changelog): notes for the dashboard, the TUI page, examples and the docs site** ([`57b4685`](https://github.com/jjjermiah/opencode-plugboard/commit/57b468531d99ac907b55d870f54b821a14621baa))

Curated [Unreleased] entries for #141 (usage dashboard), #142 (the /plugboard TUI page, checked live on the isolated dev server), #71 (examples), #72 (docs site, public repo, Discussions), the README rewrite, #69 packaging and the test tooling (#111 #115 #116 #118 #124). Pinned install examples, the examples and the awesome-opencode listing bumped to 0.18.0.

#### CI and tooling

**ci(docs): deploy the docs site to GitHub Pages** ([`5aec17e`](https://github.com/jjjermiah/opencode-plugboard/commit/5aec17e7a34b6590f6869b99d500550ccbb98859))

Nothing publishes the site without a deploy step, and a hand-run deploy drifts. This workflow builds the site and publishes it on every push to main that touches docs/, README.md or the package inputs, and on demand from the Actions tab.

It uses the Pages Actions flow (configure-pages, upload-pages-artifact, deploy-pages) in two jobs. The build job has read-only permissions, and only the deploy job holds pages and id-token write. Every action is pinned to a commit SHA with its release tag in a comment, as the other workflows are. The pages concurrency group queues deployments and never cancels one that is running.

The repository setting Settings, Pages, Source must be GitHub Actions before the first run. Until then the deploy job cannot publish.

actionlint 1.7.12 passes on every workflow file.

Refs #72

#### Dependencies

**chore(deps): add OpenTUI and Solid for the TUI usage page** ([`de562f9`](https://github.com/jjjermiah/opencode-plugboard/commit/de562f941c4800328702d3b3153f382266f592b2))

The TUI entry (./tui) renders with OpenTUI's Solid JSX, so a published plugin needs @opentui/core, @opentui/solid and solid-js. They are optional peers: a server-only install does not pull them, and OpenCode provides them to the TUI. The devDependencies pin the versions OpenCode 2.0.26 uses (0.5.17 and 1.9.15) so typecheck sees the same APIs.

tsconfig.tui.json checks the one JSX file on its own, leaving the root config (Node types, no JSX) unchanged. typecheck runs it.

Refs #142

**build(deps): add uplot for the usage dashboard** ([`2fca981`](https://github.com/jjjermiah/opencode-plugboard/commit/2fca9813a8ea66da38e5926bb124830d497c4d00))

uPlot 1.6.32 draws the per-app daily charts on /dashboard (#141). It is pinned exactly, because the host installs runtime dependencies unattended. Checked with npm view: no dependencies of its own, and its scripts are only build and test, so no install script runs. Plugboard serves its browser build and stylesheet itself, so the page loads nothing from another origin.

**chore(deps): use the semver package in the release script** ([`5757c7a`](https://github.com/jjjermiah/opencode-plugboard/commit/5757c7ab02707d885ef7bead97da12052aaa0c8d))

.github/scripts/release.ts hand-rolled a semver regex, a parser and a precedence compare. Replace them with the semver package (ISC, no dependencies, no install scripts), pinned as a devDependency, with @types/semver for the editor. The script is tooling and is not shipped.

What changed in release.ts: validVersion() is semver.valid(v) === v, so a leading "v", surrounding spaces and build metadata are still rejected as before. The two precedence checks are now !semver.gt(next, current) and !semver.gt(next, previous), which use the same ordering.

One accepted input is now rejected: a numeric prerelease with a leading zero, such as 1.0.0-01. The old regex accepted it, but the semver spec forbids it and semver.valid does not. No real release version has this shape. Ordering of every other valid pair matched the old compare in a scratch check.

Checked: a dry run for 0.17.1, v0.18.0 and 0.18.0-rc.1 in a throwaway clone prints the expected diff. 0.17.0, 0.16.9, 1.0.0-01, 1.0.0+b, " 1.2.3" and 0.17 fail with the same messages as before.

Fixes #124

**build(deps): declare engines and types, and record the ship-source decision** ([`625b568`](https://github.com/jjjermiah/opencode-plugboard/commit/625b568521271c86116b995822ec44abc4fed107))

package.json shipped raw TypeScript (main ./index.ts) with no engines and no types. That works because OpenCode loads the entry with Bun, but the runtime floor was undeclared and TypeScript consumers had no types entry.

Decision: keep shipping the .ts source, with no dist/ build. OpenCode 2.0.26 resolves the entry with Bun.resolveSync and imports it directly (packages/plugin/src/host.ts, packages/util/src/runtime/import.bun.ts). Its npm install runs with ignoreScripts: true (packages/util/src/npm.ts:225), so a prepack build would never run for a user, and the host does not read engines. The reasoning and file references are in docs/packaging.md.

Changes: engines.bun is >=1.4.2, the Bun that OpenCode 2.0.26 pins (package.json packageManager and bun-types). types points at index.ts. The "." and "./rpc" exports become objects with a types condition first, then default. Bun ignores the types condition, so it still resolves to the same files; smoke-pack and a bun import of opencode-plugboard/rpc from the packed tarball both confirm this. There is no ./tui export on main, so none was added.

Known gap, left open: a TypeScript consumer that checks the package reads the .ts source, and src/discovery.ts imports escape-html, whose types are a devDependency. Without @types/escape-html the consumer gets TS7016. With it installed, tsc passes under bundler and node16 resolution. Adding the types to dependencies or shipping a declare-module shim is a separate decision.

Checked: bun run typecheck, bun test (1547 pass), check-pack, smoke-pack, and a consumer tsc run against the packed tarball.

Fixes #69

**build(deps): pin vitepress 1.6.4 for the docs site** ([`c999daa`](https://github.com/jjjermiah/opencode-plugboard/commit/c999daaf4330b5c7b56931a0da723e8938235fbc))

The docs/ folder becomes a static site (issue #72). VitePress builds it from the existing Markdown with a small config, so no page has to move. It is an exact-pinned devDependency like the other tools here, so a site build never picks up a new minor on its own. Its manifest has no install or postinstall script.

Starlight was the other option. It needs Astro and content collections, which means moving the pages before the site can build at all. VitePress is the smaller change.

Adds the scripts docs:dev and docs:build. Nothing in src/ or test/ uses them, so bun run typecheck and bun test do not change.

Checked: bun install resolves vitepress 1.6.4 and adds only lockfile entries. npm view vitepress@1.6.4 scripts lists no install hook.

Refs #72

</details>
<!-- commit-detail:end -->

## [0.17.0] - 2026-10-11: Counting Every Call

**Full diff:** [v0.16.0...v0.17.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.16.0...v0.17.0)

### Added

- **Per-app usage statistics** ([#139](https://github.com/jjjermiah/opencode-plugboard/issues/139), [#140](https://github.com/jjjermiah/opencode-plugboard/issues/140)). Plugboard now keeps, per app and per UTC day: requests, errors by class, latency (p50/p95), tokens by kind, estimated cost at catalog list prices, cache hits, fallbacks, 429 refusals and each model's share. Read it with `GET /v1/usage?from=2026-10-01&to=2026-10-12`. An app key sees only its own app; the new `adminKey` option sees every app:

  ```jsonc
  "adminKey": "{env:PLUGBOARD_ADMIN_KEY}",
  "usage": { "retentionDays": 90 }   // on by default; { "enabled": false } turns it off
  ```

  OpenCode clients can read the same report over OpenCode's own API through the new `opencode-plugboard/rpc` entry (`opencode-plugboard.usage` / `get`), which is what the upcoming dashboard and TUI page build on. Records reach OpenCode's plugin storage at most every ten seconds, so a restart during a quiet stretch can lose the last few seconds of counts. Cost is an estimate, not a bill.
- **Token counting endpoints** ([#143](https://github.com/jjjermiah/opencode-plugboard/issues/143), [#144](https://github.com/jjjermiah/opencode-plugboard/issues/144)). `POST /v1/messages/count_tokens` and Gemini `:countTokens` answer instead of 404, so clients that budget context before sending (Claude Code, the Anthropic and Gemini SDKs) work. The count is an estimate (characters / 4 plus a fixed cost per image or file), not the provider's exact tokenizer.
- **Anthropic stop sequences** ([#145](https://github.com/jjjermiah/opencode-plugboard/issues/145)). When one of your `stop_sequences` ends the answer, `/v1/messages` reports `stop_reason: "stop_sequence"` with the matched sequence and strips it from the text.
- **Spec conformance tests** ([#107](https://github.com/jjjermiah/opencode-plugboard/issues/107), [#148](https://github.com/jjjermiah/opencode-plugboard/issues/148)). OpenAI and Gemini responses are validated against vendored upstream schemas, and the compat matrix (now 203 passing cells) separates "not applicable" from "not written yet".

### Fixed

- **Removing or rotating a key takes effect immediately** ([#90](https://github.com/jjjermiah/opencode-plugboard/issues/90)). Before, a removed key kept working until restart while an older plugin instance (for example an app directory that had not reloaded) was still serving. Adding a new key, or any other option change, still needs a restart.

### Changed

- The ratcheting test floors moved from `.ci/` to `.github/floors/`.
- Internal runtime version 12. Restart OpenCode after upgrading.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (9 commits)</summary>

#### Features

**feat(metrics): add the per-app usage store and its options** ([`67f39ae`](https://github.com/jjjermiah/opencode-plugboard/commit/67f39aeef79fca824a4d579b1c9fc76542e96796))

Operators cannot answer "which app costs me the most": the token counts in /metrics are not split by app and day, and nothing keeps cost. This adds the store that both planned front-ends (the web dashboard and the OpenCode TUI) will read. It is the backend only: no route or RPC yet.

What:
- src/usage.ts keeps one record per app per UTC day: requests, error classes (client, server, timeout, disconnected), a latency histogram, tokens by kind (input, cacheRead, cacheWrite, output, reasoning; the same split as plugboard_tokens_total), cost in USD, cache hits and misses, fallbacks, 429 refusals, requests and cost per model, and the time of the last request.
- The live days are held on the process runtime, so a plugin generation can be replaced without losing them. VERSION goes 10 to 11 for that.
- Each day is persisted as one JSON value under usage/<app>/<YYYY-MM-DD> in the plugin's host storage, through a StoragePort view of ctx.storage (src/session/host.ts). Writes come from request handling only.
- Options: usage { enabled, retentionDays } (default on, 90 days, 1 to 3650) and adminKey (non-empty, different from every app key). authenticateUsage in src/config.ts checks the admin key first, then the app keys.

Decisions:
- Cost mirrors OpenCode's calculateCost (packages/core/src/session/usage.ts). The price entry is the largest context tier that the prompt (uncached input plus cache reads and writes) exceeds, else the base entry. Output and reasoning are both priced at the output rate. A model with no applicable price costs 0 and is counted in unpricedRequests.
- Rejected: summing every tier, and pricing from the first entry.
- Latency is a fixed histogram of 12 bounds (100 ms to 10 min) plus an overflow bucket. p50 and p95 are the upper bound of the bucket holding the percentile. Rejected: keeping every sample (unbounded) and a quantile sketch dependency for two numbers.
- Writes are debounced per day: a day is written at most every 10 s, by the request that finds the last write that old. So the newest changes can wait in memory until the next request, and a restart before that loses them. Accepted for now and documented in docs/configuration.md.
- Retention deletes one page of keys per run, at most every 10 minutes, from request handling. Rejected: a timer. Nothing may call the host from a timer outside a request.
- The per-model key is provider/model. The variant is not part of it, because the price does not depend on it.

Validation: test/unit/usage.test.ts covers the token split, cost with base and tiered prices (at and above a tier size, the largest tier, the cache counts toward the prompt), unpriced models, histogram buckets and percentiles, aggregation per app and day, the debounce, the persistence round trip through a fresh recorder, UTC midnight rollover, retention (page and interval), query validation, and the model caller wrapper (the fallback model, cache hits, failed calls). test/unit/config.test.ts covers the defaults and the admin key rules.

**feat(http): serve GET /v1/usage with admin and app scoping** ([`1de7ab7`](https://github.com/jjjermiah/opencode-plugboard/commit/1de7ab70f635e7ae44f3c4543bd53de93430f26b))

Usage is recorded (previous commit) but nothing reads it yet. This adds the authenticated GET /v1/usage?from=&to=&app= that returns the usage report as JSON, and feeds the store from the request log point.

What:
- The route checks its own credentials (authenticateUsage): the admin key reads every app, or one with `app`; an app key reads its own app, and naming another app is a 403 app_forbidden; keyless loopback is the app `default`. A missing or wrong key is a 401, as on every authenticated path.
- from and to are UTC days (YYYY-MM-DD, both inclusive). The default is the 30 days ending today, and a range may span at most 366 days. A bad date, a reversed range, a long range or a bad app name is a 400 that names the parameter.
- With usage off the route is unknown (404 once the caller is authenticated), and the discovery document does not list it.
- run() in src/openai/route.ts counts each finished request into the store, with its status and outcome, when the app is known. Only the model routes count (chat, responses, completions, messages and Gemini generateContent). Model listing, status, metrics, discovery and this route do not.
- RouteHost takes an optional `usage` recorder. The route itself gained the usage handler, one call in the log point and that field.

Decisions:
- Usage gets its own credential check instead of a new return value from authenticate, which every route uses. The admin key only matters here.
- An app key that names another app gets a 403, not an empty report. A probe is visible, and the answer does not reveal whether that app exists.
- Admin reads have no app in the request log or in the metrics labels, because the admin key is not an app.
- Rejected: a second listener on another port (one per process is the rule), and a synchronous read of the store in the log point (storage is async, and a request must not wait for it).

Validation: test/http/usage.test.ts covers keyless loopback, an app key seeing only its own app, the 403 for another app, the admin key reading all apps or one, 401 for a missing, wrong or admin-on-chat key, bad dates and app names, a rejected chat counted as a client error, a usage read not counting itself, the discovery listing with the option on and off, and the absent route with usage off.

Fixes #139
Closes #52, except the x-plugboard-usage response header that #52 also asked for: it is not in this change.

**feat(runtime): wire usage into the plugin and expose the usage RPC** ([`f9209f8`](https://github.com/jjjermiah/opencode-plugboard/commit/f9209f85ce521ef190bd1d18b69392820a7634f5))

The store and the route exist but nothing feeds the store yet, and OpenCode's own clients (the TUI front-end) need the same report without a plugboard port or key. This wires the recorder into each generation and adds the RPC.

What:
- index.ts builds the recorder from closures during setup, with no storage call. The model caller is wrapped outermost with withUsage, so it sees the answer the client gets. The limiter's 429 refusals and the fallback retries feed the recorder through their existing callbacks, and the route gets the recorder.
- src/rpc.ts defines opencode-plugboard.usage with method get: input is the query (from, to, app, all optional), output is the usage report, and the declared error invalid_query carries { param } naming the bad field. It is exported from the package as ./rpc.
- Each accepted generation registers the handler with ctx.rpc.register. The registration is synchronous and touches no storage or filesystem. The handler reads the same store the route reads, from request time only.
- With usage off nothing is wired: the route is absent and no RPC is registered.

Decisions:
- The host types the register error channel as unknown, but the plugin effect must fail with never. The error is caught and logged as rpc.register_failed, and the plugin keeps loading (the same rule as invalid options).
- The output is a permissive JSON Schema object. The report's shape is defined in src/usage.ts, and the host checks only that it is an object. Checked with the installed effect: the host's JSON Schema codec returns a nested report unchanged and encodes the declared error's data.
- The RPC returns every app. OpenCode's own API is already authenticated by the server password, so this matches what a TUI client may see.
- Rejected: an `updated` event. Nothing subscribes to it yet, and a dashboard can poll. It can be added later without changing the method.
- Rejected: a local copy of Rpc. It comes from @opencode/plugin/rpc, which the host provides as a peer.

Validation: test/unit/rpc.test.ts covers the contract, the query pass-through, malformed input read as no filter, and invalid_query. test/runtime/plugin.test.ts covers that setup registers the RPC with its id, that none is registered with usage off, and the list of setup calls. The test-count floors are raised in .ci. Not run against a live OpenCode server in this change.

Fixes #140

**feat(anthropic): estimate token counts, report stop sequences (#143 #144 #145)** ([`8c0876b`](https://github.com/jjjermiah/opencode-plugboard/commit/8c0876bd4dc89f9c3a2625bcc432cbe410056201))

Anthropic count_tokens (POST /v1/messages/count_tokens) and Gemini countTokens (POST /v1beta/models/{m}:countTokens) answered 404 (#143, #144). Both now answer with the spec's shape ({ input_tokens } and { totalTokens }) from an estimate: characters / 4 over the system prompt, the message text, tool-call and tool-result payloads, tool names, descriptions and schemas, plus a fixed 1600 tokens per image or file. The estimator lives in src/anthropic/tokens.ts and both routes share it. The count is documented as an estimate: plugboard has no tokenizer and the host does not expose the provider's counter, so no exact number exists here. The routes authenticate and resolve the model like messages, so an unknown model is the same 404. The Anthropic count takes the message body without max_tokens; a placeholder stands in for the parser, and a max_tokens the client did send is still validated.

A stop sequence that ends the answer is now reported as stop_reason "stop_sequence" with stop_sequence set to the match, and it is removed from the text (#145). The host's finish event carries no stop reason or matched sequence, so the end of the text is checked: the longest stop sequence the answer ends with. To remove it before it reaches the client, the encoder holds back the longest sequence's length of text while streaming. A length or tool-call finish is never a stop sequence, and a sequence in the middle of the answer is not one. Rejected: a host change to carry the stop reason, which needs a contract change (src/contract.ts) and host behaviour this lane cannot verify.

Thinking blocks still carry an empty signature (#146). The host does not expose the provider's thinking signature (PlugEvent reasoning-delta has only text). The field is documented in src/anthropic/response.ts, and the matrix accepts any string. Not fixed.

Other endpoints (chat, completions, Gemini) still return a matched stop sequence. Only /v1/messages removes it, so those rows are matrix gaps.

Matrix (#101, #148): the legend splits n/a (the client has no such feature, with the reason) from todo (no case yet). Every scenario is now a case, an n/a with a reason, or a gap, and the CI summary counts todo (0 now). New scenarios: multi-turn, thinking, stop-sequence, n, stream-usage, developer, echo-suffix, count-tokens, document, model-id, prompt-array, logprobs and cancel. New clients: LangChain (chat, responses, Anthropic, Google, legacy completions) and ai + @ai-sdk/openai-compatible. The cancel scenario checks the server saw the client's abort on the model call (test/compat/abort.ts); the fake model can hold a stream open ("hang"). Not done: odd tool-argument splits. The fake emits a tool call whole, and splitting it needs a contract event (src/contract.ts), which is out of scope here.

Conformance (#107): test/compat/conformance.test.ts validates plugboard's OpenAI chat (response and stream chunks), completions, responses and models, and Gemini generateContent and countTokens, against the schemas vendored in test/fixtures/specs (source URLs and dates in each file). Unknown fields and missing required fields fail. Known deviations are test.failing, with only the named field waived: Responses omit access_programs and usage.input_tokens_details.cache_write_tokens (the gaps test/types already lists), and /v1/models adds a plugboard field to each model. Anthropic has no public spec to vendor, so it stays with the SDK types (#132).

Gaps found and pinned as test.failing (src unchanged): stop sequences on /v1/chat/completions, /v1/completions and Gemini; candidateCount above 1; the @google/genai SDK cuts a model id at # (plugboard expects %23); the AI SDK and LangChain Google clients send a slash id without models/ (401); the LangChain Google SDK reports an abort as an unhandled error; message_start reports input_tokens 0 (the count arrives in message_delta).

Not done: the Responses item_reference (#147 stays a gap; it needs a src/responses change, outside this round). Live mode, Python clients, Claude Code, Gemini CLI and the OpenAI Agents SDK stay live-only (#99, #108).

Checked: bun run typecheck passes. bun test: 1455 pass, 0 fail, 3.6 s. Matrix (PLUGBOARD_COMPAT_RESULTS, compat-matrix.ts --docs): 203 pass, 16 gap, 0 fail, 117 n/a, 0 todo. test-gates.ts --ratchet raised the compat floor to 234 and unit to 768. check-pack.ts passes (44 files).

Fixes #143
Fixes #144
Fixes #145
Fixes #148
Refs #7
Refs #101
Refs #102
Refs #103
Refs #104
Refs #105
Refs #106
Refs #107
Refs #146

#### Fixes

**fix(runtime): apply key revocation and rotation on the live listener** ([`017b1ca`](https://github.com/jjjermiah/opencode-plugboard/commit/017b1cac62b653a0f64b4ce10583f7b6b5054502))

A config reload that removes a key only reaches the listener if every Location reloads its plugin. An app directory whose older generation stays live kept serving with its captured options. The newer generation differed in `keys`, so it was rejected, and the removed key still got 200 (#90).

What: authentication now reads the live key set (`Runtime.keys`, read through `liveOptions` in src/runtime.ts) instead of the serving generation's options. The listener fingerprint covers the options without `keys`. While generations are live, a newer generation replaces the live keys when they only revoke or rotate: it names no app the live set lacks, names at least one app, and nothing else in its options differs. Any other difference is rejected until restart, as I5 says.

Why: removal and rotation make access stricter, so applying them at once cannot widen it. Adding a key still waits for a restart, because a project config entry must not add access on a live listener.

Decisions: a changed value for an existing app counts as revocation, since the old value must stop working. A key set with no apps is rejected, so the rule cannot turn a keyed listener keyless. Runtime VERSION 10 to 11 (new `keys` field). The Anthropic front-end reads the same live keys.

Validation: bun run typecheck passes; bun test passes (1388 tests). The four new cases in test/runtime/key-revocation.test.ts cover removal, rotation, an added key with other differences (still rejected), and a rejected generation that leaves the keys alone. Test gates ratcheted: test/runtime floor 58 to 62, coverage unchanged. check-pack and smoke-pack pass. The live check on the isolated dev server was not run: its plugboard config points at the main checkout on 0.0.0.0:4010.

Fixes #90

#### Docs

**docs(docs): describe usage statistics, the admin key and the usage RPC** ([`6920d24`](https://github.com/jjjermiah/opencode-plugboard/commit/6920d24728fce30c0ce391e33f48af2a22b5a6ae))

Operators and the two front-ends need the contract written down: what the usage response holds, who may read which app, and what is not promised.

What:
- docs/configuration.md: rows for adminKey and usage, and a Usage statistics section with the access rules, an example response, what each field means, retention, and persistence.
- docs/architecture.md: a Usage statistics section (recording, live aggregate, storage, queries, access, cost, RPC), invariants I23 (usage is written from request handling only) and I24 (usage reads are scoped by key), module map lines, and the runtime VERSION, which the text said was 9 and is 11.
- STRUCTURE.md lists src/usage.ts and src/rpc.ts; AGENTS.md names I1 to I24.

Decisions:
- The persistence lag is documented, not hidden: a day is written at most every 10 s by a request, so a restart can lose the last few seconds of traffic, or the tail of an idle period. Reports read memory, so they are never behind.
- Cost is described as an estimate at list prices, not as spend. A subscription login is not billed per token, so the figure compares apps and is not a bill.
- Rejected: a timer that flushes idle days. Nothing may call the host from a timer outside a request (I23). The gap is listed as a follow-up.

Validation: docs only. The field names, error codes and access rules in the examples are the ones asserted by test/http/usage.test.ts and test/unit/usage.test.ts.

Refs #139
Refs #140

**docs(changelog): notes for usage statistics, token counts and key revocation** ([`ba36f03`](https://github.com/jjjermiah/opencode-plugboard/commit/ba36f03a08c9d93b9e7c4edefdaedbe004cba7db))

Curated [Unreleased] entries for #139/#140 (usage store, GET /v1/usage, adminKey, the usage RPC), #143/#144 (token counting endpoints), #145 (Anthropic stop sequences), #107/#148 (spec conformance and the matrix legend), #90 (immediate key revocation and rotation), the .github/floors move and runtime version 12. Usage and the RPC were checked live on the isolated dev server: GET /v1/usage returned the recorded call with cost, and POST /api/rpc/opencode-plugboard.usage/get returned the same report. Pinned install examples bumped to 0.17.0.

#### CI and tooling

**ci(ci): move the ratcheting floors from .ci/ to .github/floors/** ([`5c65afc`](https://github.com/jjjermiah/opencode-plugboard/commit/5c65afc6de796683fa318c060576f24901ed9483))

The test-count and coverage floor files lived in a top-level .ci/ directory, which added one more dot-folder to the repository root for two JSON files that only CI reads. They now live next to the scripts and workflows that use them, under .github/floors/. test-gates.ts, the CI workflow comment, STRUCTURE.md, CONTRIBUTING.md and test/README.md point at the new path. No floor values changed. Older CHANGELOG entries keep the old path because they describe what was true at the time.

#### Dependencies

**build(deps): add ajv for the #107 response-schema conformance tests** ([`4710c98`](https://github.com/jjjermiah/opencode-plugboard/commit/4710c98f4796af1815b3414277f532ddbf17eb24))

test/compat/conformance.test.ts validates plugboard's responses and stream events against the OpenAI and Gemini response schemas vendored in test/fixtures/specs. ajv is the validator: the most used JSON Schema library, and it validates JSON Schema 2020-12 natively, which OpenAPI 3.1 uses.

Pinned exact at 8.20.0, devDependency only (never shipped; check-pack still lists only the package files). npm view shows no install, postinstall or prepare hook (its "prepare-tests" script is the browser test runner). Its dependencies are pure JS: fast-deep-equal, fast-uri, json-schema-traverse and require-from-string.

Refs #107

</details>
<!-- commit-detail:end -->

## [0.16.0] - 2026-10-11: Knock Before Entering

**Full diff:** [v0.15.0...v0.16.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.15.0...v0.16.0)

### Added

- **Filter models by capability.** `GET /v1/models?capability=vision` or `?capability=tools` lists only models the catalog says can see images or call tools, so a UI's model picker can hide the ones that would fail. Any other value is a 400. (The 0.15.0 notes said the parameter was not wired yet; it is now.)
- **`Retry-After` on every 429.** When a concurrency cap or rate window refuses a call before any output, every API family now sends `Retry-After`, so well-behaved clients back off on their own instead of hammering the server.
- **Discovery lists every endpoint.** `GET /` and `GET /v1` now include legacy completions, Anthropic Messages and the Gemini routes, from one `ENDPOINTS` constant that a test checks against the router in both directions ([#136](https://github.com/jjjermiah/opencode-plugboard/issues/136)).
- **Wider client coverage.** The compatibility matrix now runs LangChain (OpenAI, Anthropic, Google) and `@ai-sdk/openai-compatible` alongside the official SDKs, with `n > 1`, thinking and token-count scenarios. It found five gaps, each pinned as a known failure and filed as an issue.

### Security

- **`/v1/messages` checks the key before the method** ([#137](https://github.com/jjjermiah/opencode-plugboard/issues/137)). An unauthenticated GET used to get a 405 that confirmed the route exists; it now gets a 401 like every other route.
- **Gemini metrics labels are bounded** ([#135](https://github.com/jjjermiah/opencode-plugboard/issues/135)). The route label is a fixed template and unknown verbs count as `unknown`, so a caller can't grow the metrics table by inventing paths.
- A test now proves that a key removed by a config reload is refused by the live listener.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (11 commits)</summary>

#### Features

**feat(openai): filter GET /v1/models with ?capability=vision or tools** ([`e18270e`](https://github.com/jjjermiah/opencode-plugboard/commit/e18270e85e5b14f7ea2fbdfeb6605b9c48ab040f))

The capability filter from the previous change (parseCapability and filterByCapability in src/models.ts) was never called. GET /v1/models ignored the query, so a client asking for vision models got every model.

The list branch now reads ?capability=. A valid value filters the listed models on the catalog flags (image for vision, tools for tools). Any other value, including an empty one, is a 400 invalid_request_error with code invalid_capability, param capability and the message "capability must be vision or tools". The value is checked before the catalog loads, so a bad query never waits on the host. A missing parameter returns the full list, as before. /v1/models/{id} ignores the parameter.

Rejected: accepting json. The catalog has no structured-output flag, so a json filter would guess from response_format support. docs/configuration.md already says json is not offered; it is accurate and unchanged.

Checked with bun test test/http/ingress.test.ts (40 of 40). New tests: the vision and tools filters on the loopback route, and a table of json, an empty value and toString, each a 400 with the catalog failing on purpose, so a 500 would show that the catalog loaded first.

Refs #61

**feat(http): send Retry-After on a refused call before any output** ([`fe4dd17`](https://github.com/jjjermiah/opencode-plugboard/commit/fe4dd17c0c4470a33a0d2434e50194722512a3ee))

The limiter (src/limits.ts) refuses a call over a cap with a 429 and sets PlugError.retryAfterSeconds, but no route sent that value. A client had no hint when to retry, so it retried at once or gave up.

Every front-end now answers a pre-output error through one helper, sendError in src/http.ts. It sends the status and the wire body as before, and adds Retry-After when the error carries retryAfterSeconds. Routes using it: Chat Completions, legacy completions, Responses, Messages and Gemini. The fan-out and the non-stream Chat Completions path read the value from the failing choice, so `n` above 1 keeps the hint too. collectCompletion and the completions collector now return retryAfterSeconds with their status and body. That is the one shape change; the wire bodies are unchanged.

Rejected: putting the header in a shared middleware. The routes build their own error bodies, and the error only exists inside each route's fail step, so a helper called there is the smaller change. Errors after the first output cannot carry a header, so they are not changed.

Checked with a new test file, test/http/retry-after.test.ts. A fake caller yields a 429 with retryAfterSeconds 1 on each route (chat, streamed chat, n=2, completions, responses, messages, Gemini and streamed Gemini), and each answers Retry-After: 1. A plain 503 sends no header. bun test test/http test/unit passes (990 of 990) and bun run typecheck is clean.

#### Fixes

**fix(anthropic): authenticate before the method check on /v1/messages** ([`7c4200f`](https://github.com/jjjermiah/opencode-plugboard/commit/7c4200faac34013c480a72f8274409e21be62819))

A GET or any other non-POST to /v1/messages answered 405 before the request was authenticated. An unauthenticated caller could tell that the path exists, which was the one exception to invariant I15. The Messages route now runs the Host and Origin checks, then authentication, then the 405 for a non-POST method. An unauthenticated GET is a 401 in Anthropic's error shape, and an authenticated GET is still a 405.

The other route families already authenticate first (#91), so this follows that order. Only the position of the method check changes; the 405 itself is unchanged. docs/architecture.md (I15 and the error section) now describe the same order.

Checked with two new tests in test/http/messages.test.ts: the unauthenticated GET is a 401 and the authenticated GET is a 405. The messages suite passes (20 of 20) with bun test test/http/messages.test.ts.

Fixes #137

**fix(gemini): bound the route label of Gemini requests** ([`736b9af`](https://github.com/jjjermiah/opencode-plugboard/commit/736b9af7ae573c48056d1705cef5ec8e90f196d5))

The route label of a Gemini request was built from the method verb in the request path, `POST /v1beta/models/{model}:<verb>`. With option `metrics` on, an unauthenticated caller could mint a new `route` label value for each made-up verb, and the registry keeps every label value for the life of the process. The label is set before authentication, so nothing checked the path against a fixed set.

The two Gemini verbs plugboard serves keep fixed labels (`POST /v1beta/models/{model}:generateContent` and the streaming one, with the `/v1/models/` spelling keeping its own). Every other verb is labelled `unknown`, and the verb stays only in the response body, where the client already sent it. The model name was never in the label, so the model side was already bounded. I considered labelling unsupported verbs with a fixed template such as `POST .../{model}:{verb}`, but that still names the template only and gives no information a count of `unknown` does not.

Checked with bun test test/http/gemini.test.ts (23 of 23). The existing test.failing for #135 is now a test. New tests: made-up verbs share the label `unknown`; `fast`, an unknown model and another name share one generate label; a path outside the Gemini routes is `unknown`.

Fixes #135

**fix(discovery): list every endpoint the router serves** ([`e539c0d`](https://github.com/jjjermiah/opencode-plugboard/commit/e539c0d76c32248c95e4a7b35f58a6be4cf6cf9a))

The discovery document (GET /v1 and the GET / page) listed only the OpenAI routes. POST /v1/completions, POST /v1/messages and the Gemini paths (GET /v1beta/models, GET /v1beta/models/{model}, and the generateContent and streamGenerateContent methods) were served but not listed, so a client that reads the document could not find them.

The list is now one exported constant, ENDPOINTS in src/discovery.ts. The metrics endpoint is still added only when option metrics is on. I considered deriving the list from the router's own route table, but the router matches on method and path in several front-ends, so a shared table would have touched every route for a small gain. The constant plus a test is the smaller change.

The test is test/http/discovery.test.ts. It probes every served route with an authenticated request and checks that each answers something other than the router's own "No route for" 404, and that GET /v1 lists it under its template. A second test checks the reverse: the document lists no endpoint that no probe reaches. A new route therefore needs a probe, which is the point of the test.

Two existing assertions matched the substring "beta" in the keyless document to catch another app's name. The Gemini paths contain "/v1beta/", so those assertions now ignore "v1beta" (a negative lookbehind). They still reject another app's name, and the behaviour they protect is unchanged.

Checked with bun test test/http/discovery.test.ts test/unit/discovery.test.ts test/http/observability.test.ts (53 of 53).

Fixes #136

#### Tests

**test(gemini): expect the unknown label for an unsupported Gemini verb** ([`4cf8ada`](https://github.com/jjjermiah/opencode-plugboard/commit/4cf8ada3094a2db633a20f1cea3400402316a2ef))

Commit 736b9af (#135) labels every Gemini verb other than generateContent and streamGenerateContent `unknown`, so the client's verb never reaches a metric label. The unit test for matchGeminiRoute still expected the old template `POST /v1beta/models/{model}:countTokens`, so the suite was red after that commit. I ran only test/http/gemini.test.ts for it and did not run the whole suite; this commit corrects the expectation.

The assertion now reads route "unknown" for countTokens, the same value the route returns, and the op and verb are unchanged.

Checked with bun test test/unit/gemini-request.test.ts and the full bun test run (see the report for the counts).

Refs #135

**test(tests): widen the compat matrix to LangChain, n > 1, thinking and token counts** ([`c8c5556`](https://github.com/jjjermiah/opencode-plugboard/commit/c8c555693c9cb2cfef053a6080ae074a17cd4a60))

The matrix (#101) gains the scenarios the client issues ask for, and the clients that exercise them. Every case is a real request through plugboard's loopback route, with the fake model scripted in test/compat/scenarios.ts. New scenarios: multi-turn (#103, #104), thinking (#102), stop-sequence (#102), n (#106), stream-usage (#106, #7), developer (#7), echo-suffix (#106), count-tokens (#102, #103), document (#102), model-id (#103). A client with no case for a scenario stays n/a, as before.

New clients: @langchain/openai chat and responses (useResponsesApi), @langchain/anthropic, @langchain/google-genai, the legacy @langchain/openai completions class (test/compat/langchain.ts), ai + @ai-sdk/openai-compatible, and ai + @ai-sdk/openai with store: false.

Known gaps, pinned as test.failing with the reason in the matrix footnotes:
- ai + @ai-sdk/openai (responses), multi-turn: the AI SDK default (store: true) resends the first answer as an item_reference. plugboard answers 400, and the message names providerOptions.openai.store (checked by running it). The store: false row passes.
- @anthropic-ai/sdk, stop-sequence: a stop returns end_turn with stop_sequence null. Anthropic reports stop_sequence and the matched text.
- @anthropic-ai/sdk, count-tokens: 404 not_found_error (count_tokens is not served). @google/genai, count-tokens: 404 NOT_FOUND (countTokens is not served). Gemini CLI calls countTokens, so this affects it too (live only).

Spec gap found, not pinned as a failure: thinking blocks go out with an empty signature (src/anthropic/response.ts). Anthropic signs thinking blocks, and a client that resends them has nothing valid to send back. The case accepts any string, so the gap is recorded here, not as a test.

Matrix server option: maxN: 2. The default maxN of 1 refuses n > 1 because each choice is a model call. The matrix opts in so the n scenario runs. The default refusal stays tested in test/unit/openai-request.test.ts (#58).

LangChain Google has no image case: it refuses inline images unless the model name looks multimodal, and the matrix alias is `fast`. That case is n/a.

Not covered here, and why: streamed tool-call argument splits (#7; the fake emits whole calls), chats and Python clients (#103, #104, #105: live only), the OpenAI Agents SDK (#104), the live mode (PLUGBOARD_LIVE, #99), and upstream spec validation (#107; no spec package is installed, only the #132 SDK types).

Checked: bun run typecheck passes. bun test: 1350 pass, 0 fail. The matrix (PLUGBOARD_COMPAT_RESULTS, compat-matrix.ts --docs docs/compatibility.md) gives 137 pass, 5 gap, 0 fail, 146 n/a. test-gates.ts --ratchet raised the compat floor 69 to 143; it also raised unit, http and runtime, which were already behind the base tree and not changed here. check-pack.ts passes.

Refs #7, #101, #102, #103, #104, #105, #106, #107

**test(http): a key dropped by a config reload is rejected on the live listener** ([`7ce1d91`](https://github.com/jjjermiah/opencode-plugboard/commit/7ce1d91b8cc912d348e5b4bf5fe383ed4428ba48))

The report behind #90 says a removed key might keep working after a reload, because authentication uses the serving generation's options and an app-directory generation that did not reload could keep serving the old ones. I checked the path the host normally takes: a config reload disposes the Location's generations, then the edited config registers as a new one. With no generation live, its options are adopted (I5 and runtime registerGeneration).

The new test builds the real OpenAI route on the real listener, with two keys. It disposes the first generation, registers the edited config with only one of the keys, and checks GET /v1/models over loopback. The dropped key gets 401, the kept key gets 200. It passes on the code as it is, so no change to src/runtime.ts or authentication was needed.

One case is not covered by this test, and I did not change it. If an old generation stays live across a reload (the case the issue describes), the new config is rejected by design: a live generation's options are never replaced, so a project config cannot weaken authentication (I5). I checked it with a throwaway probe: the new registration was rejected and the dropped key still answered 200. Closing that case needs a decision about whether a stricter config may replace live options, so it is left open.

Checked with bun test test/runtime/key-revocation.test.ts (1 of 1).

Refs #90

#### Docs

**docs(changelog): notes for the route fixes, capability filter and compat coverage** ([`378fbb3`](https://github.com/jjjermiah/opencode-plugboard/commit/378fbb3afb993e184306d3f29a6ac64c742cc4e6))

Curated [Unreleased] entries for #135, #136, #137, the ?capability= wiring (correcting the 0.15.0 note that said it was not wired), Retry-After on pre-stream 429s, the wider compat matrix and the key-revocation test. Pinned install examples bumped to 0.16.0.

#### CI and tooling

**ci(tests): raise the test-count and coverage floors** ([`385afcb`](https://github.com/jjjermiah/opencode-plugboard/commit/385afcb31c73caa1cdb9342db0994d5ff0676b80))

The route fixes above added 49 tests (http 187 to 236, runtime 38 to 58, unit 684 to 754). The floors only go up, so they now match the counts after this branch. session and compat stay where they were, since no test was added there. Coverage moved from 97.5 to 97.6 lines and 91.3 to 91.6 functions.

Ran the coverage command from test/README.md, then bun .github/scripts/test-gates.ts .coverage --ratchet. Every floor was met before the ratchet, and the ratchet only raised values.

#### Dependencies

**build(deps): add langchain and ai-sdk openai-compatible for the compat matrix** ([`b6db59f`](https://github.com/jjjermiah/opencode-plugboard/commit/b6db59fc39e467600c60efdb2e67dd0b77390577))

The compatibility matrix (#101) runs the clients the issues name. Four were missing from devDependencies: the LangChain JS packages for OpenAI, Anthropic and Google (#102, #103, #104, #106), and @ai-sdk/openai-compatible for the Vercel path that any OpenAI-compatible server uses (#105). All four are official, pinned exact, and test-only: check-pack still lists only the package's own files.

Rejected: driving LangChain through its Python package. That needs a second toolchain in CI for the same JS wire. Rejected: hand-writing the LangChain request shapes, which would test our guess of the client instead of the client.

Checked: none of the four has an install, postinstall or prepare script (npm view). bun add resolved 15 new packages, all pure JS. The lockfile is committed with the versions, since CI runs bun install --frozen-lockfile.

Refs #101, #102, #103, #104, #105, #106

</details>
<!-- commit-detail:end -->

## [0.15.0] - 2026-10-11: Brakes, Memory, Clean Names

**Full diff:** [v0.14.0...v0.15.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.14.0...v0.15.0)

### Added

- **Concurrency caps and rate limits** ([#54](https://github.com/jjjermiah/opencode-plugboard/issues/54), [#86](https://github.com/jjjermiah/opencode-plugboard/issues/86), [#131](https://github.com/jjjermiah/opencode-plugboard/issues/131)). One runaway client could open dozens of parallel calls against your subscription and your OpenCode process. The new `limits` option caps model calls in flight, globally and per app, and how many calls each app may start per minute:

  ```jsonc
  "limits": { "maxConcurrent": 8, "perApp": { "maxConcurrent": 2, "requestsPerMinute": 30 } }
  ```

  A call over a cap gets an immediate 429 and never reaches a provider or creates a session. Nothing queues, so a burst can't pile up behind the cap. Built on `p-queue`; refusals are counted in `plugboard_limited_total`.
- **Response cache** ([#59](https://github.com/jjjermiah/opencode-plugboard/issues/59)). Pollers and bots ask the same thing over and over. With `cache: { ttlSeconds: 300 }`, an identical request from the same app is answered from memory with zero token usage and no new session. Only completed answers without tool calls are kept, `n` above 1 is never cached, apps never share entries, and every answer says `x-plugboard-cache: hit` or `miss`. Changing `cache`, `apps`, `models` or `aliases` empties it, so a hit can never serve a model your current policy forbids. Built on `lru-cache`.
- **Model ids that survive any UI** ([#61](https://github.com/jjjermiah/opencode-plugboard/issues/61)). Some chat UIs mangle the `/` and `#` in `anthropic/claude-haiku-4-5#high`. Set `modelIds: "slugs"` (or `"both"`) and `/v1/models` lists `anthropic--claude-haiku-4-5__high` instead. Requests accept either spelling regardless of the option, so a cached slug keeps working.

### Changed

- Internal runtime version 10. Restart OpenCode after upgrading.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (8 commits)</summary>

#### Features

**feat(models): ui-safe model id slugs and capability filtering** ([`c517c5d`](https://github.com/jjjermiah/opencode-plugboard/commit/c517c5d81be8e7198794c9a918bf701cf458941d))

Some chat UIs mangle the `/` and `#` in model ids, so `anthropic/claude-haiku-4-5#high` breaks there and users wrote an alias by hand for each model. This adds a `modelIds` option (`canonical` by default, `slugs`, or `both`). The slug form replaces `/` with `--` and `#` with `__`, so the model above is `anthropic--claude-haiku-4-5__high`. `toSlug` and `fromSlug` in src/models.ts do the mapping. `fromSlug` returns undefined for anything that is not a slug of a known shape, including canonical ids and alias names.

`resolveModel` accepts a slug wherever it accepts a canonical id, whatever `modelIds` says, so a client that cached a slug keeps working when the option changes. Aliases are checked first, so an alias named like a slug still wins.

An id that contains `--` or `__` does not round trip through the slug form. Listing only emits a slug when `fromSlug(toSlug(id))` gives the same id back. In `slugs` mode such a model is left out, and it stays listed under `canonical`. Without this check the list would offer a slug that resolves to a different model. Aliases are listed unchanged in every mode.

`filterByCapability` and `parseCapability` filter the listed models on the flags the catalog already reports: `capabilities.image` for `vision` and `capabilities.tools` for `tools`. `json` is not accepted. The host catalog has no structured-output flag, and deriving one from `response_format` support would be a guess. The `capability` query parameter itself is wired in src/openai/route.ts by a separate change, so until that lands `/v1/models` ignores it.

Docs: a `modelIds` row in docs/configuration.md and a "Model ids in UIs" section. Test-count and coverage floors were raised with `test-gates.ts --ratchet`. The http and session floors were already below the counts on the base commit, so the ratchet moved them too.

Checked with `bun run typecheck`, `bun test` (1171 pass), `bun .github/scripts/check-pack.ts` and `bun .github/scripts/test-gates.ts`. The new unit tests cover round trips, a fast-check property over plain segments, junk rejection, slug resolution, alias priority, all three listing modes, the option parser and the capability filter. The live pong gate was not run for this change.

Fixes #61

**feat(limits): cap concurrent calls and requests per minute per app** ([`c6f8449`](https://github.com/jjjermiah/opencode-plugboard/commit/c6f844901123d822bcfe8829e058d26f1ebb67cd))

Option `limits` caps how many model calls run at once, globally and per app, and how many calls an app may start per minute. Without it nothing is capped, which is today's behaviour. One runaway client could hold every provider slot and burn a subscription's quota (#54), and many parallel requests each hold a host session for up to requestTimeoutMs (#86).

withLimits (src/limits.ts) is a ModelCaller wrapper. It is outermost in index.ts, outside withFallbacks, so one request takes one slot in each applicable cap however many alias targets it tries. Before the inner caller runs, the global cap, the app's cap and the app's requests-per- minute window are checked together. A refused call yields one error event: status 429, kind rate_limit, code too_many_requests or rate_limit_exceeded, and retryAfterSeconds. It never reaches the session caller, so no session is created and the provider never sees the call.

Decisions. A call over a cap is refused at once. Nothing queues: #131 mentioned a bounded queue, but the decided design fails fast, so there is no wait to bound. apps.<name> overrides perApp field by field. Every check runs before anything is taken, so a refused call holds no slot and spends no window count. A slot is freed when the inner stream ends, throws, the consumer stops, or the request signal aborts; the abort also frees a slot whose inner stream ignores the signal. The rate limit is a fixed 60 s window per app. The queues and windows live on the runtime, and VERSION goes from 8 to 9, so they survive plugin generations (I6). PlugError gains retryAfterSeconds. No route reads it yet, so the Retry-After header is for the route lane to wire. Metrics gain plugboard_limited_total{app,reason}.

Rejected: a hand-rolled counter (#131 asks for p-queue, and the counting is small either way), a sliding window (a fixed window needs one number per app and is enough for a per-minute cap), and a queue with a timeout (more state, and a waiting request holds its socket).

Known edge: p-queue counts a slot free one microtask after its job resolves, so a call made in that same tick can be refused by mistake. Requests arrive from the I/O loop, so this is not seen in practice. The tests flush with tick() after a release.

Checked: test/unit/limits.test.ts covers cap refusal, release after completion, a throw, an early stop and an abort (the abort case with an inner stream that ignores the signal), per-app independence, the window reset with an injected clock, and a fallback chain that holds one slot. Config and metrics tests cover the parsing and the counter. bun run typecheck passes, bun test passes (1161 tests), and check-pack and smoke-pack pass. Not run: a live run on an isolated server.

Fixes #54
Fixes #86
Fixes #131

**feat(cache): serve repeated requests from memory** ([`2025f84`](https://github.com/jjjermiah/opencode-plugboard/commit/2025f84da5d6d37f4c764c43ea3577c7597b65de))

Pollers and bots resend identical prompts and pay for each one. With the new opt-in `cache` option, a completed answer is kept in memory and the same request from the same app is answered without a session or a provider call.

What is kept: turns that end with stop or length, with text or reasoning, and no tool call, error or abort. Tool calls are not kept because they need the caller's results. Structured output is a forced tool call, so it is not kept either. A hit replays the stored events with zero usage, the onServed and onPolicy notes of the original (so x-plugboard-model and x-plugboard-policy match), and no history record.

Decisions: the ModelCaller is wrapped in src/cache.ts, so no front-end has cache logic beyond reportCache. The wrapper sits outside the fallback chain in index.ts, so a hit never reaches a provider. The store lives on the runtime (VERSION 9) and is rebuilt when the cache option or the apps policy changes, because the key does not cover policy. Fan-out sets noCache for n above 1, since each choice must be a fresh sample. Every route sets x-plugboard-cache hit or miss, first writer wins. Metrics: plugboard_cache_requests_total, counted only with the metrics option. Rejected: a disk store. Memory keeps the change small; a restart empties the cache, and the docs say so.

Checked: bun run typecheck, and bun test with the test commit (1204 pass). check-pack and smoke-pack pass.

Fixes #59

#### Tests

**test(cache): cover the response cache** ([`4a1b826`](https://github.com/jjjermiah/opencode-plugboard/commit/4a1b8269568183ca7d2c4f26df25d398b1770f03))

Adds unit tests for the wrapper (test/unit/cache.test.ts), http tests for the header on every front-end and for n above 1 (test/http/cache.test.ts), and runtime and config tests (test/runtime/cache.test.ts).

The TTL test uses a short real TTL. lru-cache's injected perf clock did not move its expiry check after the first read, so a fake clock would have tested nothing. The http tests wrap the fake caller with cachedCaller, because startRoute does not run the runtime wiring.

Checked: bun test (1204 pass, 74 of them new), bun run typecheck (src and test).

Refs #59

#### Docs

**docs(cache): describe the response cache** ([`a7dd468`](https://github.com/jjjermiah/opencode-plugboard/commit/a7dd4689f7fc7cca1ab2a7e8ae670c2c8f89af11))

Adds the cache option to docs/configuration.md: fields, defaults, what is and is not kept, the headers, and when the store resets. Adds a section and a module map line to docs/architecture.md: key, storage, replay, context flags and metrics. Operators need to know that a hit reports zero usage, that the cache is memory only, and why n above 1 is never cached.

Refs #59

**docs(changelog): notes for limits, the response cache and model slugs** ([`7afa987`](https://github.com/jjjermiah/opencode-plugboard/commit/7afa987008f88264bacde85ac49cc03f05024f27))

Curated [Unreleased] entries for #54/#86/#131 (concurrency caps and per-app request windows), #59 (opt-in response cache) and #61 (UI-safe model id slugs), plus runtime version 10. README drops the stale "no concurrency limit" gap in favour of the real one (single-process state). Pinned install examples bumped to 0.15.0.

#### Dependencies

**build(deps): pin p-queue 9.3.5 for the request limiter** ([`98fe7d4`](https://github.com/jjjermiah/opencode-plugboard/commit/98fe7d40481259433909a1e4a0b060d53dda104d))

The concurrency caps in src/limits.ts (#54, #86, #131) are p-queue instances, one per capped scope, with concurrency set to the cap. p-queue is the popular choice for this and #131 asks for it, so it was taken instead of a hand-rolled counter. It is pinned exact like every runtime package, because OpenCode installs plugin dependencies unattended.

Checked before adding: `npm view p-queue scripts` shows no preinstall, install or postinstall script, so the ignoreScripts install is safe. Its own dependencies are p-timeout and eventemitter3, both pure JS. It is ESM only (Node >= 20) and ships its own types, so nothing goes in devDependencies. bun add p-queue@9.3.5 --exact installed 3 packages.

Refs #131

**build(deps): add lru-cache for the response cache** ([`e390650`](https://github.com/jjjermiah/opencode-plugboard/commit/e390650bd7b78f0b521b725c268aff7f838383cc))

The response cache (src/cache.ts) needs an LRU with a TTL, an entry cap and a byte cap. lru-cache does exactly that, is widely used and has no dependencies of its own, so it replaces a hand-rolled map with expiry and eviction logic.

Checked: bun install resolves lru-cache 11.5.3 (engines: node 20 or 22 and later). The Bun test suite loads it. It is a plain runtime dependency, which OpenCode installs next to the plugin with its npm install step.

</details>
<!-- commit-detail:end -->

## [0.14.0] - 2026-10-11: Standard Issue Gauges

**Full diff:** [v0.13.0...v0.14.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.13.0...v0.14.0)

### Changed

- **Metrics and logs on proven libraries** ([#125](https://github.com/jjjermiah/opencode-plugboard/issues/125), [#126](https://github.com/jjjermiah/opencode-plugboard/issues/126)). The hand-rolled Prometheus exposition and logger are gone. Metrics now run on `@prometheus-io/client` (the maintained successor of `prom-client`, which npm marks deprecated) and logs on `pino`. Metric names, labels and buckets are unchanged; `plugboard_history_sessions_removed_total` now reads 0 from the start and histogram bucket lines put `le` first. JSON logs keep `level` as a name; text lines look the same; info still goes to stdout and errors to stderr. Internal runtime version 8: restart OpenCode after upgrading.

### Security

- **Credentials are redacted from logs.** Fields named `authorization`, `key`, `apiKey`, `x-api-key` and `x-goog-api-key`, also under `headers`, are written as `[redacted]`, so a future log line can't leak a key by accident.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (4 commits)</summary>

#### Refactors

**refactor(metrics): back the registry with prom-client** ([`bb97738`](https://github.com/jjjermiah/opencode-plugboard/commit/bb97738c6b89c4058aac67cc68bc2e623ae0c379))

src/metrics.ts hand-rolled the Prometheus text format: label and help escaping, counter series maps, histogram buckets and the render loop. It is now built on prom-client 15.1.3 (Apache-2.0, pure JS, no install script; its only dependencies are tdigest and @opentelemetry/api, both script-free). The Metrics interface and createMetrics() factory keep their shape, so no call site moves except the one that renders.

What changed:
- createMetrics() makes a new Registry per call. The global default registry is never used and collectDefaultMetrics is never called, so the process emits only the plugboard_* series it did before. The runtime still holds one Metrics (and so one Registry) on globalThis.
- Same metric names, labels, bucket bounds and registration order as before, so the exposition order is unchanged.
- Metrics.render() is now async (registry.metrics() returns a promise) and Metrics gains contentType, taken from the registry. The /metrics route awaits it and uses that content type instead of a literal. This is a one-line change in src/openai/route.ts.
- Counter and histogram guards stay in a small wrapper: zero, negative and non-finite amounts are ignored. prom-client would throw on the last two and write an empty series for zero, and a metrics call must never throw into request handling.
- Runtime VERSION 7 -> 8. The Metrics object on the runtime changed shape (async render), and a hot-reloaded module of the old version must not call a sync render on it.

Output differences, all legitimate under text format 0.0.4:
- A counter without labels (plugboard_history_sessions_removed_total) reads 0 from the start instead of having no sample until its first event. Labelled counters still have no series until first use.
- Histogram bucket lines write le first, then the other labels. Test expectations changed for exactly these two, and the in-flight, token-kind, escaping and ignore-bad-amount behaviour is unchanged.

Rejected: keeping render() synchronous by hand-rendering the registry (defeats the point); collectDefaultMetrics (unbounded new series, not asked for); pre-initialising labelled series (cardinality is bounded by what actually happens, as before).

Validation: bun run typecheck; bun test (metrics unit tests are now async and gain registry isolation, default-register and content-type cases); bun .github/scripts/smoke-pack.ts and check-pack.ts run after both lanes landed. npm view prom-client scripts shows no install script. Note: npm marks prom-client 15.1.3 deprecated in favour of @prometheus-io/client (same API lineage, 0.16.1); see issue.

Fixes #125

**refactor(log): back the logger with pino and redact credentials** ([`c816b3f`](https://github.com/jjjermiah/opencode-plugboard/commit/c816b3f600a97864dd98dcb67858d31ad7037d21))

src/log.ts hand-rolled text and JSON formatting, value quoting, the envelope keys and the request-id scoping, and nothing censored a credential that reached a log field by mistake. It is now built on pino 10.4.0 (MIT, pure JS, no install script; its dependencies are script-free too). log, logError, withRequestId, outsideRequest, setLogFormat and errorMessage keep their signatures, so the ~40 call sites do not move.

What changed:
- One pino instance, created on first use and kept on globalThis in src/log.ts under a new versioned key. It is not on the runtime object: src/runtime.ts imports the logger and must still log when a foreign-version runtime owns the process.
- Request id: pino's mixin reads the existing AsyncLocalStorage on every line, so withRequestId and outsideRequest behave as before and an explicit id field still wins over the ambient one.
- logFormat "json" is pino's JSON. Keys: level, time (ISO 8601), service, event, then the fields. Differences from the old line: the key order (level first) and no pid or hostname. The level is its name ("info", "error") through formatters.level, not pino's 30 and 50, so existing parsers keep working. The message key is "event". A field named level, time, service or event is dropped, as before.
- logFormat "text" is the same "[opencode-plugboard] event key=value" line, made from the pino record by a 15 line formatter.
- Output still goes where it did: info to console.log (stdout), error to console.error (stderr). pino.multistream with dedupe sends each record to one of two small destinations that call console at write time, so test spies and host patches of console keep working.
- redact censors authorization, Authorization, x-api-key, x-goog-api-key, key and apiKey, at the top level and under headers, as "[redacted]". It matches names, not values; the rule "ids and outcomes only" stays.

Decision on pino-pretty: not used. It prints multi-line, level-prefixed records, cannot produce the event key=value shape that scrapers match, and adds a dozen packages. It also invites pino.transport, which starts a worker thread (thread-stream); that is a freeze and Bun-compatibility risk inside the OpenCode host, so no transport is used anywhere.

Docs: docs/architecture.md and STRUCTURE.md describe both new dependencies (this commit also carries the metrics wording, see #125).

Validation: bun run typecheck; bun test, 838 pass, 0 fail (new tests for pino JSON shape and stream, redaction in both formats and under headers, request id in JSON); bun .github/scripts/smoke-pack.ts and bun .github/scripts/check-pack.ts pass with the packed tarball installed with --ignore-scripts; npm view pino scripts shows no install script. The test helper captureLogs needed no change: text goes through console.

Fixes #126

#### Docs

**docs(changelog): notes for the metrics and logging swap** ([`c4c231c`](https://github.com/jjjermiah/opencode-plugboard/commit/c4c231c4dfa376b1ea7af5484198e0d96a2f0606))

Curated [Unreleased] entries for #125 and #126: metrics on @prometheus-io/client (prom-client is deprecated upstream), logs on pino, the two visible metric-format differences, runtime version 8, and credential redaction in logs. Pinned install examples bumped to 0.14.0.

#### Dependencies

**build(deps): switch metrics to @prometheus-io/client** ([`e1ce7bc`](https://github.com/jjjermiah/opencode-plugboard/commit/e1ce7bce598868678724d037452f11dfc4512737))

prom-client, added in the previous metrics commit, is deprecated on the registry: `npm view prom-client deprecated` prints "prom-client has been replaced by @prometheus-io/client" (last prom-client release 15.1.3, published 2026-08-25). The replacement is published from the same repository, prometheus/client_js (Apache-2.0), at 0.16.1 (2026-08-27). Shipping a package its maintainers have retired would leave users installing a deprecation warning and no future fixes, so this switches before the first release that contains it.

What changed:
- package.json and bun.lock: prom-client 15.1.3 out, @prometheus-io/client 0.16.1 in, pinned exact. The runtime dependencies are the same two as before (tdigest and @opentelemetry/api), so nothing new is installed.
- src/metrics.ts and the metrics test import from the new package. The code is otherwise unchanged: Registry, Counter, Gauge and Histogram have the same constructors, `registry.metrics()` is still async and `registry.contentType` is still the 0.0.4 text type. Every metrics test passed against it without an expectation change.
- One typing difference: the new typings define the label argument of Counter.inc as a conditional type (LabelValues<L>) that TypeScript cannot resolve for a generic L, so the `count` helper casts the counter to Counter<string> at the single inc call. The runtime call is the same; a comment says why.
- Docs name the new package (docs/architecture.md, STRUCTURE.md), and the runtime VERSION comment is reworded.
- Stale fixtures: the runtimeVersion in test/support/loopback.ts (TEST_STATUS) and test/unit/discovery.test.ts said 6; the runtime is at 8 since the async render and was already at 7 before that. They are now
  8. Nothing asserted the number against the real runtime.

Install safety: npm view shows no preinstall, install or postinstall script. It has a `prepare: husky` script, which npm runs only when the package itself is installed from git or packed, never for a registry dependency, and with scripts disabled by the host anyway. Pure JS, no native build. Bun loads it: the whole suite runs on Bun, and the packed tarball installed with --ignore-scripts imports under Bun in smoke-pack.

Rejected: staying on prom-client (deprecated, no more releases expected); hand-rolling the exposition again (the point of the earlier commit).

Validation: bun run typecheck clean; bun test 838 pass, 0 fail; bun .github/scripts/smoke-pack.ts "smoke ok" with no prom-client deprecation warning left in the install; bun .github/scripts/check-pack.ts "pack ok: 40 files". No prom-client left in node_modules or the lockfile.

Refs #125

</details>
<!-- commit-detail:end -->

## [0.13.0] - 2026-10-11: House Rules

**Full diff:** [v0.12.0...v0.13.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.12.0...v0.13.0)

### Added

- **Rules per app** ([#78](https://github.com/jjjermiah/opencode-plugboard/issues/78), [#51](https://github.com/jjjermiah/opencode-plugboard/issues/51)). One key used to reach every allowed model, and the only way to change an app's behaviour was to change the app. The new `apps` option lets the operator decide, per app:

  ```jsonc
  "apps": {
    "discord-bot": { "key": "sk-...", "models": ["fast"], "system": "Answer in one sentence.", "tools": false },
    "n8n": { "key": "sk-...", "models": ["anthropic/*"], "maxTools": 8 }
  }
  ```

  `models` narrows the global allowlist for that app (an app can only ever narrow it): anything outside is the usual 404, and every model list, the setup page and `/v1/status` show only what that key may use. Fallback targets an app can't use are skipped. `system` is prepended (or appended, or replaces the caller's) on every request, `tools: false` strips caller tools and says so in `x-plugboard-policy: tools-stripped`, and `maxTools` lowers the tool cap. It all happens in the session layer, so it applies to every endpoint. `keys` keeps working and merges with `apps`.
- **Every client, checked on every push** ([#101](https://github.com/jjjermiah/opencode-plugboard/issues/101), [#132](https://github.com/jjjermiah/opencode-plugboard/issues/132), [#130](https://github.com/jjjermiah/opencode-plugboard/issues/130)). The official `openai`, `@anthropic-ai/sdk` and `@google/genai` SDKs and four Vercel AI SDK providers now run text, streaming, tool round trips, parallel tools, images, structured output, errors and usage against plugboard in CI, and the result is published as [docs/compatibility.md](https://github.com/jjjermiah/opencode-plugboard/blob/main/docs/compatibility.md) (67 pass, 1 known gap). Every response encoder is type-checked against the SDKs' own wire types, and property tests throw arbitrary JSON at every decoder to prove it answers with a 400, never a crash. The suite is now **1122 tests in about 1.5 s**, with per-layer test-count floors and a 97.5% line-coverage floor that can only go up ([#110](https://github.com/jjjermiah/opencode-plugboard/issues/110), [#100](https://github.com/jjjermiah/opencode-plugboard/issues/100)).

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (11 commits)</summary>

#### Features

**feat(config): per-app policy through the apps option** ([`71afc6d`](https://github.com/jjjermiah/opencode-plugboard/commit/71afc6d05b2257b4fa034c955b43f2d6e8184e9b))

Some apps need steering the operator controls, not the caller: a chat UI that must not get tools, a bot that may only use one cheap model, a JSON-only instruction. This adds an `apps` option keyed by app name: `key`, `models`, `system`, `systemMode`, `tools` and `maxTools`.

`keys` keeps working. `parseOptions` merges it with `apps.<name>.key` into the one key map `authenticate` already reads; a key set in both places must match or the config is rejected. Validation is strict: unknown fields, a non-default app without a key, `apps.default` next to keys, an empty `models`, a `systemMode` without `system` and a `maxTools` above the global cap all fail at load with a message naming the field. The keyless `default` app can be configured too.

`models` only narrows the global allowlist. An entry is a model pattern or an alias name. An alias entry admits that name only (a bot scoped to `fast` cannot call the model behind it by id), a pattern admits every model it matches and the aliases pointing at them. A request outside the scope gets the same 404 `model_not_found` as an unknown model. `/v1/models`, `/v1/models/{id}`, the Gemini model routes, the setup page and `/v1/status` list only what the calling app may use, and a fallback target the app may not use is skipped instead of turning a retry into a 404.

Enforcement sits behind the seam, so every front-end gets it with no per-route logic: the session caller checks the scope and applies `tools: false` (tools and tool choice dropped before the session is built) and the app's `maxTools` (400 `too_many_tools`), and the context hook prepends, appends or substitutes the app's `system`.

The contract gains one optional callback, `CallContext.onPolicy`. The caller calls it when tools were stripped and every route sets `x-plugboard-policy: tools-stripped` next to `x-plugboard-model` while the headers are open; the first writer wins.

Alternatives rejected: a 400 for a request that sends tools to a `tools: false` app (the point is that the app need not change), and resolving the scope in `resolveModel` (four routes plus Gemini would each need the app, and a new front-end could forget it). Known limits, documented: `tools: false` also drops the tool `json_schema` structured output is answered through, and `replace` drops the instruction `json_object` adds.

Fixes #78
Fixes #51

#### Tests

**test: parse SSE with eventsource-parser, the parser real clients use** ([`8aea37a`](https://github.com/jjjermiah/opencode-plugboard/commit/8aea37a4ff0a0f2407bb8bd8b92ba1e42faf6bbb))

parseSse now feeds the body to eventsource-parser, so tests see events the way the AI SDK and eventsource do (multi-line data, CRLF, unterminated last event not delivered). Comments are still reported in order for the keepalive checks, and raw reads stay available as OpenStream.received.

Adds the devDependencies the next commits use: eventsource-parser, fast-check, openai, @anthropic-ai/sdk, @google/genai, ai and the AI SDK OpenAI, Anthropic and Google providers. None ship in the package.

Fixes #129

**test(gemini): cover the codec, routes, key sources and Google errors** ([`d1f56c9`](https://github.com/jjjermiah/opencode-plugboard/commit/d1f56c9fc12df79e63922930995c1affb535407b))

Request decoding (contents, function call pairing, schema conversion, tool config, structured output, thinking), the GenerateContentResponse encoder, Google error bodies, route matching, the three key sources (x-goog-api-key, ?key=, Authorization), alt=sse streams, #38/#49 status rules and the deadline. A test.failing records #135 (made-up method names grow the route label).

Refs #5 #135

**test: pin every encoder to the official SDK wire types** ([`f2b6661`](https://github.com/jjjermiah/opencode-plugboard/commit/f2b666194f797f206da637da3015bd50a223d156))

test/types/wire.ts holds one golden per wire shape (chat completion and chunks, errors, model list, Responses object and events, legacy completions, Anthropic message, events and error, Gemini response and chunks), generated from the real encoders by test/types/generate.ts. Each golden satisfies Wire<SdkType> (every field we send exists in openai, @anthropic-ai/sdk or @google/genai with a compatible type) and is passed to exact<SdkType> (required fields we omit). Known gaps carry a @ts-expect-error naming them, so closing one fails the type check until the directive is removed. test/unit/wire.test.ts checks the encoders still produce the goldens. Types only: the SDKs are imported with import type.

Fixes #132

**test: add fast-check properties for every decoder and the schema converter** ([`eaeeb3a`](https://github.com/jjjermiah/opencode-plugboard/commit/eaeeb3a35cbf067aba1b56610bb767967362f351))

Each decoder (Chat Completions, Responses, Anthropic Messages, legacy completions, Gemini) gets two properties: any value (JSON or not) decodes to a 400 invalid_request or a well-formed, serializable request, never a throw; and so does a request-shaped body whose fields are usually valid and sometimes wrong, which reaches the deeper branches (it must decode successfully at least 1% of the time, or the arbitrary is not doing its job). The schema converter never throws, emits lowercase JSON Schema types and keeps every property. Checked: dropping the isRecord guard in the chat decoder's textOf is caught on every run.

Fixes #130

**test: add the client compatibility matrix layer (first slice)** ([`4af4cbb`](https://github.com/jjjermiah/opencode-plugboard/commit/4af4cbb1472f7f517926a03acca2354cb60dc017))

test/compat runs the official SDKs (openai for chat, responses and legacy completions; @anthropic-ai/sdk; @google/genai; the AI SDK with its OpenAI chat and responses, Anthropic and Google providers) through one scenario set (text, stream, tool round trip, parallel tools, image, structured output, errors, usage) against a real plugboard route backed by a scripted model. A case the endpoint cannot have is n/a; a known incompatibility is a gap (test.failing) with its reason. .github/scripts/compat-matrix.ts renders the outcomes for the Actions summary and generates docs/compatibility.md.

Result: 67 pass, 1 gap (Anthropic SDK output_config.format), 4 n/a. Live mode against real providers is #99.

Refs #101

**test(policy): cover the apps option, scope enforcement and the policy header** ([`7ed1ab4`](https://github.com/jjjermiah/opencode-plugboard/commit/7ed1ab4be9b84a932589900212580f86c7fd4f16))

Tests for per-app policy at each layer, using the existing fakes. test/unit/apps.test.ts covers parsing (keys and apps.key merge, every rejection, defaults, the keyless default app), the model scope on lists and fallbacks, `checkAppModel` and the header writer. test/session/policy.test.ts drives the real session caller and the context hook: 404 outside the scope with no session created, alias entry versus pattern entry, tools stripped before the session is built, the app's `maxTools`, and prepend, append and replace for the system prompt. test/http/policy.test.ts checks `x-plugboard-policy` on chat (JSON, SSE, n = 2), legacy completions, Responses, Messages and Gemini, the model lists of `/v1` and `/v1beta` per key, and the real caller behind the real route.

`FakeModelCaller` gets a `{ policy: notes }` step that calls `context.onPolicy`, and the parseOptions defaults test now expects `apps: {}`.

#### Docs

**docs(tests): document the new test layers, gates and package rule** ([`f3952f4`](https://github.com/jjjermiah/opencode-plugboard/commit/f3952f440cdc722dd535a0719178ac6c7464a4bd))

test/README.md gains the compat and types layers, how the property tests, SDK wire-type goldens and client matrix work and how to extend them, and how to raise the .ci floors. AGENTS.md replaces "no other framework or test dependency" with the owner's rule (prefer popular, exact-pinned packages to hand-rolled test code) and lists the new CI gates. CONTRIBUTING.md and STRUCTURE.md point at the new directories, .ci/ and docs/compatibility.md.

Refs #101
Refs #110

**docs(changelog): notes for per-app policy and the compat matrix** ([`6cf97f8`](https://github.com/jjjermiah/opencode-plugboard/commit/6cf97f85d28e363a262e6eee1fd70d006034d650))

Curated [Unreleased] entries for the apps option (#78, #51) and for the test work that landed with it: the client compatibility matrix (#101), SDK wire type checks (#132), decoder property tests (#130) and the test-count and coverage floors (#110, #100). Pinned install examples bumped to 0.13.0.

#### CI and tooling

**ci: gate test counts per layer and coverage with ratcheting floors** ([`504be7d`](https://github.com/jjjermiah/opencode-plugboard/commit/504be7d85437df245a6937784bc18d4fcefb247a))

One extra test run in the package job writes JUnit and lcov, and .github/scripts/test-gates.ts checks them against floors in .ci/:

- .ci/test-count-floors.json: tests that ran per layer (test/unit, test/http, test/session, test/runtime, test/compat). Deleting or skipping tests now fails CI instead of passing quietly. Skipped and todo tests do not count.
- .ci/coverage-floor.json: line and function coverage of index.ts and src/ (test helpers are excluded in bunfig.toml). Today 97.5% lines, 91.1% functions; stable to 0.1% over ten runs despite the random property tests.

Floors only go up: --ratchet raises them to the current values and never lowers them, so a PR that adds tests commits the new floor with them. The job summary shows a per-layer count table and per-area coverage (src/session, src/openai, ...), with rows above their floor marked "raise".

JUnit is read with fast-xml-parser and lcov with lcov-parse (with @types/lcov-parse), the widely used parsers, instead of hand-rolled ones. A separate step re-runs the suite (about 2 s) rather than changing the existing Test step, which another lane may be editing.

Checked: raising the http floor by one and the line floor by 0.1 each exit 1 with a named failure; the real floors pass.

Fixes #110
Fixes #100

**ci: render the client compatibility matrix in the job summary** ([`0c6a334`](https://github.com/jjjermiah/opencode-plugboard/commit/0c6a334b4b631e4a3877c50fa5ddcde8c14a1a2f))

The package job runs test/compat with PLUGBOARD_COMPAT_RESULTS set, renders the client x scenario x endpoint table into the job summary with .github/scripts/compat-matrix.ts, and regenerates docs/compatibility.md, failing when the committed file is stale so the published matrix always matches what CI proved. Only a new step; existing steps are unchanged.

Refs #101

</details>
<!-- commit-detail:end -->

## [0.12.0] - 2026-10-11: Plan B Built In

**Full diff:** [v0.11.0...v0.12.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.11.0...v0.12.0)

### Added

- **Model fallback chains** ([#53](https://github.com/jjjermiah/opencode-plugboard/issues/53)). One provider having a bad minute used to fail every caller of that alias. Now an alias can be an ordered list:

  ```jsonc
  "aliases": { "fast": ["opencode-go/glm-5.3-flash", "anthropic/claude-haiku-4-5"] }
  ```

  When a call fails before any output reaches the client (rate limit, quota, provider down or timing out, a lost provider sign-in, a failed model run), plugboard quietly retries the next target in a fresh session. Nothing is retried once output has started, so an answer is never stitched together from two models, and client errors (bad request, context too long, content filter) come back as they are. It works on every endpoint: Chat Completions, Responses, Messages, completions and Gemini.

  You always know who answered: the `x-plugboard-model` header (plus `x-plugboard-fallbacks` when retries happened), the response's `model` field, `served=` and `fallbacks=` on the request log line, `plugboard_fallbacks_total` in metrics, and the whole chain on the setup page. Checked live with a dead provider as the first target on all five front-ends.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (8 commits)</summary>

#### Features

**feat(ci): add the commit-level full story to release notes** ([`082147b`](https://github.com/jjjermiah/opencode-plugboard/commit/082147b0ea4ebf64c700e93326ab07685409cc04))

A release used to be only the curated CHANGELOG section. The commit bodies, where the reasoning and validation evidence live, never reached readers. Now every release has two layers: the curated notes on top, and "The full story" generated from the git history below them.

commit-detail.ts collects the commits between the previous tag and this one, drops merge commits (including squashed "Merge w5/x" ones git does not see as merges) and the release commit, and groups the rest by conventional type: Features, Fixes, Security, Performance, Refactors, Tests, Docs, CI and tooling, Dependencies, Other. Each entry is the header, a short-hash link and the full body. Wrapped lines are joined into one line per paragraph, because GitHub renders single newlines as line breaks and a 72 column body would otherwise look ragged. Lists, quotes, tables, code fences and footers such as "Fixes #N" keep their lines.

I used conventional-commits-parser to classify headers instead of regexes. I do not use its body/footer split: it cuts at the first "word: " line, which in prose is not a footer, and rejoining the halves inserted a blank line in the middle of a sentence. The body is the raw text under the header. Old commits are not conventional. "Tests:", "changelog:", "docs + changelog:" and "Security hardening:" are mapped by their first word; everything else is Other rather than guessed.

release-notes.ts prints curated notes, then "## The full story" with one collapsed details block per group, then the Full diff link. It cuts the generated block out of the CHANGELOG section first, using the commit-detail markers, so the story is always rebuilt from git. It fails before anything is published when the previous tag is not in the clone (publish.yml already checks out with fetch-depth 0), and falls back to HEAD for a dry run before the tag exists. A --changelog-detail flag prints the CHANGELOG block for one version.

release.ts is a focused change: it appends that block, collapsed in one details element, to the new section, and the release commit is now "chore(release): X.Y.Z" with the title in the body, so it passes commitlint by the ignore rule. The tag message is unchanged.

Rejected: writing the story into the GitHub release from the CHANGELOG block alone. The CHANGELOG would then be the only source, and a hand edit there would change the release. Rebuilding from git keeps one source of truth.

Checked: release-notes.ts for 0.9.1, 0.8.0 and 0.4.0 shows the expected groups and bodies; a release.ts --dry-run in a scratch clone (0.11.0 sample) adds the block with the right previous tag and no merge or release commits; typecheck and bun test (799) pass; npm pack and check-pack are unchanged.

#### Docs

**docs: document the commit convention and the two layer release notes** ([`300bfef`](https://github.com/jjjermiah/opencode-plugboard/commit/300bfeff540eb22df1f33455409ca968c92965db))

Contributors and agents need one place that says what a commit looks like and why the body matters, now that bodies are published.

CONTRIBUTING.md gets a Commits section: the format, the type list, suggested scopes, the 150 character floor for feat, fix, perf, refactor and security, a full example body (checked with commitlint, it passes), what is exempt, and how enforcement works locally and in CI. It also records why there is no prepare script, so nobody adds one and breaks the publish job. The pull request checklist gains a commit line.

AGENTS.md gets one rule: every agent commit is a Conventional Commit with a detailed body, checked with "bunx commitlint --edit <file>" before "git commit -F". Agents were the main source of one line commits.

docs/releasing.md explains the two layers (curated notes, generated full story), how commit-detail.ts groups them, the markers that fence the CHANGELOG block, why release-notes.ts rebuilds the story from git instead of reading that block, the new release commit subject, and the preview commands.

Prose follows the repo rule: no em or en dashes.

**docs(changelog): add commit-level detail to every released section** ([`fc16e1e`](https://github.com/jjjermiah/opencode-plugboard/commit/fc16e1ec90a51a6260dbad958fbf2b50c2c52d2d))

Each released section of CHANGELOG.md (0.1.0 to 0.11.0) now ends with a collapsed "Commit-level detail" block, generated by release-notes.ts --changelog-detail from the real history between the previous tag and the tag. The curated text above each block is untouched; the diff is additions only, so the file stays scannable and nothing written by hand changed.

0.2.1 has no block: its only commit is the release commit, so there is nothing to show. Commits from before the convention are listed as they were written, grouped by an obvious prefix or under Other, with no invented types. The block is fenced by commit-detail markers so release-notes.ts can cut it out and rebuild it, and the backfill can be run again safely.

The matching GitHub releases were edited with the full story appended after their existing notes, keeping each body as it was because some had been edited by hand after release (0.1.0, 0.3.0, 0.4.1 and 0.9.0 differ from the CHANGELOG text). The Full diff link and the release names are unchanged. v0.10.0 has no GitHub release (its publish run failed), so it only got the CHANGELOG block and I did not create a release for it.

#### CI and tooling

**ci: enforce Conventional Commits with detailed bodies** ([`db2c03e`](https://github.com/jjjermiah/opencode-plugboard/commit/db2c03ecf13e5ca41187de2ca4cda206c6f25fbe))

Commit history was the raw material for nothing: subjects like "Tests: session layer" and "Add a Gemini generateContent front-end" mixed styles, and half of the bodies were one line. The owner wants every commit to be a Conventional Commit whose body says what changed, why, what was rejected and how it was checked, because those bodies now feed the release notes (next commits).

commitlint.config.mjs extends @commitlint/config-conventional and adds:
- body-empty never, so every commit explains itself.
- a small local rule, body-min-length-for-types, requiring 150 characters of body for feat, fix, perf, refactor and security. commitlint's own body-min-length cannot be limited to some types, so a six line plugin rule is the least code that works.
- a "security" type, since the changelog has a Security group and conventional has no such type.
- a scope-enum at warning level: scopes are suggested (openai, responses, anthropic, gemini, completions, session, runtime, http, config, metrics, discovery, cache, fallback, tests, ci, docs, changelog, deps) but an unknown one does not block a commit.
- an ignore for "chore(release): X.Y.Z", which release.ts writes. Merge commits are already ignored by commitlint's defaults.

Local enforcement is a lefthook commit-msg hook (lefthook.yml). I did not add a "prepare" script that runs "lefthook install": npm runs prepare on "npm publish", the publish job installs no dev dependencies, so the release would fail with "lefthook: not found". Contributors run "bunx lefthook install" once; CONTRIBUTING.md says so.

CI enforcement is a new workflow, commits.yml, kept apart from ci.yml so publish.yml (which reuses ci.yml) does not lint on release and so it does not collide with the CI lane's edits. It lints "from..to" for the push or pull request range and falls back to the cutoff, main at 204bd5f on 2026-10-11, when the base is missing or older, so history is never failed retroactively. commitlint treats an empty range as an error, so the job exits early then.

Checked: commitlint accepts a detailed fix and rejects a missing body, a 10 character fix body, a capitalised subject and a non-conventional header; chore(release) and merge messages pass; actionlint is clean on all workflows; linting HEAD~3..HEAD of the old history fails as intended, which is why the cutoff exists. conventional-commits-parser is added here too because the next commit uses it.

**ci: start the commit lint after Release 0.11.0** ([`873644b`](https://github.com/jjjermiah/opencode-plugboard/commit/873644b3f1afb994167d1c3f85299d70e7b2dfa5))

The commits workflow skips history before a cutoff so old commits are never failed retroactively. I set the cutoff to main's HEAD at the time (204bd5f), but main kept moving while this branch was open: the CI lane landed its commits and 0.11.0 was released. Those commits are not all written to the new convention, and the cutoff is also the fallback range start for a new branch push or a force-push whose "before" sha is gone, so a cutoff at 204bd5f could fail them.

The cutoff is now a54a703, "Release 0.11.0", main's HEAD when this branch was rebased onto it. Every commit after it must follow the convention. CONTRIBUTING.md names the same commit.

Checked: actionlint is clean and "commitlint --from main --to HEAD" passes for the commits on this branch.

#### Other

**Ordered model fallbacks for aliases: retry the next target before the first output** ([`67cbf82`](https://github.com/jjjermiah/opencode-plugboard/commit/67cbf821326a0cddc01df358535fe85be9548d33))

Fixes #53

**Fallbacks: report the served model from every front-end** ([`bd8b7eb`](https://github.com/jjjermiah/opencode-plugboard/commit/bd8b7eb812d820a89ad5e7e7a2d78b051af903db))

x-plugboard-model and x-plugboard-fallbacks headers, served/fallbacks in the request log line, the served model echoed in the body for a single call, and the whole chain in discovery. Fixes #53

**Fallbacks: Gemini route, tests** ([`ecaaabd`](https://github.com/jjjermiah/opencode-plugboard/commit/ecaaabdd0e28252afc63be31e1f66c2de4b5b03e))

Wire onServed into the Gemini route and add unit tests for the chain and the alias list options (config defaults test gains the new fallbacks field).
Fixes #53

</details>
<!-- commit-detail:end -->

## [0.11.0] - 2026-10-11: Safety Nets Everywhere

**Full diff:** [v0.10.0...v0.11.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.10.0...v0.11.0)

0.10.0 was tagged but never reached npm: the new test suite failed in CI on Linux and the release gate refused to publish. That's the gate working. This release carries everything 0.10.0 had, plus the fix and a lot more hardening.

### Added

- **Release safety nets** ([#109](https://github.com/jjjermiah/opencode-plugboard/issues/109), [#112](https://github.com/jjjermiah/opencode-plugboard/issues/112), [#113](https://github.com/jjjermiah/opencode-plugboard/issues/113), [#117](https://github.com/jjjermiah/opencode-plugboard/issues/117)). Every release now installs the packed tarball into a throwaway project and loads it the way OpenCode does, proving setup returns synchronously and the host packages resolve to one copy. CI tests against every published OpenCode host version in the supported range, a weekly job proposes host bumps, a nightly job catches dependency drift, and `bun run release --push` follows the publish to the end and waits until npm actually serves the new version.
- **A map of the code** ([#119](https://github.com/jjjermiah/opencode-plugboard/issues/119)). `STRUCTURE.md` says where everything lives and where new code goes, and the architecture doc now opens with 22 numbered invariants, each naming the file that enforces it.

### Changed

- **Battle-tested packages instead of hand-rolled code** ([#120](https://github.com/jjjermiah/opencode-plugboard/issues/120)). Plugboard now depends on `ipaddr.js` for the remote-image address guard ([#121](https://github.com/jjjermiah/opencode-plugboard/issues/121)), `escape-html` for the setup page ([#127](https://github.com/jjjermiah/opencode-plugboard/issues/127)) and `safe-stable-stringify` for option fingerprints ([#128](https://github.com/jjjermiah/opencode-plugboard/issues/128)). All three are MIT, tiny, dependency-free and have no install scripts, which matters because OpenCode installs plugins with scripts disabled. The address guard also refuses a few more reserved ranges than before; `remoteImages.allow` still overrides.
- **Keys are compared as SHA-256 digests with `crypto.timingSafeEqual`** ([#122](https://github.com/jjjermiah/opencode-plugboard/issues/122)), so timing no longer depends on the length of a wrong key.
- One shared abort helper replaces four copies ([#133](https://github.com/jjjermiah/opencode-plugboard/issues/133)). Internal runtime version 7: restart OpenCode after upgrading.

### Fixed

- **Remote images try every resolved address** ([#134](https://github.com/jjjermiah/opencode-plugboard/issues/134)). A host that resolves to `::1` and `127.0.0.1` with the image server on only one of them used to fail; plugboard now tries each checked address in order. Found by the test suite.
- A transport test assumed macOS socket buffer sizes and failed on Linux; it now uses a stub that models exactly the full-buffer state it tests.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (11 commits)</summary>

#### Tests

**test(http): make the sseWriter backpressure test independent of OS socket buffers** ([`7c57296`](https://github.com/jjjermiah/opencode-plugboard/commit/7c57296d016589fd817abfe1a4a5acdf304c8560))

The v0.10.0 Publish run failed in CI on this one test: "drained() waits while the socket buffer is full" expected "pending" but saw "drained". The test wrote 64 MB into a real loopback socket with a paused client and assumed the buffer stayed full. On macOS it does; on Linux (CI, and reproduced locally in an oven/bun:1.4.2 container, 5 of 5 runs failing) loopback autotuning absorbs the data and Bun keeps reading despite pause(), so `drain` fires within the 5 ms window. The product behaviour is right; the test was measuring the OS.

The test now drives sseWriter with a stub response whose write() always returns false and never emits `drain`, which is exactly the state the test is about. It asserts drained() stays pending, then resolves when the request scope aborts (#32).

Rejected: writing until writableNeedDrain on the real socket. Tried it; the response reports needDrain but Linux still flushes it within milliseconds.

Validation: bun test test/http/transport.test.ts green on macOS (3 runs) and Linux container (3 runs); full suite 799 pass / 0 fail inside the container; typecheck clean.

This is why v0.10.0 never reached npm: the release gate did its job.

#### Docs

**docs: STRUCTURE.md and numbered invariants (I1 to I22)** ([`5b0ea21`](https://github.com/jjjermiah/opencode-plugboard/commit/5b0ea218d011f5bc88ce396c0f5899b9f3a6875f))

Fixes #119

A new contributor had to read the whole architecture doc to learn where code goes and which rules are load-bearing. STRUCTURE.md maps src/ and gives the request flow and a "where to add new code" guide. The architecture doc now opens with 22 numbered invariants, each naming the file that enforces it, so reviews and tests can cite them.

Also fixes stale text in the architecture doc: the front-end headings had two "Third", the dependency paragraph missed Anthropic and legacy completions, the 401 rule omitted the discovery pages and the Messages 405, and the error mapping is per front-end, not OpenAI only.

**docs(changelog): notes for 0.11.0** ([`5df68f4`](https://github.com/jjjermiah/opencode-plugboard/commit/5df68f488ed2b0fa6e52da29838a081333465b3f))

Curated notes for the release that replaces the unpublished 0.10.0: CI safety nets (#109 #112 #113 #117), STRUCTURE.md and invariants (#119), package swaps (#120 #121 #122 #127 #128 #133), and the #134 multi-address fix. Pinned install examples bumped to 0.11.0.

#### CI and tooling

**ci: pack smoke test, OpenCode host matrix, nightly run, weekly host bump, release watch** ([`a69c0f0`](https://github.com/jjjermiah/opencode-plugboard/commit/a69c0f0657f4d0cd6a3eaeb4ef3494f748690a3c))

Four release-safety pieces, all reusing ci.yml so they also gate publishing.

Pack smoke (#109): .github/scripts/smoke-pack.ts runs npm pack, installs the tarball into a throwaway project with peers, and smoke-probe.ts imports the entry the way OpenCode does. It runs the plugin effect against a spy ctx under Effect.runSync(Effect.scoped(...)), so a setup that awaits or blocks fails the job (invariant I1); it checks session.hook, agent.transform and tool.transform were registered and that effect and @opencode/plugin resolve to exactly one copy. Dev-path tests cannot see packaging or dependency-resolution breaks; this can.

Host matrix (#112): host-versions.ts lists stable @opencode/plugin versions inside the peer range (Bun.semver, no new dependency) and ci.yml fans out typecheck + tests over oldest/middle/newest. host-bump.yml runs weekly, bumps the pinned devDependency (and effect) when a newer 2.0.x exists and opens a PR, as a draft when checks fail. Opening PRs needs the repo setting "Allow GitHub Actions to create pull requests".

Nightly (#113): fresh install with the lockfile removed and no cache, then typecheck, tests, pack check and smoke, so dependency drift shows up without blocking pushes.

Release watch (#117): `bun run release --push` now follows the Publish run with `gh run watch --exit-status`, then polls npm (--prefer-online, every 10 s, 5 min cap) until the version is visible and latest/next points at it, and exits with that result. --no-watch skips it; --watch-only X.Y.Z re-checks an existing tag. npm can acknowledge a publish and keep it staged for a minute, which is how 0.9.x briefly looked missing.

Merge note: kept main's unconditional `bun test` step (the suite has landed) over the branch's conditional one.

Validation: actionlint clean; smoke passes locally; host-matrix steps run locally on 2.0.26 and 2.0.25; nightly, host-bump and a publish dry run green on the branch; --watch-only checked against v0.9.1 (success) and v0.10.0 (failed run, exit 1); typecheck clean.

Fixes #109
Fixes #112
Fixes #113
Fixes #117

#### Other

**Restate the dependency rule in AGENTS.md and CONTRIBUTING.md** ([`8c18572`](https://github.com/jjjermiah/opencode-plugboard/commit/8c18572d5838054dec074a23b43ee485da05d634))

Fixes #120

**Compare API keys with timingSafeEqual over SHA-256 digests** ([`6e72b07`](https://github.com/jjjermiah/opencode-plugboard/commit/6e72b0726e538270a886f215ca5e874682bf1faf))

Fixes #122

**Use escape-html in the discovery page** ([`c455271`](https://github.com/jjjermiah/opencode-plugboard/commit/c4552719f931976fcb1bf69bbba430cd7ed1b8ba))

Fixes #127

**Use safe-stable-stringify for the options fingerprint** ([`8f110df`](https://github.com/jjjermiah/opencode-plugboard/commit/8f110dfa37414b52fcede856a7fc92e3e8f0b300))

Bumps the runtime VERSION to 7.

Fixes #128

**Classify SSRF addresses with ipaddr.js and try each checked address** ([`e731a76`](https://github.com/jjjermiah/opencode-plugboard/commit/e731a76529c132538851b2a91299bd342585ad97))

Replaces the hand-rolled IPv4/IPv6 parsing and range tables in src/session/media.ts with ipaddr.js. The resolve-all, pin and generic error behaviour is unchanged, and NAT64/6to4 still defer to the embedded IPv4 address. The connection now tries each checked address in order instead of only the first.

Fixes #121
Fixes #134

**One shared abort helper instead of four** ([`0dc8a2c`](https://github.com/jjjermiah/opencode-plugboard/commit/0dc8a2c6cf9f64afbf33e30cb8924bf3c20cfbb3))

raceAbort in src/abort.ts replaces abortable (runtime.ts), raceAbort (session/caller.ts) and the body of RequestScope.race (http.ts); sleep uses node:timers/promises with a signal. src/openai/fanout.ts keeps its own copy of the race (another lane owns that file).

Fixes #133

**Dependency rule: pin exact versions, types in devDependencies** ([`a75ae24`](https://github.com/jjjermiah/opencode-plugboard/commit/a75ae24bebbdb6bc1662ae6a772369526c580796))

Refs #120

</details>
<!-- commit-detail:end -->

## [0.10.0] - 2026-10-11: Proof, Not Promises

**Full diff:** [v0.9.1...v0.10.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.9.1...v0.10.0)

### Added

- **A test suite worth reading** ([#93](https://github.com/jjjermiah/opencode-plugboard/issues/93)). Until now plugboard was proven by hand: curl runs, throwaway scripts and an acceptance record. Every release needed a person to re-check, and the subtle promises (setup never blocks the host, the first byte decides the status, provider text never reaches callers) lived only in prose. `bun test` now runs **799 tests in under a second**, layered like the code:

  | Layer | Tests | What it proves |
  |---|---|---|
  | unit | 448 | every request and response codec, config, model resolution, sampling drops, metrics text, discovery |
  | http | 146 | real loopback sockets with a scripted model: auth, Host/Origin, limits, streaming, keepalive, deadlines, every endpoint, `n` fan-out |
  | session | 167 | the OpenCode session layer against fake host APIs: lifecycle, stop rules, bounds, error classes, SSRF guard, pruning |
  | runtime | 38 | plugin lifecycle and the freeze-safety rules as executable assertions |

  Tests name the behaviour and the issue they protect, never touch a real OpenCode server or your config, and CI runs them before every release. Each layer was checked by breaking the code on purpose and watching the right test fail.

### Fixed

- **A Responses stream that fails after reasoning now says so.** The new tests caught it: when a model reasoned first and then failed before writing anything, `/v1/responses` sent a 200 stream with no events, so a client couldn't tell failure from an empty answer. It now ends with `response.failed`.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (10 commits)</summary>

#### Tests

**Tests: pure codecs (config, models, sampling, Chat Completions, Responses)** ([`3ef7ad8`](https://github.com/jjjermiah/opencode-plugboard/commit/3ef7ad8ff59ecb8b1231d40ab453cdc7e6aaa6cc))

Fixes #95

**Tests: HTTP layer over loopback with a fake model caller** ([`dcf90f4`](https://github.com/jjjermiah/opencode-plugboard/commit/dcf90f4547a36a95fd6d67cf4f012f58fecfe7b6))

beginRequest takes an optional grace (default unchanged) so the slow-reader cut runs in milliseconds. A test.failing records a bug in the Responses stream: a failure after reasoning commits the stream ends it with no event.

Fixes #96

**Tests: runtime and plugin lifecycle, freeze safety as assertions** ([`0326438`](https://github.com/jjjermiah/opencode-plugboard/commit/03264389e2e44f03185bd190e0bdd0777810fb0b))

Fixes #98

**Tests: follow v0.8.0 (#58 n above maxN is too_many_choices, 12-char request id, new option defaults)** ([`950c288`](https://github.com/jjjermiah/opencode-plugboard/commit/950c2884a536c2dd21e8f5b33002a406907aa6b3))

**Tests: Anthropic Messages, legacy completions, n fan-out, discovery, metrics, status, request id, catalog and logs** ([`ada14b3`](https://github.com/jjjermiah/opencode-plugboard/commit/ada14b35e8c45970fe8fab778d038038860db58e))

Codec units for src/anthropic, src/completions, src/discovery.ts, src/metrics.ts, src/log.ts and the host catalog; loopback HTTP tests for /v1/messages, /v1/completions, n > 1 (merge, interleave, cancellation), GET / and /v1, /v1/status, /metrics and its auth, x-plugboard-request-id, and #91 (401 before route lookup). startRoute takes a fresh metrics registry and a fixed runtime status, so route tests never create the process runtime.

Refs #4 #56 #58 #73 #74 #75 #76 #87 #91

**Tests: session layer (collector, store, caller, context hook, media SSRF, history, prune)** ([`078f32c`](https://github.com/jjjermiah/opencode-plugboard/commit/078f32cf49ede3d019b1a1b9a5087148ec5ee74b))

RequestCollector event mapping, usage, finish reasons (#36), stop-turn rules (#33), queue bounds (#39) and the caller-safe error classes (#88); the store's dispatch, retire and failAll; the session caller's lifecycle against FakeSessionPort (#35, #40); the context hook and seed re-keying by descriptor identity; the #84 address matrix and allowlist with a loopback image server; #89 title and transcript sanitizing; the bounded history sweep.

A test.failing records that remote image fetches try only the first resolved address.

Fixes #97

#### Docs

**docs: CI gates include the tests (releasing, publish workflow, PR template); test README covers the new layers** ([`a43132a`](https://github.com/jjjermiah/opencode-plugboard/commit/a43132a7125556687abd407ef1a7b97bf3f34da4))

Refs #100

**changelog: test suite** ([`9400448`](https://github.com/jjjermiah/opencode-plugboard/commit/94004483ada5a41fbb5d5b35c537fd4af935880a))

#### Other

**Test suite: bun test runner, layout, shared fakes and conventions** ([`bd75ca6`](https://github.com/jjjermiah/opencode-plugboard/commit/bd75ca6f148fd8fc2fc202408ec793abcd357ad8))

bun test with a preload that sandboxes HOME and XDG, a test tsconfig that adds Bun types for test files only, shared fakes under test/support (FakeModelCaller, loopback client, log capture, spy plugin context, runtime helpers, FakeSessionPort, FakeHistoryPort, bus builder) and test/README.md. AGENTS.md and CONTRIBUTING.md replace the no-test-suite rule; CI runs bun test.

Fixes #94
Refs #100

**responses: a failure after reasoning committed the stream ends with response.failed** ([`24b62a0`](https://github.com/jjjermiah/opencode-plugboard/commit/24b62a0381ec05399bded79cc5a9be92714311e3))

When reasoning arrives first, the SSE writer commits the 200 stream (#49). If the model then failed before any output, runResponse emitted nothing and the client got an empty 200 stream, unable to tell a failure from an empty answer. Chat Completions writes an error frame in that case. runResponse now takes a committed() check from the route: when the transport is committed, a failure still opens the response (created, in_progress) and ends it with response.failed. Flips the test.failing that recorded the bug.

</details>
<!-- commit-detail:end -->

## [0.9.1] - 2026-10-11: Gemini, For Real

**Full diff:** [v0.9.0...v0.9.1](https://github.com/jjjermiah/opencode-plugboard/compare/v0.9.0...v0.9.1)

### Fixed

- **The Gemini front-end is actually in the package now.** 0.9.0's notes describe the Gemini API, but a botched merge on my side tagged 0.9.0 without the `src/gemini/` code, so `/v1beta/...` answered 401/404 in that version. This release contains the code exactly as it was live-tested. If you installed 0.9.0 for Gemini, upgrade.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (3 commits)</summary>

#### Docs

**docs: Gemini live test results** ([`290de5a`](https://github.com/jjjermiah/opencode-plugboard/commit/290de5a60e6a8fca6402d5ccf0ba0771945681b2))

Fixes #5

**changelog: 0.9.1 ships the Gemini code** ([`3203c9a`](https://github.com/jjjermiah/opencode-plugboard/commit/3203c9a874c652982f4d5a0727ec75cce81fd19f))

#### Other

**Add a Gemini generateContent front-end** ([`d172952`](https://github.com/jjjermiah/opencode-plugboard/commit/d172952f85dbbbafe9b2fc67a8c747e699e91520))

Serve POST /v1beta/models/{model}:generateContent and :streamGenerateContent (alt=sse), plus GET /v1beta/models and /v1beta/models/{model}, on the neutral seam. Decodes contents, systemInstruction, function declarations, toolConfig, generationConfig and structured output; encodes Gemini responses, SSE chunks and Google-shaped errors. Accepts x-goog-api-key and ?key= on these routes.

Fixes #5

</details>
<!-- commit-detail:end -->

## [0.9.0] - 2026-10-11: Speaks Fluent Gemini

**Full diff:** [v0.8.0...v0.9.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.8.0...v0.9.0)

### Added

- **Gemini API** ([#5](https://github.com/jjjermiah/opencode-plugboard/issues/5)). Plugboard now speaks Google's dialect too: `POST /v1beta/models/{model}:generateContent`, `:streamGenerateContent?alt=sse`, and `GET /v1beta/models[/{model}]`. The Google GenAI SDKs, and the tools built on them, can now run on any OpenCode provider: checked live with `@google/genai` on an OpenCode Go model, Claude Haiku 5.5 and GPT-5.6 Luna, covering text, streaming, parallel function calls with a full round trip, chats, JSON schemas (array schemas included) and thinking levels.

  It decodes `contents` (text, images, `fileData` URLs, function calls and responses), `systemInstruction`, function declarations (Gemini's uppercase OpenAPI-style schemas are converted to JSON Schema), `toolConfig` modes and allowed names, `generationConfig` including structured output and `thinkingConfig` (mapped to a model variant when one fits). Answers come back as `GenerateContentResponse` JSON or SSE chunks with `usageMetadata`, errors use Google's body shape, tokens count in `/metrics`, and every response carries `x-plugboard-request-id`.

  Point a client at the plugboard root as its base URL and pass an alias as the model name (ids with `/` work literally; `#` must be written `%23`). The key works as `x-goog-api-key`, `?key=` or a Bearer token. Hosted tools such as `googleSearch` and `codeExecution`, `candidateCount` above 1 and `cachedContent` get a 400; `countTokens` and embeddings a 404. Gemini function calls carry no id, so responses are paired with calls by name and order.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (3 commits)</summary>

#### Docs

**changelog + readme: Gemini API** ([`ffa40f5`](https://github.com/jjjermiah/opencode-plugboard/commit/ffa40f5f9914fcf0282c1569f50dde8235f73013))

#### Other

**Require a title on every release** ([`2c302f4`](https://github.com/jjjermiah/opencode-plugboard/commit/2c302f41393da31f4cf3244dda7fe98a1e72e63e))

CHANGELOG headings read '## [X.Y.Z] - date: Title'. release.ts needs --title (2 to 5 words, max 40 chars), the publish workflow fails without a title and names the GitHub release 'vX.Y.Z: Title'.

**Add a Full diff link to every release's notes** ([`6c2956b`](https://github.com/jjjermiah/opencode-plugboard/commit/6c2956b71e62af2c077b61ec47a7e42f6d974753))

release.ts writes it under the new version heading; release-notes.ts moves it to the end of the notes. Backfilled for 0.1.0 to 0.8.0.

</details>
<!-- commit-detail:end -->

## [0.8.0] - 2026-10-11: Many Voices

**Full diff:** [v0.7.0...v0.8.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.7.0...v0.8.0)

### Added

- **Legacy `/v1/completions`** ([#75](https://github.com/jjjermiah/opencode-plugboard/issues/75)). Older scripts and some tools' "completion" mode still POST here. A prompt becomes one user message with no system prompt, a prompt array makes one call per prompt, `suffix` becomes an instruction (best effort; chat models have no insert mode), `echo` works, and so do streaming and `stream_options.include_usage`. `logprobs`, `best_of` above 1 and token-array prompts get a 400.
- **Several answers per request with `n`** ([#58](https://github.com/jjjermiah/opencode-plugboard/issues/58)). Eval and sampling tools ask for `n: 3` and expect three choices. Plugboard now runs one model call per choice, in parallel, each in its own session, and merges them: one `choices` array, summed usage, and in a stream the chunks carry their choice `index` and interleave. If any choice fails, the request fails and the others are cancelled, because a silently short set of samples skews whatever the caller is measuring. Each choice is a full model call, so this is opt-in: set `maxN` (default 1, max 64). Checked live with `n: 3` on Go and a streamed `n: 2` on Claude.

### Changed

- **Breaking:** `n` above the cap now returns 400 `too_many_choices` instead of `unsupported_parameter`.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (2 commits)</summary>

#### Docs

**changelog + readme: completions and n** ([`d481023`](https://github.com/jjjermiah/opencode-plugboard/commit/d4810234793e8d725f8a71dfc0150c630f6f5d3d))

#### Other

**Add legacy /v1/completions and n > 1 by parallel fan-out** ([`c9b217d`](https://github.com/jjjermiah/opencode-plugboard/commit/c9b217d337ff66cfab3858234a165bf0ebc2f875))

Legacy completions: new src/completions front-end (prompt string or string array, suffix as a system instruction, echo, stream, usage; logprobs, best_of > 1 and token prompts are 400).

n > 1: src/openai/fanout.ts runs one ModelCaller call per choice in its own session and merges them (JSON choices and summed usage, SSE chunks interleaved by index, one [DONE]). Any failing choice fails the request and cancels the rest. New option maxN (default 1) caps the calls.

Fixes #75
Fixes #58

</details>
<!-- commit-detail:end -->

## [0.7.0] - 2026-10-11: Claude Code, Any Brain

**Full diff:** [v0.6.0...v0.7.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.6.0...v0.7.0)

### Added

- **Anthropic Messages API: run Claude Code on any model** ([#4](https://github.com/jjjermiah/opencode-plugboard/issues/4)). `POST /v1/messages` now sits beside Chat Completions and Responses, so the Anthropic SDKs, Claude Code and everything built on them can talk to any provider in your OpenCode server. Checked live with Claude Code itself: it reads files with its own tools while the model behind it is Claude Haiku, GPT-5.6 Luna, Copilot GPT-5.5 or an OpenCode Go model.

  ```sh
  ANTHROPIC_BASE_URL=http://127.0.0.1:4010 ANTHROPIC_AUTH_TOKEN=<plugboard key> \
  ANTHROPIC_MODEL=openai/gpt-5.6-luna#low ANTHROPIC_DEFAULT_HAIKU_MODEL=fast claude
  ```

  It takes `system`, text, image, document, `tool_use` and `tool_result` blocks, custom tools, `tool_choice`, sampling, `stop_sequences` and `thinking` (mapped to a model variant when one fits; reasoning comes back as thinking blocks), and streams Anthropic's event sequence. Keys work as `x-api-key` or `Authorization: Bearer`, and errors use Anthropic's body shape. Server tools, `mcp_servers` and `output_config.format` get a 400, `count_tokens` a 404, and a stop sequence is reported as `end_turn` because the backend doesn't say which one fired.

  One deliberate leniency: Claude Code sends a `system`-role message when it doesn't recognise the model id, which Anthropic's own API would reject. Plugboard folds it into the system prompt, because that is exactly the case this endpoint exists for.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (2 commits)</summary>

#### Other

**Add an Anthropic Messages front-end (POST /v1/messages)** ([`53647ba`](https://github.com/jjjermiah/opencode-plugboard/commit/53647baaa9bbd60e03152028e5a1216c20771c0b))

Decodes system, content blocks, custom tools, tool_choice, sampling and thinking into a PlugRequest and encodes PlugEvents as a message object or the Anthropic SSE sequence, with Anthropic-shaped errors and x-api-key auth. count_tokens answers a clear 404. src/openai/route.ts only dispatches.

Fixes #4

**anthropic: lift system-role messages into the system prompt (Claude Code on non-Claude models); docs + changelog** ([`5c16b70`](https://github.com/jjjermiah/opencode-plugboard/commit/5c16b70dc3a407c402be05d81b83989fd01c90fa))

</details>
<!-- commit-detail:end -->

## [0.6.0] - 2026-10-11: Locked Doors

**Full diff:** [v0.5.0...v0.6.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.5.0...v0.6.0)

This release closes most of the findings from a hostile read of the code: what would make a careful person refuse to install it.

### Security

- **`remoteImages` can't reach your own network any more** ([#84](https://github.com/jjjermiah/opencode-plugboard/issues/84)). The image host is resolved first and loopback, private, link-local, CGNAT, unique-local, multicast and reserved addresses are refused, including IPv4 hidden inside IPv6. The address that was checked is the one plugboard connects to, so DNS rebinding doesn't help. Every fetch failure returns the same generic error, so plugboard can't be used as a scanner. Need an internal image host? `remoteImages: { allow: ["images.internal", "10.1.0.0/16"] }`.
- **Provider error text stays on the server** ([#88](https://github.com/jjjermiah/opencode-plugboard/issues/88)). Provider errors can carry endpoints, account and org ids. Callers now get a stable code and a fixed message (`rate_limited`, `quota_exceeded`, `context_length_exceeded`, `provider_auth_failed`, `content_filter`, `provider_timeout`, `provider_unavailable`, `provider_rejected_request`, `model_run_failed`); the raw text goes to the log as `model.failed`.
- **Session titles can't carry terminal escapes** ([#89](https://github.com/jjjermiah/opencode-plugboard/issues/89)). Control and bidi-override characters are stripped from titles and stored transcripts, so an API caller can't paint your TUI.
- **Authentication comes before route lookup** ([#91](https://github.com/jjjermiah/opencode-plugboard/issues/91)). Without a valid key every path answers 401, so the API surface can't be mapped. `/healthz` and the setup pages stay open.

### Fixed

- **A stolen port is loud** ([#87](https://github.com/jjjermiah/opencode-plugboard/issues/87)). If another process holds plugboard's port, that is now an error in the OpenCode log on bind, on every plugin load, and every 5 minutes, and plugboard retries every 15 seconds so it takes the port back as soon as it's free. Before, it stayed quietly inert while clients talked to whoever had the port.
- Key revocation was checked live ([#90](https://github.com/jjjermiah/opencode-plugboard/issues/90)): removing a key from the config takes effect on OpenCode's next config reload, which happens when the file changes.

### Changed

- **Breaking:** unknown paths now return 401 instead of 404 without a valid key.
- Internal runtime version 6. Restart OpenCode after upgrading.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (3 commits)</summary>

#### Security

**Security hardening: remote image SSRF, error text, titles, auth order, lost port** ([`b3018f1`](https://github.com/jjjermiah/opencode-plugboard/commit/b3018f10812c1078dc937f0598b2422957546548))

Remote image fetches resolve the host, refuse non-public addresses unless `remoteImages.allow` names them, and connect to the checked address. Provider error text goes to the log only; callers get stable codes. Session titles and transcript headers lose control and bidi characters. Authentication runs before route existence. A failed bind logs at error level, retries and is repeated per generation. Runtime VERSION is 5.

Fixes #84
Fixes #88
Fixes #89
Fixes #91
Fixes #87
Refs #90

#### Docs

**docs: compare against standalone gateways only** ([`896e9f5`](https://github.com/jjjermiah/opencode-plugboard/commit/896e9f5fdae7020290f2d219278bb6945417df53))

**changelog + docs: security release** ([`afb6310`](https://github.com/jjjermiah/opencode-plugboard/commit/afb6310ef79132e9560f51cef78ec5914b88d0fd))

</details>
<!-- commit-detail:end -->

## [0.5.0] - 2026-10-11: Lights On

**Full diff:** [v0.4.1...v0.5.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.4.1...v0.5.0)

### Added

- **A setup page at `GET /` and `GET /v1`** ([#73](https://github.com/jjjermiah/opencode-plugboard/issues/73)). Point a browser at plugboard and it tells you what it is serving: the listen address, the endpoints, a curl example, and a paste-ready `models` suggestion built from what your OpenCode server actually offers. An empty `models` list used to mean a 403 on every call with no clue why; now the page says so. With `keys` set, strangers only see the address and endpoints, and a valid key sees its own app and the allowlist, never other apps or any key.
- **Prices and limits in `/v1/models`** ([#74](https://github.com/jjjermiah/opencode-plugboard/issues/74)). Each entry now carries the model's context and output limits, input and output modalities, cost per million tokens (with context tiers), status, family and release date, straight from OpenCode's catalog. UIs can show price and limits instead of guessing.
- **Prometheus metrics and a status endpoint** ([#56](https://github.com/jjjermiah/opencode-plugboard/issues/56)). Opt in with `metrics: true` and scrape `GET /metrics`: requests and durations by app and route, in-flight requests, tokens by kind (input, cache read and write, output, reasoning), dropped sampling params, history sweeps and event pump health. `GET /v1/status` answers "is it healthy and what is it doing" in one call. `/healthz` stays a cheap liveness check.
- **JSON logs and a request id** ([#76](https://github.com/jjjermiah/opencode-plugboard/issues/76)). `logFormat: "json"` writes one JSON object per line for log pipelines. Every response carries `x-plugboard-request-id`, and the same id is on every log line written while that request runs, so a client error can be matched to the server's side in one search.

### Changed

- Internal runtime version 5. Restart OpenCode after upgrading.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (3 commits)</summary>

#### Docs

**docs + changelog: setup page, metrics, catalog metadata, JSON logs** ([`f5ec7bd`](https://github.com/jjjermiah/opencode-plugboard/commit/f5ec7bdb97aa544d30d478a94aef2fcd7b4d7305))

#### Other

**package: description and keywords cover the Responses API** ([`643077a`](https://github.com/jjjermiah/opencode-plugboard/commit/643077acb5d7d1737888bbb712ab7505df73d1ce))

**Observability and discovery: JSON logs + request id, /metrics + /v1/status, catalog metadata in /v1/models, GET / and /v1** ([`2211fe5`](https://github.com/jjjermiah/opencode-plugboard/commit/2211fe53ac6b5537d6a5a1e75d6dcf2d51d19ae1))

Fixes #76
Fixes #56
Fixes #74
Fixes #73

</details>
<!-- commit-detail:end -->

## [0.4.1] - 2026-10-11: First Impressions

**Full diff:** [v0.4.0...v0.4.1](https://github.com/jjjermiah/opencode-plugboard/compare/v0.4.0...v0.4.1)

### Changed

- **A README you can try in a minute** ([#62](https://github.com/jjjermiah/opencode-plugboard/issues/62), [#66](https://github.com/jjjermiah/opencode-plugboard/issues/66)). The top of the page is now a one-line pitch, a diagram, a pinned install, the warm-up call and a curl that prints `pong`. A "What this is not" section says plainly that plugboard is V2 only, which API formats it serves, and how it differs from a standalone gateway such as LiteLLM, which needs its own provider keys. The long reference sections moved to `docs/configuration.md`, `docs/history.md` and `docs/warm-up.md`; the README went from 231 to 119 lines.
- **Pin the version you install** ([#83](https://github.com/jjjermiah/opencode-plugboard/issues/83)). A bare `"opencode-plugboard"` makes OpenCode track `latest`, and a global plugin runs inside OpenCode in every project, next to your provider logins. The docs now recommend `opencode-plugboard@<version>` and say why.
- Release and CI scripts moved to `.github/scripts/` ([#92](https://github.com/jjjermiah/opencode-plugboard/issues/92)). `bun run release` works as before.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (3 commits)</summary>

#### Docs

**docs: fix stale Responses, concurrency and history links after the README split** ([`f86ba36`](https://github.com/jjjermiah/opencode-plugboard/commit/f86ba36616c9f99f6277e02dec71ff5bb0a5c9fd))

**docs: pin 0.4.1** ([`84a6e86`](https://github.com/jjjermiah/opencode-plugboard/commit/84a6e8614de21ea1b97327a8984385ad4cb07868))

#### Other

**README first screen, pinned install, honest comparison; scripts under .github** ([`398b7d2`](https://github.com/jjjermiah/opencode-plugboard/commit/398b7d25df6e48ad3080d315d05c14f7277cf073))

The README now opens with a one-line pitch, a diagram, a pinned install, the warm-up call and a curl that prints pong. Options, models, errors, warm-up units and history moved to docs/ pages. A "What this is not" section compares plugboard with opencode-llm-proxy and LiteLLM. The install recommends pinning and states the global-plugin trust boundary. The release and CI scripts moved to .github/scripts with every reference updated.

Fixes #62
Fixes #66
Fixes #83
Fixes #92

</details>
<!-- commit-detail:end -->

## [0.4.0] - 2026-10-11: No Awkward Silences

**Full diff:** [v0.3.0...v0.4.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.3.0...v0.4.0)

### Fixed

- **Streams start right away** ([#49](https://github.com/jjjermiah/opencode-plugboard/issues/49)). A reasoning model could think for over a minute before saying anything, and plugboard sent nothing at all until then, not even headers, so clients with a header timeout gave up. Now the 200 and SSE headers go out at the first model event (reasoning counts), followed by a `: keepalive` comment after every 15 seconds of silence, including long pauses while a tool call's arguments are generated. A failure before that first event is still a real HTTP error; after it, it's an SSE error frame. The same applies to `/v1/responses`.
- **`json_object` answers come back as plain JSON** ([#50](https://github.com/jjjermiah/opencode-plugboard/issues/50)). Claude sometimes wrapped them in a markdown code fence, which broke strict parsers. If the whole answer is one fence and the inside parses as JSON, you get the inside. A fenced answer in a stream arrives as one chunk; unfenced answers stream as before.

### Changed

- **Sampling parameters a model rejects are dropped, not fatal** ([#30](https://github.com/jjjermiah/opencode-plugboard/issues/30)). Apps like n8n and Open WebUI let users set `temperature`, `top_p` and the penalties, and several models refuse some of them with a 400: older Claude won't take `temperature` and `top_p` together, newer Claude and the GPT-5/6 family refuse them outright, and two OpenCode Go models only accept fixed values. Plugboard now drops what the target model is known to reject and tells you in the `x-plugboard-dropped-params` response header and the request log line, so nothing changes silently. The table comes from probing every model on a live server, not from docs. A model plugboard doesn't know still gets everything as sent. Set `dropUnsupportedParams: false` to turn this off.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (3 commits)</summary>

#### Docs

**changelog, readme, architecture: keepalive, json_object fences, dropped sampling params** ([`4e9695d`](https://github.com/jjjermiah/opencode-plugboard/commit/4e9695dcf90312932ac60c6992d2a5d116e7844b))

#### Other

**Keep streams alive while reasoning, unfence json_object, drop rejected sampling params** ([`a4d059b`](https://github.com/jjjermiah/opencode-plugboard/commit/a4d059b0d70fb2b6a02b3688bd1f3c4ac28b16df))

Fixes #49: a stream commits 200 and the SSE headers at the first model event that is not terminal (reasoning counts) and sends a `: keepalive` comment after 15 s idle until the stream ends. Failures before that keep their HTTP status; later ones are SSE error frames.

Fixes #50: in json_object mode, a single code fence around text that parses as JSON is stripped, in JSON bodies and streams. Fence-led streamed text is held and sent as one chunk; other text streams as before.

Fixes #30: sampling parameters a model is known to reject are dropped and listed in `x-plugboard-dropped-params`. Option `dropUnsupportedParams` (default true) turns it off.

**Publish workflow: dry run on an already-published version only packs** ([`866b478`](https://github.com/jjjermiah/opencode-plugboard/commit/866b478ce3cfa191f6f8771a303435c128c9c040))

</details>
<!-- commit-detail:end -->

## [0.3.0] - 2026-10-11: Two Front Doors

**Full diff:** [v0.2.1...v0.3.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.2.1...v0.3.0)

### Added

- **Responses API** ([#1](https://github.com/jjjermiah/opencode-plugboard/issues/1)). `POST /v1/responses` now works next to Chat Completions. This was the most common first failure: the Vercel AI SDK's default `openai(id)`, `@langchain/openai` for `gpt-5.6*` ids and n8n's default Chat Model node all call it, and used to get a 404.

  It's a second front-end on the same model caller, so the neutral contract and the Chat Completions path didn't change. Supported: `input` as a string or items (messages, images, files, `function_call` and `function_call_output`), `instructions`, function tools, `tool_choice`, `text.format` (`json_schema`, `json_object`), `max_output_tokens`, `temperature`, `top_p`, `reasoning.effort` (picks the model variant of that name) and `stream` with the standard event sequence. Checked live on Go, Claude, ChatGPT and Copilot, and with the Vercel AI SDK default (17 of 17) and LangChain JS.

  It's stateless on purpose. `previous_response_id`, `conversation`, `item_reference`, `background` and hosted tools like `web_search` return 400 `unsupported_parameter` instead of pretending. With the Vercel AI SDK, set `providerOptions.openai.store = false` for multi-turn chats, because its default replays earlier turns as `item_reference`. Details in `docs/responses.md`.
- **History limits** ([#8](https://github.com/jjjermiah/opencode-plugboard/issues/8)). Set `history: { maxSessions, maxAgeDays }` and old request sessions get deleted. `maxSessions` keeps the newest N per app, `maxAgeDays` drops anything older; with both, the stricter wins. Leave it unset and history is kept forever, as before.

  OpenCode gives plugins no way to list sessions, so while a limit is set plugboard writes a tiny index entry to OpenCode's plugin storage for every session it creates, and sweeps from that. With no limit set it writes nothing, so the index can't grow forever ([#85](https://github.com/jjjermiah/opencode-plugboard/issues/85)). Sweeps run on requests (never in setup, at most every 10 minutes), delete at most 200 sessions per pass, and never touch a session that is still running. Sessions created before you set a limit aren't in the index, so they are never pruned; clean those up with `compat/tools/sessions.py`.
- **CI** ([#64](https://github.com/jjjermiah/opencode-plugboard/issues/64)): typecheck, a check that the npm package holds exactly the files `package.json` names, and the compat kit's own type and syntax checks. Actions are pinned by commit SHA.
- **Publishing from CI with provenance** ([#63](https://github.com/jjjermiah/opencode-plugboard/issues/63)). A workflow on `v*` tags runs the CI checks, publishes through npm trusted publishing (no npm token stored anywhere) and creates the GitHub release from this file. Provenance attestations are added once the repository is public; npm can't generate them for private repositories. A manual dry run (`gh workflow run publish.yml -f dry_run=true`) proves the pipeline without releasing.
- **`bun run release <version>`** ([#70](https://github.com/jjjermiah/opencode-plugboard/issues/70)) cuts a release from this file: it moves `[Unreleased]` under the new version, fixes the compare links, bumps `package.json`, commits and tags. See `docs/releasing.md`.
- **SECURITY.md** with a private reporting route and an honest threat model ([#65](https://github.com/jjjermiah/opencode-plugboard/issues/65)), **CONTRIBUTING.md** plus issue and pull request templates ([#68](https://github.com/jjjermiah/opencode-plugboard/issues/68)), and weekly **Dependabot** updates that group `@opencode/*` and `effect`, so a host bump arrives as one reviewable pull request ([#67](https://github.com/jjjermiah/opencode-plugboard/issues/67)).

### Changed

- Internal runtime version 4. Restart OpenCode after upgrading; a hot reload over an older plugboard stays inert and says so in the log.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (9 commits)</summary>

#### Docs

**changelog: note 0.2.1 as the first npm release** ([`6b63251`](https://github.com/jjjermiah/opencode-plugboard/commit/6b63251ee0d76bd4fc29ce0d6a4ab1d918a5ce7d))

**readme: status line reflects the npm release; link the acceptance record** ([`0322246`](https://github.com/jjjermiah/opencode-plugboard/commit/0322246acb6e32761d1a44e389d20a848e555e84))

**changelog: Unreleased entries for history limits and project infrastructure** ([`470c68e`](https://github.com/jjjermiah/opencode-plugboard/commit/470c68ecd0fcea0d6a5f09a0fe4adec770a77996))

**docs: history index only while a limit is set** ([`1ca44a6`](https://github.com/jjjermiah/opencode-plugboard/commit/1ca44a6b8eee4a6279a409750d5aba8b04b72640))

**readme + changelog: Responses API and history limits** ([`7bd83d9`](https://github.com/jjjermiah/opencode-plugboard/commit/7bd83d9e8e8ed2b6bc133c0ac12dec5ea3a9f9db))

#### Other

**Prune old request history** ([`4851caa`](https://github.com/jjjermiah/opencode-plugboard/commit/4851caa27ade0668166208bbbe136273ab4a60d8))

Index each request session in the host's plugin storage and sweep past history.maxSessions / history.maxAgeDays, skipping sessions whose request guard is active. Unset keeps history forever.

Fixes #8

**Add CI, publish workflow, release script and community files** ([`a6a134f`](https://github.com/jjjermiah/opencode-plugboard/commit/a6a134f826b66523b1adb1e3cd2190e2dd185db4))

CI runs the typecheck, a pack check derived from package.json files, the compat/js typecheck, py_compile and bash -n. The publish workflow uses npm trusted publishing on v* tags and refuses while the repo is private. scripts/release.ts cuts a release from CHANGELOG.md.

Fixes #63
Fixes #64
Fixes #65
Fixes #67
Fixes #68
Fixes #70

**Add POST /v1/responses front-end** ([`b8fa40a`](https://github.com/jjjermiah/opencode-plugboard/commit/b8fa40aa0ed1c9cbfbf22cb116be52b574073650))

Parse Responses input items, instructions, function tools, text.format and reasoning.effort into the neutral PlugRequest; encode PlugEvents as a response object or the named SSE events. Stateless: previous_response_id, conversation, item_reference, background and hosted tools return 400 unsupported_parameter. Core contract and Chat Completions unchanged.

Fixes #1

**Publish workflow: private-repo trusted publishing, shared CI gates, dry run** ([`e3fd3ab`](https://github.com/jjjermiah/opencode-plugboard/commit/e3fd3aba4734d137bfcb30d166bcebb5f9316d1a))

</details>
<!-- commit-detail:end -->

## [0.2.1] - 2026-10-11: Out in the Open

**Full diff:** [v0.2.0...v0.2.1](https://github.com/jjjermiah/opencode-plugboard/compare/v0.2.0...v0.2.1)

First release on npm. No code changes since 0.2.0.

- Published as [`opencode-plugboard`](https://www.npmjs.com/package/opencode-plugboard), so the `package` entry in your OpenCode config can be the name instead of a local path.
- The GitHub repository went public, then back to private the same day while the project is polished. The npm package stays published.

## [0.2.0] - 2026-10-11: Second Opinion

**Full diff:** [v0.1.0...v0.2.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.1.0...v0.2.0)

A fresh reviewer read 0.1.0 cold, as a stranger would on first public read, and found eighteen things worth fixing. None of them needed a redesign. Most were places where the code promised something it didn't quite do, so this release is about making those promises true. Nothing in the public API was removed. A few malformed requests that 0.1.0 quietly repaired now get a 400, which is why this is a minor bump and not a patch.

### Highlights

- **Tools and structured output work together.** Ask for `json_schema` and offer tools, and the model can call your tools first and give the structured answer after. 0.1.0 silently dropped your tools in that case ([#34](https://github.com/jjjermiah/opencode-plugboard/issues/34)).
- **Plugin setup never touches the disk.** The freeze rules said setup only registers and returns, but 0.1.0 still resolved real paths there. A hung network mount could have stalled the whole server. Ownership is now worked out from request handling ([#31](https://github.com/jjjermiah/opencode-plugboard/issues/31)).
- **No more fail-open requests.** Before creating a session, plugboard now checks that its hook is live in the app directory and boots that directory if needed. If it can't, you get a 503 `backend_unavailable` instead of the model receiving your raw transcript as an ordinary prompt ([#35](https://github.com/jjjermiah/opencode-plugboard/issues/35)).

### Fixed

**Lifecycle**
- The stop decision follows OpenCode's execution, not the HTTP response. A failed step used to leave the provider being called for up to 30 seconds after we had already returned the error ([#33](https://github.com/jjjermiah/opencode-plugboard/issues/33)).
- Aborts are checked before every side effect, and session creation races the request signal, so a deadline during preparation no longer creates a session ([#40](https://github.com/jjjermiah/opencode-plugboard/issues/40)).
- Inputs sent to OpenCode are type-checked with `satisfies` instead of cast, so an OpenCode upgrade that changes their shape fails `bun run typecheck` rather than a live request ([#41](https://github.com/jjjermiah/opencode-plugboard/issues/41)).

**HTTP and streaming**
- A client that stops reading an SSE stream can no longer outlive the deadline. The drain wait is abortable and the socket is cut 2 seconds after the deadline ([#32](https://github.com/jjjermiah/opencode-plugboard/issues/32)).
- The first byte decides the status. A failure before any visible output is a real HTTP error, not a 200 with an error frame, and the request log records `outcome=error` instead of `ok` ([#38](https://github.com/jjjermiah/opencode-plugboard/issues/38)).
- Per-request limits: 10,000 queued events or about 8 MiB (502 `response_overflow`), and 50 MB of images in total (400 `images_too_large`). One greedy request can't hold the process's memory ([#39](https://github.com/jjjermiah/opencode-plugboard/issues/39)).

**Protocol**
- A tool call no longer hides a `length` or `content_filter` finish reason ([#36](https://github.com/jjjermiah/opencode-plugboard/issues/36)).
- A tool or alias named `__proto__` is kept as a real name instead of vanishing ([#37](https://github.com/jjjermiah/opencode-plugboard/issues/37)).

### Changed

- **Stricter validation** ([#42](https://github.com/jjjermiah/opencode-plugboard/issues/42)). Malformed fields are rejected with a 400 that names the field instead of being repaired: non-object tool parameters, a `json_schema` without a schema, bad `n`, out-of-range `temperature`, `top_p`, penalties and token limits, more than 4 `stop` sequences, and a named `tool_choice` together with `json_schema`.
- **Config checks.** Loopback now means exactly `localhost`, `127.0.0.1` or `::1`, the same set the Host check accepts. Two apps can't share a key value.
- The `respond` tool describes itself as the final answer, so a model offered your tools as well knows which call ends the turn.
- The internal runtime version is 3. Restart OpenCode after upgrading; a hot reload over an older plugboard stays inert and says so in the log.

### Docs and compatibility kit

- History is stored in OpenCode's own database, not in the app directories, which only group sessions. Deleting one removes nothing ([#43](https://github.com/jjjermiah/opencode-plugboard/issues/43)).
- README and client pages match the code again ([#44](https://github.com/jjjermiah/opencode-plugboard/issues/44)), and `docs/clients/any-app.md` has a working recipe for reaching plugboard from another machine or a container ([#45](https://github.com/jjjermiah/opencode-plugboard/issues/45)).
- The compat runners exit nonzero when anything fails ([#46](https://github.com/jjjermiah/opencode-plugboard/issues/46)), the Open WebUI script keeps its token private ([#47](https://github.com/jjjermiah/opencode-plugboard/issues/47)), and old results are marked where they've been superseded ([#48](https://github.com/jjjermiah/opencode-plugboard/issues/48)).
- `AGENTS.md` tells coding agents the rules that matter here: the isolated dev server, freeze safety, and what may be imported at runtime.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (8 commits)</summary>

#### Docs

**docs: CHANGELOG for 0.1.0** ([`5d18b06`](https://github.com/jjjermiah/opencode-plugboard/commit/5d18b067725d9ad8b22b264122a24f1c8067c6c2))

**docs, compat: fix stale claims, harden runners, clean results** ([`c922a59`](https://github.com/jjjermiah/opencode-plugboard/commit/c922a59fe639692724825aee091a494350779a64))

History lives in OpenCode's database; the app directory only groups sessions. The README also still said models.retrieve was missing, json_object used the respond tool, and every request needed a key. It now matches the code, uses absolute doc links (the npm package ships only the README) and says tested on 2.0.26 with a 2.0.x peer range. any-app.md gains one recipe for reaching plugboard from another host or container.

Compat runners now aggregate outcomes and exit nonzero on failure (langchain_py s6 no longer prints PASS after catching failures). open-webui.sh uses umask 077, a private mktemp -d, a cleanup trap and PID-based stop instead of pkill. Result files lose agent handoff chatter and gain notes marking superseded conclusions; a release-candidate record template is added.

Fixes #43
Fixes #44
Fixes #45
Fixes #46
Fixes #47
Fixes #48

#### Other

**session: interrupt on execution end, keep length/filter reasons, bound queue and images, abort before side effects, checked host inputs** ([`1884e82`](https://github.com/jjjermiah/opencode-plugboard/commit/1884e8243f83e9200e444ab96fbd38945015022a))

Fixes #33
Fixes #36
Fixes #39
Fixes #40
Fixes #41

**config: loopback means the Host check's set, reject duplicate key values and __proto__ aliases** ([`d5b45e7`](https://github.com/jjjermiah/opencode-plugboard/commit/d5b45e723fdacd3650709f41ab4cc131f8c71b01))

127.0.0.2 counted as loopback but failed the Host check, so a keyless listener there rejected every request. isLoopbackHost is now exactly localhost, 127.0.0.1 and ::1. Two apps with the same key value are an error instead of the last one winning. Maps are built with Object.fromEntries and a __proto__ alias is rejected.

Fixes #42
Refs #37

**Fail closed per app directory; no filesystem in plugin setup** ([`497b1ae`](https://github.com/jjjermiah/opencode-plugboard/commit/497b1ae03c744521f944257b4e6d44b2791785cc))

Setup no longer calls realpathSync. Ownership of a Location is decided asynchronously by ensureBackend (request handling): it canonicalizes the app dir (symlink containment), confirms it, boots the Location with an agent lookup scoped to it when no generation is there, rebuilds transforms of a generation set up earlier, and waits until an accepted generation has its hook installed. A rejected generation or a timeout is 503 backend_unavailable. The hook, agent deny and seed tools are registered for every accepted generation but stay no-ops until the directory is confirmed. The pump now starts lazily, as documented. Seed tool map is built with Object.fromEntries so a tool named __proto__ stays a key; duplicate tool names are reported.

Fixes #31
Fixes #35
Fixes #37

**http: abortable drain, first visible output decides status, caller tools with json_schema, strict request fields** ([`6d06773`](https://github.com/jjjermiah/opencode-plugboard/commit/6d06773afcc250b43b5004814a279af46860703a))

Streams: the SSE drain wait ends on the request scope's abort, and after the deadline a grace timer destroys the socket of a client that stopped reading, so the handler settles and logs. The encoder commits the 200 only when it writes its first frame and returns the terminal outcome; a failure before that (including after suppressed prose or reasoning) is a real HTTP error, and a stream error after it logs outcome=error with the code.

With tools and response_format json_schema, the caller's tools are offered next to `respond` with tool_choice required; a caller tool call returns tool_calls, otherwise `respond` is the answer.

The request decoder rejects invalid tool parameters/description, missing or invalid json_schema, non-integer n, out-of-range numeric fields and more than 4 stop sequences, each with a param path.

Fixes #32
Fixes #34
Fixes #38
Refs #42

**openai: respond tool description marks it as the final answer (matters when caller tools are offered too)** ([`fb1d522`](https://github.com/jjjermiah/opencode-plugboard/commit/fb1d522e16b18725c96608012560504945e07a82))

**Add AGENTS.md for agents working in this repo** ([`77a737f`](https://github.com/jjjermiah/opencode-plugboard/commit/77a737fc561c1e92ba8738e618274da09e1d5f66))

</details>
<!-- commit-detail:end -->

## [0.1.0] - 2026-10-11: First Spark

**Full diff:** [v0.1.0](https://github.com/jjjermiah/opencode-plugboard/tree/v0.1.0)

Not published to npm; 0.2.1 was the first npm release ([#29](https://github.com/jjjermiah/opencode-plugboard/issues/29)).

### Why this exists

You log in to ChatGPT, Claude, Copilot or OpenCode Go once, in OpenCode. Then every other tool you run (a fitness app, a Discord bot, n8n, Open WebUI, a script) wants its own key or its own gateway with its own logins. Those tools all speak the OpenAI API. OpenCode V2 does not.

V2's server API is built for agents: sessions run tools on the server, and the one-shot generate call takes a prompt and returns text. An app that sends a chat plus a tool list and expects tool calls back has nowhere to go. Whatever worked on V1 stopped working when V2 changed the plugin and server APIs. Before writing any code I checked whether anything V2-native existed. Nothing did, and the upstream feature request for it was closed by a bot without a maintainer reply.

So plugboard is a V2 plugin that serves an OpenAI-compatible endpoint from inside your OpenCode server, using the providers and logins you already have. Tool calls go back to the caller. OpenCode never runs your tools.

SparkyFitness was the first real app verified against it. The first spike proved the idea worked. The rest of 0.1.0 is what it took to make that spike safe to leave running.

### Highlights

- `POST /v1/chat/completions` with streaming, tools, images and structured output.
- Works with whatever works in an OpenCode session on your server: ChatGPT, Claude (including through an auth plugin), Copilot, OpenCode Go and API-key providers. Checked on ChatGPT, Claude, Copilot and OpenCode Go.
- Tool calls come back un-executed, in the shape OpenAI clients expect.
- An explicit model allowlist, so nothing is exposed by accident.
- One key per app, with each app's history kept apart from your real projects.
- Eight real clients checked: both OpenAI SDKs, the Vercel AI SDK, LangChain in Python and JS, pydantic-ai, Open WebUI and n8n.

### Added

**Endpoints**
- `POST /v1/chat/completions`. Messages with system, developer, user text and images, assistant `tool_calls` and tool results. Parameters: `tools`, `tool_choice`, `response_format`, `temperature`, `top_p`, `max_tokens`, `max_completion_tokens`, `stop`, `presence_penalty`, `frequency_penalty`, `reasoning_effort`.
- `GET /v1/models`, listing the allowlist intersected with the models enabled on your server, plus your aliases. Ids are de-duplicated. Each entry carries `owned_by` set to the provider and a small `plugboard` object with capabilities and context limit.
- `GET /v1/models/{id}` ([#9](https://github.com/jjjermiah/opencode-plugboard/issues/9)). `client.models.retrieve("fast")` used to fail with a 404, and some UIs call it to validate a configured model. Ids like `openai/gpt-6-luna#low` contain `/` and `#`, and the SDKs percent-encode them, so the router decodes before lookup. Aliases resolve, and a model outside the allowlist gets the same 404 `model_not_found` as the chat route.
- `GET /healthz`.

**Streaming**
- SSE with text deltas, tool calls, finish reason, a final usage chunk when `stream_options.include_usage` is set, and `[DONE]`. Text arrives as the model produces it. A streamed tool call arrives as one delta carrying the whole arguments string.
- A failure after the stream has started arrives as an `error` event followed by `[DONE]`. A failure before it starts is a normal HTTP error.

**Tools go back to the caller**
- Caller tools are offered to the model and returned as `tool_calls`. Tool-result turns work. Nothing of yours is executed by OpenCode.
- Up to `maxTools` tools per request (default 32). A request over the limit gets a 400 `too_many_tools` that names the option.

**Images**
- Image inputs as `data:` URLs.
- Remote image URLs are off by default (`remoteImages`). Turned on, the server fetches them with a 20 MB cap, no redirects and `image/*` only.

**Structured output**
- `response_format` with `json_schema` works through a forced `respond` tool, and its arguments come back as the message content.
- `json_object` uses a short system instruction instead ([#11](https://github.com/jjjermiah/opencode-plugboard/issues/11)). The first version used the same forced tool with an open object schema. On a small model that gave `{}` four times out of four, because the model had nothing to aim at.

**Models**
- An allowlist in the `models` option: `provider/model`, `provider/model#variant`, or `provider/*`. With none configured, `/v1/models` is empty and chat calls get a 403 that names the option.
- Aliases, so a client that mishandles `/` and `#` in ids can use `fast` instead. Every alias target must pass the allowlist.
- Variants. `reasoning_effort` picks a variant when the model name has none and the model has one by that name. An alias can fix an effort level for a client that cannot send one.

**Apps and history**
- One API key per app. The key name is the app name and also its history directory. Names match `[a-z0-9-]+`, and `default` is reserved for keyless loopback use.
- Every request is kept as an OpenCode session holding the full caller transcript (system prompt, messages, images as attachments, tool calls and results) plus the reply. The title is the first user message. Each app has its own directory under `$XDG_DATA_HOME/opencode-plugboard/`, so plugboard's sessions stay out of your real projects' lists.
- An `x-plugboard-session` response header with the OpenCode session id ([#12](https://github.com/jjjermiah/opencode-plugboard/issues/12)). After several clients shared one app with identical prompts in the same seconds, nobody could tell whose sessions were whose, and cleanup had to guess.
- Usage numbers that agree with each other ([#10](https://github.com/jjjermiah/opencode-plugboard/issues/10)). The same prompt had returned `completion_tokens: 3` with `reasoning_tokens: 64` in one run and `completion_tokens: 83` with `reasoning_tokens: 0` in another. Usage is now inclusive: reasoning tokens count inside `completion_tokens` and `total_tokens`, for stream and non-stream alike, as OpenAI reports them.

**Operations**
- A warm-up recipe for always-on servers, as a systemd `ExecStartPost` and a launchd job. See Known limitations for why it is needed.
- A `listen` option (default `127.0.0.1:4010`), `requestTimeoutMs` (default 10 minutes), and `{env:VAR}` expansion for keys.

### How it works

Each request becomes a session in the calling app's directory, run through OpenCode's own request path. That detail is the whole reason for the design. Provider fixes and auth plugins, such as the one that lets Claude Max work, only run inside a session's request pipeline. A plugin that calls a provider directly skips them, and ChatGPT, Copilot and Claude logins break.

So plugboard steers a session instead:

1. A front-end turns the OpenAI request into a format-neutral request. The core checks the key and resolves the model.
2. The session backend creates a session and uses a `context` hook to swap the caller's system prompt, messages and tools in for OpenCode's own. In the spike, a "reply with pong" prompt cost 13 tokens instead of the roughly 10,400 that OpenCode's own prompt and tools add.
3. Caller tools map onto a pool of placeholder tools. A placeholder settles at once with a fixed result, so history shows a completed call.
4. When the model has emitted its tool calls, plugboard interrupts the turn and returns the calls. Without the interrupt, OpenCode's runner would start a second model step after any tool result.
5. The front-end encodes the events as JSON or SSE. The session stays as history.

The model call sits behind one interface, `ModelCaller`, with names that mirror OpenCode's own `@opencode/ai` types. A native backend can replace the session backend later without touching the front-ends. [docs/architecture.md](docs/architecture.md) has the lifetimes, the process-wide state and the rules in detail.

### Design decisions

The ones that shaped the code, with the reasons.

**V2 only.** V1 and V2 differ in plugin API, server API and session model. Supporting both would mean two plugins sharing a README. V2 is where OpenCode is going, and it had nothing.

**A session backend now, a native one later.** The cleaner design is an upstream `ctx.llm.stream` that runs one provider turn through the session hook pipeline with no persistence. I think that is where this should end up, and the seam for it exists ([#3](https://github.com/jjjermiah/opencode-plugboard/issues/3)). But shipping would then wait on maintainers who did not answer the original request, and a plugin that calls the AI layer directly skips the hooks that make ChatGPT, Copilot and Claude work. The session path works on four providers today. It costs session setup per call, writes history that has to be managed, needs the plugin loaded in every directory, and its interrupt can race the runner ([#14](https://github.com/jjjermiah/opencode-plugboard/issues/14)). I took that bill to ship now.

**Its own port, not an OpenCode route.** Plugins cannot register routes on OpenCode's server. The only door is the RPC endpoint, which OpenAI clients cannot call with OpenCode's password and shape. Plugboard opens its own listener (default `127.0.0.1:4010`), once per process, because OpenCode loads a plugin once per project directory.

**Callers never get OpenCode's password.** Reusing it would hand every app full control of the server. Callers use plugboard keys. With no keys configured, only a loopback bind is accepted. Binding elsewhere without keys refuses to start. Once any key exists, every request needs one, loopback included.

**An explicit model allowlist.** The first idea was to list every model with an active credential. Then every model on your account becomes reachable by anything that can reach the port, including expensive ones. You now name what callers may use, or nothing is exposed.

**History is kept, per app.** I wanted to be able to see what each app asked and what the model answered, and deleting sessions after each reply would have thrown that away. The price is that OpenCode loads hooks per directory, so plugboard has to be loaded in the app directories, which means a global install. Everywhere else it is inert: it joins the shared listener and registers no hooks, tools or agent rules, so your real projects behave as before. Pruning is deferred ([#8](https://github.com/jjjermiah/opencode-plugboard/issues/8)), because the plugin session API has no `list` and pruning needs its own index.

**`json_schema` through a forced tool.** It behaves the same on every provider, and it is how OpenCode does structured output itself. The cost is that no provider enforces the schema.

**No OpenCode prompt or tools reach the model.** An endpoint called by a food-logging app should not tell the model it is a coding agent with shell access. The caller's system prompt and tools replace OpenCode's. Permissions on request sessions deny everything except the placeholders, so a step that slips past the interrupt still cannot run a real tool.

**Plain naming.** Early candidates were poetic. They were rejected because new users could not say them or guess what they do. `opencode-plugboard` is plain, readable, and not tied to one API format.

**Other defaults chosen on purpose.** A request gets a 404 `model_not_found` for an unknown or disallowed model. `n` above 1, `logprobs` and `top_logprobs` return 400. `parallel_tool_calls` and `seed` are accepted and ignored. There is no per-app concurrency limit.

### Safety and hardening

**The freeze.** The first spike was registered in a real project on a live OpenCode server and froze every prompt in that project. The plugin's setup effect ended with an inline `Effect.never`. OpenCode runs plugin effects inside activation, and sessions wait for activation to finish, so the location waited forever. I reproduced it later in isolation. That one mistake produced the rules everything else follows:

- Plugboard is developed only against an isolated OpenCode server with its own home directory, never the live one.
- Every change must pass the pong gate first: after the plugin loads, a plain prompt in a throwaway project and in an app directory must still come back with `pong`.
- Setup only registers and returns. It awaits nothing from the session or model APIs.
- Finalizers are synchronous and call nothing on the host.
- Nothing is registered outside plugboard's data root, so in a real project the plugin does nothing but join the listener. The check compares real paths.
- Request work runs on a process-wide runtime owned by the listener, so an unrelated project reloading does not kill a request in flight.

**Web attacks.** An endpoint on localhost is reachable from any web page in your browser. On a loopback bind, requests with a `Host` header that is not `127.0.0.1`, `localhost` or `[::1]` get 403 `invalid_host`, which stops DNS rebinding. Without keys, a request carrying an `Origin` header gets 403 `cross_origin_forbidden`. `POST` bodies must be `application/json`, or the answer is 415.

**Remote images are off by default.** Fetching a URL a caller supplies lets that caller make your server request internal addresses. Callers can always send `data:` URLs. The option exists for people who accept that risk.

**Options are authoritative.** OpenCode loads the plugin once per directory, and each load could carry different options. The first accepted load decides. A load with different options logs once and stays inert, so a project entry cannot serve with weaker auth than the live one. When no generation is live, such as mid-reload, the next one's options are adopted.

**The request guard outlives the response.** The state that makes the context hook rewrite a session is released only when OpenCode reports the execution ended, not when the HTTP response ends. If the host never confirms, a 30 second bound logs `session.cleanup_timeout`, retries the interrupt and releases. Nothing in teardown waits on this.

**Deny-all permissions.** Request sessions are created with `deny *`, then `allow` for the placeholders. A person prompting inside an app directory never sees the placeholders, and a request session never sees a real tool.

**Symlink containment.** Plugboard compares real paths when it decides whether a directory is inside its data root, so a symlink does not make a real project look like an app directory or the reverse.

**Cancellation, deadlines and backpressure.** Each request has one scope that holds both the client disconnect and a single deadline (`requestTimeoutMs`). A disconnect, SSE included, interrupts the request. A slow SSE reader is paced by backpressure instead of growing a buffer. The second review found gaps here, fixed in 0.2.0.

**Validation.** A malformed request URL returns 400 instead of an unhandled rejection. Bad bodies get 400 or 413. Aliases and timeouts are validated on load. Missing placeholders or attachments fail the request with `backend_preparation_failed` instead of silently dropping a tool. Event subscriptions are filtered by session id before anything is buffered, so other projects' sessions are never held.

**What the logs hold.** One line per request: ids and outcomes only, never keys, bodies or URLs.

### Compatibility

Checked on 2026-10-11 by driving each client's own SDK or API against a dev server: one plain chat, a tool round trip, streaming, an image and structured output, on a small fast model, a Claude model and a ChatGPT model. The raw evidence is in `compat/results`. I did not use a browser for Open WebUI, so the results there come from its API.

| Client | Version | Result |
| --- | --- | --- |
| OpenAI Python SDK | `openai` 3.29.0 | pass |
| OpenAI JS SDK | `openai` 7.32.0 | pass |
| Vercel AI SDK | `ai` 7.0.137, `@ai-sdk/openai-compatible` 3.0.67, `@ai-sdk/openai` 4.0.91 | pass with `createOpenAICompatible` or `.chat(id)`. `openai(id)` calls `/v1/responses` |
| LangChain Python | `langchain-openai` 1.7.0 | pass |
| LangChain JS | `@langchain/openai` 1.6.2 | pass except `gpt-5.6*` ids, which force the Responses API |
| pydantic-ai | `pydantic-ai-slim` 2.55.0 | pass with `OpenAIChatModel` |
| Open WebUI | 0.12.0 | pass |
| n8n | 2.42.6 | pass with "Use Responses API" off. Sampling options hit [#30](https://github.com/jjjermiah/opencode-plugboard/issues/30) |

Providers, through the session path: GitHub Copilot, Anthropic (Claude Max through an auth plugin), OpenAI (ChatGPT, with a `#variant`) and OpenCode Go. Each passed plain text, a tool call returned un-executed, a tool-result turn and an image, sixteen checks out of sixteen, at 0.6 to 5.7 seconds each. That run came before the final cross-directory design, so the second review's acceptance record ([#48](https://github.com/jjjermiah/opencode-plugboard/issues/48)) is meant to repeat it on the release commit.

### Known limitations

- **No `/v1/responses`** ([#1](https://github.com/jjjermiah/opencode-plugboard/issues/1)). Clients that default to the Responses API get `404 No route for POST /v1/responses`. The workarounds are in the table above. This is the first thing planned after 0.1. It stayed out only because the release gate was written for Chat Completions.
- **`tool_choice` is best effort** ([#13](https://github.com/jjjermiah/opencode-plugboard/issues/13)). `auto` and `none` work. `required` and a named function are sent to the model as an instruction, because the session API cannot set a tool choice, and a model can still answer in text. The forced `respond` tool for structured output has the same limit. The native backend closes it.
- **The interrupt can race the runner's next step** ([#14](https://github.com/jjjermiah/opencode-plugboard/issues/14)). In practice the interrupt wins. If it loses, a second model step is wasted: tokens, and a stray message in history, but no wrong output for the caller.
- **The listener needs a warm-up** ([#15](https://github.com/jjjermiah/opencode-plugboard/issues/15)). OpenCode loads no plugin until a client touches the server, so after a restart the port stays closed until something connects. The README has the warm-up recipes. The real fix is upstream, and I plan to file that request once 0.1.0 is out ([#2](https://github.com/jjjermiah/opencode-plugboard/issues/2)).
- **Sampling parameters some providers reject come back as 400** ([#30](https://github.com/jjjermiah/opencode-plugboard/issues/30)). Plugboard forwards them faithfully. Real OpenAI behaves the same on its reasoning models, but clients rarely expect a 400 for a temperature knob.
- **No pruning of history** ([#8](https://github.com/jjjermiah/opencode-plugboard/issues/8)).
- **No other front-ends yet.** Anthropic Messages ([#4](https://github.com/jjjermiah/opencode-plugboard/issues/4)), Gemini ([#5](https://github.com/jjjermiah/opencode-plugboard/issues/5)) and OpenCode agents as models ([#6](https://github.com/jjjermiah/opencode-plugboard/issues/6)) are planned. Embeddings, audio and image generation are not.
- **Pinned to OpenCode 2.0.26** (peer range `>=2.0.26 <2.1`). The host's session API is not stable across versions. Type-level checks make the build fail when the pinned host changes shape.
- **No automated test suite.** The checks are the type checker and live runs against an isolated server, including the client matrix above. The second review's items [#46](https://github.com/jjjermiah/opencode-plugboard/issues/46) and [#48](https://github.com/jjjermiah/opencode-plugboard/issues/48) are about making those runs more trustworthy.
- **Unpublished.** Not on npm yet ([#29](https://github.com/jjjermiah/opencode-plugboard/issues/29)).

### Acknowledgements

`copilot-api` and LiteLLM showed what an OpenAI-compatible front door should feel like to the people calling it. No code was taken from either.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (26 commits)</summary>

#### Refactors

**refactor(session): split session backend by responsibility** ([`b187ea5`](https://github.com/jjjermiah/opencode-plugboard/commit/b187ea5b911a2dba79102a1e3c331d73adef6b2c))

**refactor(http): separate HTTP ingress from OpenAI route; models policy stays neutral** ([`f42e63c`](https://github.com/jjjermiah/opencode-plugboard/commit/f42e63c7fb22d576ba57b99174586dfa3552654f))

**refactor(runtime): single process owner for listener, pump and session store** ([`5e0a891`](https://github.com/jjjermiah/opencode-plugboard/commit/5e0a8912ed5461f61d7f476929de21db903e1977))

**refactor: integrate modules, neutral model-call contract, architecture doc** ([`962b5bc`](https://github.com/jjjermiah/opencode-plugboard/commit/962b5bc5f17db3eac6d41b6c746b2aa789719b63))

#### Docs

**docs: native-backend issue reflects completed seed tools and step.ended interrupt** ([`aacf221`](https://github.com/jjjermiah/opencode-plugboard/commit/aacf22113b872656cccbc69fc13498bba1e3296d))

**docs: architecture and README match the request guard, accepted generations and owner preference** ([`2a70bb6`](https://github.com/jjjermiah/opencode-plugboard/commit/2a70bb619d15d5cdd5e0672477e640e9afdc815a))

#### Other

**Spike: session-backend OpenAI endpoint + shared contracts** ([`6e27cbc`](https://github.com/jjjermiah/opencode-plugboard/commit/6e27cbc3e04f9311829946389d690f4e5bbb50b1))

**config + models** ([`475907e`](https://github.com/jjjermiah/opencode-plugboard/commit/475907e288d9523ca6196117d5e4b443af3aaea9))

**openai chat front-end** ([`ab8d471`](https://github.com/jjjermiah/opencode-plugboard/commit/ab8d47169f3b9035a316b22d98c04ebdbbc1927c))

**README + roadmap issue drafts** ([`7814e28`](https://github.com/jjjermiah/opencode-plugboard/commit/7814e28a726bde86c111b2e2d8b0e6ef90beb6dd))

**runtime: cross-location session backend, versioned listener, process-wide registry, route table** ([`73dc146`](https://github.com/jjjermiah/opencode-plugboard/commit/73dc146aebbe310a7c00fecd28148ea1d34c08cc))

**Wire real config/models and OpenAI front-end into the router; drop spike shims** ([`b2d0332`](https://github.com/jjjermiah/opencode-plugboard/commit/b2d0332a0e3db9455a26ba55faec6f3e0eb699ed))

**Address runtime review: CSRF/host checks, remoteImages off, authoritative options, early stream errors** ([`81a07ad`](https://github.com/jjjermiah/opencode-plugboard/commit/81a07ad12e65472da6405f066ebbbe3f4b7c1805))

**Re-adopt options when no generation is live** ([`e44407c`](https://github.com/jjjermiah/opencode-plugboard/commit/e44407cd579338be05abf2d9a542f4964938aaae))

**Seed tools settle at once; interrupt on step end so history shows completed calls** ([`96ac463`](https://github.com/jjjermiah/opencode-plugboard/commit/96ac4630485ee654a9f8e07f0cc3a08c7ed824a4))

The seed tool returned never, so every tool-call turn showed aborted tool parts and a failed assistant message. It now returns 'Returned to caller', and the turn is interrupted on session.step.ended, before a second step can produce output. The HTTP response is unchanged.

**compat: shared kit for client checks** ([`4ab8044`](https://github.com/jjjermiah/opencode-plugboard/commit/4ab804449cc2517592eda75cf900444dd2278405))

**models: dedupe /v1/models ids** ([`3fcedc7`](https://github.com/jjjermiah/opencode-plugboard/commit/3fcedc7d7e2e1bdee2d540012e063f63f514b961))

**compat: client check scripts and results (OpenAI py/js, Vercel AI SDK, LangChain py/js, pydantic-ai)** ([`f351307`](https://github.com/jjjermiah/opencode-plugboard/commit/f3513079f36daf54f46b66fcf002cb9a940e9dc0))

**Move roadmap to GitHub issues** ([`85e5027`](https://github.com/jjjermiah/opencode-plugboard/commit/85e5027e51a3dd785ffa1b88f0f541a04f8a1868))

The deferred-feature drafts are now issues and milestones, so docs/issues goes away and the README roadmap links to them.

**compat: Open WebUI 0.12.0 check (pass)** ([`d0762d7`](https://github.com/jjjermiah/opencode-plugboard/commit/d0762d7a44ca55c4930560426e41d8c463077f98))

**compat: n8n 2.42.6 check (pass)** ([`8f0d040`](https://github.com/jjjermiah/opencode-plugboard/commit/8f0d040650fd13e47478a681598ed95abe422bd7))

**contract: inclusive usage semantics; CallContext.onRecord for the history id** ([`48e3314`](https://github.com/jjjermiah/opencode-plugboard/commit/48e331448f8f0af6ea20bf98db46de62cd01cda9))

**protocol: shared structured-output projection, stricter request validation, json_object via instruction, alias/timeout validation** ([`7dcd86e`](https://github.com/jjjermiah/opencode-plugboard/commit/7dcd86e3016eab2a9116425172a7ac127aec2569))

**http: request scope (disconnect + single deadline), 400/413/500 hardening, SSE backpressure, GET /v1/models/{id}, x-plugboard-session header** ([`4f17677`](https://github.com/jjjermiah/opencode-plugboard/commit/4f1767749065c7f328f9f2a78b724a247abf63db))

**safety: keep the request guard until host execution ends; explicit generation registration; app dir containment; preparation checks; inclusive usage; history id hook** ([`6c2bdf1`](https://github.com/jjjermiah/opencode-plugboard/commit/6c2bdf1676d6841f23f4276e471a8f7e768da3de))

**release prep: package metadata, client docs, portable compat kit** ([`f4c8afb`](https://github.com/jjjermiah/opencode-plugboard/commit/f4c8afb8861ad2db6656fffa773d9d21f6a3312f))

package.json gets real metadata, an exports entry, a files allowlist and a 2.0.26 host pin. README and docs match what the code and the client checks showed. The compat kit reads PLUGBOARD_* env vars, pins Docker images and drops machine-specific paths.

</details>
<!-- commit-detail:end -->

[Unreleased]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.19.0...HEAD
[0.19.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jjjermiah/opencode-plugboard/releases/tag/v0.1.0
