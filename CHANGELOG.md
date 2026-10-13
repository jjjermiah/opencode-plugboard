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

- **Per-app request deadline** ([#257](https://github.com/jjjermiah/opencode-plugboard/issues/257)). `apps.<name>.requestTimeoutMs` (since 0.29.0) gives one app its own deadline in place of the global `requestTimeoutMs`, higher or lower, so a batch job and a chat widget can differ. The timeout error is the same as today. Unset, the global value applies unchanged.
- **Per-app request body cap** ([#258](https://github.com/jjjermiah/opencode-plugboard/issues/258)). `limits.maxBodyBytes` (since 0.29.0) sets the largest body for every app, at most 32 MiB, and `limits.apps.<name>.maxBodyBytes` lowers it for one app. A body over the app's cap gets 413 before it is read, so a chat widget can be held to a few hundred kilobytes while a bot keeps a larger one. Unset, the 32 MiB cap applies as before.
- **Per-app output token cap** ([#263](https://github.com/jjjermiah/opencode-plugboard/issues/263)). `apps.<name>.maxOutputTokens` (since 0.29.0) bounds one answer of an app. A caller with no limit gets the cap, a higher limit is lowered to it, and a lower one is kept, on Chat Completions, Responses, legacy completions, Messages and Gemini. On Messages a thinking budget the cap cannot hold gets the existing 400, not a silent change to thinking.
- **LangChain JS example** ([#181](https://github.com/jjjermiah/opencode-plugboard/issues/181)). `examples/langchain-js` runs S1 to S7 and the two error paths against a scripted plugboard in CI. Chat Completions and the Responses route are both run for `openai/gpt-5.6-luna#low`; the Responses route is recorded as a gap, because LangChain does not expose a `finish_reason` for it.

### Fixed

- **`count_tokens` and Gemini `countTokens` count what the session sends** ([#201](https://github.com/jjjermiah/opencode-plugboard/issues/201)). The count left out an agent's prompt, a skill's content and the schemas of `serverTools`, so Claude Code could budget against a number that was too small. The count now runs the same builders as the session caller, so it cannot drift from the request: it counts only the caller tools the request offers (none for `tool_choice: none`, one for a named choice), and it refuses what the request would refuse. An app with `tools: false` is also counted without the caller's tools that the request drops. The tool schemas are an estimate: they are converted without OpenCode's draft-07 step.

## [0.27.0] - 2026-10-12: Every App Its Own Rules

**Full diff:** [v0.26.0...v0.27.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.26.0...v0.27.0)

Each app can now carry its own history limits and `n` cap, the log level is yours to set, and browser apps can read plugboard's response headers.

### Added

- **Browser scripts can read the plugboard response headers** ([#314](https://github.com/jjjermiah/opencode-plugboard/issues/314)). With `cors` set, an allowed origin's answers now send `Access-Control-Expose-Headers` with the `x-plugboard-*` headers and `retry-after`. Before, a browser hid them, so `x-plugboard-session` or `x-plugboard-usage` could not be read from a page. Origins off the list still get no CORS headers.
- **History retention per app** ([#265](https://github.com/jjjermiah/opencode-plugboard/issues/265)). `history` was one pair of numbers for every app. A high-volume bot wants to keep few sessions while a coding assistant keeps many. `apps.<name>.history` sets `maxSessions` and `maxAgeDays` for one app. A field replaces the global one for that app, and an unset field falls back to it. The stricter field still wins inside an app. An app with no limit anywhere keeps its sessions forever, as before. The history index is written only for an app that has a limit, so an unlimited app adds nothing to host storage.

  ```jsonc
  {
    "history": { "maxSessions": 500, "maxAgeDays": 30 },
    "apps": {
      "discord-bot": { "history": { "maxSessions": 20 } },
      "coding": { "history": { "maxSessions": 5000, "maxAgeDays": 180 } }
    }
  }
  ```
- **A per-app cap on `n`** ([#270](https://github.com/jjjermiah/opencode-plugboard/issues/270)). `maxN` was one number for every app, so a batch tool that needed `n: 4` forced the same allowance onto the chat widget. `apps.<name>.maxN` lowers the global cap for one app. A request above it gets the usual 400 `too_many_choices`. It cannot be higher than the global `maxN`, the same rule as `maxTools`. Unset, the global cap applies as before. The 400 `too_many_choices` message now names the option that applied (`apps.<name>.maxN` for an app with its own cap, else `maxN`). Before, it always named `apps.<name>.maxN`, so the text changes for a request refused under the global cap.

  ```jsonc
  {
    "maxN": 4,
    "apps": { "chat-widget": { "maxN": 1 }, "batch": { "maxN": 4 } }
  }
  ```
- **Log levels and an access log switch** ([#262](https://github.com/jjjermiah/opencode-plugboard/issues/262)). Plugboard wrote one access line per request and had no way to change how much it logged. `logLevel` sets the lowest level written (`debug`, `info`, `warn` or `error`). `logRequests: false` drops the per-request access lines and keeps warnings and errors, so an operator can keep the alerts without the traffic. Neither option changes what a line holds: keys and bodies are still never logged. The defaults are `info` and `true`, as before. What each level shows is listed in [configuration](docs/configuration.md): `warn` keeps the rate limit, budget, failed fallback and failed history deletion lines, and the admin key audit lines (`admin.key_created`, `admin.key_revoked`) are written at every level. `debug` adds only the keep-alive line for now; the per-step debug lines the issue lists are not written yet, so #262 stays open.

  ```jsonc
  {
    "logLevel": "warn",
    "logRequests": false
  }
  ```

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (21 commits)</summary>

#### Features

**feat(http): expose the x-plugboard-* response headers to browser apps** ([`46baf49`](https://github.com/jjjermiah/opencode-plugboard/commit/46baf49de36a94ddb3f3a0ab4eb6dba55fcfe834))

With `cors.origins` set, browser scripts could not read the plugboard headers (x-plugboard-session, x-plugboard-model, x-plugboard-usage and the rest). A browser only exposes the CORS-safelisted response headers unless the response says otherwise, and no answer sent Access-Control-Expose-Headers.

What: an allowed origin's answer now carries Access-Control-Expose-Headers with the documented plugboard header list plus retry-after. The list is one constant (CORS_EXPOSED_HEADERS in src/http.ts). It is set in the same place as Access-Control-Allow-Origin, so every route the CORS block reaches (chat, messages, responses, gemini) gets it. An origin off the list gets no CORS headers, as before.

Why: the header list is fixed and documented, so one constant beats per request computation. The header is set on the preflight too; browsers ignore it there, and it keeps the two responses symmetric.

Rejected: sending the list only on routes that set plugboard headers (more branches for no gain); Access-Control-Expose-Headers: * (it does not expose headers when credentials are used, and it leaks the whole set).

Validation: test/http/cors.test.ts (#314 block: expose list on an allowed answer, none for an off-list origin, none without cors); tsc --noEmit clean.

Fixes #314

**feat(config): logLevel and logRequests volume switches** ([`3c38d39`](https://github.com/jjjermiah/opencode-plugboard/commit/3c38d39da224848e99cbc50f6e5b752b23e122ed))

Plugboard wrote one access line per request at info, and no switch changed how much it logged. Only the format was adjustable. An operator with a log pipeline paid for the access lines, and one who wanted only the alerts had no way to get them.

What: two process-wide options, validated at load.
- logLevel: debug | info | warn | error, default info. Lines below it are dropped. debug gets its own pino stream so debug records reach stdout; the existing logDebug lines (keep-alive, #310) are the only debug lines today.
- logRequests: false drops the per-request access lines (`request` from the route, `request.finished` from the caller) through a new logRequest helper. Warnings and errors are never affected. Both are set in runtime.ts with logFormat, when a generation is accepted.

Why: the level is the usual pino knob, and logRequests is a separate switch so an operator can keep warnings without the access lines. Neither changes a line's content, so the I14 redaction and the envelope keys are unchanged.

Rejected: a per-line sampler (more code, and it hides which requests ran); per-app logging (logging is process-wide like logFormat, see the issue).

Tests: test/unit/log.test.ts (#262 block: error and warn drop info, debug written at debug, logRequests off, redaction at debug); test/unit/config.test.ts (#262 block; the defaults test now lists the two new defaults). Full bun test: 2321 pass, 0 fail, 126 skipped (live).

Refs #262. The per-step debug lines the issue lists are not added yet, so the issue stays open.

**feat(config): apps.<name>.maxN caps the choices one app may ask for** ([`ad4d8b9`](https://github.com/jjjermiah/opencode-plugboard/commit/ad4d8b95cbd82c2084939b0027e0e847b653c5ff))

maxN was one number for every app. A batch tool that needs n: 4 forced the same allowance onto a chat widget that should never fan out, and each choice is a full model call and a kept session.

What: apps.<name>.maxN lowers the global cap for one app, validated at load the same way as apps.<name>.maxTools: a positive integer no higher than the global maxN. The routes that decode n (chat completions and legacy completions) check the request against maxNFor(options, app), which is the app's value or the global one. The 400 too_many_choices message names the app option. Responses and Messages have no n, so they are unchanged.

Why: the shape already exists for maxTools, so parsing and error style are settled. Passing the effective cap as a copy of the options keeps the decoders unchanged apart from the message.

Rejected: a route-level check after decoding (the decoder already owns the n check and its error param); an app maxN above the global one (it would be a second, unchecked global).

Tests: test/http/per-app-maxn.test.ts (two apps on one server: the capped app gets 400 with no model call, the other app gets 200; n: 1 passes; legacy completions obey the cap; without it the global cap holds). test/unit/config.test.ts (#270 block: only lowers, in-range kept, global when unset, zero and non-integer rejected). bun test on the touched files: 314 pass.

Fixes #270

**feat(config): apps.<name>.history sets history retention per app** ([`56d1598`](https://github.com/jjjermiah/opencode-plugboard/commit/56d1598d5f476288b41b24e0f643ea891bcbf457))

history was one pair of limits for every app. A high-volume bot wants to keep very few sessions while a coding assistant keeps thousands, and the operator had to pick one pair for both or turn pruning off.

What: apps.<name>.history takes maxSessions and maxAgeDays, validated at load (1 or more, maxAgeDays up to 36500, unknown fields rejected). A field replaces the global one for that app and an unset field falls back to it, field by field (limitsFor in src/session/prune.ts). The stricter field still wins inside an app. The sweep takes each app's effective limits, and trackSession writes the index only when the app's effective limits have a field set (invariant I21). An app with no limit in either place is kept forever.

Why: the merge is per field, so setting only maxSessions for a bot keeps the global age limit, the same way apps.<name>.maxTools and the budgets override work. The index check uses the same merge, so the index and the sweep cannot disagree about whether an app is pruned.

Rejected: a separate sweep timer per app (I1 and I7 keep the sweep on request handling, and one bounded sweep already loops over every app); copying the global limits into each app's entry at load (a global change would not reach the app).

Tests: test/session/prune.test.ts (#265 block: limitsFor merge, per-app sweep, app with no global limit, the stricter field inside an app); test/runtime/generations.test.ts (#265: indexed with its own limit and no global one; not indexed with no limit in either place); test/unit/config.test.ts (#265 block: parsing, the per-app map, rejected values name the app).

Fixes #265

#### Fixes

**fix(session): an app with no history limit is not read by the sweep** ([`c2e0bda`](https://github.com/jjjermiah/opencode-plugboard/commit/c2e0bda0f99b40831e80169f417d5dfea962a4b7))

Review of #319 (SHOULD 1-3). Before this change, sweepHistory read every indexed app even when limitsFor gave it no limit. Before per-app history (#265) that could not happen: a global limit gave every app one. Now an app that was indexed under a limit that has since been removed still gets scanned, and a scan over 20,000 entries reports more=true, so the runtime re-sweeps every SWEEP_BACKLOG_MS (1 minute) and deletes nothing.

What: sweepHistory skips an app whose effective limits are both unset, before reading its index. The "no limits: nothing is removed" expectation changes from scanned 3 to scanned 0: that is the change, the app is not read at all.

Also covered by new tests (these pass against the fixed code and pin the behaviour the reviewer asked for):
- a per-app limit looser than the global one wins in the sweep (maxSessions 5000 over 2 keeps all 5 sessions; maxAgeDays 10 over 3 removes nothing), with the limitsFor unit case. The clamping mutation (min of own and global) now fails.
- the sweep starts when only per-app limits exist: a new session under apps.app.maxSessions 1 removes the two older sessions (runtime test).

Tests that failed before the fix: "an app with no effective limit is not even read" (scanned 2, more true, against scanned 0, more false). The other new cases pass before and after; they are coverage the review asked for.

Mutations for these are in the catalogue commit.

Refs #265

**fix(log): operational problems are warn lines; admin key audit lines ignore logLevel** ([`494d475`](https://github.com/jjjermiah/opencode-plugboard/commit/494d475f86a4d14c0d45a53cd56c5bbd15d435ed))

Review of #319 (SHOULD 4). `logLevel: warn` is the setting an operator uses to "keep the alerts", but several lines that signal a problem were written at info, so warn and error silenced them: request.limited (a 429), request.budget_exceeded (a refusal by budget), model.fallback_exhausted (every target failed) and history.swept with deletions that failed. The admin key audit lines (admin.key_created, admin.key_revoked) were info too, so an operator at `error` lost the record of who changed a key.

What:
- request.limited, request.budget_exceeded and model.fallback_exhausted are logWarn. history.swept is logWarn only when failed > 0; a clean sweep stays info. model.fallback (a normal retry) stays info.
- logAudit writes admin.key_created and admin.key_revoked on a second pino instance fixed at info. setLogLevel changes only the main logger, so the audit line is written at every logLevel, including error. Redaction and the envelope are the same.

Why a second instance and not a bypass: pino checks the level per logger, and the main logger's level is the operator's setting. A separate instance keeps the same destinations and redaction and removes only the level dependency.

Tests that failed before the fix:
- test/unit/limits.test.ts: "request.limited is a warning" (the JSON line's level was info).
- test/unit/log.test.ts: the audit line was missing at error (the export did not exist, so the file failed to load). Passes now at every level.

The level each event shows is documented in configuration.md with logLevel.

Refs #262

**fix(openai): the choice-cap 400 names the option that applied** ([`0e5977c`](https://github.com/jjjermiah/opencode-plugboard/commit/0e5977c46b3a5d109d8161a3e20587096c0dda4d))

Review of #319 (NIT 7, NIT 8, SHOULD 5). The too_many_choices message named `apps.<name>.maxN` even for an app with no cap of its own, which pointed the operator at a setting that did not apply. Under a global cap the message now names `maxN`; under an app cap it names `apps.<app>.maxN`. The message text of this error changes for every user; the CHANGELOG says so.

What: maxNOption(options, app) gives the option that set the cap. Chat and legacy completions receive it as an optional argument and put it in the 400 message. Both routes pass it.

Tests (NIT 7, failed before the fix): per-app-maxn.test.ts now asserts the applied option for chat and completions, and that a global-cap refusal does not mention apps.

NIT 8 (no code change, tests pin the edges): an app maxN equal to the global one is accepted; apps.default.maxN caps the keyless app; an unknown app and an inherited name such as constructor get the global cap.

SHOULD 5 (no code change, tests pin the behaviour): the expose-headers list is on an allowed origin's 204 preflight and on its 401 answer, and the list equals the set of x-plugboard-* names the source sets, plus retry-after. A new header that is not in the list now fails the test.

Refs #270, #314

#### Refactors

**style(docs): gofmt the go-openai example** ([`af006bc`](https://github.com/jjjermiah/opencode-plugboard/commit/af006bc5ee8b880ef92200a63e1f17a3e03782ed))

Aligns the Parameters field in the tool definition, the one line gofmt -l flagged. No behaviour change.

Refs #234

#### Tests

**test(tests): one mutation per enforced per-app cap of the config epic** ([`427b2c3`](https://github.com/jjjermiah/opencode-plugboard/commit/427b2c3353f63c4d52b0e9b29ac76c3d4b2c2448))

The mutation catalogue (#111) gates the guards that must never silently break. The per-app options added in this branch enforce caps and switches that a refactor could break without a test failing, so each gets one entry: the per-app maxN (#270), the per-app history limit and the index write rule (#265), the access-line switch (#262) and the CORS expose-headers list (#314).

Each entry is one exact find/replace and names the test files that must fail. All five are killed by their test files (mutation-check.ts --only, one at a time). The ids use a P<issue> prefix because these options have no numbered invariant; the catalogue's invariant field carries the issue instead.

Fixes nothing by itself; it is part of #270, #265, #262 and #314.

**test(tests): raise the test-count floors for the per-app options** ([`e06bd90`](https://github.com/jjjermiah/opencode-plugboard/commit/e06bd903408121a223accc5e087d7ee58dd93268))

The new tests for #262, #265, #270 and #314 raised the per-layer counts (http 522 to 529, runtime 81 to 83, session 300 to 304, unit 1167 to 1186). The ratchet only moves floors up, so these are the counts the branch now has. Coverage floors are unchanged: the total is at its floor (98.6% lines, 94.5% functions).

**test(tests): cover n > 1 usage and streamed legacy completions in the compat matrix** ([`51e0d66`](https://github.com/jjjermiah/opencode-plugboard/commit/51e0d669f7dbd4ed4dde9993f7aedd26ebb17223))

The compat matrix's `n` case now checks what clients see for several choices. Chat Completions and legacy completions both assert summed usage on the non-streamed answer and, when streamed with include_usage, that the final chunk has no choices and carries the summed usage. The legacy completions streamed case reassembles text per choice index. LangChain's legacy LLM class and ChatOpenAI assert summed tokenUsage on generate. The scenario legend in docs/compatibility.md is regenerated to match.

Issue #106 lists streamed and non-streamed n, index interleaving and summed usage. The matrix had a streamed n only for Chat Completions, and no client checked usage across choices.

Decisions:
- Extended the existing `n` scenario instead of adding one, so the table keeps its shape. The docs change is the single legend line.
- Expected usage is twice the scripted per-call usage, because fan-out sums usage per choice (src/openai/fanout.ts). The assertions reuse USAGE.
- Not added: an eval-harness client (lm-eval-harness, promptfoo). The matrix has no path for them: the Python harnesses run by hand (compat/py), and promptfoo is not a TypeScript SDK. Left open on #106.
- Not added: prompt-array with n. Two prompts with n=2 make four calls, above the matrix's maxN of 2.

Validation:
- bun test test/compat: 236 pass, 0 fail.
- bun run typecheck: pass (root, tui, test, examples harness).
- bun test: 2306 pass, 126 skip, 0 fail.
- Coverage and test-gates --ratchet: all floors met, none changed (assertions only, no new tests).
- coverage-manifest, check-pack, smoke-pack, docs:build and the scripted examples pass; examples/ diff is clean.
- The new assertions pass on current behaviour. They guard existing behaviour; I did not check that they fail on a broken fan-out.

Refs #106

**test(tests): mutations for the review fixes of the per-app options** ([`8d95d9d`](https://github.com/jjjermiah/opencode-plugboard/commit/8d95d9d89e4bc868176fad7d10d7223bef5ec9a3))

Review of #319. Each guard the review fixes is now in the mutation catalogue (#111), so a refactor that reverts it fails a test: the maxAgeDays merge (own field ignored), the sweep started by app-only limits, the unlimited app that is read, and the audit line that follows logLevel. Each was killed by its test file, one at a time (mutation-check.ts --only).

The ids keep the P<issue> prefix used for the other per-app entries, since these options have no numbered invariant.

Refs #262, #265

**test(tests): raise the test-count floors for the review tests** ([`04609a6`](https://github.com/jjjermiah/opencode-plugboard/commit/04609a6cc63310349c165ec63bd612d6175b84a6))

The review tests added to http (cors, per-app maxN), runtime (history sweep with app-only limits), session (looser app limits, unlimited app not read) and unit (log audit, limits warning, config edges) raise the per-layer counts: http 529 to 534, runtime 83 to 84, session 304 to 308, unit 1186 to 1195. The ratchet only moves floors up. Coverage floors are unchanged.

#### Docs

**docs(docs): list the x-plugboard headers exposed on CORS answers** ([`62f4478`](https://github.com/jjjermiah/opencode-plugboard/commit/62f44785772d3da7582718bb8fa305bd5f780215))

The CORS section of configuration.md said nothing about which headers a browser can read, so an operator could not tell that x-plugboard-session or x-plugboard-usage are readable from an allowed origin (#314). The section now names the exposed headers and says they come from one list.

Refs #314

**docs(docs): per-app history and maxN in README and architecture** ([`db05b2d`](https://github.com/jjjermiah/opencode-plugboard/commit/db05b2d2415c3d889bde3b4e03e52a347908ba9e))

The per-app history limits (#265) and the per-app choice cap (#270) were documented only in configuration.md. architecture.md is where a reader looks for how the history index and sweep decide what to prune, so it now says the index and sweep both use an app's effective limits. The README's multiple choices section names the per-app cap next to the global one.

Refs #265, #270

**docs: add Go (go-openai) client page and example** ([`bf0f345`](https://github.com/jjjermiah/opencode-plugboard/commit/bf0f3459fb091d0d0ea456e05340991f658240b3))

Adds docs/clients/go-openai.md, examples/go-openai (a Go program with a text call, a stream and one tool round trip), a Clients sidebar row, a README client-table row and an examples/README row.

Epic #206 lists go-openai under language SDKs. It is the most-used community OpenAI client for Go and exposes ClientConfig.BaseURL, so the page is a config snippet plus a runnable example.

The example uses Chat Completions, because that is the path it checks. The Responses API is named on the page but not exercised. Reasoning-model caps use max_completion_tokens (MaxCompletionTokens: 1024). BaseURL replaces the default whole, so the page says to include /v1.

A Go test in the scripted suite was not added. The lane is docs and an example, and the harness does not run Go.

Validation: go build and go vet in examples/go-openai against go-openai v1.43.0 both pass. A live run against the dev server was not done: 127.0.0.1:4010 refused connections on 2026-10-12, and the lane forbids restarting it.

Refs #234

**docs: add .NET (openai-dotnet) client page and example** ([`9b33345`](https://github.com/jjjermiah/opencode-plugboard/commit/9b33345bcb99c57cd8cfeecb40096c1413369a5f))

Adds docs/clients/openai-dotnet.md, examples/openai-dotnet (a console app with a text call, a stream and one tool round trip), a Clients sidebar row, a README client-table row and an examples/README row.

Epic #206 lists the .NET library under language SDKs. The official OpenAI .NET library exposes OpenAIClientOptions.Endpoint, so the page is the construction snippet plus a runnable app.

The example uses Chat Completions, which is the path it checks. The Responses API and structured output are named on the page but not exercised. The output cap uses MaxOutputTokenCount (1024) for the reasoning model.

Validation: dotnet build of examples/openai-dotnet against OpenAI 2.14.0 on .NET SDK 8.0.423 passes with 0 warnings and 0 errors. A live run was not done: 127.0.0.1:4010 refused connections on 2026-10-12, and the lane forbids restarting it. The example folder ignores its bin and obj output.

Refs #236

**docs: per-app options, the log levels and the 0.27.0 markers** ([`cbdb430`](https://github.com/jjjermiah/opencode-plugboard/commit/cbdb43024adaa2884e4c315a2ffea69897b01c4f))

Review of #319 (SHOULD 4 docs, SHOULD 6, NIT 9, NIT 12). The options of this branch shipped in the docs unevenly: the #262 log level was not in the README or the architecture, the history docs still read as global, and the CHANGELOG claimed a louder mode and gave an example with an empty app entry.

What:
- README: History shows apps.<name>.history with the gotcha (the 30-day global default applies to an app that sets only maxSessions) and that an app cannot set maxAgeDays 0. Metrics and logs names logLevel, logRequests and what the warn level keeps. The maxN section says raise the global cap first.
- docs/history.md: the per-app history and the same two gotchas.
- docs/architecture.md: I21 now says the index is written while the app has an effective limit; the history option bullet says so too; a new log level bullet lists which events are warn and that the audit lines use logAudit.
- docs/configuration.md: the logLevel row lists what each level shows; the history and maxN rows state the new rules; the CORS sentence about reading the headers now uses response.headers.get.
- CHANGELOG: the #262 entry says debug adds only the keep-alive line today and that #262 stays open; the #270 example uses "batch": { "maxN": 4 }; the 400 message text change is noted.
- Every "since" marker this branch added reads 0.27.0, because 0.26.0 is released from main without these options. Markers already on main (keepAlive, cors, requireKeys, trustProxy, endpoints) are unchanged.

Refs #262, #265, #270, #314

**docs(docs): record the live go and .net runs and fix the max token note** ([`f03c1fe`](https://github.com/jjjermiah/opencode-plugboard/commit/f03c1fe131bc029ba2c54a0402eafa9e8cbe0a2b))

The reviewer ran both examples twice against the dev server on 2026-10-13 with model fast: text, stream and a tool round trip passed for go-openai v1.43.0 and the OpenAI NuGet 2.14.0. The pages, the README client table and the examples index said "build only, dev server down"; they now record the pass and say the clients are not in compatibility.md yet.

The Go page implied go-openai would refuse max_tokens for fast. Its client-side check only matches real OpenAI reasoning model ids, so the note now says that, and the code comments no longer call fast a reasoning model by name.

Refs #234
Refs #236

**docs(docs): link the logLevel section by absolute URL** ([`c3473de`](https://github.com/jjjermiah/opencode-plugboard/commit/c3473deea14dc2ce4d3b70a567774b3b586e6340))

The docs site builds README.md as its home page, so a relative link to docs/configuration.md is a dead link and fails docs:build. The README uses absolute GitHub URLs for its other documents; this link does the same.

Refs #262

**docs(changelog): move the per-app notes out of the 0.26.0 section** ([`20ba1e6`](https://github.com/jjjermiah/opencode-plugboard/commit/20ba1e6d54ca2fd411253398d51de938e7a357d8))

The per-app config pull request branched before 0.26.0 was cut. Its bullets sat under Unreleased on the branch, and merging main into it put them under the new 0.26.0 heading instead, so main's changelog credited 0.26.0 with the CORS headers, per-app history, the per-app n cap and log levels, and left Unreleased empty. The published 0.26.0 release and its GitHub notes are correct, since they were cut before the merge; only the file on main was wrong.

The four bullets move back under Unreleased with a one-line summary, so the release script can cut 0.27.0. The text is unchanged apart from one duplicated clause in the n cap bullet.

Refs #265, #270, #314, #262

</details>
<!-- commit-detail:end -->

## [0.26.0] - 2026-10-12: Locks and a Heartbeat

**Full diff:** [v0.25.1...v0.26.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.25.1...v0.26.0)

Five options for locking down who and what can reach plugboard, and a fix for a listener that went silent after an idle hour. Nothing changes until you set an option, except the keep-alive, which is on by default.

### Added
- **`requireKeys` makes a keyless server impossible** ([#271](https://github.com/jjjermiah/opencode-plugboard/issues/271)). On a shared machine, loopback is not a boundary, so a keyless server should be something you can rule out in config. With `requireKeys: true`, the plugin refuses to load without `keys`, and every request needs a key, loopback included. `/healthz` and `/readyz` stay open. The default is `false`, so keyless loopback works as before.

  ```jsonc
  {
    "keys": { "my-app": "{env:PLUGBOARD_KEY_MY_APP}" },
    "requireKeys": true
  }
  ```
- **Limit an app to some endpoints** ([#268](https://github.com/jjjermiah/opencode-plugboard/issues/268)). Every key could reach every model route, so a key given to a polling bot could also call Messages or Responses. `apps.<name>.endpoints` names the endpoint families an app may call. A call outside the list is a 403 `endpoint_forbidden` in the route's own error shape, and the model is not called. The check runs after authentication. Unset means every endpoint, as before.

  ```jsonc
  {
    "keys": { "discord-bot": "{env:PLUGBOARD_KEY_BOT}", "claude-code": "{env:PLUGBOARD_KEY_CLAUDE}" },
    "apps": {
      "discord-bot": { "endpoints": ["chat"] },
      "claude-code": { "endpoints": ["messages"] }
    }
  }
  ```
- **Set the limits on remote image fetches** ([#259](https://github.com/jjjermiah/opencode-plugboard/issues/259)). `remoteImages` was on or off, and its bounds were fixed in the code: 20 MB per image, a 20 second timeout, no redirects, any `http` or `https` URL. An operator who allows one internal image host could not tighten the rest. The object form now takes `schemes`, `maxBytes`, `maxItems`, `maxRedirects` and `timeoutMs`. Each is optional and only tightens the fetch: the SSRF filter, the address pinning and the 50 MB total per request are unchanged. `true` and `{ "allow": [...] }` keep working, with the same defaults.

  ```jsonc
  {
    "remoteImages": {
      "allow": ["images.internal"],
      "schemes": ["https"],
      "maxBytes": 5242880,
      "maxItems": 4,
      "maxRedirects": 0,
      "timeoutMs": 10000
    }
  }
  ```
- **Allow a browser origin to call plugboard** ([#256](https://github.com/jjjermiah/opencode-plugboard/issues/256)). A web UI on another origin could not call plugboard: no CORS header was sent, and a keyless endpoint refused every `Origin`. `cors.origins` names the origins that may call it. An allowed origin gets `Access-Control-Allow-Origin`, and its preflight is answered before authentication (the Host check still runs, and the actual request still needs its key). An origin off the list gets no CORS header, as before. `allowPrivateNetwork: true` answers Private Network Access preflights. `"*"` needs keys.

  ```jsonc
  {
    "cors": {
      "origins": ["https://chat.example.net", "http://localhost:3000"],
      "allowPrivateNetwork": false
    }
  }
  ```
- **Read the real client and the public host behind a reverse proxy** ([#266](https://github.com/jjjermiah/opencode-plugboard/issues/266)). Behind Traefik, nginx or Caddy, every request logged the proxy's address, and the loopback Host check refused the proxy's public name. `listen.trustProxy` names the proxies whose `X-Forwarded-For`, `X-Forwarded-Host` and `X-Forwarded-Proto` are read, and only from those peers. The log gets a `client=` field, and on a keyed endpoint the forwarded host passes the Host check. Forwarded headers never authenticate. Unset means the headers are ignored, as before.

  ```jsonc
  {
    "listen": { "host": "127.0.0.1", "port": 4010, "trustProxy": ["127.0.0.1", "10.0.0.0/8"] }
  }
  ```

### Fixed

- **The listener no longer goes deaf after an hour idle** ([#310](https://github.com/jjjermiah/opencode-plugboard/issues/310)). OpenCode closes a Location after 60 minutes with no durable session event for it, and closing it closed plugboard's listener too. The TTL is fixed upstream, so plugboard now keeps its own Location warm: every 30 minutes it renames one dedicated session, `plugboard keep-alive`, which it creates once and never prompts. The rename is a durable event, so the timer restarts. The session stays out of the history index, pruning and usage. The new option `keepAlive` (default on) turns it off. The systemd keepalive timer is no longer needed, except as a belt.
- **`/plugboard/status` takes the admin key** ([#311](https://github.com/jjjermiah/opencode-plugboard/issues/311)). The admin key already read `/plugboard/usage` and `/plugboard/metrics`, but status answered it 401, so monitoring had to borrow an app key. Status now answers the admin key with the operator view, which names no app. The key rule for every `/plugboard/` route is one table in `docs/configuration.md`.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (14 commits)</summary>

#### Features

**feat(config): add requireKeys to refuse a keyless server** ([`2e3c5bc`](https://github.com/jjjermiah/opencode-plugboard/commit/2e3c5bc74c2c8950fe512254691f239d880d9e3e))

Loopback is not a security boundary on a shared or multi-user host, and the keyless default serves every local caller as the app `default`. An operator needs to rule that out by configuration, not by hoping no drift removes `keys`.

`requireKeys: true` makes two things hold:
- with no `keys` the plugin refuses to load (I5: the generation is rejected loudly, nothing is served), so the server never runs keyless;
- with keys, a loopback request without a key is a 401, as on any non-loopback endpoint. `/healthz` and `/readyz` stay open.

Default `false` (absent from the parsed options), so keyless loopback behaves exactly as before. The authentication path is unchanged: keyed servers already required a key on every route; the flag only adds the load-time refusal.

Rejected: a per-app override (this is a server property, per the issue) and a separate loopback-only key check (the same rule already applies to any keyed server, so a second path would be a second thing to keep right).

Validation: test/unit/config.test.ts (#271 block: default absent, refusal without keys, boolean type), test/http/ingress.test.ts (#271: loopback request without a key is a 401, /healthz open). Mutation I16-require-keys-refuses-keyless is killed by the config tests.

Fixes #271

**feat(config): limit an app to some endpoint families with apps.<name>.endpoints** ([`c119fb5`](https://github.com/jjjermiah/opencode-plugboard/commit/c119fb54f229e517ecc937af96f67f521b88c743))

Every key reaches every model route, so a key given to a polling bot can also call Messages or Responses. The narrower the surface a key can reach, the smaller the blast radius of a leak.

`apps.<name>.endpoints` takes a non-empty list of `chat`, `completions`, `responses`, `messages` (both Messages paths), `gemini` and `models` (the list and the by-id route). A call outside the list is 403 `endpoint_forbidden`, in the route's own error shape (OpenAI, Anthropic Messages, or Google for Gemini). The message names the option. The model is never called. Unset keeps every endpoint reachable, as before.

The check runs after authentication and route existence (I15): an unauthenticated caller still gets 401, and an unknown path still 404, so the list reveals nothing a caller could not already see. It refuses with 403 because the caller is authenticated and the reason is policy. Usage, status, metrics, the dashboard and the probes are not restricted.

Rejected: a separate `models` permission on the key itself (the policy already lives in `apps`, and one list keeps every per-app limit in one place), and a 404 for a refused route (it would look like a missing route to a client that has every right to know the route exists).

Validation: test/http/endpoints.test.ts (chat-only app: 403 on responses, completions and models with no model call; models-only app; 401 before 403; unknown route stays 404; Anthropic and Google shapes; unset keeps everything) and test/unit/config.test.ts (#268 block: parse, unknown name, empty list, string). Mutations I15-endpoint-check-skipped and I15-messages-endpoint-check-skipped are killed by the endpoint tests. Full `bun test`: 2331 pass, 0 fail.

Fixes #268

**feat(config): bound remote image fetches with remoteImages schemes, size, items, redirects and time** ([`fc82c5e`](https://github.com/jjjermiah/opencode-plugboard/commit/fc82c5e9e8a07c486fed9568f085d66e74309bc5))

`remoteImages` was on or off, and every bound on a fetch was a constant in the code (20 MB per image, 20 s, no redirects, any http or https URL). An operator who allows one internal image host could not tighten those, and could not require HTTPS only.

The object form takes five optional fields, each of which only tightens:
- `schemes`: `["http", "https"]` by default; `["https"]` refuses an http URL. Redirect targets are checked too.
- `maxBytes`: one image, 1 to 104857600; default 20 MB as before. The 50 MB total per request is unchanged.
- `maxItems`: remote URLs per request, 1 to 1000; absent means no count cap, as before. The next remote URL fails with `too_many_remote_images` before its fetch; data URLs are not counted.
- `maxRedirects`: 0 to 10; default 0, so no redirect is followed, as before. A followed redirect's target goes through the same address check (I17) as the first URL, so a redirect cannot reach an address the first URL could not.
- `timeoutMs`: 1 to 600000; default 20000.

`true` and `{ "allow": [...] }` keep working with the same defaults. A field that is not set is absent from the parsed object, so existing configs parse to the same values.

Rejected: a per-app `remoteImages` (the issue keeps it global; a later issue can add it), and following redirects by default (today's behaviour is no redirect, and a redirect is the usual way around an address check).

Validation: test/session/media.test.ts (#259 block: https-only refuses http before any connection, maxBytes boundary, maxRedirects 0 and 1, a redirect to a private address is refused even with redirects allowed, a server that never answers fails at timeoutMs, maxItems refuses the second remote URL before its fetch and counts no data URL) and test/unit/config.test.ts (#259 blocks: parse, absent fields, each bad value named). Mutations I17-remote-scheme-check-skipped, I17-remote-redirect-cap-ignored and I17-remote-max-items-skipped are killed. Full `bun test`: 2221 pass, 0 fail.

Fixes #259

**feat(http): allow named browser origins to call plugboard with cors.origins** ([`278a1ff`](https://github.com/jjjermiah/opencode-plugboard/commit/278a1ff3f7404458c8a01c2e52ac11c99aa86acf))

A web UI on another origin (Open WebUI, LibreChat, a dashboard widget) could not call plugboard: no Access-Control-Allow-Origin was ever sent, and a keyless endpoint refused every Origin with 403. The workarounds were a same-origin reverse proxy or turning the browser's CORS checks off.

`cors.origins` lists the origins that may call. Each is canonical `http(s)://host[:port]` (no path, query, credentials, trailing slash or wildcard host), or `"*"` alone. For an allowed origin:
- every answer carries Access-Control-Allow-Origin (the origin itself, echoed, or `*` when configured), and Vary: Origin;
- its preflight (OPTIONS with Access-Control-Request-Method) is answered 204 before authentication, since a preflight carries no credentials, with the allowed methods and headers;
- the Host check still runs first, so CORS does not bypass the DNS rebinding check (I16);
- the actual request still needs its key on a keyed endpoint.

An origin off the list gets no CORS header, so the browser blocks the response. On a keyless endpoint it keeps the 403 cross_origin_forbidden. `allowPrivateNetwork: true` adds Access-Control-Allow-Private-Network when the preflight asks for it (default false).

Fail closed: `"*"` is refused without keys, because a wildcard must not sit in front of an unauthenticated model route. A specific allowed origin works on a keyless endpoint, as the issue asks.

Rejected: a `*` default or a reflect-any-origin mode (it would let any page read answers), and exposing x-plugboard-* headers to scripts with Access-Control-Expose-Headers (not asked for; a follow-up if a UI needs the session header).

Validation: test/http/cors.test.ts (preflight 204 keyless and keyed, no key needed for the preflight but still for the call, disallowed origin gets no header, Host refused on preflight, Messages preflight, actual answer header and unchanged body, * with keys, Private Network Access both ways) and test/unit/config.test.ts (#256 block: default absent, origin forms refused with the option named, * with keys only). Mutations I16-cors-off-list-origin- echoed, I16-preflight-skips-host-check and I16-keyless-origin-refusal- ignores-cors are killed. Full `bun test`: 2241 pass, 0 fail.

Fixes #256

**feat(http): read forwarded headers from listed reverse proxies with listen.trustProxy** ([`dedf120`](https://github.com/jjjermiah/opencode-plugboard/commit/dedf12017eeed62e28a41a367ea0f40b541205f8))

Behind Traefik, nginx or Caddy, plugboard saw the proxy's address for every client, and its loopback Host check refused the proxy's public name (403 invalid_host). The discovery page also showed 127.0.0.1 as its base URL.

`listen.trustProxy` takes `true` (loopback only), or a list of IP addresses and CIDR ranges. Forwarded headers are read only when the immediate peer's socket address is on the list. From any other peer they are ignored, and the socket address is used.
- The client for the log is the rightmost X-Forwarded-For address that is not a trusted proxy. A client's own leftmost value cannot win. The request log gets `client=`, and only when the option is set.
- On a keyed endpoint, a trusted proxy's X-Forwarded-Host passes the Host check (last value, well-formed), and the discovery base URL uses X-Forwarded-Proto with that host.
- A forwarded header never authenticates. Auth reads only Authorization and x-api-key, as before.

Rejected: using the forwarded host on a keyless endpoint. A page that rebinds its name to a loopback listener can send the same header, so on keyless loopback it would switch off the one check that stops that page. The cost is that keyless plus a proxy is refused by the Host check; the docs say to set keys.

Known trade-off, reported in SECURITY.md: with a loopback peer in the list and keys set, a rebinding page can pass the Host check. It then reaches only the endpoints that need no key (healthz, readyz, the minimal discovery page). Every model, usage and admin route still needs a key.

Validation: test/unit/forwarded.test.ts (option forms and refusals, the client rule for one and two hops and a spoofed leftmost value, the IPv4-mapped peer, the forwarded host and origin from trusted peers only), test/http/forwarded.test.ts (trusted keyed host passes, untrusted ignored, keyless never takes it, base URL, log client, no auth from headers, option unset keeps today's behaviour) and test/unit/config.test.ts (#266 block). loopback.ts now keeps the caller's other `listen` fields, so a route test can set trustProxy. Mutations I16-forwarded-host-from-untrusted-peer and I16-keyed-proxied-host-check-skipped are killed. Full `bun test`: 2263 pass, 0 fail.

Fixes #266

#### Fixes

**fix(http): return void from the CORS preflight answer** ([`4a1892b`](https://github.com/jjjermiah/opencode-plugboard/commit/4a1892b4ef8a4e2cc39b0931c6fd1bf69c47b020))

`bun run typecheck` failed at src/openai/route.ts: the preflight answer in #256 ended with `return response.end()`, which returns a ServerResponse, while `serve` returns Promise<void>. The response is ended the same way before the return; no behaviour changes.

Validation: `bun run typecheck` exit 0; `bun test test/http/cors.test.ts` passes.

**fix(runtime): keep the Location warm so idle eviction does not close the listener** ([`deefd2a`](https://github.com/jjjermiah/opencode-plugboard/commit/deefd2ab38f4026fed0d0e4f70fbbd25b5b93bde))

OpenCode's LocationActivity evicts a Location after 60 minutes with no durable session event that carries it, and eviction closes the Location's scope. Plugboard's listener lives in that scope, so an idle server went deaf after an hour. The TTL is hard-coded upstream (no config key, no env var), so plugboard keeps its own Location warm.

What: an accepted generation forks a loop into its plugin scope. Setup still only registers and returns (I1). Every 30 minutes the loop renames one dedicated session, "plugboard keep-alive", with ctx.session.update. A rename is the session.renamed durable event, and the bus stamps it with the publishing fiber's Location, which is this plugin's Location, so the eviction timer restarts. The session is created once, is deny-all, is never prompted, and its id lives in ctx.storage under keepalive/session. A deleted session is recreated. It is never registered with the session store, so it is not indexed, pruned or counted in usage. One loop runs per process: Registration.keepAliveOwner hands the lease to one live generation and passes it on when that generation leaves. VERSION goes to 16 because the runtime shape changed (I6). Option keepAlive (default on) and the keepalive.ts module are new; the parse in src/config.ts is the one option.

Rejected: a session in the data root. The touch is keyed by the publishing Location, not by the session's, so the session's location buys nothing, and creating a session there boots another Location. A warm-up call does not reset the timer (only durable events do). The warming option stops 30 minutes after the last real activity, so it does not help either.

Evidence (OpenCode v2.0.26): packages/core/src/location-activity.ts (touch on a durable session event with a location, 60 minute TTL), session.ts rename, bus.ts publish (location from the caller's Location service), projector.ts (session.renamed sets time_updated). Live on the isolated dev server with PLUGBOARD_KEEPALIVE_INTERVAL_MS=60000: session ses_ecce45d68ffedmXR6QNPVlw3B2 had time.updated advance by 60 s per interval (871559, 931566, 991573 ms) and sat in the plugin's Location. The 60 minute TTL itself was not reproduced: it is not configurable, so the live run shows the durable event the TTL counts, not the eviction.

Tests: test/runtime/keepalive.test.ts covers the loop starting after setup, a touch per interval, create once, rename a stored session, recreate a deleted one, stopping with the generation, no loop with keepAlive false, one loop per process with failover, and the session staying out of history and usage. Mutation I1-keepalive-setup-waits is killed by that file.

Fixes #310

**fix(http): /plugboard/status takes the admin key** ([`7e7e663`](https://github.com/jjjermiah/opencode-plugboard/commit/7e7e66341ce903f204de7f03c723e142ea7eb3e7))

GET /plugboard/status answered 401 to the adminKey. Usage, metrics and the admin routes all accept it, so monitoring had to borrow an app key or fall back to the probes. Status is an operator view that names no app, so the admin key now reads it, answered without an app.

What: src/openai/route.ts checks the admin key for GET /plugboard/status before the general authenticate step. The admin key stays out of the model routes, and every other credential goes through the same rules as before. buildStatus takes no app for the admin key (src/discovery.ts), and its models count is the catalog's available models without an app policy.

Docs: docs/configuration.md has one table, "Which key opens which route", for every /plugboard/ route and its four credentials. It also documents the keepAlive option (see the previous commit). CHANGELOG.md [Unreleased] gets both fixes.

Tests: test/http/plugboard-key-rule.test.ts checks every /plugboard/ route with none, app, admin and wrong keys over loopback, the app-scoped usage 403, and the admin key's 401 on the model routes. The test-count and coverage floors are ratcheted (test/http and test/runtime rose).

Live: the isolated dev server returned 200 for the admin key on this branch (runtime v16), and 401 invalid_api_key on the main checkout, which is the bug.

Fixes #311

#### Tests

**test(gates): raise the test-count and coverage floors for the security options** ([`0b16352`](https://github.com/jjjermiah/opencode-plugboard/commit/0b16352bf38974b205bb3dfbf357c657c1fb644e))

The five security options added tests across unit, http and session (#271, #268, #259, #256, #266). Ratcheted with `bun .github/scripts/test-gates.ts .coverage --ratchet`, which only raises: test counts per layer and line and function coverage of index.ts and src/ are now at their measured values (total 98.6% lines, 94.4% functions). Floors were not lowered.

Validation: `bun test --coverage` 2263 pass, 0 fail; test-gates exit 0 with "All floors met".

**test(mutations): repoint I16-keyless-origin-allowed at the CORS-aware refusal** ([`6d8a631`](https://github.com/jjjermiah/opencode-plugboard/commit/6d8a63137be5bb7286e0bfffa74b507289d37177))

#256 changed the keyless Origin refusal in checkOrigin to allow an origin on the cors allowlist. The entry's find text no longer occurred, so the mutation run reported an anchor failure (1 of 52 not run). The entry keeps its id and its intent: the refusal is switched off and the ingress test must fail. The new find text includes the corsOrigin check.

Validation: `bun run mutations -- --only I16-keyless-origin-allowed` killed (2 failing test lines); full `bun run mutations`: 52 of 52 killed.

#### Docs

**docs: point the endpoint names link at its heading slug** ([`04c5427`](https://github.com/jjjermiah/opencode-plugboard/commit/04c54277b0069e8e4be1930dfbe71e72d02b1267))

The link to the endpoint names section used #endpoint-names. The heading is "Endpoint names (since 0.26.0)", so its slug is endpoint-names-since-0-26-0. VitePress does not fail on a dead anchor, so docs:build passed with the wrong link.

**docs(changelog): notes for 0.26.0 and pin the install examples** ([`bf2de8b`](https://github.com/jjjermiah/opencode-plugboard/commit/bf2de8baedad503e922e55c431aa6be84e304f98))

Adds the summary line for the unreleased security options (#271 #268 #259 #256 #266), the location keep-alive (#310) and the admin key on /plugboard/status (#311), whose notes the lanes already wrote. Bumps the pinned install examples to 0.26.0 so the release ships right after the merge instead of waiting for the per-app options lane.

#### CI and tooling

**ci(ci): wait up to ten minutes for npm before attesting** ([`0e9ec6c`](https://github.com/jjjermiah/opencode-plugboard/commit/0e9ec6c180bd34bd36f8a4ab931a2071fcd3e121))

The 0.25.1 attest job failed with an empty served integrity: npm had accepted the publish but did not serve the new version's metadata within the two minutes the check waited. Re-running the failed jobs a few minutes later attested the same tarball and created the release, so the bytes were right and only the wait was short.

The check now polls for up to ten minutes, fails at once on a real digest mismatch, and says when the version never appeared, with the re-run as the next step. actionlint passes.

**ci(ci): compare the PR head with its base in one job, not a laptop baseline** ([`278fd0e`](https://github.com/jjjermiah/opencode-plugboard/commit/278fd0e1d7da1d133939b9b00d72f14e55676865))

The advisory request-path benchmark job failed on every PR since #118. The committed baseline (.github/floors/bench-baseline.json) was recorded on an M4 laptop, and the Ubuntu runner measured 2-5x slower on every row, including paths the PR does not touch. The gate could not tell a regression from a machine difference.

Compare like with like. The bench job now runs on pull requests only and checks out the PR's base commit (pull_request.base.sha) into base/ next to the PR head. Both trees install with the frozen lockfile and run test/bench/request.bench.ts --json on the same runner, one after the other, then bench-gate.ts compares base.json with head.json.

- Gate fails when a head median is more than 1.5x its base median (was: 2x against a foreign baseline). A benchmark that ran on the base and not on the head fails too, so a rename is said out loud. A new benchmark never fails.
- Baseline file removed. Nothing else read it, and a committed number from another machine is the thing this change removes. --update is gone.
- Local use compares two runs on one machine (documented in test/README.md).
- Job stays advisory (continue-on-error). Non-PR events skip it: a push to main has no base to compare with.

Why run both instead of a workflow_dispatch baseline: a full bench run is about 13 s on a laptop and 23 s for the pair (measured locally), so two runs in one job fit well under the 10 minute timeout and need no baseline PR to keep in sync. Measured locally: base and head of the same tree gave ratios of 0.98x to 1.10x on every row.

Docs: test/README.md (the new comparison and local recipe), CONTRIBUTING.md (the gate description, no longer a baseline to move).

Closes #315

</details>
<!-- commit-detail:end -->

## [0.25.1] - 2026-10-12: Front Door, Unlocked

**Full diff:** [v0.25.0...v0.25.1](https://github.com/jjjermiah/opencode-plugboard/compare/v0.25.0...v0.25.1)

0.25.0 was tagged but never published: its publish run stopped at a CI gate, so npm never had it. This release is 0.25.0's content, published. Read the [0.25.0 notes](#0250---2026-10-12-its-own-front-door) for the breaking route moves and the new defaults.

### Added

- **Runnable examples that check themselves** ([#175](https://github.com/jjjermiah/opencode-plugboard/issues/175), [#176](https://github.com/jjjermiah/opencode-plugboard/issues/176), [#185](https://github.com/jjjermiah/opencode-plugboard/issues/185), [#177](https://github.com/jjjermiah/opencode-plugboard/issues/177)). `examples/curl` and `examples/openai-python` run every scenario (chat, tools, streaming, images, structured output, models, errors) against a scripted plugboard in CI and against a live one on demand, and commit their results under `runs/`. `bun examples/_harness/run.ts <example> --target scripted|live` runs one.

### Fixed

- The scripted example runs recorded the curl, bash and Python versions of whoever ran them, so CI saw them as stale and blocked the 0.25.0 publish. They now record only pinned versions.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (2 commits)</summary>

#### Tests

**test(examples): record only pinned versions in the scripted runs, so CI matches a laptop** ([`df231e6`](https://github.com/jjjermiah/opencode-plugboard/commit/df231e66acd18bc8d17806d5c835ad4f96da7f33))

The Examples job in CI failed on PR #303. The committed scripted runs recorded the local host's versions (curl 8.7.1 on bash 5.3, Python 3.13), and the CI runner has curl 8.5.0, bash 5.2 and Python 3.12. A scripted run must not depend on the machine it ran on, so this fixes the inputs rather than the check.

examples/openai-python and examples/_harness/smoke-py get a .python-version pinning 3.13. uv then runs the same interpreter everywhere, including the CI runner, which downloads it.

curl and bash have no lockfile, and their minor versions differ between hosts. The curl runner now reports their major version only (curl 8, bash 5). The schema accepts a major-only runtime version, and the contract in #174 says so: a system tool records its major version. Live records already committed keep their full versions. They match the schema as before and are not rewritten.

The scripted runs are regenerated and checked twice, with git diff --exit-code clean after the second pass. openai-python and both smoke runs did not change, since their pins already gave the same values.

Refs #174, #177, #185

#### Docs

**docs(changelog): notes for 0.25.1, which publishes 0.25.0** ([`6146673`](https://github.com/jjjermiah/opencode-plugboard/commit/6146673ac418500aa337ce2e7b68d5b6671d8461))

The 0.25.0 tag's publish run stopped at the new Examples gate: the scripted example runs had recorded the local curl, bash and Python versions, which differ on the CI runner. That was fixed on main in #306, after the tag. Re-running the publish on the 0.25.0 tag would hit the same commit, and moving a pushed tag rewrites shared history, so 0.25.1 publishes the same content plus the fix. The notes say 0.25.0 never reached npm and point at its breaking-change section. Install pins move to 0.25.1.

</details>
<!-- commit-detail:end -->

## [0.25.0] - 2026-10-12: Its Own Front Door

**Full diff:** [v0.24.0...v0.25.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.24.0...v0.25.0)

### Breaking

No users yet, so these changes ship without a deprecation period. Old paths are not aliased (except the two probes): each returns its namespace's 404.

**Routes moved under `/plugboard/`** ([#253](https://github.com/jjjermiah/opencode-plugboard/issues/253)). The model routes did not move.

- `GET /v1/usage` is now `GET /plugboard/usage` (the usage RPC is unchanged).
- `GET /v1/admin/keys`, `POST /v1/admin/keys` and `DELETE /v1/admin/keys/{keyId}` are now `/plugboard/admin/keys` and `/plugboard/admin/keys/{keyId}`.
- `GET /v1/status` is now `GET /plugboard/status`.
- `GET /metrics` is now `GET /plugboard/metrics`.
- `GET /dashboard` and its files are now `GET /plugboard/dashboard` and `/plugboard/dashboard/*`.
- New `GET /plugboard/health` and `GET /plugboard/ready`. `GET /healthz` and `GET /readyz` stay at the root for probes, with the same answers.

**Errors under `/plugboard/` are problem details** ([#254](https://github.com/jjjermiah/opencode-plugboard/issues/254)). Every error on a `/plugboard/` route is `application/problem+json` (RFC 9457) with `type` (an anchor in the new [error page](https://jjjermiah.github.io/opencode-plugboard/errors)), `title`, `status`, `detail`, `instance`, `code`, `param` when there is one, and `requestId`. A client that read `error.code` from these routes now reads `code`, and `error.message` is `detail`. The model routes keep their provider's error shape (OpenAI, Anthropic, Gemini), unchanged.

**New defaults**

- `history` keeps sessions for 30 days ([#158](https://github.com/jjjermiah/opencode-plugboard/issues/158)). Before, it kept them forever. Set `history: { maxAgeDays: 0 }` to keep them forever. The index that makes pruning possible is now always on, so sessions created before 0.25.0 are not indexed and are never pruned. OpenCode's own backups keep copies of pruned sessions.
- `maxTools` defaults to 64, up from 32 ([#242](https://github.com/jjjermiah/opencode-plugboard/issues/242)): Claude Code sends 36 tools per request and was refused. Each slot is a registered placeholder tool; registering 64 costs a few microseconds and about 20 KiB per Location.

### Changed

- The usage dashboard reads `/plugboard/usage` and shows the `detail` of a refusal.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (9 commits)</summary>

#### Tests

**test(examples): add scenarios, scripted model and server, and the summary schema** ([`dcd0046`](https://github.com/jjjermiah/opencode-plugboard/commit/dcd0046f9063f794d0789f21864980df7b2b1829))

The examples harness starts here (#175 of the runnable-examples epic #174). Every client example will be run against the same nine scenarios (S1 to S7, E1, E2), so the prompts, models, checks and routes live in one file, examples/_shared/scenarios.json, and the fixtures the scenarios need are copied from compat/fixtures so that compat/ can be deleted later without breaking the examples.

examples/_harness/scripted-model.ts answers only the exact prompts in scenarios.json: pong, a get_weather call then "18 C and cloudy", red when a PNG data URL arrived, and the meal JSON both as text and as a forced tool's arguments. Anything else returns an error event, so an unknown prompt fails a scenario. It is built on FakeModelCaller and ev from test/support, the fakes the HTTP tests already use.

examples/_harness/scripted-server.ts serves the real OpenAI-compatible route on a port it binds (--port, default ephemeral). startRoute from test/support always listens on an ephemeral port, so this file builds the same route itself. The app is compat with a fixed local key, the models are the two live ids, and fast is an alias for Claude Haiku. Checked by hand with curl: /v1/models lists fast, anthropic/claude-haiku-4-5 and openai/gpt-5.6-luna#low; a text prompt gets pong; the weather prompt gets a get_weather tool call; a wrong key gets 401; model nope gets 404 model_not_found.

run.schema.json is the source of truth for summary.json. The golden fixture validates against it, and test/unit/examples-harness.test.ts proves a missing verdict and an unknown status are rejected. The date field is a regex, not ajv's date format, because ajv-formats is not a dependency. The harness has its own tsconfig, added to the root typecheck script, and examples is in the commitlint scope list. The root .gitignore ignores .venv, __pycache__ and the raw capture directory.

Checked: tsc on examples/_harness, bun test test/unit/examples-harness.test.ts (3 pass), the curl probes above.

Closes #175

**test(examples): add the capture proxy, the orchestrator and the deterministic writer** ([`492cfec`](https://github.com/jjjermiah/opencode-plugboard/commit/492cfecbb47b6aa8e0db4b96950be2dcb3aececc))

Part of the runnable-examples epic (#174). After #175 there was a scenario list and a scripted server, but nothing that ran a client through them or wrote the result. This adds the pipeline: bun examples/_harness/run.ts <example>|all --target scripted|live.

capture.ts is the capture proxy, ported from compat/tools/logproxy.py. It streams responses through untouched, records each exchange tagged with the scenario mark that was current when the request started, and waits for in-flight requests before it accepts the next mark. A request outside the scenario's routes goes to _background.json. logproxy.py stays until the cleanup issue deletes it.

run.ts starts the scripted server in process (or attaches to a live one), starts the capture proxy, starts the example's runner (uv run --frozen for a pyproject.toml, bun for run.ts, bash for run.sh) with PLUGBOARD_BASE_URL, PLUGBOARD_KEY and PLUGBOARD_CAPTURE_URL, reads its JSON lines, slices the exchanges by mark, and writes. It exits 1 when a required scenario fails. Live directories are dated and commit-named, take a -2 suffix on a collision, and are never rewritten. Scripted directories are replaced.

normalise.ts applies the Contract's rules: an allow-listed header set, id placeholders numbered by first appearance in each file (so a turn-1 call id is the turn-2 tool_call_id), the plugboard URL replaced everywhere, the Gemini key parameter removed, and SSE parsed into frames with keepalive comments dropped. Model ids on a GET of a models route are kept as names. render.ts is the one writer: it validates summary.json against run.schema.json, refuses any file that contains the app key, renders summary.md, and only then writes.

py/harness.py and ts/harness.ts are the runner helpers, about the same size, and apply the same checks from scenarios.json to the same observations. They mark each scenario, print one JSON line per result, and write nothing.

The smoke examples (examples/_harness/smoke-py and smoke-ts) are ports of compat/py/smoke.py and compat/js/smoke.ts. They run S1 on all three models through the whole pipeline, and their scripted runs are committed. examples/_tools/sessions.py is a copy of compat/tools/sessions.py.

Checked: two scripted runs of smoke-py and of smoke-ts, git diff --exit-code clean after the second run. A summary whose transcript carries the key is refused, with nothing written (unit test). bun run typecheck and bun test pass (2172 pass, 0 fail). The normaliser unit tests cover turn-consistent placeholders, URL and header rules, key removal, SSE frames and canonical JSON.

Closes #176

**test(examples): add a variant per API, number timestamps by occurrence, finish the runner protocol** ([`8858dd0`](https://github.com/jjjermiah/opencode-plugboard/commit/8858dd0549eaadda5a0990afd710e1c8fde5208c))

Part of the runnable-examples epic (#174). Writing the curl example (#185) showed three gaps in the harness, fixed here before any client depends on them.

A scenario runs once per API for curl: S1 on chat, responses, messages, gemini and completions, and S2 and S3 on chat, messages and gemini. Each run needs its own transcript, so the mark, the result line, the summary row and the transcript name carry an optional variant: transcripts/<scenario>.<variant>.<model-slug>.json. The contract change is in #174 (Scenarios, How a run works, summary.json); the observations keep the same names, so the checks do not change.

Timestamps were numbered by value, so two responses in one second shared a placeholder and a run that crossed a second did not. created and created_at are now <time-N> by occurrence. Gemini's unprefixed responseId is a key-based id. Both were caught by running the same example twice and diffing: the scripted runs must be byte-identical, and they now are for smoke-py, smoke-ts and curl.

The protocol got two safeguards. The helpers end the stream with a done line, and run.ts refuses to write a run whose runner did not reach it, so a crashed runner cannot record a partial run as a result. A result with no scenario is a fail row, not a silent gap. The model "-" (list models) is left out of the summary's model list and named none in its transcript.

Both smoke runs are regenerated under the corrected rules. Tests: the timestamp rule and the Gemini responseId rule are unit-tested in test/unit/examples-normalise.test.ts. bun run typecheck and bun test pass (2300 tests, 0 fail).

Refs #174, #176

**test(examples): add the curl example, one shell file per API, with scripted and live runs** ([`279c747`](https://github.com/jjjermiah/opencode-plugboard/commit/279c747f260a3ffae12219b7c1b6fba4d9f00407))

Part of the runnable-examples epic (#174). examples/curl/ is the first client example to run through the whole harness, and the only one for the Anthropic Messages and Gemini routes. It replaces the curl section of examples/README.md, which the docs issue will drop. That section is not changed here.

One file per API, each runnable on its own with curl and jq: chat.sh (S1 to S6, E1, E2), responses.sh (S1), messages.sh (S1 to S3), gemini.sh (S1 to S3, streamGenerateContent), completions.sh (S1) and models.sh (S7). Each prints one JSON object of observations, the names the checks in scenarios.json use. The copyable part of each scenario sits between region markers, so the docs can import it.

run.ts is the runner. It maps each scenario and API to its shell file and calls the shared TypeScript helpers, which mark, check and print. It writes nothing. The contract change for the API dimension (variant) is in #174 and in the harness commit before this one.

Scripted: runs/scripted/ is committed. Verdict pass: 37 rows, every required scenario passes on the scripted model. Two runs in a row, git diff --exit-code clean (see the harness commit for the timestamp and Gemini responseId fixes this surfaced).

Live (the isolated server; model ids fast, anthropic/claude-haiku-4-5 and openai/gpt-5.6-luna#low): two runs are recorded and neither is rewritten. The first failed on messages.sh's 64-token budget: fast routes to a reasoning model, which spent the budget on reasoning (REPORT.md there). The budget is now 1024. The second failed one chat S1 on fast with an unexpected tool call whose name holds the reply text; five calls made afterwards passed (REPORT.md there). That is recorded as an intermittent suspected bug, not as a gap.

Gotchas (README) are checked against these runs: tool arguments as a JSON string, the assistant turn sent back as received, percent-encoded Gemini model ids, accumulated stream arguments, the fake key of E1 never written, and /v1/usage left out because it takes the admin key.

Checked: bash -n on every shell file (the CI glob), the scripted run twice with git diff --exit-code, and the live run above.

Closes #185

**test(examples): add the OpenAI Python SDK example, with scripted and live runs** ([`e25102e`](https://github.com/jjjermiah/opencode-plugboard/commit/e25102eb227743e2eb06a8462901c9c19904ac85))

Part of the runnable-examples epic (#174). examples/openai-python/ replaces the OpenAI Python parts of compat/py. It is a standalone uv project with the exact pins from the 2026-10-11 record (openai 3.29.0, pydantic 2.14.1, httpx 0.28.1), locked in uv.lock.

One file per scenario, each with run(client, model) and a __main__ block: chat.py (S1), tools.py (S2), stream.py (S3, raw stream and the SDK helper, which must agree), stream_tools.py (S4), image.py (S5), structured.py (S6: beta parse with a Pydantic model, top-level parse, raw json_schema), models.py (S7: list and retrieve, which the old record had as a 404 and which is implemented now) and errors.py (E1 wrong key, E2 unknown model). run.py is the runner; it sets max_retries=0 so a retry never appears as a second request, and it writes nothing.

Scripted: runs/scripted/ is committed. Verdict pass, 17 rows, every required scenario and both optional error paths pass. Two runs in a row, git diff --exit-code clean. No key literal appears in any run file (checked).

Live (the isolated server): runs/live/2026-10-12-a38860b/ passes all 17 rows. The 2026-10-11 record is migrated unchanged to runs/live/2026-10-11-3fcedc7/REPORT.md. Its gaps are closed by the current code (models.retrieve), and the README says so.

Gotchas (README) come from docs/clients/openai-python.md and the record, and the ones this run can show (tool call ids are placeholders in the runs, so the id prefixes are marked as coming from the record) are labelled as such. The reasoning-in-content sample from the record did not reproduce.

Checked: uv lock, the scripted run twice with git diff --exit-code, the live run, the key literal scan of examples/, and the harness typecheck and tests (see the harness commit).

Closes #177

**test(examples): regenerate the curl scripted run for the 1024-token budget** ([`8a8210e`](https://github.com/jjjermiah/opencode-plugboard/commit/8a8210e8c254629094587690cd24972d013031c1))

The curl commit (279c747) changed messages.sh from 64 and 256 tokens to 1024 after its scripted run had been generated, so the committed transcripts still showed the old budget. The check that catches this is the one CI runs: rerun the scripted example and git diff --exit-code.

Seven transcripts change, all in max_tokens of the Messages requests (S1, S2 and S3). Nothing else in the run changes, and a second run gives no diff.

Refs #185

**test(http): keep the problem-docs anchor check in test/http** ([`87aebe7`](https://github.com/jjjermiah/opencode-plugboard/commit/87aebe70b11de08d63baf03ebe5eceab5e52a830))

The anchor check was in test/unit, which moved the per-layer test counts off their ratcheted floors in CI (test/http 461 of 462, test/unit 1109 of 1108). Moving the file back under test/http restores the counts exactly, so no floor is lowered.

The check reads docs/errors.md, so it stays out of the route tests: the mutation harness copies src and test but not docs, and runs only the files a mutation names.

Refs #254

#### CI and tooling

**ci(examples): check that the scripted runs of the curl and openai-python examples are current** ([`f5f1a1f`](https://github.com/jjjermiah/opencode-plugboard/commit/f5f1a1fd5496eec2471df77169c4e22b2faa07b1))

The examples epic (#174) makes every client example's scripted run a committed file. A run goes stale when its scenarios, the checks, a pinned client or the normaliser changes, and a run that is not deterministic goes stale on every commit. This job catches both on every pull request: it runs both scripted examples and fails when a file under their runs/scripted/ directories changed or appeared.

It takes about 5 seconds for the two runs. Bun is set up at the SHA the other jobs pin, and uv comes from pipx at the version the lockfile was made with, so no new action has to be pinned. The live runs are not in CI: they need the isolated server.

Alternatives rejected: a separate workflow (more setup for the same check), and running the examples without the diff (a passing run that changed a committed file would go unnoticed). The job runs in parallel with the others, as the host and compat jobs do.

Checked: js-yaml parses ci.yml (the new job has six steps); the same status check run locally on the current tree is clean; bun run build:tui, check-pack and docs:build pass.

Refs #174, #177, #185

#### Other

**feat(http)!: move plugboard routes to /plugboard/, problem+json errors, new defaults** ([`5caf0e2`](https://github.com/jjjermiah/opencode-plugboard/commit/5caf0e2a36f9a95787e4b6268079c412ef30697c))

Breaking wave for 0.25.0. No users yet, so no aliases except the probes.

#253: plugboard's own routes move under /plugboard/. The model routes do not move.
- /v1/usage -> /plugboard/usage (the usage RPC is unchanged)
- /v1/admin/keys[/{id}] -> /plugboard/admin/keys[/{id}]
- /v1/status -> /plugboard/status
- /metrics -> /plugboard/metrics
- /dashboard[/*] -> /plugboard/dashboard[/*] (the page fetches /plugboard/usage)
- new /plugboard/health and /plugboard/ready. /healthz and /readyz stay at the root.

Old paths are the namespace's 404, after authentication as I15 requires. The discovery pages list the new paths.

#254: every error on a /plugboard/ route is application/problem+json (RFC 9457): type (an anchor in docs/errors.md, else about:blank), title, status, detail, instance, code, param when there is one, and requestId. One encoder, sendProblem in src/http.ts. The router marks a response when its target is under /plugboard/ (invariant I25, mutation I25-plugboard-errors-problem-json). The dashboard shows detail. Model-route errors are unchanged, pinned per dialect in test/http/plugboard-routes.test.ts. /plugboard/ready answers a 503 as a problem (code not_ready); /readyz keeps its document.

#158: history.maxAgeDays defaults to 30. maxAgeDays: 0 is the explicit opt-out (keep forever); before, 0 was rejected. The history index is now on by default, so pruning runs for every app. Sessions created before this release are not indexed and never pruned.

#242: maxTools defaults to 64 (was 32). Claude Code sends 36 tools and was refused. Measured with the spy plugin context: installing the seed pool takes 5.7 us at 32 seeds and 7.0 us at 64, and retained memory per Location grows from about 11 KiB to 20 KiB.

Runtime VERSION is unchanged: the process runtime's shape did not change.

BREAKING CHANGE: plugboard's own routes moved. /v1/usage is /plugboard/usage, /v1/admin/keys is /plugboard/admin/keys, /v1/status is /plugboard/status, /metrics is /plugboard/metrics, /dashboard is /plugboard/dashboard. /healthz and /readyz stay at the root. Old paths return their namespace's 404.
BREAKING CHANGE: errors on /plugboard/ routes are application/problem+json. Clients that read error.code or error.message there now read code and detail.
BREAKING CHANGE: history.maxAgeDays defaults to 30 (was unlimited). Use maxAgeDays: 0 to keep sessions forever.
BREAKING CHANGE: maxTools defaults to 64 (was 32).

Closes #253
Closes #254
Closes #158
Closes #242

</details>
<!-- commit-detail:end -->

## [0.24.0] - 2026-10-12: Smaller, Faster, Stricter

**Full diff:** [v0.23.0...v0.24.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.23.0...v0.24.0)

OpenCode 2.0.27 support, a 95% smaller install, prompt-cache affinity, and a round of security and protocol fixes. One change can break a working setup: server tools now follow your OpenCode permissions (see Changed).

### Added

- **OpenCode 2.0.27 is supported and tested**, and 2.0.26 still works. Plugboard runs on the host's own `effect`, so one release serves both. CI now watches for new OpenCode releases every day: a passing one gets a pull request that merges itself, and a failing one opens an issue the same day.
- **Prompt-cache affinity** ([#80](https://github.com/jjjermiah/opencode-plugboard/issues/80)). Each request is a fresh OpenCode session, so providers that key their prompt cache on the session never saw a repeat. `promptCache` makes every request session a child of one long-lived anchor session per app (or per user), so the cache key stays the same:

  ```jsonc
  "promptCache": { "affinity": "anchor", "scope": "app" }
  ```
  Measured live on ChatGPT subscription models: 8 of 9 repeat requests read the cache, against 2 of 9 without it. Claude, Copilot GPT and Qwen already cache without it; GLM and Copilot Gemini cache in neither mode. Answers carry `x-plugboard-affinity`. A deleted anchor is recreated on the next request, and `maxAnchors` (default 1000) caps how many one app may hold. Reusing one session for a whole conversation was measured too and helped less, so it was not shipped ([#81](https://github.com/jjjermiah/opencode-plugboard/issues/81)).
- **`apps.<name>.maxServerToolCalls`** (default 16) caps server tool calls across all steps of a request ([#198](https://github.com/jjjermiah/opencode-plugboard/issues/198)). `maxServerToolSteps` still counts steps.
- **Single tool call on request.** `parallel_tool_calls: false` (Chat Completions, Responses) and `disable_parallel_tool_use` (Messages) keep only the first tool call and send `x-plugboard-parallel-tools: limited` ([#202](https://github.com/jjjermiah/opencode-plugboard/issues/202)).
- **Caller `cache_control`** on Anthropic message blocks reaches the model as a 5-minute cache breakpoint ([#275](https://github.com/jjjermiah/opencode-plugboard/issues/275); the 1-hour TTL is not carried yet). `x-plugboard-usage` adds `cache_write` ([#276](https://github.com/jjjermiah/opencode-plugboard/issues/276)).
- **Docs:** twelve more client pages (LobeChat, Chatbox, Jan, AnythingLLM, SillyTavern, Cline, Roo Code, LlamaIndex, Haystack, Mastra, smolagents, promptfoo), a structured-extraction recipe for Anthropic-only clients, and a banner on every page saying the docs follow `main`.

### Changed

- **Server tools follow your OpenCode permissions** ([#194](https://github.com/jjjermiah/opencode-plugboard/issues/194)). Before, `serverTools` could allow a tool your own agent rules deny. Now a listed tool needs an allow rule for it in the agent, or the request gets 400 `server_tool_denied_by_operator`, and the agent's deny rules still apply to the resources they name. **If you use `serverTools`, add an allow rule for each listed tool before upgrading.**
- **Smaller install** ([#190](https://github.com/jjjermiah/opencode-plugboard/issues/190), [#165](https://github.com/jjjermiah/opencode-plugboard/issues/165)). `effect` and `@opencode/plugin` are optional peers, since OpenCode provides them, so installing plugboard pulls 26 packages instead of 313 (about 13 MiB instead of 450). The package ships an `npm-shrinkwrap.json`, so OpenCode installs the exact dependency versions that were tested.
- **Provider overload** answers 529 `overloaded_error` on `/v1/messages`, and 503 `provider_overloaded` on the OpenAI routes, instead of a generic 502 ([#204](https://github.com/jjjermiah/opencode-plugboard/issues/204)).

### Fixed

- **Thinking blocks carry their signature** ([#146](https://github.com/jjjermiah/opencode-plugboard/issues/146)). Plugboard looked for the signature one level too deep in what OpenCode reports, so it was always empty.
- **Server-tool hardening** ([#195](https://github.com/jjjermiah/opencode-plugboard/issues/195), [#196](https://github.com/jjjermiah/opencode-plugboard/issues/196), [#197](https://github.com/jjjermiah/opencode-plugboard/issues/197)):
  - `subagent` and `task` are refused in `serverTools`, because each starts a session outside the request's rules.
  - A server tool call that runs after the request ended is logged and its session stopped.
  - The admin key can no longer mint a key for an app with `serverTools`.
- **`tools: false` keeps structured output** ([#252](https://github.com/jjjermiah/opencode-plugboard/issues/252)). It dropped the internal tool that answers `json_schema`, so structured requests failed. Now only the caller's tools are dropped.
- **`count_tokens` and Gemini `countTokens`** include the app's system prompt policy and tool-choice steering ([#201](https://github.com/jjjermiah/opencode-plugboard/issues/201)).

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (51 commits)</summary>

#### Features

**feat(http): report cache_write in x-plugboard-usage** ([`c8ea623`](https://github.com/jjjermiah/opencode-plugboard/commit/c8ea62305d746b02ad23398077ad0f944828cf57))

The per-response usage header carried cache_read but not cache_write, so a first-turn caller that paid for a cache write read cache_read=0 with no write figure and could not tell a write from a call with no cache. The cost part already priced the write (verified live: 3658 written tokens priced at the catalog write rate), so only the token count was missing.

CallTotals gains an optional cacheWriteTokens (optional so existing literals still compile; absent reads as 0). withUsage sets it from the provider's cache write count, reportUsage sums it over the choices of a fan-out, and formatUsage prints cache_write=<n> between cache_read and cost_usd. docs/configuration.md documents the new field.

Tests: the pinned header strings in test/unit and test/http gain cache_write=, a new formatUsage case shows a write, and withUsage prices a 300-token write at the write rate instead of as uncached input.

Fixes #276

**feat(config): cap server tool calls, not only steps** ([`b4ed699`](https://github.com/jjjermiah/opencode-plugboard/commit/b4ed699817b3658454837c99bb8d0f0b2dcfe2f7))

maxServerToolSteps counted steps, so one step could fan out to any number of parallel webfetch or bash calls. The host runs a server tool as soon as the model calls it, so by the time plugboard stopped a mixed step, its server calls had usually already run. The cap was never a bound on calls.

apps.<name>.maxServerToolCalls caps the calls across all steps of a request (default 16, 1 to 1000, needs serverTools). The call past it fails the request with 502 server_tool_calls_exceeded and interrupts the turn. maxServerToolSteps keeps its name and meaning; the docs now say it counts steps. The docs also say that a mixed step's server calls may already have run.

Tests: the collector tests cover the cap across steps, a mixed step past the cap (the caller's call is not returned), and the calls up to the cap. Mutation I9-server-tool-calls-cap-off breaks the check.

Fixes #198

**feat(openai): keep one tool call when the caller asks for it** ([`ba63ee9`](https://github.com/jjjermiah/opencode-plugboard/commit/ba63ee95f7e8253a1dcc3a28a5dee91a7be2f9eb))

Requests that set parallel_tool_calls to false (Chat Completions and Responses), or Anthropic's disable_parallel_tool_use inside tool_choice, were ignored, so an agent loop that runs one tool at a time could still get several calls with no signal. The docs said so.

Host check: the host can switch parallel calls off only through toolChoice.disableParallelToolUse (packages/ai/src/protocols/ anthropic-messages.ts) or a per-protocol provider option (open-responses, mistral, groq, alibaba, venice). plugboard's context hook cannot set toolChoice (the caller's choice is steered by instruction, not passed to the host), and the provider options differ by route, so no single route is guaranteed. The option was therefore enforced by plugboard, not the host.

The caller's flag now travels as PlugRequest.parallelToolCalls (false only). The decoders set it from parallel_tool_calls, or from tool_choice.disable_parallel_tool_use. The session caller passes it to the collector, which keeps the first caller tool call of the step and drops the rest (singleToolCall). The step still ends as tool-calls. Every route sets x-plugboard-parallel-tools: limited before any body, through reportParallelTools in src/policy.ts, so a stream gets it too. Responses still echoes the value it was sent, which is now true to what happens.

Rejected: reject false with unsupported_parameter (the caller asked for a behaviour it can get, and an agent loop would break), and steer by instruction only (best effort, which is the silent gap this fixes). A non-boolean parallel_tool_calls is a 400 naming the field.

Tests: decoder cases for Chat Completions, Responses and Anthropic; collector cases with and without the flag; Chat Completions and Messages HTTP cases for the header and the request flag. docs/configuration.md, docs/messages.md and docs/responses.md say what is enforced and where the header appears.

Fixes #202

**feat(anthropic): carry the caller's cache_control breakpoints to the model** ([`fedabc9`](https://github.com/jjjermiah/opencode-plugboard/commit/fedabc91824382a7f57ca7fdad45c38c0e5090df))

A caller's cache_control on a message block was accepted and dropped, so the caller could not choose what was cached. OpenCode still caches by its own default policy, and the host's cache policy keeps any breakpoint already set on a part, so the caller's breakpoint can ride along on the part.

PlugPart text, media and tool-result parts gain an optional cache flag. The Anthropic decoder sets it from cache_control: ephemeral on a text, image, document or tool_result block (src/anthropic/request.ts, cached()). The context hook writes the host's ephemeral cache hint on the matching host part (src/session/context.ts, EPHEMERAL), and for a media part it keeps the hint through the attachment swap. applyCachePolicy (packages/ai/src/cache-policy.ts) counts those manual breakpoints against its four and fills only the rest, so the caller decides what is cached, and the total never exceeds four.

Not carried, and documented in docs/messages.md:

- ttl "1h". The host sends a 1h breakpoint only when the cache policy asks for one, and plugboard has no way to set the policy from the hook. Also, the host's own automatic tool and system breakpoints are 5-minute ones. Anthropic requires a longer TTL to come before a shorter one, so a 1h breakpoint after them is rejected. A 1h caller breakpoint therefore becomes the default 5 minutes. The ordering rule comes from the Anthropic docs; it was not checked against a live request.
- cache_control on system and tools. The hook sets system parts as plain text, and copies only description and input schema of a tool, so the hint would be lost. Documented as ignored.
- Opting out. Caching cannot be turned off per request (no cache policy reaches the hook), so the caller can only add breakpoints.

Tests: the decoder for text, image, assistant text and tool_result (with ttl ignored, and no field when absent); the hook maps each to the host's hint; an HTTP check that the model call receives the breakpoint.

Refs #275

**feat(session): anchor request sessions for a stable prompt-cache key** ([`6d782d2`](https://github.com/jjjermiah/opencode-plugboard/commit/6d782d2eca7c0f9d03a2347c1c562da47315422f))

Every plugboard request was a new top-level session, so OpenCode's affinity (the session id, packages/core/src/session/affinity.ts) changed on every request, and the provider cache key with it.

Option `promptCache`, global or per app as `apps.<name>.promptCache`: `affinity: "anchor"` makes each request session a child of one anchor session per scope key (`scope: "app"`, or `"user"` for the end user). The anchor is made once, stored in host storage, never prompted and never pruned. Default `off` is unchanged. Responses of an anchored app carry `x-plugboard-affinity: anchor`.

Measured live on the dev server (OpenCode v2.0.26). Cache reads on runs 2-4 of a repeated ~4000 token prompt, one unique prompt per set:

  model                          off      anchor   session (dropped) openai/gpt-5.6-luna#low        2/9      8/9      4/9  (3 sets) github-copilot/gpt-5.5         3/3      3/3      2/3  (1 set) opencode-go/qwen3.8-flash      3/3      3/3      3/3  (1 set) anthropic/claude-haiku-4-5     3/3      3/3      3/3  (1 set) opencode-go/glm-5.3-flash      0/3      0/3      0/3  (1 set) github-copilot/gemini-3.8-flash 0/3     0/3      0/3  (1 set)

Only ChatGPT subscription models gain. The others already cached with `off`, or showed no cache reads in any mode.

Shared-session mode (one session per key, reused) was prototyped and measured at 4/9 against 2/9, not a clear gain, so it was dropped with the conversation scope (`x-plugboard-conversation`), which was never measured.

Fixes #80
Refs #81

**feat(session): cap anchors per app with promptCache.maxAnchors** ([`6acc2c8`](https://github.com/jjjermiah/opencode-plugboard/commit/6acc2c8cc1165fc8dcaaca35a6cde48481c7ec8f))

Under scope "user", every new end user made one anchor session that was never removed, so the count grew without a bound.

promptCache.maxAnchors (default 1000, positive integer, global or per app through the promptCache option) caps the anchors one app may hold. The count is the anchors stored for the app, read with one bounded scan when an anchor is about to be made. A key beyond the cap gets no affinity: the request runs as a top-level session, as it did before. Concurrent first requests from new users can briefly pass the cap.

The response header x-plugboard-affinity now says what happened under anchor mode: "anchor" when the request is under its key's anchor, "none" when it got none (no user under scope "user", or the cap is reached). It stays absent when the policy is off.

Pruning already never touches anchors: history indexes only sessions registered by a request, and anchors are never registered, so the history sweep never sees them (tested). Removing an anchor is documented: delete its session in OpenCode, and the next request recreates it (previous commit). The cap counts stored records, so deleting does not free a slot.

Refs #80

#### Fixes

**fix(config): refuse subagent and task as server tools** ([`95b614f`](https://github.com/jjjermiah/opencode-plugboard/commit/95b614f515df7c2680883173a9403df768b13ac6))

subagent and task start a child session. The child runs with its own agent's rules, not the request session's deny-all, so listing one would let a caller reach every tool that agent allows. Both are now rejected at config load, next to execute and the seed names. The config tests pin the rejection and mutation I8-server-tools-reject-subagent breaks it.

Fixes #195

**fix(http): refuse runtime keys for apps with server tools** ([`1d17dd0`](https://github.com/jjjermiah/opencode-plugboard/commit/1d17dd075bb0cd692995beec620b9c6474ca5395))

POST /v1/admin/keys minted a runtime key for any app that had no key in the config. A key for an app with apps.<name>.serverTools lets its holder run OpenCode tools on the server, so the admin key holder could hand that power to anyone. The route now answers 409 app_has_server_tools before the config-key check, and the docs say so. The config already rejects a serverTools app without a config key, so this guard is defense in depth: the test gives the app a config key and checks the route's own refusal. The mutation I25-admin-mints-key-for-server-tools-app breaks it.

Fixes #197

**fix(session): keep the structured respond tool when tools is off** ([`9e89eec`](https://github.com/jjjermiah/opencode-plugboard/commit/9e89eecbb0bf69c5a0f4f47f3f63ef760ef96ac9))

An app with tools: false dropped every tool in the request, including the respond tool that carries a json_schema answer. A tools-off app therefore lost its structured output without any error, and the karakeep docs warn against it. The front-ends now mark the structured tool on the request (structuredTool in src/contract.ts). With tools: false the caller drops only its own tools, keeps respond and forces it, and reports tools-stripped only when a caller tool was actually dropped. A caller tool named respond on a request without structured output is still dropped.

Tests: the session policy tests cover the kept respond tool, the forced choice and the note; the chat, Responses, Gemini and completions decoder tests pin the structuredTool marker. Mutation I9-tools-off-drops-structured-tool breaks the kept tool. Messages has no structured output (output_config.format is refused), so it has no path to keep.

Fixes #252

**fix(anthropic): answer a provider overload as 529 overloaded_error** ([`5bf0f53`](https://github.com/jjjermiah/opencode-plugboard/commit/5bf0f533a12ccc810902b2b4cd192a656609e6a0))

The docs listed overloaded_error (529) among the Messages errors, but nothing produced a 529. The host reports a provider failure as a provider.* error with the provider's HTTP status when it has one, and an overload that arrives inside a stream (an overloaded_error event) has no status, so it reached Anthropic clients as a 502 api_error. The SDKs and Claude Code retry 529 with backoff and do not retry a 502 the same way.

events.ts now classifies a provider overload (its own 529, or an "overloaded" signal in the message or body) as a neutral error with code provider_overloaded, sent as 503 so the OpenAI routes keep an honest status. Other 503s stay provider_unavailable. The Messages route maps provider_overloaded to HTTP 529 with overloaded_error (messagesStatus in src/anthropic/response.ts, used by the route's fail). Stream failures after output keep their error event as before.

Alternatives: map every 503 to overloaded (rejected: a generic 503 is not a retry signal Anthropic clients use), or drop 529 from the docs (rejected: the host does report overloads, so the signal is available).

Tests: collector mapping cases for a 529, an overloaded_error body and an overloaded message without a status; encodeError and messagesStatus; and a Messages HTTP test for the 529 status and body. docs/messages.md now states the mapping, and the OpenAI-route answer is 503 server_error.

Fixes #204

**fix(session): stop server tools that run after the request ended** ([`7d14d27`](https://github.com/jjjermiah/opencode-plugboard/commit/7d14d2757105a523057516c3c19a5050d618acb8))

Once the response was over (client gone, timeout, answer returned), the collector dropped session.tool.called events. A server tool call that still ran was then neither counted nor logged, and the turn was only interrupted once. If that interrupt lost the race with the runner (#14), the listed server tools kept running with no step cap until the cleanup timeout. Apps without server tools were safe, because the deny-all backstop blocks every tool; apps with server tools were not.

The collector now logs a late server call once as server_tool.after_request (tool, lateCalls, serverCalls, serverSteps), never with arguments. A step that ran a late server call stops the turn again. The step and call caps keep their counts for the whole session lifetime, since the guard is held until the host reports the end of the execution.

Tests: fake-session tests cover a late call after cancel, a repeated call id logged once, a caller call ignored, and an end-to-end answer returned followed by a late server call that interrupts the session. Mutation I12-late-server-call-not-stopped breaks the stop.

Fixes #196

**fix(session): honour the operator's permissions for server tools** ([`264d039`](https://github.com/jjjermiah/opencode-plugboard/commit/264d039d096e31b4e037e2f211b5684956c95d82))

A listed server tool got a bare allow in the request session. The host takes the last matching rule and the session's rules come after the agent's, so that allow beat any narrower rule the operator wrote for the tool. With read: { "*.env": "deny" } in the agent, serverTools: ["read"] still read .env files.

Host mechanism (anomalyco/opencode v2.0.26): Permission.configured merges merge(agent.permissions, session.permissions) (packages/core/src/permission.ts around line 162), and evaluate takes findLast (line 91). The agent's rules come first, so the session's rules decide.

The session now gets, per listed id: a deny for every resource, then the agent's own rules for that id in their order, rewritten to the id. A resource the agent names keeps the agent's decision. Any other resource is denied, and an ask is a deny, because a request session cannot answer a prompt. A listed id needs an allow rule in the agent: without one the request is refused with 400 server_tool_denied_by_operator before anything is created. The agent is read per request (SessionPort.agentRules), the persona's agent or the selected default.

This is a behaviour change for apps with serverTools: an operator whose agent has no allow for the tool must add one. Apps without serverTools are unchanged. The mutations I8-server-tool-no-rule-allowed and I8-server-tool-ask-as-allow break the two rules.

Fixes #194

**fix(anthropic): pass the provider's thinking signature through** ([`62aad52`](https://github.com/jjjermiah/opencode-plugboard/commit/62aad52112782ae9024e64fcb7092c519eb41f28))

Thinking blocks went out with signature "" even though the host reports the provider's signature. The host publishes it on session.reasoning.ended as the block's provider metadata (packages/core/src/session/runner/ publish-llm-event.ts: reasoning-end -> providerState(event.providerMetadata), and the Anthropic protocol puts the signature there, anthropic-messages.ts). So the host does expose it, and the empty signature was a gap, not a limit.

The collector now maps session.reasoning.ended to an empty-text reasoning-delta that carries the signature, and only when the metadata has one (signatureOf, src/session/events.ts). PlugEvent's reasoning-delta gains an optional signature rather than a new event type: the OpenAI, Responses and Gemini encoders already skip reasoning-delta, so they need no change. The Messages encoder sends a signature_delta before the thinking block stops (the SDK accumulator takes the signature from it) and keeps the signature in the non-streamed body. The response cache keeps the signature as its own event, so a cache hit replays it after the block it closes. Without a signature the block stays empty, as before.

Replayed thinking is still dropped on the way in (src/anthropic/request.ts), so a client that sends the block back to plugboard never forwards the signature to a provider. The pass-through matters to a client that keeps a transcript and sends it to Anthropic directly.

Alternatives: keep the empty signature and document it (rejected: the host does carry the value, and the issue asked for it), or omit thinking blocks unless asked (already the case; it cannot help a caller that asked for them).

Tests: collector cases with and without a signature, encoder cases (a signature_delta and the aggregated block; a signature ignored without thinking), a cache replay case, and a request case for a replayed block with an empty signature.

Fixes #146

**fix(anthropic): count the system prompt plugboard adds in count_tokens** ([`5aa6c25`](https://github.com/jjjermiah/opencode-plugboard/commit/5aa6c2557f39c06bee007898fe5d65de58f0a601))

count_tokens (Anthropic) and countTokens (Gemini) estimated only the caller's parsed request, so the count left out what plugboard sends: the app's system policy and the tool-choice steering sentence. Claude Code sizes and compacts its context against that count, so an app with a long policy looked smaller than it was.

The system prompt is now built by one function, requestSystem in src/session/context.ts: the skill prelude, the caller's prompts with the app's policy applied (prepend, append or replace), then the steering sentence. The context hook sends that list, and both count routes count the same list, so the two cannot drift. The Messages and Gemini routes pass the app's policy in.

Still not counted, and now listed in docs/messages.md and docs/gemini.md: an agent's prompt (it replaces the caller's system prompt) and a skill's content (prepended), because both come from the OpenCode session's lookups, which the count path has no port for; and the schemas of the app's serverTools, which the host supplies per session. An app that uses those can still be counted low. Closing that needs the session port in RouteHost (index.ts wiring), which is a separate change.

Tests: requestSystem order and policy modes, the steering sentence, and the skill prelude (unit); a count over HTTP with an app policy for Messages and Gemini, which must differ by exactly the policy's 100 tokens.

Refs #201

**fix(session): recreate a deleted prompt-cache anchor once** ([`b65b83d`](https://github.com/jjjermiah/opencode-plugboard/commit/b65b83db7a9ea298d48d7b5f91f80a2e9985e2f7))

When the anchor of a key is deleted in OpenCode, creating its next child session fails with the host's Session.NotFoundError. Plugboard kept reusing the stored anchor id, so every request on that key failed.

The host port now reports that failure as MissingParentError (the failure is captured as a value first, so the promise rejects with the typed error). The caller then forgets the stored anchor, makes one new anchor, logs affinity.anchor_recreated and retries the child create once. A second missing-parent failure fails the request (502 backend_failed); it never loops.

Tests: the host mapping (missing parent vs other failures), a stale anchor replaced and remembered by the next request, the single retry, and anchors never registered in the session store, so history pruning never sees them.

Refs #80

**fix(session): read the thinking signature from the unwrapped host state** ([`c85d701`](https://github.com/jjjermiah/opencode-plugboard/commit/c85d7014a406b84d494ba566cde0b447482ed325))

The live dev server still returned empty Anthropic thinking signatures after the earlier fix. OpenCode publishes a reasoning block's provider state already unwrapped from its provider key, so the state is just the signature object (providerState in publish-llm-event.ts returns the value under providerMetadataKey). The dev server database stores exactly that shape for claude-haiku-4-5 with the high variant. signatureOf only looked one level down, under a provider key, so it never found it, and the unit fixtures encoded the same wrong shape.

signatureOf now reads the signature at the top level first and keeps the wrapped form as a fallback. The collector test uses the unwrapped shape and fails on the old code; a second test pins the wrapped form.

Fixes #146

#### Tests

**test(tests): cover the response cache gaps from the caching audit** ([`607cafa`](https://github.com/jjjermiah/opencode-plugboard/commit/607cafae399b9e15104ad79dd7526c4d908ac6a9))

The caching audit checklist passed on code and on the existing tests, but several cases had no test. This adds them. Every new case passes on the current code, so no production change was needed; each one pins behaviour that a later change could break silently.

Keys (test/unit/cache.test.ts): stop, top_p, presence_penalty and frequency_penalty each make a different entry, an image with another URL is a different entry, and two end users with identical content share one entry (the end user is deliberately not part of the key). The response_format case (json_object vs json_schema) is an HTTP test.

Routes (test/http/cache.test.ts): the same app and resolved request on Chat Completions then Messages share one entry; response_format json_object and json_schema are different entries; a streamed hit on Responses, Messages and Gemini replays the stored text with no new model call; a non-streaming hit under withUsage carries x-plugboard-usage with zero tokens and cost_usd=0.000000.

Runtime (test/runtime/cache.test.ts): a persona model (a skill alias or agent/<name>) bypasses the cache, not only serverTools apps; a plain alias is still cached.

Usage (test/unit/usage.test.ts): the real cache wrapper under withUsage counts a hit in cacheHits and adds no tokens, which is what GET /v1/usage reports.

Store (test/unit/cache.test.ts): maxBytes counts the 128-byte entry overhead, so a payload just under the cap is rejected; this pins the accounting rather than the raw JSON size.

Fixes #278

**test(tests): raise coverage and test-count floors** ([`8f20c27`](https://github.com/jjjermiah/opencode-plugboard/commit/8f20c27b026bd292c3aa63a95f6b1c30067604c2))

The server-tool hardening adds tests for the session, config, admin and front-end request paths. The ratchet raises each floor to the value the suite now reaches; no floor is lowered. No issue is closed here: the fixes are in the commits before this one.

**test(ci): ratchet floors and fix stale mutation anchors after the merge** ([`4490ad9`](https://github.com/jjjermiah/opencode-plugboard/commit/4490ad95960200149c1da4f4a66acf848d3a9638))

Floors raised to the merged tree's measured values (never lowered).

Three mutation anchors went stale when the lanes merged: two caller and events anchors, and one rate-limit anchor that matched twice. Each is now unique in the merged source.

docs/configuration.md escapes a bare <name> in an error table cell, so the docs build passes.

**test(tests): describe LangChain's streamed input usage as its source does** ([`e372e56`](https://github.com/jjjermiah/opencode-plugboard/commit/e372e56328af02b814424c58dae548a63f2d8597))

The comment said LangChain sums message_start and message_delta usage to get the input count. @langchain/anthropic's message_outputs.js hard-codes input_tokens 0 in the usage_metadata of message_delta, so the streamed usage has no input count whatever the event reports. The comment now says that.

#### Docs

**docs(docs): replace homelab hosts and addresses with reserved examples** ([`4865c46`](https://github.com/jjjermiah/opencode-plugboard/commit/4865c4602d6ed82e85f83baabe72923d1b5fc078))

The docs and a released CHANGELOG entry used a real home network: private addresses (10.0.1.x), a LAN host name, and a real app name as the example key. AGENTS.md rules that out for the repo.

Swap in reserved values: 192.0.2.0/24 (TEST-NET-1) for addresses, a .example host for hosts, and my-app for the example app. The SparkyFitness self-hosted page stays. Its address was already a placeholder.

The CHANGELOG change touches only the host in the 0.20.0 entry. The src and test fixtures that use private ranges (SSRF checks need them) are not changed.

Fixes #192

**docs(docs): add LobeChat client page** ([`c228aa3`](https://github.com/jjjermiah/opencode-plugboard/commit/c228aa3d99328d9d48fe83984c52efd49f7bc833))

Adds docs/clients/lobechat.md with the two OpenAI-provider variables (OPENAI_PROXY_URL with /v1, OPENAI_API_KEY) and the model list.

The issue named CUSTOM_MODELS; LobeHub's env reference lists OPENAI_MODEL_LIST, so the page uses that. Verified against the LobeHub model provider env docs. Not run: LobeChat is a web app and the dev server on 127.0.0.1:4010 was not listening.

Adds examples/lobechat (compose + .env.example), the Clients sidebar entry, the README client row, and the examples index row.

Refs #208

**docs(docs): match packaging, the Vercel store note and the error table to the code** ([`cb31414`](https://github.com/jjjermiah/opencode-plugboard/commit/cb31414b182e87a67929cded5a7d658755bf230e))

Three places drifted from the code:

- packaging.md said ./rpc maps to ./src/rpc.ts and ./tui is not exported. package.json exports ./rpc as ./rpc.ts and ./tui as types ./tui.ts with default ./dist/tui.js, since the files moved to the package root.
- The README client table said the Vercel AI SDK default openai(id) call needs store: false for multi-turn. The Vercel page and the code agree the default store: true works: src/responses/store.ts keeps recent output items for an hour, so the item_reference the SDK sends back resolves.
- The error table in configuration.md did not list four codes the server returns: 413 (a body over 32 MiB, no code field), 415 unsupported_media_type, 400 invalid_user (the user query parameter of /v1/usage) and 502 structured_output_missing.

A test that compares src/ error codes against the table would stop the last one from drifting again. It is not part of this change, because it needs a test file.

Fixes #191

**docs(docs): add Chatbox client page** ([`c5cd6e6`](https://github.com/jjjermiah/opencode-plugboard/commit/c5cd6e6396d25adacb9cf71d999ff43fdddb9425))

Adds docs/clients/chatbox.md covering both provider types: OpenAI API compatible (API Host ending in /v1, default path /v1/chat/completions) and Google Gemini compatible (plugboard root host, generateContent).

Verified against Chatbox's provider guide. The Gemini host value is not in that guide, so the Gemini section is marked unverified in Chatbox. Not run: desktop/mobile app, and the dev server on 127.0.0.1:4010 was not listening.

No examples/chatbox directory: the app stores settings itself, so a setup note adds nothing a copyable file would.

Adds the Clients sidebar entry and the README client row.

Refs #209

**docs(docs): document the Anthropic system lift and buffered json_object streams** ([`de87b75`](https://github.com/jjjermiah/opencode-plugboard/commit/de87b75fc362db2910b5d825aef5efa960abe19d))

Two protocol exceptions were in the code and not in the docs.

- /v1/messages accepts role: "system" entries inside messages. Claude Code sends them for models it does not know, and the real API refuses them. The server lifts them out and appends them after the top-level system, in order (src/anthropic/request.ts). messages.md now says so.
- Legacy /v1/completions with stream: true and json_object buffers the whole answer and writes one chunk (src/completions/response.ts). json_schema has to wait for the respond call anyway. json_object could stream, and does not yet. completions.md now says so and links the Chat Completions behavior (#106). Streaming json_object is a code change and is left out of this docs fix.

Fixes #205

**docs(docs): add Jan client page and examples** ([`50f2d57`](https://github.com/jjjermiah/opencode-plugboard/commit/50f2d57d79b46e7294e9085c59f44940d94743fc))

Adds docs/clients/jan.md for the desktop custom-provider dialog (OpenAI and Anthropic API formats) and the jan config set route. Base URL is /v1 for OpenAI-compatible and the root for Anthropic-compatible.

Verified against Jan's custom endpoint and Jan Agent provider docs. Not run: GUI app, and the dev server on 127.0.0.1:4010 was not listening.

Corrects the issue's per-project agent.toml idea: Jan keeps that file under ~/.jan/projects/, outside the repo, so the example says so. The env var for a key on provider "plugboard" is PLUGBOARD_API_KEY, per Jan's <PROVIDER>_API_KEY rule.

Adds examples/jan (setup.sh, agent.toml.example), the Clients sidebar entry, the README row and the examples index row.

Refs #210

**docs(docs): add an Anthropic structured-extraction recipe with a forced tool** ([`c525fe1`](https://github.com/jjjermiah/opencode-plugboard/commit/c525fe1e03e0873c6349bef29b6d7224d57f7617))

The README says Anthropic structured outputs (output_config.format) are refused with a 400 and points to json_schema on the OpenAI or Gemini routes. An Anthropic-only client had no documented path to JSON.

A forced tool call gives one. Define a tool whose input_schema is the schema, set tool_choice to that tool, and read the input of the tool_use block. The issue (#284) reports 3 of 3 synthetic invoices validated with pydantic.

messages.md gets a section with a Python and a TypeScript snippet. It says the schema is not enforced, and that a named tool_choice is applied as an instruction, so the caller handles a text reply and validates the input. The README structured-output section and its known-gaps line link to it.

The snippets are not run in CI. Only the Python one was run, by the issue author, against a live server.

Fixes #284

**docs(docs): add AnythingLLM client page and example** ([`4bd4b2b`](https://github.com/jjjermiah/opencode-plugboard/commit/4bd4b2b526452ae29e086f63ff1cd3551f942049))

Adds docs/clients/anythingllm.md for the Generic OpenAI provider and examples/anythingllm/docker-compose.yml with the matching env vars.

Env names checked against server/.env.example on master: GENERIC_OPEN_AI_BASE_PATH, GENERIC_OPEN_AI_API_KEY, GENERIC_OPEN_AI_MODEL_PREF, GENERIC_OPEN_AI_MODEL_TOKEN_LIMIT. The issue named GENERIC_OPENAI_STREAMING_DISABLED, which is not in that reference; the page does not use it and says streaming is unverified. The docs page did not render the UI field list, so UI field names are marked unverified.

Not run: desktop/Docker app, and the dev server on 127.0.0.1:4010 was not listening.

Refs #211

**docs(docs): add SillyTavern client page and example** ([`83c7935`](https://github.com/jjjermiah/opencode-plugboard/commit/83c79353937c3bd78b71cfa36ac0e4f89794df2c))

Adds docs/clients/sillytavern.md for the Custom (OpenAI-compatible) Chat Completion source: endpoint with /v1 (no /chat/completions), key, model dropdown from /v1/models or a typed id, and Test Message.

Checked against SillyTavern's OpenAI API connection docs. The issue's field labels and its bug citation (#5275) are not in that page, so the page omits them. Not run: web app, and the dev server on 127.0.0.1:4010 was not listening.

examples/sillytavern/docker-compose.yml runs only the app. Its image tag is not pinned or checked against a release; the page says so.

Refs #212

**docs(docs): list packaging, TUI and the live matrix in the sidebar, and explain the failures** ([`517b768`](https://github.com/jjjermiah/opencode-plugboard/commit/517b7684c632cebe24fb9e616133559be2468f6f))

Three pages were built but linked from nowhere: packaging.md, tui.md and live-matrix.md. They are now in the Project group of the sidebar.

The live matrix reports 36 failing cells, with no note saying why. The run (2026-10-12, plugboard 0.20.0) breaks down like this: 30 cells are one ChatGPT account at its usage limit, 3 are the anthropic tools-json cells fixed in 0.21.1 (the run predates the fix), and 3 are completions json checks where the model answers in prose around 42. That last group is not explained yet, and the note says so. The note also says how to regenerate the page.

The raw docs/live-matrix.json stays published for now. Moving it out of docs/ would change where tools read it, so that is a follow-up.

Fixes #193

**docs(docs): add Cline client page** ([`8dc940a`](https://github.com/jjjermiah/opencode-plugboard/commit/8dc940a50eb699ab885f5502a0daec52bbe66e68))

Adds docs/clients/cline.md for the OpenAI Compatible provider: Base URL with /v1, API key, model, and Model Configuration (context window, max output tokens, image support, computer use).

Checked against Cline's OpenAI Compatible provider docs. The issue's claims that agent mode requires native tool calling and that the plain OpenAI provider's Base URL field is missing are not on that page, so the page marks them unverified and does not repeat them as fact.

Not run: VS Code extension, and the dev server on 127.0.0.1:4010 was not listening. No examples/cline directory: settings live in the extension.

Refs #217

**docs(docs): add Roo Code client page** ([`15b2f9f`](https://github.com/jjjermiah/opencode-plugboard/commit/15b2f9f01395c59570497f16d2552650148989a8))

Adds docs/clients/roo-code.md for the OpenAI Compatible provider in Roo Code (a Cline fork): Base URL with /v1, API key, model, and Model Configuration. Roo Code uses native tool calling only, so the page says the model must support it and that the tool round trip is the first test.

Checked against Roo Code's OpenAI Compatible provider docs (native tool calling requirement and partial tools-API note are there). Not run: VS Code extension, and the dev server on 127.0.0.1:4010 was not listening.

No examples/roo-code directory: settings live in the extension.

Refs #218

**docs(docs): say the docs follow main and mark options newer than the release** ([`df2af60`](https://github.com/jjjermiah/opencode-plugboard/commit/df2af60685336d6571a40678aa1dd5c40dc838dc))

The docs site deploys from main, but the README pins the last release. A user who installs the pin and pastes a documented option gets "Unknown plugboard option". The gap was 34 commits at the time of the report.

- Every page shows a banner: "These docs follow main; the latest release is vX (see changelog)". The version comes from package.json at build time (vite.define in config.ts, read in theme/index.ts). package.json on main is the last release, because the release pull request bumps it and the tag is its merge commit, so the build does not need git tags.
- Options added in 0.20.0 to 0.23.0 are marked "(since 0.x.y)" in configuration.md, taken from the CHANGELOG sections: historyUrl and agents (0.20.0), the skill alias target (0.20.0), serverTools and maxServerToolSteps and limits.maxBodyBytesInFlight and bodyReadTimeoutMs (0.21.0), apps.<name>.historyUrl (0.23.0). adminKey predates that range.
- CONTRIBUTING.md states the rule: mark a new option with the version that will ship it, in the commit that adds it.

A build-time generated per-option table was considered and left out. It would need the same data kept in two places.

Fixes #188

**docs(docs): add LlamaIndex client page and example** ([`7a0a712`](https://github.com/jjjermiah/opencode-plugboard/commit/7a0a71210c64bf6ed020ccd6d677d208d2798865))

Adds docs/clients/llamaindex.md and examples/llamaindex/example.py (PEP 723, run with uv). The script checks text, streamed text, a tool call and its round trip against plugboard, using OpenAILike.

Run 2026-10-12 against the scripted fake plugboard (test/support/fake- server.ts): all four checks pass with llama-index-llms-openai 0.8.2 and llama-index-core 0.14.25. The live dev server on 127.0.0.1:4010 was not listening, so no live run.

Corrects the issue: LlamaIndex's OpenAI class raises "Unknown model 'fast'" on every call, because its metadata looks the name up in OpenAI's table. The page uses OpenAILike for plugboard ids. This is a client limit, not a plugboard bug, so no bug was filed.

Fixes #222

**docs(anthropic): document zero message_start usage and pin message_delta totals** ([`8d9ad07`](https://github.com/jjjermiah/opencode-plugboard/commit/8d9ad07b89d12eb7efccaed14cfe106bb0451c92))

The host reports token counts only when a model answer ends (the usage event comes with the finish), so a streamed message_start cannot carry the real input count: it is known only after the answer. The options were to delay message_start until the answer ends (rejected: it defeats streaming and the keepalive) or to send an estimate (rejected: the field is documented as real usage). So message_start keeps zero usage, as the docs already said, and message_delta carries the complete final usage (input_tokens without the cached parts, cache_creation_input_tokens, cache_read_input_tokens, output_tokens).

Evidence: the Anthropic SDK accumulator (node_modules/@anthropic-ai/sdk, MessageStream) takes input and cache counts from message_delta whenever they are non-null, so finalMessage() is correct. The compat matrix already checks that through the real SDK (@anthropic-ai/sdk | messages | stream-usage). The LangChain Anthropic adapter reads input only from message_start and hard-codes input_tokens 0 on message_delta, so its streamed usage has no input count. That remains a known gap in test/compat/langchain.ts.

docs/messages.md says why message_start is zero and lists the message_delta fields. The new unit test pins both halves: zero at message_start, real counts at message_delta.

Fixes #203

**docs(docs): add Haystack client page and example** ([`99b3364`](https://github.com/jjjermiah/opencode-plugboard/commit/99b336402bb1fc9d6dbc4e283256b739453826b5))

Adds docs/clients/haystack.md and examples/haystack/example.py: a two-component Pipeline (ChatPromptBuilder into OpenAIChatGenerator) with api_base_url and Secret.from_token, plus a streamed run and a tool round trip.

Run 2026-10-12 against the scripted fake plugboard: text (pipeline), stream, tool call and tool round trip all pass with haystack-ai 3.3.0. The live dev server on 127.0.0.1:4010 was not listening, so no live run.

The issue's OPENAI_* env fallbacks and the OpenAIGenerator claim were not run here; the page does not state them as checked.

Fixes #223

**docs(docs): add Mastra client page and example** ([`9b4068e`](https://github.com/jjjermiah/opencode-plugboard/commit/9b4068ee02edd0ef218466c931e82a17f8339fa6))

Adds docs/clients/mastra.md and examples/mastra/agent.ts: one agent, one Zod tool, using the model object with a provider prefix.

Corrects the issue: id "fast" fails in @mastra/core 1.76.0 with "Failed to resolve model configuration". The working form is id "plugboard/fast" (Mastra splits the id into provider and model; url is the /v1 base).

Run 2026-10-12 against the scripted fake plugboard: text, stream, tool call and tool round trip all pass with "plugboard/fast". The live dev server on 127.0.0.1:4010 was not listening, so no live run.

Fixes #226

**docs(docs): add smolagents client page and example** ([`7db2971`](https://github.com/jjjermiah/opencode-plugboard/commit/7db2971aaf29a4f2d32ec54a4278cf39e55d876c))

Adds docs/clients/smolagents.md and examples/smolagents/example.py (OpenAIModel: text, streaming, and a ToolCallingAgent with one tool).

Run 2026-10-12 against the scripted fake plugboard with smolagents 1.26.0: text, stream and tool call pass. The tool round trip fails on the fake: smolagents sends the tool result as a user observation, and the fake's scripted reply answers only after a tool-role result, so the agent calls the tool until max_steps. Forcing a tool role gets a 400 from plugboard (tool_call_id missing), the same rule OpenAI applies, so that is a client message-shape issue, not a plugboard bug. No bug filed; live run needed.

Corrects the issue: OpenAIModel needs the openai extra (smolagents[openai]); a plain install raises ModuleNotFoundError.

Not run: the live dev server on 127.0.0.1:4010 was not listening.

Refs #228

**docs(docs): add promptfoo client page and example** ([`b7626bb`](https://github.com/jjjermiah/opencode-plugboard/commit/b7626bb37134283fff4d7b8b67b3a74ad487a7b9))

Adds docs/clients/promptfoo.md and examples/promptfoo/promptfooconfig.yaml: openai:chat:fast with apiBaseUrl and apiKey from env templates, a text check and a tool-call check (is-valid-openai-tools-call plus a JavaScript assertion), using deterministic assertions only.

Run 2026-10-12 against the scripted fake plugboard with promptfoo 0.124.1: promptfoo eval --no-cache is green, 2 of 2. The live dev server on 127.0.0.1:4010 was not listening, so no live run.

Notes: a per-test prompt key was ignored in 0.124.1, so the example uses an {{input}} variable. Model-graded assertions default to OpenAI as the grader and need defaultTest.options.provider pointed at plugboard; the page says so and was not run. The issue's OPENAI_BASE_URL env claim is not in the provider docs and was not tested.

Fixes #239

**docs(docs): mark Haystack env fallbacks unverified** ([`02b89b6`](https://github.com/jjjermiah/opencode-plugboard/commit/02b89b6528267aed295eba0ed63ce8b2f57c566a))

The Haystack page stated that OPENAI_API_KEY, OPENAI_TIMEOUT and OPENAI_MAX_RETRIES are read as fallbacks. That came from the issue and was not tested in the run, so the page now labels it unverified.

Refs #223

**docs(docs): document optional peers, install size and the shrinkwrap** ([`dc476eb`](https://github.com/jjjermiah/opencode-plugboard/commit/dc476ebc9ad26813c556bd640b3a6767761ed0d8))

packaging.md now records why effect and @opencode/plugin are optional peers (the host serves both through build.module, and foreign copies are refused), the before and after install measurements (313 packages and 457,848 KiB down to 26 packages and 12,964 KiB on the file install, 12,976 KiB on the registry install with the shrinkwrap), and when OpenCode honours npm-shrinkwrap.json (only with the registry _hasShrinkwrap flag, so file-tarball smoke and check runs do not exercise the pins). Adds the regeneration command and the residual risks: the pins cover registry installs only, and no per-release SBOM is generated.

**docs(docs): list OpenCode 2.0.27 as tested, explain the effect contract** ([`10cd438`](https://github.com/jjjermiah/opencode-plugboard/commit/10cd438cda31f95999af4cb8e2d8b900f22c8d02))

The docs still named 2.0.26 as the only tested host and said the devDependency was pinned to 2.0.26. They also did not say which effect a plugin runs with, so the effect peer change looked like a bug.

- README quick start: tested on 2.0.26 and 2.0.27.
- docs/architecture.md: supported version 2.0.26 and 2.0.27, with the effect of each. The dev dependency is pinned to 2.0.27, and CI checks each host with its own effect.
- docs/development.md: the type check gate, the pins, and which hosts CI tests.
- AGENTS.md: the tested hosts and the reading tag (v2.0.27 or v2.0.26).
- docs/packaging.md: a new section on where plugins get effect and @opencode/plugin. Evidence: ensurePluginRuntime in packages/plugin/src/runtime.ts, identical at v2.0.26 and v2.0.27.

The minimum OpenCode version stays 2.0.26. The peer range @opencode/plugin >=2.0.26 <2.1 is unchanged.

**docs(changelog): notes for 0.24.0** ([`28cb7b0`](https://github.com/jjjermiah/opencode-plugboard/commit/28cb7b0271bc8e2162971728b5a8e00deab270b5))

Curated [Unreleased] notes for OpenCode 2.0.27 support and the release watch, prompt-cache affinity (#80, with the measurements), the server tools permission change and hardening (#194 to #198, #252), optional peers and the shrinkwrap (#190, #165), the Anthropic and caching fixes (#146 #201 #202 #204 #275 #276) and the docs work. Bumps the pinned install examples to 0.24.0.

#### CI and tooling

**ci(ci): name the repository in the release job and bump install pins** ([`e05f5c7`](https://github.com/jjjermiah/opencode-plugboard/commit/e05f5c778d0945f9a34501f1242f44dfd1bd67fc))

The 0.23.0 publish run published to npm and attested the tarball, but the release job failed with "not a git repository": it has no checkout, so gh could not tell which repository to use. GH_REPO now names it. The 0.23.0 release was created by hand from that run's artifacts (tarball, SBOM, attestation bundle); gh attestation verify passes on the npm tarball, which is byte-identical to the attested one.

Also bumps the pinned install examples to 0.23.0. The PR-based release flow does not bump them; a follow-up should fold that into release.ts.

**ci(tests): ratchet test and coverage floors after the protocol fixes** ([`c61d1ee`](https://github.com/jjjermiah/opencode-plugboard/commit/c61d1eec425623fa3ffb07839cb2e7727c320e0e))

The new tests for the Anthropic and caching fixes raised the test count in the http, runtime, session and unit layers and the line coverage (98.3 to 98.4). Raised with test-gates.ts --ratchet, which only raises floors; the function coverage floor is unchanged at 93.8. No code changed in this commit.

Refs #146 #201 #202 #203 #204 #275 #276 #278

**ci(ci): install each host's own effect in the host matrix** ([`c00eee7`](https://github.com/jjjermiah/opencode-plugboard/commit/c00eee7d71dbe11d4f5a424bc7682ced9a97a215))

The host matrix ran `bun add --dev @opencode/plugin@<host>` and left effect at the devDependency pin. A 2.0.27 plugin depends on effect 4.0.1, so its types came from a second copy next to plugboard's effect, and the typecheck failed (TS2741, Effect type mismatches). Every PR failed the matrix once 2.0.27 was published.

The job now reads the host's own effect pin with `npm view @opencode/plugin@<host> dependencies.effect` (2.0.26 gives rc.112, 2.0.27 gives 4.0.1) and installs that version next to @opencode/plugin. The host-versions example now shows both hosts.

Checked locally: the 2.0.26 leg (@opencode/plugin 2.0.26 with effect 4.0.0-rc.112) and the 2.0.27 leg (2.0.27 with 4.0.1) both pass the typecheck and bun test. `bun .github/scripts/host-versions.ts` prints ["2.0.26","2.0.27"]. actionlint is clean. The GitHub matrix itself runs on push.

**ci(ci): watch OpenCode releases daily and open host-bump PRs** ([`b670f19`](https://github.com/jjjermiah/opencode-plugboard/commit/b670f19662b8d6b41a18d082cebf4820a8f78858))

host-bump.yml ran weekly, so a new OpenCode host waited up to a week for a pull request. 2.0.27 moved effect from 4.0.0-rc.112 to 4.0.1, which broke the host lane for every PR until someone noticed.

host-bump.yml now runs daily and opens or updates one PR per version, build(deps): support opencode <v>, on branch deps/opencode-<v>. The read-only check job bumps @opencode/plugin and the effect it pins, widens the peers only where the new version needs it (effect gets the version appended to its || list; the @opencode/plugin upper bound moves only for 2.1+, and the PR says so), then runs typecheck, tests, the TUI build, check-pack and smoke-pack. The bump is text edits of the pins plus bun install, not bun add, so package.json does not get reformatted. When every gate passes, the PR is labelled dependencies and set to auto-merge. When one fails, it is a draft with the log tails, and the issue "OpenCode <v> breaks plugboard" links the run. A new major of @opencode/plugin stops the script and fails the run, because that peer range needs a decision.

A PR opened with GITHUB_TOKEN starts no workflow, so the required checks would never report and auto-merge would wait forever. ci.yml and commits.yml get a workflow_dispatch trigger (one line each), and host-bump.yml starts both on its branch. The check names are the same, so they satisfy the required checks for that commit.

opencode-release.yml is new and runs daily. It installs the newest @opencode/cli-linux-x64 into CI, starts opencode serve with its own HOME and plugboard loaded from the checkout as a local plugin, and checks that /api/plugin lists opencode-plugboard as active and /healthz answers 200. It uses no provider credentials and makes no model call, so it proves the plugin loads in that host, not that a prompt works; the pong gate stays manual. A failure opens or updates the same issue. The check is .github/scripts/opencode-load-check.ts; breakage-issue.sh files the issue.

Checked locally: actionlint with shellcheck is clean on every workflow. The load check passes against the macOS 2.0.27 binary (plugin active, /healthz 200 on 4596). The host-bump dry run against 2.0.27 changes four values and the lockfile, and typecheck, the TUI build, check-pack and smoke-pack pass on the bumped tree. The worktree passes typecheck, bun test (2050 pass, 0 fail), check-pack and the docs build.

Not verified here: the gh calls in breakage-issue.sh and the auto-merge and dispatch steps. They run only in GitHub Actions. The daily host-bump run will open deps/opencode-2.0.27 after this merges to main, unless merge/wave-1 has already moved the pins.

Also changed: docs/releasing.md (section "OpenCode releases") and one CONTRIBUTING line.

**chore(ci): ratchet test and coverage floors for the affinity tests** ([`1f6a651`](https://github.com/jjjermiah/opencode-plugboard/commit/1f6a65188f22583c90492a44bd87f9c34c3008fe))

2156 tests (was 2121 in the layer floors); coverage 98.4% lines, 94.1% functions. Floors only rise.

**chore(ci): ratchet test count floor after the main merge** ([`d39e393`](https://github.com/jjjermiah/opencode-plugboard/commit/d39e393694d6a34fd987f75ed449aae15227e44d))

2157 tests in the layer floors.

#### Dependencies

**fix(deps): make effect and @opencode/plugin optional peers, ship npm-shrinkwrap** ([`3c92174`](https://github.com/jjjermiah/opencode-plugboard/commit/3c921745870abeed0ebe784017dca2dbe4258290))

OpenCode's installer (Arborist reify, no omit or legacyPeerDeps) installs required peers, so every plugboard version pulled effect and @opencode/plugin with their graph. The host provides both at runtime (packages/plugin/src/runtime.ts build.module overrides every importer), so the plugin never needs its own copy. Mark both optional, as the TUI peers already are.

Measured with Arborist 9.4.0 under Bun 1.4.2, ignoreScripts, npm defaults, on the 0.23.0 tarball (du -sk of node_modules):

  before: 313 packages, 457,848 KiB, 7 effect/@opencode/plugin dirs after (file install): 26 packages, 12,964 KiB, 0 copies

The shrinkwrap is generated from runtime fields only (npm install --omit=dev --omit=peer, then npm shrinkwrap) and ships in files. Arborist honours a dependency's npm-shrinkwrap.json only when the registry manifest sets _hasShrinkwrap, which OpenCode's registry install gets and a file tarball does not. Registry install with the flag: 26 packages, 12,976 KiB. The flag was set by hand in a scratch registry (verdaccio), so the npmjs side is inferred from its packuments, not verified by publishing.

check-pack fails when the shrinkwrap is missing or its root dependencies or peerDependencies differ from package.json. smoke-pack fails if a plain install puts effect or @opencode/plugin in node_modules, and smoke-probe loads the plugin through a host copy in ./host, so the host-provided path is what gets tested.

Live proof, OpenCode 2.0.26 in a scratch HOME, plugin from the registry install: plugboard active in /api/plugin, /healthz ok, /v1/models lists opencode-go models, and a chat completion on opencode-go/glm-5.3-flash returned "pong" with x-plugboard-model set.

Fixes #190
Fixes #165

**build(deps): support OpenCode 2.0.27 with effect 4.0.1** ([`948a729`](https://github.com/jjjermiah/opencode-plugboard/commit/948a729a7288ad880a80f7656541e45b07e7cec4))

OpenCode 2.0.27 pins effect 4.0.1 (@opencode/plugin 2.0.27 depends on it). Plugboard had effect 4.0.0-rc.112 as its devDependency and as an exact peer, so a fresh install of the tarball with 2.0.27 resolved two effect copies, and the host typecheck failed (TS2741 NodeInspectSymbol, Effect type mismatches in index.ts, src/rpc.ts, src/session/context.ts, src/session/host.ts).

Changes:
- devDependencies: @opencode/plugin 2.0.27, effect 4.0.1 (the newest host and the effect it pins).
- peerDependencies: effect "4.0.0-rc.112 || 4.0.1". The @opencode/plugin peer stays ">=2.0.26 <2.1", so 2.0.26 users keep working.
- CHANGELOG Unreleased: the 2.0.27 support, the effect peer, and the two CI and smoke fixes.

Why both effect versions are allowed: a plugin never loads its own effect. packages/plugin/src/runtime.ts (ensurePluginRuntime) serves the host's effect and @opencode/plugin for every such specifier, and throws for a copy under a plugin node_modules. runtime.ts, runtime-modules.ts and source.bun.ts are byte-identical at v2.0.26 and v2.0.27 (md5). So at runtime plugboard runs on the host's effect, 4.0.0-rc.112 on 2.0.26 and 4.0.1 on 2.0.27. The peer range only has to match the types and the one-copy install check.

Rejected: option (a), dropping 2.0.26 from the peer range. Nothing in the code needs it, and it would strand 2.0.26 users for no runtime gain.

API changes: none needed. Plugboard imports only Effect, Cause, Exit, Scope and Stream from effect, and the code compiles and passes the suite under both versions without an edit.

Checked:
- typecheck and bun test on the 2.0.27/4.0.1 pair: 2050 pass, 126 live tests skipped, 0 fail.
- typecheck and bun test on the 2.0.26/4.0.0-rc.112 pair: same counts.
- test gates, coverage-manifest, compat matrix (docs unchanged), check-pack.
- smoke-pack: one effect (4.0.1, deduped under the host) and one @opencode/plugin; "smoke ok".
- Live, from the packed tarball, on OpenCode v2.0.27 and v2.0.26 (scratch HOMEs): plugin active, /healthz ok, 114 models, chat "pong", a get_weather tool call, and opencode run "pong".

bun.lock: bun resolved the 4.0.1 closure of @effect/* and the 2.0.27 @opencode/* packages. Some @msgpackr-extract entries left the lock with the old closure. The lock installs with --frozen-lockfile.

</details>
<!-- commit-detail:end -->

## [0.23.0] - 2026-10-12: What the Red Team Found

**Full diff:** [v0.22.0...v0.23.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.22.0...v0.23.0)

The first red-team round ([#269](https://github.com/jjjermiah/opencode-plugboard/issues/269), run by [docs/red-team.md](https://jjjermiah.github.io/opencode-plugboard/red-team)) attacked a dev server and, within strict limits, a real deployment. Auth, app isolation, server tools, SSRF and body limits held. These are its findings, all fixed. This release also adds the security workflows and moves releases to pull requests.

### Fixed

- **Every answer names its model** ([#279](https://github.com/jjjermiah/opencode-plugboard/issues/279)). `x-plugboard-model` now comes on every answer, streamed or not, alias or model id. Before, only list aliases set it.
- **`/metrics` with an admin key** ([#285](https://github.com/jjjermiah/opencode-plugboard/issues/285)). Any app key could read every app's counters. With `adminKey` set, `/metrics` now takes the admin key only (an app key gets 403 `admin_key_required`). Without `adminKey`, it behaves as before, and the docs say so.
- **Bad input is a 400, not a 500** ([#286](https://github.com/jjjermiah/opencode-plugboard/issues/286), [#288](https://github.com/jjjermiah/opencode-plugboard/issues/288), [#287](https://github.com/jjjermiah/opencode-plugboard/issues/287)). A `data:` image that isn't a real PNG, JPEG, GIF or WebP, file data that isn't a PDF, and a `stream` that isn't a boolean are refused up front. A 500 from request preparation no longer names host internals.
- **Clearer structured-output failures** ([#282](https://github.com/jjjermiah/opencode-plugboard/issues/282)): the 502 says the model did not return JSON matching the schema, and no longer names the internal tool.
- **Responses echoes `strict`** on function tools, as the OpenAI schema requires ([#289](https://github.com/jjjermiah/opencode-plugboard/issues/289)), and the README and Anthropic docs match the actual error bodies ([#283](https://github.com/jjjermiah/opencode-plugboard/issues/283)).

### Added

- **Hide the session link from an app** ([#280](https://github.com/jjjermiah/opencode-plugboard/issues/280)). `x-plugboard-session-url` reveals your OpenCode server's address. Turn it off, or give an app its own template:

  ```jsonc
  "apps": { "public-bot": { "key": "{env:BOT_KEY}", "historyUrl": false } }
  ```
- **Security workflows**: CodeQL and OpenSSF Scorecard run on every change. Each GitHub release attaches a CycloneDX SBOM and a build provenance attestation for the exact tarball published to npm (`gh attestation verify`). SECURITY.md gives response targets (7 days to acknowledge, 30 to fix). [Security reviews](https://jjjermiah.github.io/opencode-plugboard/security-reviews) records the AI-assisted reviews and what they changed: they were not an audit.
- **The red-team playbook** ([docs/red-team.md](https://jjjermiah.github.io/opencode-plugboard/red-team)) and pages for 10 self-hosted apps (Karakeep, Frigate, paperless-gpt, Mealie, Khoj, Nextcloud Assistant, Mattermost, Open Notebook, Langflow, SparkyFitness).

### Changed

- **Releases go through a pull request**: `main` is protected, the release script opens a `release/vX.Y.Z` PR, merges it once CI passes and tags the merge commit.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (27 commits)</summary>

#### Features

**feat(config): add apps.<name>.historyUrl, false hides the session link** ([`d3c3915`](https://github.com/jjjermiah/opencode-plugboard/commit/d3c391506615e7ac938b9dfa2f15c091ef580a45))

Option historyUrl (#77) is global, and every response with x-plugboard-session carries x-plugboard-session-url filled from it. That link points at the OpenCode server's own address and port, so any app key holder could read the internal address of the server from a plain answer. The README never mentioned the header, and an operator had no way to keep the link from one app without dropping it for all of them.

apps.<name>.historyUrl is now a per-app field. A string is that app's own template, checked the same way as the global one, and its errors name the app option. false turns the link off for the app: no x-plugboard-session-url and no session_url= log field. Unset inherits the global template.

Routes read the template through one lookup, historyTemplate(options, app), instead of options.historyUrl, in all five front-ends and in the fan-out. The policy only holds the field when it is set, so an app with only a key is unchanged.

Rejected: removing the header for everyone. It is useful to trusted apps and to the operator, and the docs now say what it reveals instead.

Rejected: a flag on the app key. A per-app template covers the same case and reuses the validation the global option already has.

Tests: test/unit/session-link.test.ts (load validation and the lookup, global and per app) and test/http/session-link.test.ts (three apps: false, own template, inherited; and n above 1 for the false app). The false cases were refused as an unknown option before the change, so they failed. The docs (configuration.md) state the disclosure and the new field.

Fixes #280

#### Fixes

**fix(fallback): name the answering model on every answer, not only lists** ([`cef62d3`](https://github.com/jjjermiah/opencode-plugboard/commit/cef62d31db7c85a588f32d39ffdfa15a2eff716a))

x-plugboard-model was set only when an alias was written as a list. The fallback wrapper (withFallbacks) reported the served model from its chain path alone, so a single-target alias ("fast": "a/x") and a canonical id ("a/x") got no header on any front-end, streamed or not. The docs and the README example said every answer names the model that answered.

The plain path now reports it too, before the first non-error event, so a failed call still reports nothing. ServedModel gained `chain`: only a list alias echoes the target in the response body (reportServed runs its body callback for chain only), so a single-target alias keeps the alias in the body as before. Usage and the cache already read onServed and need no change: the target equals the resolved request ref for these calls.

Setting the header in each route was rejected. Six routes would each need the same call, and the cache hit path replays onServed already, so the shared wrapper is the one place that keeps them in step.

Tests: test/http/served-model.test.ts (new, 30 cases: five front-ends, json and stream, alias and canonical) fails 21 of them before the change and passes after; test/unit/fallback.test.ts pins the plain-call report. Full bun test passes (1962).

Fixes #279

**fix(gemini): say the model did not match the schema in structured 502** ([`3822ab5`](https://github.com/jjjermiah/opencode-plugboard/commit/3822ab552df958bd87ef56dc06da1077925a6682))

A structured turn that ended with prose (or any text that is not the schema's JSON) failed with 502 structured_output_missing and the message "The model finished without calling the `respond` tool, so there is no structured output". The caller never sends a respond tool and cannot see one, so the message named something it could not act on, and it did not say the model had answered in prose.

structuredMissing now takes no argument and says the model did not return JSON matching the response schema, and that the expected JSON (keys and types) should be stated in the prompt. The code stays structured_output_missing, so clients that branch on it are unaffected. It is one shared function, so Chat Completions, Responses, Gemini and legacy completions all change at once, and the text names no internal tool anywhere.

Rejected: quoting the start of the model's text in the message, as the issue suggested. Provider text stays out of caller-visible errors (I13), and the caller already has the text in the response it did get.

Tests: the Gemini HTTP tests and the completions unit test pinned the old text and now pin the new one. New unit tests in openai-response and gemini-response assert the message and that it does not contain "respond". Full bun test passes (1964).

Fixes #282

**fix(openai): refuse a non-boolean stream instead of treating it as false** ([`66727b7`](https://github.com/jjjermiah/opencode-plugboard/commit/66727b782dfa4d9b8ceb866289b7ee814df2f2e6))

Chat Completions, Responses and legacy completions read `stream` with `=== true`, so any other value was a non-stream request. A client that sent "yes" or "true" as a string got a whole JSON answer with no error, and a client waiting for SSE read the wrong framing. Anthropic Messages already refused a non-boolean stream; the other three now match it.

Each decoder answers a value that is neither absent, null nor a boolean with 400 invalid_request, param "stream", message "stream must be a boolean", the same way `n` is refused. The check runs before any model call, so no session or budget is spent. Gemini takes stream from the URL (alt=sse and the stream method), so it has no body field to check.

Rejected: coercing "true" to true. A string that means true is still a client bug, and guessing hides it.

Tests: test/http/stream-type.test.ts (new) sends six bad values to each of the four routes and asserts the 400 and that the model caller was never called, and sends null, absent, true and false, which must still answer. Twenty of the bad-value cases fail without the checks. test/unit/openai- request.test.ts gets the two chat rejections, and its test that pinned "yes" as false now pins null as false. Full bun test passes (2006).

Fixes #287

**fix(openai): answer an unusable data: image with 400, not a 500** ([`2c622fc`](https://github.com/jjjermiah/opencode-plugboard/commit/2c622fc4d27bab507307ce2b8735d9abf0e2d03f))

A data: image that could not be sent to a provider (a text/html media type, empty or malformed base64, or bytes with no PNG, JPEG, GIF or WebP signature) reached backend preparation. The host dropped the attachment and the caller got 500 backend_preparation_failed, which counted a caller's bad input as a server error in usage and metrics, and told a retrying client to send it again.

The check now runs in each decoder, before a session, a budget or a cache step is touched: src/image.ts (imageProblem) refuses a data: image URL that is not an image/* type, not well-formed base64, or not a supported image. The image paths are Chat Completions image_url, Responses input_image, Anthropic base64 image blocks and Gemini inlineData with an image/* type. Each answers 400 invalid_request in its own error shape, naming the image. Remote and non-data URLs are not checked here (the fetch path does that), and files and PDFs (file parts, document blocks, non-image inlineData) are not checked at all, so they keep their current behaviour.

Rejected: checking in prepareImages. It runs after the route has already resolved the model and taken a limits slot, and it cannot tell an image part from a file part, so it would need the same information the decoder has.

Rejected: sniffing every format the host might take (BMP, TIFF, HEIC). The providers take PNG, JPEG, GIF and WebP, so the others are refused early.

Fixture change: unit tests that decoded placeholder bytes ("AA", "AAAA", "BB") as images now use a real PNG or a JPEG header, because those inputs are not images any more. tokens.test.ts is untouched: it never runs the decoder.

Tests: test/unit/image.test.ts (new, the accepted formats and each refusal) and test/http/invalid-image.test.ts (new, 9 cases on chat, responses, Anthropic and Gemini; the model caller is never called). With the check disabled all 9 HTTP cases fail with the 500. Full bun test passes (2031).

Fixes #286

**fix(metrics): answer /metrics to the admin key alone when adminKey is set** ([`a66bec2`](https://github.com/jjjermiah/opencode-plugboard/commit/a66bec23ffcdf374489a58e5dcbe438849de9260))

With metrics on, GET /metrics used the same authentication as /v1, so any app key read the series of every app: plugboard_requests_total, tokens, latency, limits and cache counts, all labelled with the app name. One app key holder could learn the other apps on the server and each one's traffic profile. The usage report and /v1/usage already scope by key (I24), and /metrics did not.

With adminKey set, /metrics now takes the admin key only, checked the way the usage route checks it: no key or a wrong one is 401, an app key is 403 admin_key_required and its body carries no series. The admin key reads every app, as before for the admin path.

Without adminKey the behaviour does not change: any app key still reads every app's series. Scoping an app key to its own app would mean changing what keyless and single-key operators see, and the issue offered the admin-only choice, so the chosen default is documented in configuration.md, SECURITY.md and architecture.md instead.

Rejected: scoping each app key to its own app label. It works for an operator without adminKey too, but it changes a response that existing scrapers depend on, and it would still leave the names of other apps out of reach only per series, not in the metric list. Left for a later decision.

Tests: test/http/observability.test.ts gets three cases: with adminKey (no key 401, app key 403 with no series in the body, admin key 200 with every app), and without adminKey (an app key reads every app, pinned as the choice). The 403 case failed before the change (the app key got 200). Mutation entry I24-metrics-app-key-reads-all-apps removes the check; `bun run mutations -- --only` kills it (2 failing lines).

Fixes #285

**fix(openai): refuse unusable file parts with 400, keep the 500 message generic** ([`b4c23c2`](https://github.com/jjjermiah/opencode-plugboard/commit/b4c23c24527f8153e15014fcdf05b2d665547281))

A chat `file` part with bare base64 (no media type) reached backend preparation as application/octet-stream. The host did not deliver it, so the caller got 500 backend_preparation_failed. The same thing happened to Responses input_file data that was not a PDF. The 500 message named host internals ("1 attachment(s) not delivered by the host", "2 tool(s) without a seed tool", "Prepared 1 attachment(s) for a request with 2"), which told a caller how many attachments the host dropped.

File data is now checked in the decoder (pdfProblem in src/image.ts), as image data is (#286). A PDF given as a data:application/pdf;base64 URL is accepted, with a %PDF signature check. The compatibility matrix already sends that form on OpenAI Chat (test/compat/clients.ts, `document`), so it works and stays working. Bare base64, any other type and broken base64 are a 400 invalid_file with the field named in param. Checked before any session, budget or cache step.

Rejected: refusing every file part on Chat Completions. The docs scope Chat to images, but the compat matrix proves PDF file parts work, so refusing them would break a working client.

The 500s for backend preparation now say "Could not prepare the model request", with no counts, and the counts go to the log as request.preparation_failed. Clients get the same message from the host and from the caller's own attachment count check.

Not changed: the 400 for too many tools names the option `maxTools`. It is a caller error with the plugboard option named, not a host detail.

Tests: test/unit/image.test.ts (pdfProblem), test/unit/openai-request.test.ts (PDF kept, bare base64 refused), test/unit/responses-request.test.ts (PDF kept, non-PDF refused), test/http/invalid-image.test.ts (chat bare base64 is a 400 and the caller is not called), test/session/context.test.ts (the generic message, and the counts in the log). Fixtures that sent a non-PDF input_file were changed to a real PDF prefix, and the coverage-manifest title for the chat images cell follows the renamed test. Before the change the bare-base64 chat case returned 500 and the context test failed on the message text.

Fixes #288

**fix(responses): echo strict on function tools, false when the caller omitted it** ([`2358100`](https://github.com/jjjermiah/opencode-plugboard/commit/2358100a01bad6e121c10357602e3af79494ba2a))

The Responses response object echoes the caller's tools. It echoed the request objects as sent, so a function tool without `strict` came back without it. The OpenAI FunctionTool schema (test/fixtures/specs/openai.json, vendored) requires `strict` as a boolean, so a client that validates the response against the spec saw a non-conforming object. The SDK types agree: the typed goldens in test/types/wire.ts fail the type check without the field.

echoTool (src/responses/request.ts) gives each function tool `strict`: the caller's value when it is true, else false. That covers absent and null, which the spec does not allow, and the default is false as the OpenAI spec gives it. Other tool types are echoed as sent. The request is unchanged: plugboard still offers the tools to the model without `strict`, as before.

Rejected: echoing only the caller's exact value. Absent would then stay absent and fail the schema, which is the bug.

Tests: test/compat/conformance.test.ts gets two cases, a tool without `strict` (echoed as false) and one with `strict: true` (echoed as true), each checking the whole Response against the vendored schema. The first failed before the change: the tool was echoed without `strict`. test/unit/responses-request.test.ts (the envelope test) now expects the default. The wire goldens were regenerated (`bun test/types/generate.ts`); the diff is only the four added `strict` fields. There was no existing test.failing for this; I added the tests as passing ones since the fix is in.

Fixes #289

#### Tests

**test(gemini): pin five stop sequences as pass-through and six as a 400** ([`a96f940`](https://github.com/jjjermiah/opencode-plugboard/commit/a96f9408fb8ff756f8a7baec5b41e614a8045076))

The red-team fuzzer sent the same Gemini request with five stopSequences and got a 400 once and a 502 once. Gemini's documented limit is five (docs/gemini.md), and the decoder already accepts exactly five and refuses six with a 400 on generationConfig.stopSequences. The decoder reads the field with a plain lookup (field() in src/gemini/request.ts), so the same input cannot give two answers there.

So the variance is downstream. The likely cause is a provider that accepts fewer stop sequences than Gemini does (OpenAI-family chat takes four), which would surface as a provider 400, while the 502 came from a different answer path. I could not reproduce either status here: there is no live provider in the test run, and I did not run the fuzzer's exact request against a live server. This commit does not claim a root cause for the 502.

Decision: plugboard keeps five as the limit and passes them through unchanged. Clamping to four for providers that take fewer would silently drop a caller's stop sequence, which changes an answer, so it is left as a follow-up for a per-model limit.

Tests: test/unit/gemini-stop.test.ts (new) parses five sequences three times, expecting the same five back each time, and six three times, expecting the same 400 on generationConfig.stopSequences. Both pass before and after, since the decoder is unchanged; they pin the behaviour the report depends on. The commit is test-only, so the type is test and the reference is Refs #269, not Fixes.

**test(tests): raise test-count and coverage floors for the red-team fixes** ([`031c0f2`](https://github.com/jjjermiah/opencode-plugboard/commit/031c0f24989eb3d48e5a1a75bd826313c717b451))

Ran test-gates.ts with --ratchet after the round-1 fixes added tests in the http, session and unit layers. Floors only move up: the test count rose from 1940 to 2050, line coverage of src rose to 98.3 percent (floor 98.2), and functions to 93.8 percent (floor 93.6). No floor was lowered. The coverage run and the gate passed before the ratchet, so the new values are the current measurements, not targets.

Refs #269

#### Docs

**docs(docs): add self-hosted app pages for ten apps** ([`c21db8e`](https://github.com/jjjermiah/opencode-plugboard/commit/c21db8e45d57489dbc849967847e5254da0032b7))

Adds one page per app under docs/self-hosted/: Karakeep, Frigate, paperless-gpt, Mealie, Khoj, Nextcloud Assistant, Mattermost AI plugin, Open Notebook, Langflow and SparkyFitness.

Each page gives the plugboard options block (an app key, aliases and an apps policy), the app's own config pointing at plugboard, what works through plugboard and what does not, gotchas, and the upstream sources with the date checked. Embeddings, audio and image generation are not served by plugboard, so each page names the feature that needs another provider.

The pages are docs-verified against upstream docs and source as of 2026-10-11. None was run live. Config names come from the upstream files cited on each page.

Refs #251

**docs(docs): add self-hosted apps overview and sidebar group** ([`20e0c4e`](https://github.com/jjjermiah/opencode-plugboard/commit/20e0c4eb2f664132a3f9e1e3e2460b43f6a62cbf))

Adds docs/self-hosted.md with a status table of twenty apps. Each row says whether the app works, works for chat only, is not possible, or is not checked. It links to the app's page or to its issue (#237, #243 to #250).

Also adds a networking section that points at remote-access and the any-app client page, since most of these apps run in containers.

Adds a Self-hosted apps group to the VitePress sidebar in docs/.vitepress/config.ts. The docs build passes with no dead links.

Refs #251

**docs(docs): add runnable examples for karakeep, frigate and paperless-gpt** ([`62a391f`](https://github.com/jjjermiah/opencode-plugboard/commit/62a391f003c3824b68c7644bcb49e96d0d47fa13))

Adds examples/self-hosted/karakeep (an env file and a compose override for the upstream docker-compose.yml), examples/self-hosted/frigate (a genai provider in config.yml with the vision alias and local semantic search), and examples/self-hosted/paperless-gpt (a compose service and an env file, published on loopback only because paperless-gpt has no authentication).

Lists them in examples/README.md. The examples are docs-verified and not run. They are not in the npm package: bun .github/scripts/check-pack.ts passes.

Refs #251

**docs(docs): give SECURITY.md response targets and link the security reviews** ([`b3b34a8`](https://github.com/jjjermiah/opencode-plugboard/commit/b3b34a8a8b551763c5406b968124348943e7ae10))

The old text promised a reply "within a week" and said "no formal SLA", which is vague in both directions. It now states the targets with numbers: a report is acknowledged within 7 days, and a confirmed issue is fixed within 30 days. It says these are targets for a one-person project, not a contract, and that there is no bounty. The word "disclosure" now appears with its process: the disclosure date is agreed with the reporter once a fix is ready, and an advisory names the fixed version.

Supported versions and private vulnerability reporting were already stated and are unchanged. A "Security reviews" section links the new record in docs/security-reviews.md and says plainly that those reviews were AI-assisted, not a human or third-party audit.

Checked with docs:build (VitePress fails on dead links, so the new link is resolved there).

**docs(docs): record the AI-assisted staff reviews and prepare the Best Practices badge** ([`92bfdf3`](https://github.com/jjjermiah/opencode-plugboard/commit/92bfdf3ae88f94301ad3c329fb24fbbc02e499bd))

docs/security-reviews.md is an honest record of the three staff reviews run on 2026-10-12 (security and legal, architecture and bugs, product and developer experience). It says at the top that they were AI-assisted reviews (GitHub Copilot GPT-6 Luna acting as reviewers), not a human or third-party audit, and that the maintainer is accountable for the changes. Each finding is a row with its issue, its state and the commit that fixed it. Issues #152 to #168 come from the reviews, #169 to #173 from the first live run against real providers, and the earlier 0.2.0 review is linked to its changelog section. Open findings (#158, #165) are listed as open. The commit mapping is by commit subject, which is stated in the file.

No badge is based on these reviews.

docs/best-practices.md is the answer sheet for the passing level of the OpenSSF Best Practices badge, criterion by criterion, with the evidence URL for each. It marks what is met, what the owner must confirm, what is not yet true (for example report_responses, which needs a 2-to-12-month window that the 1-day-old repository does not have yet) and what waits for the first CodeQL run. The owner registers at bestpractices.dev and pastes the answers; nothing is registered by this change.

Both pages are in the Project sidebar of docs/.vitepress/config.ts.

Checked with docs:build; both pages are in the build output.

**docs(docs): add the OpenSSF Scorecard badge and a Best Practices placeholder** ([`9ee9a02`](https://github.com/jjjermiah/opencode-plugboard/commit/9ee9a0274f70de5ac3f9bbcc5201f144e72027d8))

The README badge row now has the Scorecard badge after CI. It reads the published score from api.scorecard.dev, so it shows "unknown" until the first Scorecard run on main publishes a result.

The Best Practices badge needs a project id that exists only after registration, so it is a commented-out line with the instructions beside it. Once the owner has the id, the line is uncommented and <id> replaced.

Not added: a CodeQL badge (the workflow has not run yet, so a badge would show nothing useful) and a static "SLSA Build L2" badge (a shields.io label that says nothing the npm Provenance panel does not already show for the package, and would keep saying L2 even if a later release lost its provenance). A Socket badge is left out until its badge endpoint works again.

**docs(docs): describe the pull request release flow and its required checks** ([`98a6d78`](https://github.com/jjjermiah/opencode-plugboard/commit/98a6d787baa4853f140b49fc74a3a9314873bc61))

main will be protected by a ruleset that requires a pull request and the passing CI checks, so a release can no longer be a commit and a push to main. docs/releasing.md now describes the flow the release script runs: a release/vX.Y.Z branch, a pull request with the release notes, auto-merge with a merge commit, a wait for the merge (up to 60 minutes), the tag on the merge commit, then the Publish run.

It lists the required checks by the job names GitHub shows on a pull request: Typecheck, test and pack; Compat kit checks; Host versions; and Lint commit messages. It says what is not required and why: the OpenCode host matrix (its job names change with each host version), the advisory benchmarks, the nightly jobs, CodeQL until it has run, and "Build the site", which is a push-only job (the docs build is a step of the package job). It names the two repository settings the flow needs: auto-merge enabled, and no required approving review, because a solo maintainer cannot approve their own pull request.

The "Release files" section documents the tarball, the CycloneDX SBOM and the attestation bundle, and the gh attestation verify command for them. The dry-run description now says that the attestation and the release only print.

CONTRIBUTING.md says main takes changes only through pull requests with the required checks passing, and that releases use the same rule.

**docs(docs): add the red-team playbook** ([`db0af47`](https://github.com/jjjermiah/opencode-plugboard/commit/db0af4718bcff79e7c01301743f80056234bc9de))

docs/red-team.md describes a repeatable red-team round: the two targets (the isolated dev server, where anything goes, and a real hub, where only realistic use through a dedicated, limited and budgeted redteam app is allowed), the rules of engagement and stop conditions, three roles with their full briefs (attacker, app builder, protocol fuzzer), the issue format with the new red-team label, and the steps to run and close a round. Linked from the Project sidebar.

**docs: match the 404 param and the Anthropic 429 body to the code** ([`a5ed1c2`](https://github.com/jjjermiah/opencode-plugboard/commit/a5ed1c201e816533ef445c21f36865fdffacbb28))

Two README and messages.md statements disagreed with what the server sends.

1. The model_not_found example showed "param": null. A model outside the allowlist is refused with param "model" on every route that names one (src/models.ts, pinned by test/http/ingress.test.ts), so the example now shows "model".
2. The concurrency cap sentence said the 429 returns code too_many_requests, without saying where. On /v1/messages the error object has a type and a message only, as in Anthropic's API (test/http/messages.test.ts pins the shape), so the 429 there has no code. The README now says which routes carry the code, and docs/messages.md says the Anthropic error has no code or param field.

The fix is in the docs and not in the response shape: Anthropic clients read type and message, and adding a code field would be a wire change for no client that asked for one. Checked against the code and the route tests; no test changes.

Fixes #283

**docs(changelog): notes for the red-team round 1 fixes and the security workflows** ([`9920a88`](https://github.com/jjjermiah/opencode-plugboard/commit/9920a88200bbb4b09e964529ed889b1f66469e85))

Curated [Unreleased] entries for #279 #280 #282 #283 #285 #286 #287 #288 #289, the CodeQL, Scorecard, SBOM and attestation work, the red-team playbook, the self-hosted app pages and the PR-based release flow.

**docs(docs): point the readme anthropic error link at the docs site** ([`96f573b`](https://github.com/jjjermiah/opencode-plugboard/commit/96f573bf59f1272593aa00b294932ed5bea962f7))

The fix for issue 283 linked docs/messages.md relatively. The README is also the docs site index page, where that path does not exist, so VitePress failed the build on a dead link. README links to docs pages use the site URL, like the others.

#### CI and tooling

**ci(ci): add a CodeQL workflow for the TypeScript source** ([`1ea8e6e`](https://github.com/jjjermiah/opencode-plugboard/commit/1ea8e6e77d25a11b1e1b984a537d13d01de5c496))

Adds .github/workflows/codeql.yml, which runs GitHub's CodeQL analysis for javascript-typescript on pushes to main, on pull requests and weekly. The JavaScript and TypeScript sources need no build, so build-mode is none and CodeQL reads the files directly.

The workflow file is the source of truth rather than the repository's default setup, so the schedule and the analysis set are versioned with the code. The default setup stays off, because enabling both would analyse the same code twice.

Actions are pinned by commit SHA, the same way as the other workflows. The job asks for contents: read and security-events: write only; the top level grants nothing.

Checked with actionlint (no findings). The first real run is on the pull request that lands this file.

**ci(ci): publish OpenSSF Scorecard results and upload them to code scanning** ([`9ea87aa`](https://github.com/jjjermiah/opencode-plugboard/commit/9ea87aab98935f7a9a73a3baece4a34c2d5c2457))

Adds .github/workflows/scorecard.yml, which runs ossf/scorecard-action on pushes to main, weekly and on branch protection changes. The score is published, so the README can show it, and the SARIF is uploaded to code scanning and kept as a workflow artifact for five days.

The action's v2 rules reject results from a workflow that breaks them, so the file follows them exactly: no top-level env or defaults, no write permission at the top, id-token: write on the one analysis job only, and only the actions the scorecard-action README lists for that job (checkout, upload artifact, codeql upload-sarif and the action itself). The header comment says so, so a later edit does not add a step that gets the results rejected.

Classic branch protection is not needed for the check: the repository's rulesets are readable with the default token, which is what the action expects.

Checked with actionlint (no findings). The first score appears after the first run on main; the badge in README.md is added in a separate commit.

**ci(ci): attest the release tarball and attach an SBOM and the attestation** ([`0c05aa1`](https://github.com/jjjermiah/opencode-plugboard/commit/0c05aa1a000565534d6161d853fe12dae7f0adf2))

The release now carries three files: the npm tarball, a CycloneDX SBOM of its production dependencies (npm sbom --sbom-format cyclonedx --omit dev), and a GitHub build-provenance attestation bundle for the tarball. Scorecard's Signed-Releases check looks for a signed asset on the release, and the SBOM check looks for an SBOM asset, so both are satisfied by the same change.

The publish job used to create the release itself, with write access to contents as well as the OIDC token for npm. It is now three jobs, so each holds only what it needs: publish (npm, with the OIDC token), attest (the attestation store and the OIDC token, to store and sign it) and release (contents write, to create the release). The jobs run in that order, and the release waits for both.

The tarball is packed after npm publish, from the same tree, and attest checks its sha512 against the integrity npm serves for that version before it signs anything. If they differ, the job fails and nothing is attested. The first real release is the first time this comparison runs for real; a dry run cannot exercise it because the version is not on npm.

Dry runs still run every step that does not write. The attestation and the release are writes (a public transparency log entry and a GitHub release), so on a dry run the attest step and the release step only print what they would do. A re-run of a release that is already on npm packs and attaches the files to the existing release with --clobber, instead of leaving it without assets.

Checked with actionlint (with shellcheck, no findings). The pack, SBOM and digest commands were run locally on this tree (npm 11.19.1) and produced a tarball and a 23-component SBOM.

**ci(ci): cut releases through a pull request instead of pushing main** ([`8da83df`](https://github.com/jjjermiah/opencode-plugboard/commit/8da83dfebaf632c68e68f1ccfe5613e6c20296b8))

main is going to be protected by a ruleset that requires a pull request and the passing CI checks. The old release path committed chore(release) to main and pushed main with the tag, which the ruleset would refuse.

With --push the script now runs from a clean main that equals origin/main: it commits the release on release/vX.Y.Z and pushes that branch, opens a pull request into main with the release notes as the body, enables auto-merge with a merge commit (the branch is deleted once merged), waits up to 60 minutes for the merge, fetches main and tags the merge commit with annotated vX.Y.Z, pushes the tag, and then follows the Publish run as before. The merge commit is on main and its package.json has the new version, so the publish workflow's tag checks pass unchanged.

Without --push the script refuses, because the release no longer ends in a local commit on main. --dry-run still prints the diff and the plan and changes nothing. --watch-only is unchanged.

A branch ruleset does not cover tags unless it targets them, so the tag push should not be blocked. That is unverified until the ruleset exists. Auto-merge needs "Allow auto-merge" enabled in the repository settings; the script says so when it is off.

Checked against a throwaway bare origin and clone, with a stub gh that performs the merge: the release branch was pushed, the tag v0.22.1 was created on the merge commit, package.json at that commit read 0.22.1, and the script exited 0. A --dry-run with --push printed the plan and created no branch. A run without --push exited 1 with the reason. typecheck passed.

**ci(ci): publish the packed tarball, so the attested bytes are the published bytes** ([`060a674`](https://github.com/jjjermiah/opencode-plugboard/commit/060a6740d40ee18eb051b0ac7fb365aff3643f7c))

The publish job used to run npm publish from the source tree, then pack a second tarball for the SBOM and the attestation. Each npm pack reads the tree again, so the file that was attested was not proven to be the file npm published. The attest job's integrity check against the registry narrowed that gap, but a mismatch would only show after the publish had gone out.

Now the publish job packs once, after build:tui and with --ignore-scripts, writes the SBOM from the same tree, records the file's sha256, and publishes that exact file with npm publish <tarball>. The --access, --tag next and --provenance logic and the dry-run and already-published branches are kept. The release-files artifact carries that file to the attest job, which checks its sha256 against the publish job's output before it checks the registry's integrity and attests it. The release job attaches the same file.

The global npm install is pinned to npm@11.21.0 instead of the ^11.5.1 range, so a new npm release cannot change how the publish runs without a commit. It is the current 11.x release on the registry and above the 11.5.1 that trusted publishing needs.

Checked with actionlint -shellcheck (no findings). npm publish of the packed tarball path was run against this tree with --dry-run: npm read the file, computed its integrity, and stopped at the expected "already published" refusal for 0.22.0. Not checked here: that --provenance works when publishing a tarball path. That needs a real run on the tag, and it is the first thing to look at in the first release's Publish log.

**ci(ci): run commitlint from the locked devDependency, not a download** ([`db4c26d`](https://github.com/jjjermiah/opencode-plugboard/commit/db4c26d776dd9b1b834602f551f7ca001cae885b))

commits.yml and lefthook.yml ran `bunx commitlint`. bunx uses a local install when there is one, but in a clone or a CI job without it, it fetches the latest matching package at run time. That is an unpinned install, which Scorecard's Pinned-Dependencies check can flag. @commitlint/cli is already a devDependency pinned to 21.2.3 in package.json and bun.lock, so both files now run ./node_modules/.bin/commitlint.

The commits workflow runs bun install --frozen-lockfile before the lint step, so the binary is there. The local commit-msg hook needs node_modules, which CONTRIBUTING already asks for (bun install in each clone or worktree). Without it the hook now fails with "no such file" instead of downloading commitlint. Installing lefthook with bunx is unchanged.

Checked: ./node_modules/.bin/commitlint --version prints 21.2.3, and actionlint -shellcheck passes on commits.yml. The commit-msg hook ran on this commit.

</details>
<!-- commit-detail:end -->

## [0.22.0] - 2026-10-11: Eleven New Friends

**Full diff:** [v0.21.2...v0.22.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.21.2...v0.22.0)

Eleven more clients documented, five of them tested automatically. This is the start of epic [#206](https://github.com/jjjermiah/opencode-plugboard/issues/206): 34 popular clients, each with a verified setup.

### Added

- **Python clients, tested** ([#221](https://github.com/jjjermiah/opencode-plugboard/issues/221), [#227](https://github.com/jjjermiah/opencode-plugboard/issues/227), [#225](https://github.com/jjjermiah/opencode-plugboard/issues/225), [#224](https://github.com/jjjermiah/opencode-plugboard/issues/224), [#215](https://github.com/jjjermiah/opencode-plugboard/issues/215)). The OpenAI Agents SDK (on both the Responses and Chat Completions paths), LiteLLM, Instructor, DSPy and Aider each have a setup page, an example and a harness. `bun run compat:python` runs them against a standalone fake plugboard or a live one; all 18 scenarios and the Aider check pass on both.
- **Coding agents and chat apps** ([#213](https://github.com/jjjermiah/opencode-plugboard/issues/213), [#214](https://github.com/jjjermiah/opencode-plugboard/issues/214), [#216](https://github.com/jjjermiah/opencode-plugboard/issues/216), [#219](https://github.com/jjjermiah/opencode-plugboard/issues/219), [#207](https://github.com/jjjermiah/opencode-plugboard/issues/207), [#220](https://github.com/jjjermiah/opencode-plugboard/issues/220)). Claude Code, Codex CLI, Continue, Kilo Code, LibreChat and Zed have setup pages and example configs, checked against each client's current docs. Claude Code was also run live: text and a tool turn work through `/v1/messages`, once `maxTools` is above its 36 tools (the page shows how; the default is [#242](https://github.com/jjjermiah/opencode-plugboard/issues/242)).

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (15 commits)</summary>

#### Tests

**test(compat): shared harness and standalone fake plugboard for python clients** ([`fa342dd`](https://github.com/jjjermiah/opencode-plugboard/commit/fa342dd0a42ab1b607a9176105ba5391d0d6d526))

The Python client harnesses (#221, #224, #225, #227) need a plugboard they can run against without a live server. test/support/fake-server.ts starts the real OpenAI route (startRoute) on a free loopback port with a fake model. Unlike the matrix's fake (test/compat/scenarios.ts), it does not read [scenario:...] tags, because these clients send their own prompts. It answers from the request: a forced or required tool is called with arguments built from its JSON Schema, a prompt that mentions the weather calls the first tool once, the answer after a tool result is text, a DSPy [[ ## field ## ]] prompt gets those fields back, and anything else answers "pong". It prints PLUGBOARD_URL and PLUGBOARD_KEY and stops when its stdin ends or on SIGTERM.

compat/py/clients/_common.py gives every harness the same contract: scenarios are functions that raise on a wrong answer, and each prints one JSON line {client, scenario, status, detail}. The detail is redacted of the key. require() replaces assert so checks still run under python -O.

compat/py/clients/run_all.py runs the registered harnesses. With PLUGBOARD_URL unset it starts the fake; with PLUGBOARD_URL and PLUGBOARD_KEY set it runs against that server instead. A harness that crashes before any scenario counts as one failure. bun run compat:python wraps it. The harness list is empty here; each client commit adds its own file.

Checked: bun run typecheck passes, and the runner starts the fake and stops it with an empty harness list.

Refs #206

**test(tests): openai agents sdk python harness, docs and example (#221)** ([`ffbeddb`](https://github.com/jjjermiah/opencode-plugboard/commit/ffbeddb2f390446bd9a36b6d56de21ef12f41953))

The OpenAI Agents SDK is OpenAI's own agent framework, and it defaults to the Responses API, so it exercises /v1/responses. compat/py/clients/openai_agents.py runs four scenarios on both the Responses path and the Chat Completions path (set_default_openai_api("chat_completions")): a text reply, a streamed reply, a function_tool round trip, and structured output through output_type. It pins openai-agents 0.23.1 in the compat/py uv lock, which resolves against the existing openai 3.29.0 pin. Tracing is off, so no request goes to OpenAI.

Against the scripted fake plugboard all 8 scenarios pass (run 2026-10-12). The live run on the isolated dev server could not happen: nothing listened on :4010 at the time, and the server was left alone. compat/results/openai-agents.md records both.

docs/clients/openai-agents.md is the setup page (client injection, the API switch, the tool and structured snippets, the gotchas). examples/openai-agents is a PEP 723 script, so uv runs it with no install step. The page is in the sidebar and examples/README.md lists it.

scripts/compat-matrix.ts rewrites docs/compatibility.md from the test matrix, which would have dropped the new Python section. It now keeps everything from the "## Python clients" heading on. Regenerating from the current results changes only the added lines (checked), so the CI staleness check still passes.

Fixes #221

**test(tests): litellm as a client python harness, docs and example (#227)** ([`7f955f3`](https://github.com/jjjermiah/opencode-plugboard/commit/7f955f3af83b5c89f7eaa7da52f62c3d8f439fd4))

LiteLLM is usually a gateway, but as a client, litellm.completion normalises the request and sends it to any OpenAI-compatible api_base. compat/py/clients/ litellm_client.py calls it with the openai/ prefix, which selects Chat Completions, and runs four scenarios: a completion, a stream, a tool round trip (the tool result goes back in a tool message) and structured output through a pydantic response_format.

LiteLLM needs openai below 3, and the Agents SDK needs openai 3, so these clients cannot share compat/py. compat/py-litellm is a second uv project that pins litellm 1.105.0 with openai 2.54.0. Its pins also cover dspy 3.4.0 and instructor 1.17.0, which are used by the next two commits. instructor 1.17 caps jiter below 0.15, which is incompatible with openai 3.29, so the three clients share this environment. run_all.py runs each harness in its project with uv run --project, and strips the parent's VIRTUAL_ENV so uv does not warn.

Against the scripted fake all 4 scenarios pass (run 2026-10-12). The live run could not happen: nothing listened on :4010, and the server was left alone. compat/results/litellm.md records both.

docs/clients/litellm-client.md covers the completion call, streaming, tools, structured output, and the gotchas that were actually observed (api_base takes /v1 and no path, the openai/ prefix, the price-map fetch on import). Model ids other than fast were not run through LiteLLM and are marked untested. The example is a PEP 723 script (examples/litellm-client), and the page is in the sidebar and the compatibility table.

Refs #227

**test(tests): instructor python harness, docs and example (#225)** ([`0c55e71`](https://github.com/jjjermiah/opencode-plugboard/commit/0c55e71ab8c3d7db13d011346c69dc8866fe1abf))

Instructor wraps the OpenAI client and returns a validated Pydantic object, so a custom base_url carries through. compat/py/clients/instructor_client.py extracts a Person (name: str, age: int, bounded) in three ways: Mode.TOOLS (a tool forced by tool_choice), Mode.JSON_SCHEMA (response_format json_schema, which plugboard serves as a forced tool), and create_partial over a stream. max_retries is 0 in the harness, so a validation failure shows instead of being retried.

It runs in compat/py-litellm (openai 2.54.0), where instructor 1.17.0 was pinned in the previous commit: instructor caps jiter below 0.15, which conflicts with openai 3.29 in compat/py. Against the scripted fake all 3 scenarios pass (run 2026-10-12). The live run could not happen: nothing listened on :4010, and the server was left alone. compat/results/instructor.md records both, and lists what was not tested: the validation-retry path (the fake is deterministic, so it cannot send a bad value first) and the tools-plus-schema case from #225.

docs/clients/instructor.md covers both client forms, the modes, partial streaming and the gotchas, with the claims that were not run marked as such. The example is a PEP 723 script in examples/instructor. The page is in the sidebar and the compatibility table.

Refs #225

**test(tests): dspy python harness, docs and example (#224)** ([`1921579`](https://github.com/jjjermiah/opencode-plugboard/commit/1921579236ec805a29b4ef3e8c2ed9e0d75fcc11))

DSPy routes its models through LiteLLM, and the openai/ prefix sends them to Chat Completions. compat/py/clients/dspy_client.py runs three scenarios on dspy.LM: Predict on a question -> answer signature, ChainOfThought, and a typed output (an OutputField typed with a pydantic model, which DSPy asks for through a JSON schema after its text format does not parse).

The typed scenario first failed on the fake, and the cause was on the fake side: it answered the bare word pong for every output field, and the typed field needs a JSON object. fake-server.ts now answers {"answer": "pong"} when the prompt carries a JSON schema ("type": "object"). This is test-only; plugboard was not changed.

Against the scripted fake all 3 scenarios pass (run 2026-10-12), and the full fake run is 18 of 18 across the four clients. The live run could not happen: nothing listened on :4010, and the server was left alone. compat/results/dspy.md records both, plus what was not tested (dspy.streamify, a real model's own JSON fallback).

docs/clients/dspy.md covers dspy.LM with api_base and the openai/ prefix, a typed output, and the gotchas. The example is a PEP 723 script (examples/dspy). The page is in the sidebar and the compatibility table.

Refs #224

#### Docs

**docs(docs): add Claude Code client guide** ([`056eccb`](https://github.com/jjjermiah/opencode-plugboard/commit/056eccb3946cffd85d920d0837b5035258fcb7a9))

Claude Code speaks the Anthropic Messages API, so the page points ANTHROPIC_BASE_URL at plugboard's root (no /v1) and maps the haiku, sonnet and opus tiers to two aliases. examples/claude-code/ has the shell exports and a settings.json env block. The gateway notes cover the two checks that still reach api.anthropic.com. Checked against the Claude Code docs, not run against plugboard.

Refs #213

**docs(docs): add Codex CLI client guide** ([`d0e0e1e`](https://github.com/jjjermiah/opencode-plugboard/commit/d0e0e1ee65068b5f8263fc5e5556470646220426))

Codex CLI accepts only wire_api = "responses", so the page points a custom provider at plugboard's /v1 root and exercises /v1/responses end to end. examples/codex-cli/ has the config.toml. The notes cover the request shapes plugboard refuses: previous_response_id, custom tool types and hosted tools. Checked against the Codex docs, not run against plugboard.

Refs #214

**docs(docs): add Continue client guide** ([`3c0a95c`](https://github.com/jjjermiah/opencode-plugboard/commit/3c0a95c4dee8ca88b764f24ebb6bc66654a25bbd))

Continue picks Chat Completions or Responses per model. The page adds one plugboard model on each route, with the capabilities Continue cannot detect for the alias. examples/continue/ has the config.yaml, which replaces the JSON form Continue marks as deprecated. Checked against the Continue docs, not run against plugboard.

Refs #216

**docs(docs): add Kilo Code client guide** ([`b2fee01`](https://github.com/jjjermiah/opencode-plugboard/commit/b2fee014dcd9fbc660c2cda449bf416bb6b60d31))

Kilo Code lets a custom provider pick Chat Completions, Responses or Anthropic Messages, so it is the one client here that can exercise all three plugboard routes. The page lists the three VS Code settings and marks what Kilo's docs do not cover: the CLI config shape (third-party guides) and the base URL form for the Anthropic choice. examples/kilo-code/ has the provider block. Checked against the Kilo docs, not run against plugboard.

Refs #219

**docs(docs): add LibreChat client guide** ([`a961580`](https://github.com/jjjermiah/opencode-plugboard/commit/a96158000f476ae9fc3dd128dd2c8111b88097b8))

LibreChat has two kinds of custom endpoint, and the page sets up both against plugboard: an OpenAI-shaped endpoint (base URL ending in /v1) and a native Anthropic endpoint (root base URL, provider: anthropic). It covers the Docker bind and key, the fields LibreChat needs before it keeps an endpoint, and the title call that each new conversation adds. examples/librechat/ has the yaml, the compose override and the .env key. Checked against the LibreChat docs, not run against plugboard.

Refs #207

**docs(docs): add Zed client guide** ([`c972d1d`](https://github.com/jjjermiah/opencode-plugboard/commit/c972d1d2e867979d035ad47c7e875402229ff3fc))

Zed has an OpenAI-compatible provider and an Anthropic-compatible provider. The page sets up both against plugboard: the OpenAI one on a /v1 base URL, the Anthropic one on the root. It covers the context window in max_tokens, the capability flags, and where keys go (the UI or a derived variable, not settings.json). examples/zed/ has the settings.json fragment. Checked against the Zed docs, not run against plugboard.

Refs #220

**docs(docs): verify Claude Code live and list the new client pages in the README** ([`0c468dd`](https://github.com/jjjermiah/opencode-plugboard/commit/0c468dd692727678c0ef015f5b241b2a3a1ded8d))

Ran Claude Code 2.1.293 against plugboard main on the isolated dev server (opencode-go/glm-5.3-flash): `claude -p` answered pong and a Bash tool turn ran the tool in Claude Code and answered with its output. The first run failed with `400 tools: 36 tools; plugboard allows 32`, so the page now sets maxTools to 64 and explains why, plus the unrecognized-model notice. The README client table lists the six new pages with honest status (Claude Code run, the rest docs-only), and compat/docker/README.md no longer says /v1/responses is missing.

Refs #213

**docs(docs): aider setup page, example and scripted check (#215)** ([`c5d24cf`](https://github.com/jjjermiah/opencode-plugboard/commit/c5d24cf1bd6359397dcaff153981338df712a61a))

Aider is a terminal coding tool that talks to any OpenAI-compatible endpoint. Its package is heavy (about 300 dependencies, Python below 3.13), so it does not join the uv harnesses. compat/py/clients/aider_check.sh runs aider-chat 0.86.2 from PyPI with uv tool run, in a throwaway git repo: one --message request through plugboard on openai/fast, with a weak model set too. It prints one JSON line like the harnesses and exits 1 if Aider fails or the answer lacks pong. The install was quick enough to try on Python 3.12 once.

Against the scripted fake the check passes (run 2026-10-12). The check proves the request path and a streamed text answer. It does not prove a file edit, because the fake answers in plain text and not with an edit block. The live run could not happen: nothing listened on :4010, and the server was left alone.

docs/clients/aider.md gives the env-var setup, the openai/ prefix, the multi-request note, the check command, and a list of what was and was not tested. The example is examples/aider: .aider.conf.yml (its keys are verified as command-line flags only, which the page says) and .env.example, since .env stays out of Git. The page is in the sidebar, the examples index and the compatibility table.

Refs #215

**docs(docs): record the live python client runs on the dev server** ([`c0b6452`](https://github.com/jjjermiah/opencode-plugboard/commit/c0b6452d57c34fdfbd8d26d6f8d7eb433fa5bd55))

The five Python client pages, their results records and the compatibility table were written while the isolated dev server on :4010 was down, so they said "not run" for the live column. The listener came up later the same day (2026-10-12), and every client was run against it with the compat app and the fast alias (opencode-go/glm-5.3-flash): the OpenAI Agents SDK 8 of 8 on both API paths, LiteLLM 4 of 4, Instructor 3 of 3, DSPy 3 of 3, and the Aider check. The live results are now in each page and record, and the compatibility table. The earlier failed curl check stays in each results file as a dated note, since results are evidence and are not rewritten.

Live results show the model's own answers (for example, Instructor extracted Ada, 36 from the sentence), which the fake cannot. No plugboard bug was found in either run. The fake run and the live run used the same harnesses.

Refs #206

**docs(changelog): notes for the new client pages and the python client harnesses** ([`c726ba6`](https://github.com/jjjermiah/opencode-plugboard/commit/c726ba6964175a219120989a2bcb6e2de392bb95))

README client table gains the five Python clients with their tested scenarios. Curated [Unreleased] notes for the eleven new client pages (#207 #213 #214 #215 #216 #219 #220 #221 #224 #225 #227), the compat:python harnesses and the live Claude Code check. Pinned install examples bumped to 0.22.0.

</details>
<!-- commit-detail:end -->

## [0.21.2] - 2026-10-11: Nothing Left Unsaved

**Full diff:** [v0.21.1...v0.21.2](https://github.com/jjjermiah/opencode-plugboard/compare/v0.21.1...v0.21.2)

### Fixed

- **Usage counts survive a restart** ([#241](https://github.com/jjjermiah/opencode-plugboard/issues/241)). Usage was written to storage at most every 10 seconds, so the newest changes sat in memory and a restart dropped them: a day could keep its tokens and model counts but show `requests: 0`. Each change is now written as it lands, one write at a time per day. Counts already lost before upgrading can't be recovered.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (2 commits)</summary>

#### Fixes

**fix(metrics): write each usage change as it lands so requests are not lost** ([`6a16973`](https://github.com/jjjermiah/opencode-plugboard/commit/6a16973c031c250ba27bd962a5edeb78c35dfd6c))

The usage store debounced its day writes: a day was written at most every 10 s, by the request that found the last write that old. A change that arrived inside that window stayed in memory until a later request, and a restart dropped it (src/usage.ts flushIfDue, before this change).

Each model request records two changes, in this order: the model call (withUsage in src/usage.ts, tokens and cost per model) and then the request itself (the route log point, src/openai/route.ts:425, which bumps requests and lastRequestAt). The call was usually written first, so the stored day had the per-model counts but requests 0 and no lastRequestAt. A single request shows exactly that, and any change still in memory was lost on restart.

Changes are now written as they land. Writes of one day never overlap: a change made during a write goes out in the next write, when that one lands. A failed write is logged and the next change tries again.

Stored days keep every field they had. fromJson still reads older records, and a day stored without `users` or `lastRequestAt` keeps its counts when a request adds to it.

Docs that described the 10 s window (docs/architecture.md I23 and the usage section, docs/configuration.md, STRUCTURE.md) now describe this.

Fixes #241

#### Docs

**docs(changelog): notes for 0.21.2** ([`06f564b`](https://github.com/jjjermiah/opencode-plugboard/commit/06f564bfeb98a638d9532bc8f9c30ecd802949fc))

Curated [Unreleased] entry for #241: usage changes are written as they land instead of every 10 seconds, so a restart no longer drops request counts. Pinned install examples bumped to 0.21.2.

</details>
<!-- commit-detail:end -->

## [0.21.1] - 2026-10-11: Read Between the Fences

**Full diff:** [v0.21.0...v0.21.1](https://github.com/jjjermiah/opencode-plugboard/compare/v0.21.0...v0.21.1)

### Fixed

- **Structured output when the model answers in prose.** Told "don't call any tool", Claude also skips the `respond` tool and writes "Here is the JSON: ```json {...}```". The text fallback now takes a single fenced JSON block from inside prose when it matches the schema, so this is an answer instead of a 502. Two blocks, or a block that doesn't match, still fail. Found by the live suite; all three Claude tools-plus-schema cells now pass.

### Changed

- **Wider docs pages.** The docs site now uses most of the window: the text column grows to 1280px beside the outline, and wide tables scroll inside themselves, so diagrams and endpoint tables have room.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (3 commits)</summary>

#### Fixes

**fix(openai): take the one fenced JSON block from prose in the structured fallback** ([`543a541`](https://github.com/jjjermiah/opencode-plugboard/commit/543a5419c75118960b8f243476abc0d727a8370d))

The live suite still failed Claude Haiku 4.5 on tools plus json_schema (chat, responses and gemini) after #170: told "Do not call any tool", the model also skips the respond tool and answers in prose around a fenced block ("I cannot call any tool. However, here is the JSON: ```json {...}```"). textFallback only accepted text that was entirely JSON or entirely one fence, so this became a 502.

The fallback now also tries the single fenced code block anywhere in the text, when there is exactly one, and returns it only if it parses and matches the schema subset. Two blocks, or a block that does not match, still give the 502. Unit tests cover all three; PLUGBOARD_LIVE=1 with anthropic/claude-haiku-4-5 now passes the three tools-json cells (3 pass, 0 fail) on the isolated dev server.

#### Docs

**docs(docs): widen the docs site pages** ([`227b059`](https://github.com/jjjermiah/opencode-plugboard/commit/227b0591dcf9e613a7a1c9e46d4996cf3658567e))

The default VitePress theme caps the layout at 1440px and the text column at 688px, which squeezed the architecture diagrams, endpoint tables and config blocks. A small custom theme (docs/.vitepress/theme) lifts the layout cap, lets the text column grow to 1280px beside the outline, makes wide tables scroll inside themselves, and lets images and SVG use the full column. The theme's own rules are scoped, so the overrides use !important. Checked with headless Chrome at 1920px on the guide and architecture pages: the text column roughly doubled and the outline stays on the right.

**docs(changelog): notes for 0.21.1** ([`a9d2a77`](https://github.com/jjjermiah/opencode-plugboard/commit/a9d2a779b607afc221266621606018697eeb5e83))

Curated [Unreleased] entries for the structured-output fallback taking a single fenced JSON block from prose (found by the live suite with Claude Haiku 4.5) and the wider docs pages. Pinned install examples bumped to 0.21.1.

</details>
<!-- commit-detail:end -->

## [0.21.0] - 2026-10-11: Answers to the Reviewers

**Full diff:** [v0.20.0...v0.21.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.20.0...v0.21.0)

This release is mostly the answer to three staff-engineer reviews and a first live run against real providers. If you installed 0.18.0 to 0.20.0 from npm, the `/plugboard` TUI page never loaded; it does now.

### Fixed

- **The `/plugboard` TUI page loads after an npm install.** OpenCode only compiles a TUI plugin's Solid JSX when the file is outside `node_modules`, so the shipped `src/tui.tsx` failed with `Cannot find package '@opentui/solid'`. The TUI entry is now precompiled to `dist/tui.js` with the same Solid transform OpenCode uses, and the smoke check inspects the installed file.
- **Structured output is honest everywhere** ([#169](https://github.com/jjjermiah/opencode-plugboard/issues/169), [#170](https://github.com/jjjermiah/opencode-plugboard/issues/170), [#172](https://github.com/jjjermiah/opencode-plugboard/issues/172), [#173](https://github.com/jjjermiah/opencode-plugboard/issues/173)). Legacy `/v1/completions` now honours `response_format`. When a model answers with schema-valid JSON text instead of calling the `respond` tool (Claude often does when it also has caller tools), that answer is used and marked `x-plugboard-structured-fallback: text`. A structured request that gets no answer is a 502 `structured_output_missing` on every API, never an empty 200.
- **Provider errors say what happened** ([#171](https://github.com/jjjermiah/opencode-plugboard/issues/171)). A subscription usage limit is now 429 `quota_exceeded`, a rate limit 429 `rate_limited`, a rejected login `provider_auth_failed`, an unknown model 404, instead of one generic `provider_unavailable`. The raw provider text is still never sent.
- **Revoking the last key fails closed** ([#152](https://github.com/jjjermiah/opencode-plugboard/issues/152)): every request gets 401 until restart, where before the removed key kept working.
- **Memory and cache** ([#153](https://github.com/jjjermiah/opencode-plugboard/issues/153), [#154](https://github.com/jjjermiah/opencode-plugboard/issues/154)): streamed Anthropic and Gemini answers keep no full copy in memory, the cache stops recording past `maxBytes`, and cached answers are served before budgets and limits, so a hit costs no slot and no budget.
- **No orphaned sessions** ([#155](https://github.com/jjjermiah/opencode-plugboard/issues/155)): a session that finishes creating after the client disconnected is deleted.

### Added

- **`/readyz` and loud config errors** ([#159](https://github.com/jjjermiah/opencode-plugboard/issues/159), [#160](https://github.com/jjjermiah/opencode-plugboard/issues/160)). An invalid option now fails the plugin's setup with the field and reason, so OpenCode lists the plugin as failed instead of active and silent. `GET /readyz` answers 503 with the first missing piece until plugboard can serve, for service units and load balancers.
- **OpenCode tools for a trusted app** ([#82](https://github.com/jjjermiah/opencode-plugboard/issues/82)). Off by default:

  ```jsonc
  "apps": { "research-bot": { "key": "{env:RESEARCH_KEY}", "serverTools": ["websearch"], "maxServerToolSteps": 4 } }
  ```

  That app's requests may run exactly those OpenCode tools on the server and get the final answer back; every other app keeps pure deny-all. Anyone holding that key can make the server run those tools with the server's credentials, so list only what the app needs.
- **Request bodies are admitted before they are read** ([#156](https://github.com/jjjermiah/opencode-plugboard/issues/156)): at most `limits.maxBodyBytesInFlight` (128 MiB) of bodies are buffered at once (503 `server_busy` beyond that), and a body that takes over `limits.bodyReadTimeoutMs` (30 s) gets 408.
- **A live test layer** ([#99](https://github.com/jjjermiah/opencode-plugboard/issues/99), [#108](https://github.com/jjjermiah/opencode-plugboard/issues/108)): `PLUGBOARD_LIVE=1 bun test test/live` runs every API and scenario against a real OpenCode server, and `bun run live-matrix` writes the provider x endpoint table in `docs/live-matrix.md`. Its first run found the structured-output and error-reporting bugs above.
- **Docs**: a remote access guide (Tailscale, TLS proxy, SSH tunnel, one replica) ([#168](https://github.com/jjjermiah/opencode-plugboard/issues/168)), third-party notices for vendored test fixtures ([#163](https://github.com/jjjermiah/opencode-plugboard/issues/163)), a non-affiliation line ([#164](https://github.com/jjjermiah/opencode-plugboard/issues/164)), and fixes for every doc the reviews found contradicting the code ([#161](https://github.com/jjjermiah/opencode-plugboard/issues/161)).

### Changed

- CI builds the docs site on pull requests ([#167](https://github.com/jjjermiah/opencode-plugboard/issues/167)), the host-bump workflow tests with read-only permissions and opens its PR from a separate clean job ([#157](https://github.com/jjjermiah/opencode-plugboard/issues/157)), the compat log proxy redacts every key header ([#162](https://github.com/jjjermiah/opencode-plugboard/issues/162)), and `@types/escape-html` ships as a dependency so TypeScript consumers compile ([#166](https://github.com/jjjermiah/opencode-plugboard/issues/166)).
- Internal runtime version 15. Restart OpenCode after upgrading.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (32 commits)</summary>

#### Features

**feat(runtime): fail plugin setup on invalid options and show the error** ([`65b48df`](https://github.com/jjjermiah/opencode-plugboard/commit/65b48dfc1511e2e98b7ac5870077f6aeb1b7ef46))

An invalid plugboard option used to be caught in index.ts and turned into a silent return. The plugin then showed as active with nothing registered, and an operator only saw connection refused. Now the setup fails with the parser's message (field path included), so the host shows the plugin as failed.

Evidence for the host state (OpenCode v2.0.26, read from the tagged source): packages/core/src/plugin.ts load() turns a failed setup into { error } (line 86); activate() stores it as the slot's error (line 154); slotInfo() reports { status: "failed", error } (lines 286-290). The CLI plugin inventory prints that error (packages/cli/src/commands/handlers/plugin/inventory.ts:40). A failed setup is attempted again on each activation, which is cheap: the setup fails before it registers anything.

The setup still registers nothing and returns promptly, so the freeze rules (I1, I2) hold: the error is thrown before any registration, and the message is recorded with a synchronous call. The error log line `options.invalid` stays at error level.

When a listener from an earlier good generation still serves the port, the runtime keeps the message (`setConfigError`, a field on the runtime) and `GET /v1/status` returns `configError: { message, at }`. The next Location that parses valid options clears it. I chose last outcome wins over a per-directory record, because a per-directory record would stay set forever after a project config entry is removed.

Not done: a TUI toast. I did not verify a host API that shows a plugin error to a TUI user, so the failed state in the plugin inventory is the surface this change relies on.

Runtime VERSION is unchanged. The runtime gained the optional field `configError`, which an older runtime object simply lacks.

Checked: test/runtime/plugin.test.ts (failing setup with the message and the error log; status and /v1/status while a good generation serves; a valid load clears it). `bun run typecheck` passes and `bun test` reports 1729 pass, 0 fail.

Fixes #159

**feat(http): add GET /readyz for backend readiness** ([`f0c3a34`](https://github.com/jjjermiah/opencode-plugboard/commit/f0c3a347ec0f7eb5712548072811dbfa8215956e))

/healthz answers {"ok":true} as soon as the route runs, so a service unit or load balancer could send traffic to a plugboard that cannot serve yet: no app directory confirmed, no event pump, or no model catalog loaded.

GET /readyz needs no key, like /healthz, and makes no host call. It answers {"ready":true} when a generation serves, the event pump runs and the catalog has loaded at least once. Otherwise it answers 503 {"ready":false,"reason"} with the first missing piece, in the order a person fixes them: a recorded invalid config (#159, its own message as the reason), no live generation, no app directory used since start, the pump stopped, the catalog not loaded. The reason never includes config values or keys.

The pieces come from the runtime status. `catalogLoaded` is new: it is set only when `loadServingCatalog` succeeds, so a failed load keeps readiness false. `readiness` in src/discovery.ts is a pure function of those facts.

Readiness does not start from setup. The first request to an app confirms its directory (ensureBackend), and any request that reaches the handler starts the event pump; the route only reads the status. A readiness probe is never logged, because it repeats until the backend is ready.

Rejected: making /readyz confirm the app directory itself. That would run ensureBackend, which creates directories, from a probe. Instead the docs say one model request to an app makes a restarted server ready, and the 503 reason says so.

Runtime VERSION is unchanged. The runtime gained an optional field, `catalogLoaded`, on the Runtime object, and RuntimeStatus gained a required `catalogLoaded`. An older runtime object simply has the field unset.

Checked: test/http/readyz.test.ts (ready with no key; each 503 reason; a wrong key or none is never 401 and never echoes a key), and test/runtime/plugin.test.ts (a real generation: 503 until an app is used, then 503 for the catalog, then {"ready":true} after one /v1/models request). Route manifest row and discovery probe added. The test gates ratcheted to the new counts. `bun run typecheck` passes, `bun test` reports 1734 pass, 0 fail, `bun run coverage-manifest` reports 0 gaps, and check-pack and smoke-pack pass.

Fixes #160

**feat(config): add apps.<name>.serverTools and maxServerToolSteps** ([`ce7cdcd`](https://github.com/jjjermiah/opencode-plugboard/commit/ce7cdcd569d592ba79cd53c07535edb3719a4eae))

Option apps.<name>.serverTools lets one trusted app opt in to a named list of OpenCode's own tools (for example websearch). It is off by default: an app without the field keeps the deny-all request sessions it has today. This commit only validates and parses the two fields; the session code that acts on them follows in the next commit.

Each id must be an exact tool id (letters, digits, _ . : -, no wildcards), at most 32 entries, no duplicates. `execute` is rejected because it is CodeMode and would run every tool it wraps, and plugboard_seed_* names are reserved for the seed pool. The keyless default app cannot have server tools, because loopback callers are not isolated from each other (#87). maxServerToolSteps is optional (default 8, 1 to 100) and needs serverTools.

Rejected alternatives: a wildcard or prefix form, which would widen silently when OpenCode adds tools, and a top-level option, since the per-app policy already carries the other app-scoped settings.

Checked with bun test test/unit/config.test.ts (new #82 block: accepted shapes, each rejection, the default app).

Refs #82

**feat(session): run an app's listed OpenCode tools in request sessions** ([`66428a4`](https://github.com/jjjermiah/opencode-plugboard/commit/66428a46d3d192df79c65703b24b8d7695b7118b))

A request session of an app with serverTools gets deny-all, the seed allow, and one exact allow per listed id (requestPermissions). OpenCode evaluates session rules last match wins, so the later allows override the deny. This was checked against the pinned host (v2.0.26): Wildcard.match and the findLast loop in Permission.evaluate, with ids that are exact names only. Apps without serverTools keep REQUEST_PERMISSIONS unchanged.

At request time, after the backend is ready and before session.create, every listed id must be a direct tool of the location (codemode false, permission name equal to its id), read through SessionPort.directTools. A missing one is a 400 server_tool_unavailable and nothing is created. The message says that CodeMode tools, including MCP tools by default, cannot be listed and need codemode: false. A caller tool with the same name is a 400 server_tool_collision.

The context hook keeps the host's own descriptor for each listed tool, so the host maps the call back to the real tool. Those tools are not offered when tool_choice is none. The collector treats a call to a listed tool as a server call. It is not emitted as a tool call, a step with only server calls continues the turn, a step with a caller call returns to the caller as before, and at most maxServerToolSteps server steps run before the request fails with 502 server_tool_steps_exceeded. Each server call writes one server_tool.call log line (tool, duration, ok) and never its arguments. Apps with serverTools bypass the response cache, through the same bypass predicate as persona models.

A non-streaming answer that ran server tools carries x-plugboard-server-tools with the count. The session caller reports it once per call when the call ends (CallContext.onServerTools), and every front-end's reportServerTools sums the choices of n while the headers are open. Streams never get the header.

Rejected alternatives: asking the caller to run the tools (the point of the issue is that OpenCode runs them), a wildcard in the session permission (it would widen with every new tool), and interrupting on every step with server calls (the model would never get to answer with the tool's result).

Checked with bun test: test/session/server-tools.test.ts (permissions, request checks, hook identity, step classification, the cap, log lines, the host port, the count callback, the header writer), test/http/policy.test.ts (the header on chat, n = 2 and streams) and test/runtime/cache.test.ts. Not run: a live websearch call against a real provider on an isolated server.

Refs #82

#### Fixes

**fix(runtime): fail closed when the last key is revoked** ([`823b725`](https://github.com/jjjermiah/opencode-plugboard/commit/823b72512c036bb0f73a319ae44aea54f714554f))

With one key and an older generation still serving, a reload that removes that key kept the old key working: an empty key set was rejected as not a revocation. Removing the last key now sets the live key set to one entry that no request can match, so every request gets 401 until restart. Adding a key back is still rejected until restart (I5). Catalogue entry I5-revoked-last-key-goes-keyless guards the rule.

Fixes #152

**fix(tests): redact every API key header and the key query in logproxy** ([`2fc13e2`](https://github.com/jjjermiah/opencode-plugboard/commit/2fc13e2aba249ff79e7ab789191784a9ca5aa556))

compat/tools/logproxy.py redacted only the Authorization header. Anthropic clients send their key as x-api-key, Gemini clients as x-goog-api-key or as the key query parameter, so a capture written with those clients kept the live key in plain text. The proxy now redacts those two headers (matched case-insensitively, with Authorization) and the value of the key query parameter. The request target is redacted in the record only; the upstream request still carries it unchanged. Other query parameters are kept as sent.

The capture file was created with mode 600, but touch() applies a mode only when it creates the file, so a capture that already existed kept its old mode. The proxy now chmods the file to 0600 on every start.

Rejected: a generic "redact anything that looks like a key" rule. It would hide ordinary headers and parameters that the captures need to show, and the list of credential names is short and known. Stdlib only, as before.

Checked: python3 -m py_compile compat/tools/logproxy.py passes. Ran the proxy against a local upstream with x-api-key, x-goog-api-key, Authorization and ?key=, on a capture file that already existed with mode 644. The record shows <redacted> for all four, the other query parameters are intact, the file contains none of the secret strings, and the mode is 600.

Fixes #162

**fix(cache): bound memory held by streams and cache capture** ([`4b77d6e`](https://github.com/jjjermiah/opencode-plugboard/commit/4b77d6e64604f2b2436118a2348bb4d92039ba09))

The Anthropic and Gemini encoders built the full content or parts aggregate for every answer, and the stream routes never read it. A streamed answer now keeps no aggregate: only a non-streamed body is built. The response cache recorded every text byte of a miss and checked maxBytes only when storing, so a long answer was held in full and then dropped. Capture now stops once the captured text passes maxBytes, which frees what it kept, and the answer is served but not stored. Both checks use the configured cap, so no new option is needed.

Fixes #153

**fix(cache): answer hits before the concurrency limiter** ([`fb19893`](https://github.com/jjjermiah/opencode-plugboard/commit/fb198936b85c437137d48eda719c0282d7b039c7))

index.ts put the response cache inside the limiter, so admission checked the app's concurrency before the cache lookup: a cached prompt got 429 while one miss held the app's only slot. The cache is now outside the budgets and the limiter, and only a miss is budgeted and limited. A hit spends no budget, takes no slot and counts toward no requests-per-minute window, so the window counts only calls that reach a model. Budgets stay outside the limiter. The wrapper order is documented in docs/architecture.md and docs/configuration.md.

Fixes #154

**fix(session): delete a session created after its request was aborted** ([`dde2b1e`](https://github.com/jjjermiah/opencode-plugboard/commit/dde2b1ee00cc0ec0b3f45d95402944d71c251941))

raceAbort rejects as soon as the request aborts, but the host keeps running session.create. A session that landed after the disconnect was never indexed, so history pruning never removed it. The caller now deletes such a session when the create resolves late, logging a failed delete. SessionPort gains remove(), backed by ctx.session.remove.

Fixes #155

**fix(completions): honour response_format on legacy /v1/completions** ([`8ed3df4`](https://github.com/jjjermiah/opencode-plugboard/commit/8ed3df43f6e1f417a4799e4b75caa4afc755f74f))

Legacy completions ignored response_format, so a json_schema prompt got prose back while the docs said it worked. The decoder now parses it with the chat parser: json_schema is the forced respond tool, and the answer is its arguments as text; json_object is the same system instruction, with one code fence stripped. A structured turn without the call is a 502 structured_output_missing, as on chat. Streamed structured answers are written as one text chunk at the end. The three live cells that failed on this are removed from test/live/known.ts.

Fixes #169

**fix(openai): answer structured output from text when respond is skipped** ([`b0acb3a`](https://github.com/jjjermiah/opencode-plugboard/commit/b0acb3afb32b4e124e260610c8211b81639edf69))

Claude Haiku with one caller tool plus json_schema often ends the turn in text and never calls respond, so the caller got a 502 even though the text was the JSON it asked for. When the final text parses as JSON (one code fence stripped) and matches the caller's schema, that text is now the structured answer. Chat Completions and legacy completions share the rule. The check is deliberately small, because ajv is a dev dependency and the runtime carries no schema library: the top-level type, the top-level required keys, and the type of each top-level property. Other schema keywords are not checked, and docs/configuration.md says so.

A non-streamed answer taken this way carries x-plugboard-structured-fallback: text. A streamed one cannot, because the headers are sent before the answer is known. Text that does not match still fails with the structured_output_missing 502.

Fixes #170

**fix(session): report provider usage, auth and model errors by their class** ([`01f517d`](https://github.com/jjjermiah/opencode-plugboard/commit/01f517d0a65b19df300144a84e5ed495d237542b))

A ChatGPT subscription at its limit came back as 502 provider_unavailable, which told the caller nothing about what to do. The host reports it as a provider.invalid-request with no status, so the status could not decide. The provider wording in the message or the raw body now decides the class when the status does not: a usage limit is 429 quota_exceeded, a rate limit 429 rate_limited, a rejected key 502 provider_auth_failed, and an unknown model 404 model_not_found. Typed 401 and 403 keep their statuses.

The caller still gets only the code and a fixed message (#88). The raw class and the code it mapped to are logged once as model.failed at error level. Once the session exists, its x-plugboard-session id is set before the first event, so it is on these error responses. A failure before the session is created has no id. A provider Retry-After is not forwarded: the host's session error carries no response headers.

Fixes #171

**fix(openai): never answer a structured turn with no answer as a 200** ([`3bcef84`](https://github.com/jjjermiah/opencode-plugboard/commit/3bcef84c5e777e65228faf321c6132159f3ee8b5))

glm-5.3-flash sometimes ended a json_schema turn with empty text and no tool call, and the 200 went out with null content. Structured output that never arrived was already a 502 for a plain stop, but a length or content-filter finish kept a 200 with null content. That exception is gone: a structured turn without the respond call (or a matching text answer, see #170) is a 502 structured_output_missing whatever the finish reason. The streamed path fails the same way before any output.

Plain turns that stop with no text, reasoning or tool call are still 200, because some models answer empty on purpose. The session now logs a warning, answer.empty, with the session id, the model and the tool count, so the session can be read when it recurs. Responses and Gemini keep their own length and content-filter handling and are not changed here.

Fixes #172

**fix(responses): answer structured output from text and 502 every missing answer** ([`d7d0f8f`](https://github.com/jjjermiah/opencode-plugboard/commit/d7d0f8fa9d273b167af5c88dcd7e0a2c310c24ee))

Responses exempted a length or content-filter finish from the missing structured output 502, and had no text fallback. The shared rules from Chat Completions now apply: a turn without the respond call is a 502 structured_output_missing for every finish reason, unless its final text is the JSON the schema asks for (#170), in which case that text is the answer and a non-streamed response carries x-plugboard-structured-fallback: text.

A streamed structured answer is held back until the turn ends. The commit still comes with the first output event, so keepalive comments run while the answer is held. A missing answer after streamed prose therefore ends as response.failed, not as an HTTP status. A transport test pins that buffered text still commits and keeps the stream alive.

**fix(gemini): answer structured output from text and 502 every missing answer** ([`b7d19d1`](https://github.com/jjjermiah/opencode-plugboard/commit/b7d19d150f65d6291f1ba223c99afddaf2226e5e))

Gemini had the same gaps as Responses: a length or content-filter finish kept its candidate with no content, and a text answer was never taken. A turn without the respond call now fails with the 502 in Google's shape for every finish reason, unless its final text is the JSON the schema asks for (#170). The schema the caller sent is carried on the exchange for that check; a wrapped (non-object) schema is checked as sent. A non-streamed answer carries x-plugboard-structured-fallback: text.

A streamed structured answer is held back until the turn ends, and the commit still comes with the first output event, so keepalive comments run meanwhile. A missing answer after streamed text ends as an error chunk.

The Haiku tools-json cells on chat, responses and gemini are removed from test/live/known.ts: the text fallback is their fix. The manifest, the configuration and gemini docs, and the ratcheted test-count floors come with this commit.

Fixes #173

#### Security

**security(http): admit request bodies against a process-wide budget** ([`497341b`](https://github.com/jjjermiah/opencode-plugboard/commit/497341bbb877a23cd6c930f557085fa46590860b))

Every route read its JSON body into memory with no bound on the total. Each request could buffer up to 32 MiB, so many concurrent large bodies from one key holder, or from any local caller on a keyless endpoint, could exhaust the OpenCode process before the model-call limits ran. readJsonBody is the one place every route reads a body, so the bound lives there and covers every route at once.

What changed: the bytes held by all bodies being read are counted in one process-wide budget, option limits.maxBodyBytesInFlight (default 128 MiB). A declared Content-Length is charged before the first byte is read, so a refusal costs no buffering. A body without one is charged as it arrives and refused once it would go over. A refusal is 503 server_busy with Retry-After 1. A body not complete within limits.bodyReadTimeoutMs (default 30 s) is 408 body_read_timeout. The bytes come back on every exit: complete, refused, timed out or abandoned.

Rejected: a module-level counter. docs/architecture.md says process-wide state lives on globalThis under a versioned key, because a plugin module can be evaluated once per Location. The budget uses its own Symbol.for key, so the runtime's shape and VERSION do not change. Rejected: capping the number of bodies in flight. A count does not bound bytes, and one 32 MiB body is not the same load as a hundred small ones. Rejected: reusing the model-call limits. They run after the body is read, which is too late.

Checked: transport tests on a loopback socket. Two bodies, the second refused with 503 while the first holds the budget, and admitted once it is released. A chunked body is charged as it arrives. A stalled body gets 408 and its bytes come back. Route tests check the 503 and 408 wire bodies, Retry-After and the logged outcome. Config tests cover the two options, their defaults and their rejections. Mutation entries I25 (admission, release, timeout) are each killed by the new tests. bun test: 1738 pass. Coverage gates pass; test floors were raised, not lowered.

Fixes #156

#### Tests

**test(tests): ratchet floors after the runtime hardening fixes** ([`aca52c1`](https://github.com/jjjermiah/opencode-plugboard/commit/aca52c1653be4de493f5c9611e7d38de766d9d47))

The new tests for the key, cache, encoder and late-session fixes raise the per-layer test counts, and function coverage rose to 92.8%. Floors are raised to these values (never lowered) with test-gates --ratchet.

**test(tests): add the opt-in live suite against an isolated OpenCode server** ([`b9786df`](https://github.com/jjjermiah/opencode-plugboard/commit/b9786dfdb2cabea1c6d0e61fba5509009e39b381))

The live layer runs the same provider x endpoint x scenario cells that the matrix uses, as tests, against a real isolated OpenCode server. The fakes in test/compat cannot show provider quirks, what the host records for a session, or what a client disconnect does to a request that is still streaming (#99).

It is skipped unless PLUGBOARD_LIVE=1, so bun test stays offline. With the variable unset the run reports the same 1547 passing tests as before and 126 skipped live tests. Configuration comes only from the environment: PLUGBOARD_LIVE_KEY (required), PLUGBOARD_LIVE_URL, PLUGBOARD_LIVE_MODELS and PLUGBOARD_LIVE_OC (the wrapper that reaches the server). The key is never written to a file or a report.

test/setup.ts records the real HOME before it sandboxes HOME. The wrapper finds the isolated server's directories under the real home, so the suite passes it on explicitly. Nothing else in the sandbox changes, and the suite never edits the server's config.

test/live/cells.ts is the table. Five endpoints (chat, responses, messages, gemini, completions) against seven scenarios: text, stream, a tool call returned unexecuted, a tool result in the history, a PNG image, json_schema output and a tool together with json_schema. A scenario an endpoint does not carry is n-a with its reason (naReason). Each cell is one call on a cheap model with max_tokens 512. A failing cell reads the provider's own error from its session, because plugboard answers a provider failure with a generic 502.

Lifecycle checks run without a restart. A client disconnect mid-stream must drain sessionGuards to 0 and leave the host with the session as interrupted; the test first checks that the request was still in flight at the hang-up. A tool-call turn and a tool-result turn each leave one assistant message in the session. Not covered: the request deadline and a plugin reload during a request. Both need a server started for that purpose, so they are left out rather than run against the shared dev server.

test/live/known.ts lists the cells that fail today. Each one runs as test.failing, so the suite keeps it visible and goes red when a fix lands, which is the cue to remove the entry. Cells that fail only sometimes are not listed. Sessions the run creates are deleted afterwards (cleanup).

Checked on the isolated dev server with PLUGBOARD_LIVE=1 bun test test/live: 122 pass, 2 fail in the last run. The two were glm-5.3-flash chat tools-json (intermittent, one failure in six runs) and anthropic gemini tools-json (known, passed once). The matrix in the next commit has the full table. Offline: bun run typecheck passes and bun test is unchanged apart from the skips.

Fixes #99

**test(tests): add the provider x endpoint live matrix (bun run live-matrix)** ([`2b32112`](https://github.com/jjjermiah/opencode-plugboard/commit/2b32112b5a4e46b5d3d1d4c1b8610ccb8d33fabd))

`bun run live-matrix` runs every cell of the live table once for each logged-in model: 4 models x 5 endpoints x 7 scenarios. Twenty cells are n/a, each with its reason. It writes docs/live-matrix.md, one table per endpoint with pass, FAIL (the reason and a snippet) or n/a for every cell, and docs/live-matrix.json with all 140 cells. Sessions the run creates are deleted at the end (--keep-sessions keeps them). A refused connection is retried once after 10 s, as docs/development.md advises, and the run keeps going if the server reloads mid-run. The exit code is 0 unless the run cannot start, because a failing cell is a finding and not a broken run.

The models are the defaults in test/live/env.ts. Each id was checked against GET /v1/models on the dev server first.

Plugboard answers a provider failure with a generic 502, so a failing cell reads the provider's error from its session. That is how the matrix shows the openai rows failed on the ChatGPT account's usage limit (subscription_sharing_usage_limit_exceeded). That is an account limit, not a plugboard fault, and it blocks every openai cell until it resets.

Findings from the committed run (plugboard 0.20.0 at 914dec6, the checkout the dev server loads; the server reloaded during the work, so the result covers that commit only):

- /v1/completions does not enforce response_format json_schema. The answer is plain text for glm-5.3-flash, gpt-5.5 and claude-haiku-4-5, although docs/completions.md says response_format works. Known in test/live/known.ts.
- Claude Haiku 4.5 with a tool and a json_schema together (chat, responses, gemini) mostly answers in text instead of calling the respond tool, so plugboard returns 502 "finished without calling the respond tool". Failed in most runs, passed once. Known.
- glm-5.3-flash chat tools-json failed in one run of six. Not listed in known.ts: it runs as a plain test.

The matrix and the suite share test/live/cells.ts. The suite is the same cells as tests (see the commit before this one); this commit adds the report, the script, and the docs. test/README.md has a Live layer section with the variables, the cost and what is not covered. CONTRIBUTING.md points to it.

Checked: bun run typecheck passes, bun test runs the same 1547 tests and skips the live ones, bun .github/scripts/check-pack.ts passes, and bun run live-matrix on the dev server gives 84 pass, 36 fail, 20 n/a of 140 cells, with sessionGuards at 0 and all 120 created sessions deleted afterwards.

Fixes #108

**test(tests): add the untrusted-app mutation and ratchet the floors** ([`f6f8aeb`](https://github.com/jjjermiah/opencode-plugboard/commit/f6f8aeb31659391bc1ce7cfec6cff7003bb1b6ee))

Adds the I8-untrusted-app-gets-server-tools mutation: it makes an app without serverTools get websearch allowed in its request session, and the named test file must then fail. The floors move to the new totals after the tests landed (session 211, unit 813, runtime 65, functions coverage 92 percent).

Mutations: 19 of 20 killed. The I15-unknown-route-before-auth entry is an anchor that already fails at HEAD: src/openai/route.ts reads liveOptions(host.options) since #90, and the catalogue still has host.options. That is not caused by this change and is left for its own fix.

Refs #82

#### Docs

**docs(docs): fix stale contradictions and link README to the docs site** ([`ecdd72a`](https://github.com/jjjermiah/opencode-plugboard/commit/ecdd72a7a5dd6a2e4aa11fc30d2cc3808c2dd17c))

Several pages described features as missing that the code now serves: /v1/responses is served, stop_sequence is returned, inline images work as `data:` URLs, and limits has a per-app concurrency cap. The reload rule was also wrong. Only key revocation and rotation apply on reload at once. Adding a key or changing any other option is rejected while an older generation still serves, so it needs an OpenCode restart. That rule now lives once in configuration.md under "Reloads and restarts", and the other mentions link to it. README links to docs pages point at the docs site instead of GitHub blob URLs. Links to CHANGELOG, LICENSE and compat/ stay on GitHub. The README known gaps for Responses storage and stop sequences were stale too.

Checked against src/openai, src/anthropic, src/limits.ts, src/stop.ts and registerGeneration in src/runtime.ts. bun run docs:build passes with no dead links.

Fixes #161

**docs(tests): add third-party notices for the vendored schema fixtures** ([`fbc1436`](https://github.com/jjjermiah/opencode-plugboard/commit/fbc1436fed1976191617ffdf35f5c0f4b5841dde))

test/fixtures/specs/openai.json is derived from openai/openai-openapi, which is MIT licensed. The MIT notice has to travel with substantial portions of the work, and the fixture carried only its source URL. THIRD_PARTY_NOTICES.md now holds the upstream copyright and license text, copied from the repository LICENSE file, plus a table that maps each fixture to its source and retrieval date.

test/fixtures/specs/gemini.json is derived from the public Gemini API discovery document. The document has no license of its own. The Google APIs Terms of Service restrict content returned by the APIs, and the Developers Site Policies cover documentation, not discovery documents. The notice says the terms are unclear and claims no open license. Keeping, replacing or removing that fixture is left to the owner. The notice is not in the npm package, because test fixtures are not in the package "files" list.

vendor.ts has a one-line comment that points to the notice. Nothing else in the test changed.

Checked with bun .github/scripts/check-pack.ts, which still passes.

Fixes #163

**docs(docs): state non-affiliation and trademark ownership in the README** ([`fb89d02`](https://github.com/jjjermiah/opencode-plugboard/commit/fb89d02351cae44a23724264b9b5a4cb54581e9d))

The README names OpenAI, Anthropic, Claude, ChatGPT, Gemini and Copilot, and readers could take the project for a product of one of those companies. A single line under the license section says that plugboard is not affiliated with or endorsed by OpenAI, Anthropic, Google, GitHub or Microsoft, and that product names are their owners' trademarks. docs/index.md includes the README, so the docs site shows the same line. Terms-of-service commentary for the providers is left out on purpose. The owner decides that separately.

Fixes #164

**docs(docs): add a remote access guide and link it from the README** ([`fbab4cc`](https://github.com/jjjermiah/opencode-plugboard/commit/fbab4cc742ce0fcae876e2769be1e607341f1dae))

Non-loopback binds serve plain HTTP, so a key sent to another machine can be read on the path. Keyless loopback is also not user isolation on a shared machine. Neither point was written down in one place, and a reader had to infer the TLS and tunnel options from the client pages. docs/remote-access.md covers when remote access is needed, what plugboard does and does not protect, and four options: a tailnet bind, a TLS reverse proxy with Caddy and Traefik examples (private bind and loopback bind, with the Host rewrite the loopback check needs), an SSH tunnel, and a firewall rule. It also says that a key sent over plain HTTP should be rotated if it crossed an untrusted path, and that each OpenCode server runs its own cache, limits and usage, so one replica per deployment is the rule.

The page is in the docs sidebar. The listen option in configuration.md and the README security section link to it. The Caddy and Traefik examples have not been run against plugboard, and the page says so.

Fixes #168

**docs(docs): document serverTools and amend the deny-all invariant** ([`7b3f036`](https://github.com/jjjermiah/opencode-plugboard/commit/7b3f036ea65bed4f11b50f159575eecce6a250e3))

docs/configuration.md gains the serverTools and maxServerToolSteps fields, a security warning (a key holder can make the server run the listed tools with the server's own credentials, and the prompt steers the arguments), the rules (request-time check, no wildcards, no execute, no keyless app, no cache), and the three new error rows.

docs/architecture.md amends I8 and I9 in place: deny-all still holds for every app that does not name a tool, and the one exception is described precisely. The request guard and seed tool sections restate the backstop with the same exception. SECURITY.md gets the threat note.

The CHANGELOG entry is left to the release notes; this commit does not touch CHANGELOG.md or README.md.

Fixes #82

#### CI and tooling

**ci(ci): build the docs site on pull requests** ([`95f6c9e`](https://github.com/jjjermiah/opencode-plugboard/commit/95f6c9e8720806590b7b51d323b1ca244dbf1606))

docs.yml builds and deploys VitePress only on a push to main. A broken link, a bad page or a VitePress error therefore showed up after the merge, when the site was already published. The package job in ci.yml now runs bun run docs:build as its last step, so the same build runs on every pull request and push. It reuses the job's frozen install and needs no new permissions (the job stays contents: read). I added a step rather than a job: the install is already there, and a separate job would install the dependencies a second time for one command.

Checked: bun run docs:build exits 0 locally, and actionlint passes on ci.yml.

Fixes #167

**ci(ci): split the host bump into a read-only check and a write-only PR job** ([`b78f13a`](https://github.com/jjjermiah/opencode-plugboard/commit/b78f13a7dfa0e958a7ed5ecc56afe5e6c6521c12))

host-bump.yml had one job with contents: write and pull-requests: write. That job installed the newest @opencode/plugin, ran its code (bun install, the typecheck and the tests) and then opened a PR with whatever the workspace held. Code that runs under the write token could change the PR it opens.

The workflow now has two jobs. check runs with contents: read: it installs the host, runs the typecheck and the tests, and uploads package.json and bun.lock as the host-bump artifact. open-pr needs check, holds the write permissions, and runs on a clean checkout of the default branch. It downloads the artifact, copies the two files in, and fails unless git status shows only " M package.json" and " M bun.lock" (no other change, no untracked file). Then create-pull-request opens the PR with add-paths limited to those two files. The PR body and draft state read the outcomes from check's outputs.

Rejected: a single job with the write token only on the last step. Any step that runs after the host install still shares the job's token, and the install runs the new host's code. Rejected: letting the PR job reuse the checkout from check. Artifacts only carry what check chose to upload, and the PR job starts clean.

Action pins match the other workflows (full SHA with the version as a comment). upload-artifact v7.0.2 and download-artifact v8.0.2 are the latest releases; neither was used in this repo before.

Checked: actionlint passes on every workflow. The path check's grep accepts the two allowed paths and rejects an untracked file. The workflow has not run on GitHub yet; the first run is the real check of the artifact hand-off.

Fixes #157

**chore(tests): ratchet test-count and coverage floors** ([`f3f3718`](https://github.com/jjjermiah/opencode-plugboard/commit/f3f3718f40d2021088e4f8985f9117cd6823a0f0))

The new tests for #169 to #172 raised the layer counts and the line and function coverage, so the floors move up to the measured values. The floors never go down.

**ci: build the compiled TUI entry before the pack checks** ([`b70da5f`](https://github.com/jjjermiah/opencode-plugboard/commit/b70da5fde13d0a7c848f716f7062e7fb24d05607))

check-pack and smoke-pack run "npm pack --ignore-scripts", which skips prepack, so dist/tui.js (the ./tui export) must be built explicitly first. ci.yml and nightly.yml now run "bun run build:tui" before check-pack. The publish workflow reuses ci.yml's jobs, so a release gets the same step, and npm publish still runs prepack for the real package.

smoke-pack builds the file itself, so the smoke job needs no extra step.

**ci(ci): build the TUI entry in the publish job, and notes for 0.21.0** ([`dca0852`](https://github.com/jjjermiah/opencode-plugboard/commit/dca085206652fb1b9ab63a000f0ff130dd8ba7f8))

publish.yml now installs dependencies and runs build:tui before npm publish, and fails if dist/tui.js is empty. npm publish would run prepack anyway, but the publish job had no node_modules, so the Babel devDependencies prepack needs were missing.

Curated [Unreleased] notes cover the TUI install fix, the structured output and provider error fixes found by the first live run (#169-#173), the staff-review hardening (#152-#157, #159-#168), trusted-app server tools (#82) and the live test layer (#99, #108). Pinned install examples bumped to 0.21.0.

#### Dependencies

**fix(deps): ship @types/escape-html with the package** ([`f1c5292`](https://github.com/jjjermiah/opencode-plugboard/commit/f1c5292dfa7e40488c761fd0972e4aad0106b17c))

src/discovery.ts imports escape-html, and its types were a devDependency. A consumer that typechecks the packed package reads the .ts source and failed with TS7016 (Could not find a declaration file for module 'escape-html'). Moving @types/escape-html to dependencies, pinned to 1.0.4, gives the consumer the types with the package. The types package has no dependencies and no install script (npm view), so the unattended install with ignoreScripts stays safe. A declare module shim was the other option. Rejected: it would hide the real types and go stale when they change.

Checked: packed the tree before and after, installed each tarball with the peers into a throwaway consumer, and ran tsc with skipLibCheck over index.ts. Before: TS7016 at src/discovery.ts. After: exit 0. bun install changed only the dependency list in bun.lock. docs/packaging.md no longer lists this as a known gap.

Fixes #166

**fix(deps): compile the TUI entry so npm installs load it** ([`6c44bed`](https://github.com/jjjermiah/opencode-plugboard/commit/6c44bedd9c8747d602ca7de15fd34458cac7afed))

The /plugboard page never loaded from an npm install of 0.20.0. OpenCode 2.0.26 showed "TUI plugin error ... Cannot find package '@opentui/solid' imported from .../node_modules/opencode-plugboard/src/tui.tsx" (reproduced in an isolated HOME with the packed tarball installed as a local plugin). A checkout worked because it loads outside node_modules.

Two host facts cause it, both in OpenCode 2.0.26 and @opentui/solid 0.5.17:

- The Solid transform skips node_modules. The runtime plugin support registers babel-preset-solid through createSolidTransformPlugin, whose sourceFilter excludes any path containing node_modules. So src/tui.tsx installed from npm is never Solid-compiled. createRuntimePlugin only rewrites literal from "..." specifiers there, and the JSX pragma adds @opentui/solid/jsx-runtime after that rewrite, so it does not resolve.
- Installed peers do not help. Peers installed with the plugin (0.6.1 @opentui/solid) load a different JSX runtime, which calls components eagerly, and the page crashed with "props.report.totals" undefined.

The fix compiles the file once, before publish, with the host's own pipeline: babel-preset-solid (generate "universal", moduleName "@opentui/solid") plus @babel/preset-typescript, the versions OpenCode 2.0.26's @opentui/solid uses (1.9.12, 7.29.7, 7.27.1), pinned exactly. The output keeps literal "solid-js", "@opentui/solid", "@opentui/core" and "@opencode/plugin/tui" imports, which the host rewrites to its own copies. The peers stay optional. dist/tui.js is gitignored and built in prepack and by CI; "npm pack --ignore-scripts" skips prepack, so check-pack and the smoke test also require the file.

The ./tui export points at dist/tui.js. The root tui.ts (local-path plugins resolve <dir>/tui) re-exports dist/tui.js too; tsconfig.tui.json checks only src/tui.tsx, so typecheck does not need a build.

smoke-pack now builds, packs, installs with --ignore-scripts into a clean project, and checks the installed dist/tui.js: it exists, has no JSX runtime calls, imports only host-provided modules, and resolves every relative import. The static check replaces import(): the optional peers are absent in a user's install by design, so a real import would fail there for the reason the host supplies them.

Checked: typecheck, bun test (1825 pass), check-pack, smoke-pack, docs build. Isolated OpenCode 2.0.26 with the fixed tarball installed under node_modules and loaded as a local plugin: /plugboard renders "Plugboard usage", w changes the range to 2026-10-06 to 2026-10-12, r reloads, and the server reports tui, rpc and server features, state active. The same run on the 0.20.0 tree shows the original "Cannot find package" error.

Not on the verdaccio path yet: the local-path install is the same node_modules file loading the npm install path uses, but the npm installer itself was not exercised on this build.

</details>
<!-- commit-detail:end -->

## [0.20.0] - 2026-10-11: Keys, Users, Personas

**Full diff:** [v0.19.0...v0.20.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.19.0...v0.20.0)

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
- **Click through to the session** ([#77](https://github.com/jjjermiah/opencode-plugboard/issues/77)). Set `"historyUrl": "http://opencode.example:4096/session/{id}"` and every answer carries `x-plugboard-session-url`, also logged as `session_url`.
- **Skills as models** ([#79](https://github.com/jjjermiah/opencode-plugboard/issues/79)). Bind an OpenCode skill to a model with an alias, and a client calls it by name without knowing the instructions:

  ```jsonc
  "aliases": { "invoice-parser": "skill:invoice-parser@anthropic/claude-sonnet-4-6" }
  ```
- **Agents as models** ([#6](https://github.com/jjjermiah/opencode-plugboard/issues/6), first part). `"agents": [{ "name": "review", "model": "anthropic/claude-sonnet-4-6" }]` lists `agent/review`, which answers with that OpenCode agent's system prompt. It never runs a tool on the server: OpenCode merges agent rules before the session's deny-all and the last match wins.

### Changed

- Internal runtime version 14. Restart OpenCode after upgrading.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (11 commits)</summary>

#### Features

**feat(config): accept skill aliases and the agents option** ([`36fabe4`](https://github.com/jjjermiah/opencode-plugboard/commit/36fabe4d51ee3ed9a6a033fe7964c925b0f0f965))

An alias target can now be `skill:<id>@provider/model[#variant]`, which binds a skill from the OpenCode server to a model (#79). A new option `agents` takes `{ name, model }` entries for OpenCode agents to expose as `agent/<name>` (#6). Both are checked at load: the model must pass `models`, a skill target takes one model and no fallback list, agent names must be unique and shaped like OpenCode agent names, and unknown fields are refused like everywhere else in the options.

The agent's model comes from its entry, not from the agent's own configuration. Reading the agent's setting would let an agent run a model the operator never put on the allowlist. Taking `agents` as plain names and reading each agent's model at request time was rejected too: listing and the allowlist check would then need a host call on every /v1/models request, and the policy could not be checked at load.

Resolution and listing read both forms in src/models.ts: parseAliasTarget splits a skill target, personaOf says which persona a request name is, and ListedModel carries the skill or agent for the model list. Session behaviour follows in the next commit.

Checked with new unit tests (test/unit/config.test.ts, test/unit/personas.test.ts) and bun run typecheck.

Refs #79
Refs #6

**feat(session): run skill aliases and agents in the session caller** ([`19c1c05`](https://github.com/jjjermiah/opencode-plugboard/commit/19c1c05d0bed52acc026ae2e519afcd24442f719))

A request for a skill alias gets the skill's content as the first system part of its session, before the app's system policy and the caller's own prompt (#79). The skill is read with ctx.skill.list in the app directory after the backend is ready, and the list is reused for 30 seconds per directory. A skill that is not there is a 404 model_not_found that names it, and nothing is created.

A request for agent/<name> runs its session as that OpenCode agent (session.create with `agent`), on the model of its entry, with the agent's system prompt in place of the caller's (#6). Caller messages still replace the history and caller tools still go back unexecuted. Every session still gets REQUEST_PERMISSIONS (deny all, then the seed tools), so the agent's own permission rules come before the session's deny and cannot widen it. Agents never run a server-side tool in this release. A missing agent is a 404 model_not_found. The app's system policy still applies to the agent's prompt.

Response-cache keys do not cover the skill content or the agent prompt, so persona calls bypass the cache (cachedCaller takes a bypass predicate). A hit would otherwise serve an answer from a skill or agent that has since changed.

Rejected: putting the skill in the transcript as a user message, because the context hook is the one place that owns the system parts and the app's system policy must still order them. Rejected: letting an agent prompt replace the app's policy, because an operator's `replace` must keep winning.

Checked with test/session/persona.test.ts (caller, 404s, the hook order, host adapter reads and the agent on create), test/http/personas.test.ts (listing and a chat request over loopback), and the new mutation I8-agent-session-keeps-deny-all, which is killed by two tests. Full catalogue: 19 of 20 killed. The one that is not (I15-unknown-route-before- auth) has an anchor that no longer exists in src/openai/route.ts; it was already stale before this change and is not touched here. Not run against a live OpenCode server: the ctx.skill.list and ctx.agent.list calls and session.create with `agent` are checked against the v2.0.26 types and source only.

Fixes #79
Refs #6

**feat(http): manage app keys at runtime through /v1/admin/keys** ([`22a42cc`](https://github.com/jjjermiah/opencode-plugboard/commit/22a42cca5e0b3652c7cb8eb5d6c66fcd84b1ec46))

Adding or revoking an app key meant editing options.keys and reloading OpenCode. This adds an admin surface, guarded by the existing adminKey: GET /v1/admin/keys lists config and runtime keys without values, POST /v1/admin/keys with { app } creates a random key and returns it once, and DELETE /v1/admin/keys/{keyId} revokes a runtime key. The key id is the first 8 hex chars of the SHA-256 of the key.

Runtime keys are stored in the plugin's host storage (ctx.storage) under keys/<id> as the SHA-256 digest of the key, so the key value is never kept. The records are read lazily from request handling, on the first request that authenticates, and cached on the process runtime, so the cache holds across plugin generations (runtime VERSION 13). Create and revoke write storage before the cache, so a revoked key stops working on the next request. A failed read fails closed for runtime keys and is retried by the next request.

Decisions. Without adminKey the admin paths are 404, and with it any credential other than the admin key is 401, so an app key cannot list or mint keys. A config key cannot be revoked through the API (409), because the config is the source of truth for it. An app that already has a config key is 409 on create, so a second key cannot silently shadow it. A runtime key authenticates its app whenever it is presented, but it does not make a keyless loopback server keyed: the config keys alone decide that. The alternative, keyed-by-any-key, would let deleting the last runtime key open a loopback server that had no config keys, and I rejected it for that reason. Runtime apps get no per-app policy, because an apps entry still needs a config key.

Checked with unit tests for the store (digests only in storage, id derivation, list and revoke, persistence round trip, failed read and retry, failed write returns no key, timing-safe digest comparison on a keyed server) and loopback HTTP tests for every admin answer (404 without adminKey, 401 for app keys, create then chat with the new key, revoke then 401, config key 409, bad app names). Two mutations were added to test/mutations/catalogue.ts for I25, and both are killed. The coverage manifest and the discovery probes list the admin endpoints. Ratchet floors are raised. Typecheck, bun test, check-pack and smoke-pack pass. Not run on a live server: the dev server loads the main checkout, so the live check waits for the merge.

Invariant I25 in docs/architecture.md.

Fixes #55

**feat(http): group history and usage by end user through the user field** ([`f142c97`](https://github.com/jjjermiah/opencode-plugboard/commit/f142c978e4c9f7668e0643e24658d54e10c7a7ec))

A bot that serves many people is one app, so every conversation landed in one pile, and the OpenAI `user` field was ignored. Plugboard now reads the caller's end user: `user` on Chat Completions, Responses and legacy completions, and `metadata.user_id` on Anthropic Messages. Gemini has no such field.

A kept user prefixes the session title as "[alice] ...", is logged as user= on the request line, and gets per-user counts in the usage day records of requests, tokens and cost. GET /v1/usage gains a users object per app and a ?user= filter. The filter narrows only users; totals and models still cover the whole app, so the report shape stays the same apart from that new field. The RPC input schema gained the same user field, and its test now expects it.

Decisions. The value is trimmed and kept only when it is 1 to 64 of A-Z a-z 0-9 . _ @ : -. Anything else is dropped rather than truncated, and the response says so with x-plugboard-user-dropped: 1, so a caller can see that its id did not stick. The value is only ever a label: it is a key in a record and never part of a path, so it cannot pick a directory outside the app folder. A day keeps at most 200 distinct users per app; the rest count under _other. I chose a cap over an unbounded map because the day record is stored as one JSON value, so an open-ended map would grow without limit under a caller that sends a new id on every request. The user is a field on PlugRequest, set by the pure decoders, so every front-end and the session caller see the same sanitized value. The decoders call one helper, so the rule lives in one place (src/user.ts).

Checked with unit tests for the sanitizer table, the dropped rule, the per-user counts, the 200-user cap (201 users give _other) and the user filter, a caller test for the title prefix, and loopback tests for every front-end's user reaching the log line, the dropped header, the usage report and the filter. Two mutations were added for I26 (the cap off by one, and an unsanitized value), and both are killed. Ratchet floors are raised. Typecheck, bun test, check-pack and smoke-pack pass.

Invariant I26 in docs/architecture.md.

Fixes #57

**feat(session): link a request to its OpenCode session page** ([`8aa2d6a`](https://github.com/jjjermiah/opencode-plugboard/commit/8aa2d6a75dc2e84389377e15d42e8f16322a8c4b))

x-plugboard-session gives an id, but nothing an operator can click. The host exposes no UI URL to a plugin, and the right URL depends on how the operator reaches OpenCode, so this adds option historyUrl: a template with {id} and an optional {directory}. When it is set, every response that carries x-plugboard-session also carries x-plugboard-session-url with the filled link, and the request log line gains session_url=.

Decisions. The template is checked when the config loads. It must be an http(s) URL that contains {id}, and the only other placeholder allowed is {directory}, so a typo such as {sesion} fails at load instead of producing links that point nowhere. Both values are URL-encoded when they are filled in, so a session id or a path cannot add a segment or a query to the operator's URL (I27). {directory} is the app's real directory on the OpenCode host. I kept it because a UI link may need it, but it shows that path to every caller that reads the header, so the docs say to leave it out unless it is needed. The caller passes the directory with onRecord as an optional second argument, so the record id contract stays the same for every existing caller. A cache hit writes no session and so has no link. With n above 1 the links are comma separated in choice order, like the session ids.

Checked with unit tests for the template rules (accepted forms, refused forms with their messages) and the encoding of both placeholders, loopback tests for Chat Completions, Responses and Messages (header and log field), the n fan-out ordering, and the absence of both without the option, and a caller test that onRecord receives the app directory. One mutation was added for I27 (the id unencoded), and it is killed. Ratchet floors are raised. Typecheck, bun test, check-pack and smoke-pack pass. Not run on a live server: the dev server loads the main checkout, so the live check waits for the merge.

Fixes #77

#### Tests

**test(tests): raise the floors for the persona tests** ([`5ab7b56`](https://github.com/jjjermiah/opencode-plugboard/commit/5ab7b56768d721e1be7a1a623fe78fe65bc6e631))

The skill and agent tests added 48 tests across the unit, session and http layers, and new session and runtime code moved line coverage to 97.7% and function coverage to 92.2%. Ran `bun .github/scripts/test-gates.ts .coverage --ratchet` after a full coverage run: test-count floors go from session 194 to 209, unit 798 to 830 and http 257 to 261; coverage floors go from 97.5 to 97.7 lines and 91.7 to 92.2 functions. No floor was lowered.

Before the host-adapter tests were added, the new closures in src/session/host.ts left coverage at 97.3% and 91.5%, below the existing floors, so the ratchet was not run until they were covered.

Refs #79
Refs #6

**test(tests): ratchet floors after rebasing onto 0.18** ([`81f7b82`](https://github.com/jjjermiah/opencode-plugboard/commit/81f7b8286a5e8b7fcde965e0a35984aee6224e78))

Rebasing the persona work onto main (budgets, stop sequences, usage on the call context) brought in more tests. The merged floors took the maximum per key, and the ratchet then raised them to the counts of the rebased tree: http 277 to 299, unit 835 to 921, and the other layers unchanged. Coverage rose to 97.9% lines and 92.7% functions, so the floors go from 97.7 and 92.2 to the same values. No floor was lowered.

Checked with bun test --coverage and bun .github/scripts/test-gates.ts .coverage --ratchet on the rebased tree (1727 pass, 0 fail).

Refs #6
Refs #79

**test(tests): point the I15 mutation at the current auth line, and fix VERSION** ([`ea44be6`](https://github.com/jjjermiah/opencode-plugboard/commit/ea44be6ce45f2e29350d7077293cc5c341279c77))

The I15-unknown-route-before-auth mutation searched for an auth line that no longer exists. Since the route read the live options, the Gemini credential check was renamed googleShaped, and runtime app keys added an await runtimeDigests() argument, the find text occurred zero times. So bun run mutations reported this entry as "not killed" and exited 1, which hid whether the guard was still tested at all. The find and replace now match the line as it is on main after the rebase, and the replacement keeps the same unknown-route check before authentication.

The 25 entries all pass now: 25 of 25 killed, exit 0. The guard is still covered by test/http/ingress.test.ts and test/http/observability.test.ts, which fail under the mutation (6 failing lines).

docs/architecture.md said the runtime VERSION was "currently 11". It is 14 after the runtime key store (#55) and the budgets already on main. The number is now 14, as approved, and no other text in that section changed.

The test floors and the coverage floors are raised to the current values (test-count: http 321, unit 929, session 197; lines 97.7, functions 92.5). Nothing was lowered.

Checked with bun run typecheck (exit 0), bun test (1745 pass, 0 fail), bun test --coverage with bun .github/scripts/test-gates.ts (all floors met), bun run coverage-manifest (matches the router), bun run mutations (25 of 25 killed), check-pack (62 files, matched by files) and smoke-pack (smoke ok).

#### Docs

**docs(docs): document skill aliases and agents** ([`9e38f04`](https://github.com/jjjermiah/opencode-plugboard/commit/9e38f04deb3702da631cc611a1c22fb1dd11b238))

docs/configuration.md gets the `skill:` alias target, the `agents` option and a section on both, including the permission model: agents never run a server-side tool in this release, every OpenCode tool stays denied, and caller tools go back to the caller. The option table lists both options, the response cache note says persona answers are never cached, and the architecture page gains a section on how a skill and an agent enter the context hook, which invariants they keep (I8, I9, I10, I11) and why the permissions do not change.

The agents section links #82 for the trusted-tools question, which is where server-side tool execution would be decided.

Refs #79
Refs #6

**docs(docs): spell out the permission model for agents** ([`d8623ae`](https://github.com/jjjermiah/opencode-plugboard/commit/d8623ae38de61bc49f1a55e7c6f3626a9bcdb470))

The agents section of docs/configuration.md now has its own permission model: agents never run a server tool, every OpenCode tool stays denied, caller tools go back to the caller unexecuted, and persistent "always" approvals do not reopen a denied tool. docs/architecture.md now cites the host source for the order the rules are combined in, instead of relying on a comment in src/session/seeds.ts.

The order was checked in anomalyco/opencode at v2.0.26. The session stores the create input's agent and permissions (packages/core/src/session.ts:284-288). Rules are merged agent first, session last (packages/core/src/permission.ts: 158-163, merge at :99-101). evaluate takes the last matching rule (:87-97), so the session's deny * wins over any agent allow. The deny check runs before saved rules are appended (:165-176). No host behaviour changed and no code changed, so there was no bug to fix. A live check on an isolated server is still the real proof of the host behaviour.

Refs #6
Refs #79

**docs(changelog): notes for runtime keys, end users, session links, skills and agents** ([`6d80758`](https://github.com/jjjermiah/opencode-plugboard/commit/6d807585427161cfd2eedb57dc7d65469cb24100))

Curated [Unreleased] entries for #55, #57, #77, #79 and #6 (first part), plus runtime version 14. Checked live on the isolated dev server: an admin key created a runtime key that then answered a chat call, the user field showed up under users in GET /v1/usage, x-plugboard-session and x-plugboard-usage were present, and agent/plan was listed and answered. Pinned install examples bumped to 0.20.0.

</details>
<!-- commit-detail:end -->

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

[Unreleased]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.27.0...HEAD
[0.27.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.26.0...v0.27.0
[0.26.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.25.1...v0.26.0
[0.25.1]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.25.0...v0.25.1
[0.25.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.24.0...v0.25.0
[0.24.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.21.2...v0.22.0
[0.21.2]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.21.1...v0.21.2
[0.21.1]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.21.0...v0.21.1
[0.21.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.19.0...v0.20.0
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
