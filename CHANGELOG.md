# Changelog

Everything notable about `opencode-plugboard` lands here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with one liberty: entries explain why a change was made, not just what changed. If a decision cost something, the cost is written down next to it.

## Versioning

The project follows [Semantic Versioning](https://semver.org/). While the major version is 0:

- A minor bump (0.1 to 0.2) may break things: an option renamed, a default changed, an error code moved.
- A patch bump (0.1.0 to 0.1.1) is for fixes only.
- The peer range on OpenCode is part of the contract. Plugboard talks to an unstable host API, so a change to the supported OpenCode range is at least a minor bump.

Work is tracked in [GitHub issues](https://github.com/jjjermiah/opencode-plugboard/issues). The [v0.1 milestone](https://github.com/jjjermiah/opencode-plugboard/milestone/1) is what had to be true before the first release. The [later milestone](https://github.com/jjjermiah/opencode-plugboard/milestone/2) holds everything that was deliberately left out.

## [Unreleased]

Nothing yet.

## [0.49.0] - 2026-10-17: No Phantom Calls

**Full diff:** [v0.48.0...v0.49.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.48.0...v0.49.0)

### Fixed

- A tool call reaches the client only when its name is one the request declared. The host can report a call to a name the request never offered, such as garbled text. Plugboard used to pass that on as a `tool_calls` answer, even when the request had no `tools` at all. Now the call is dropped and logged as `tool_call.undeclared` (warn, with the app, the request id and the name cut to 64 characters). An answer left with neither text nor a valid call fails as a failed model run (`model_run_failed`), and an answer with text finishes as `stop`. `tool_calls` is reported only when a valid call is returned. Server tools are unchanged, and every route is covered because the check sits in the session collector. Since 0.49.0 ([#463](https://github.com/jjjermiah/opencode-plugboard/issues/463)).

### Docs

- The README is a short front door: what plugboard is, install, one request, what it serves, and links. Everything it used to hold moved to the docs site, which now reads in order: get started (landing page, install, connect your app), six task guides (apps and keys; models, aliases and fallbacks; limits, budgets and caching; tools, structured output and images; history, usage and monitoring; serving other machines), the clients grouped by kind, the reference, and the project pages. New pages: Chat Completions, APIs and known gaps, response headers (every `x-plugboard-*` header), security, and a clients overview. The configuration reference opens with a map of its sections by task. Stale statements were fixed along the way: the Anthropic model list works with `x-api-key` since 0.47.0, `tools` with `json_schema` lets the model choose, usage is written on every change, and the CI host matrix. Old page paths still work.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (10 commits)</summary>

#### Fixes

**fix(session): drop tool calls whose name the request did not declare** ([`f2612c6`](https://github.com/jjjermiah/opencode-plugboard/commit/f2612c6a36ff4b21ca53560d323062ae304461bc))

The host can report a tool call to a name the request never offered, such as garbled model text. The session collector passed every such call on as a tool-call event, so a request with no `tools` could get a `tool_calls` answer naming nothing it had declared (#463, seen once in about 20 live requests to `fast`).

What changed: RequestCollector takes the request's caller tools (after the app's tool policy) and drops any call whose name is not one of them. A drop is logged once as `tool_call.undeclared` at warn, with the app, the request id and the name cut to 64 characters, and no other field of the call. When a step or run ends with no valid call and no text after a drop, the request fails with model_run_failed (the existing class for a failed model run). A step that ends tool-calls with no valid call finishes as stop, and the host is stopped before another step. Server tools keep their handling.

Why here: the collector is the one place every route reads host events through, so Chat Completions, legacy completions, Responses, Messages and Gemini are all covered without touching the encoders.

Rejected: checking names in each route encoder (five copies, easy to miss a route); fixing the upstream model (plugboard never sees the raw upstream body, so it cannot confirm the cause).

Validation: bun run validate --mutations passed all 7 steps. New tests fail without the guard (mutation P463-undeclared-call-forwarded, which forwards undeclared calls) and pass with it: test/http/undeclared-tool-calls (non-streamed and streamed, no tools, a different name, mixed text and a garbled call) and test/session/collector.test.ts (#463 block). Existing collector and caller tests now declare the names they emit.

Closes #463

#### Tests

**test(tests): ratchet test count floors for #463** ([`757786e`](https://github.com/jjjermiah/opencode-plugboard/commit/757786e47af14b720af41aa24572b8ff8613a6b1))

`bun run validate` ratcheted the per-layer test-count floors after the new #463 tests were added (test/http and test/session). Committed with the change so CI's floor check passes. No floor was lowered.

Refs #463

#### Docs

**docs(docs): cut the README to a short front door** ([`8df8cad`](https://github.com/jjjermiah/opencode-plugboard/commit/8df8cad3132b434e284face81b01db0897c5b4c8))

The README was 654 lines: quick start, a feature manual, a client table, known gaps, security and a full example. It is also the npm page and the site's landing page, so a new reader met everything at once.

What stays: what plugboard is, the install entry pinned to 0.48.0 (it said 0.42.0), one curl request, the endpoint table, six one-line highlights that link to the guides, and the project links. Everything else moves to the site in the next commits. Each removed section gets a page, listed in the pull request.

Links to the docs site are absolute, because the npm package ships only the README.

**docs(docs): add a landing page, an install page and a connect page** ([`ca35be6`](https://github.com/jjjermiah/opencode-plugboard/commit/ca35be601889c278f80d87cf0c58b586feb16ce3))

The site's front page was the README pasted in with an include. With the README now short, the site needs its own start: what plugboard is, how to install it and call it once, and how to connect an app.

- docs/index.md is a real landing page: hero, six feature cards that link to the guides, how it works, the API table and a reading order.
- docs/install.md is the install walkthrough from the old README quick start, pinned to 0.48.0, with a table of what a failed first call means.
- docs/connect.md says which base URL and key header each API takes, and sends readers to a client page by API or by client.
- config.ts gets a "Get started" sidebar group and a nav entry. Page files keep their paths, so no old link breaks.

The pages these link to (guides, chat completions, apis) come in the next commits.

**docs(docs): add six task guides** ([`fd669e0`](https://github.com/jjjermiah/opencode-plugboard/commit/fd669e07e10f61c5ebfbd451ff71564c45db890e))

Each guide starts with the problem, shows the smallest config that solves it, explains what happens and links to the configuration reference: apps and keys, models and aliases, limits and caching, tools and output, history and monitoring, serving other machines. Built from the old README feature sections. The reference anchors they link to are reorganised in a later commit, and the sidebar entries are not added yet (work halted before that).

**docs(docs): add the reference pages and tell the sidebar as a story** ([`3c4adbe`](https://github.com/jjjermiah/opencode-plugboard/commit/3c4adbedc11be5041f2ab90cb057af337893fc67))

The site had one flat Reference list, one Clients list of about sixty pages, and API pages scattered between them. A new user saw everything at once.

The sidebar now runs in reading order: Get started, Guides, Clients, Reference, Project. Clients are grouped (SDKs, agent frameworks, chat apps and automation, coding tools, evaluation and observability, self-hosted apps) and every group after Get started and Guides starts collapsed. The nav bar follows the same five parts.

New pages fill the links the earlier commits made:

- chat-completions.md: the Chat Completions fields, streaming, tools and structured output, checked against src/openai/request.ts (developer role, four stop sequences, 15 s keep-alive, logprobs refused).
- apis.md: every API and endpoint, how a request runs, and the known gaps from the old README, with resolved gaps removed (#34, #147 and the stop-sequence one are fixed).
- headers.md: every x-plugboard-* response header, when it is set and its value, read from the source.
- security.md: what plugboard guarantees, what the operator must do, and where to report.
- clients/index.md: the grouped clients overview.

The configuration reference keeps its sections and anchors, so no existing link breaks. It opens with a map of its sections by task, in guide order; the guides' "related options" links land on that map. Moving the sections themselves was rejected: hundreds of long lines to move by hand for the same navigation.

Validation: bun run validate --skip examples,pack passes (typecheck, tests, manifest, docs build). A one-off check of the built site found no link to a missing #anchor apart from five false positives on the clients overview (the anchors exist).

**docs(docs): fix statements that went stale** ([`602ea32`](https://github.com/jjjermiah/opencode-plugboard/commit/602ea324561f4a799c33df572104f2c383917894))

A pass over the docs against the current code and the CHANGELOG.

- Anthropic client pages said GET /v1/models refuses x-api-key and S7 is a gap. Fixed in 0.47.0 (#399); the anthropic-python and anthropic-js live runs on a0efa4b pass S7. The pages now say so and link the new records.
- messages.md said Claude Code and the Python SDK were never run; both run in the examples now.
- configuration.md and the tools guide said tools with json_schema returns only the caller's tool calls, or is "changing" (#34). The model may call a caller tool or give the schema answer; tool_choice none leaves only the schema, and a named tool_choice is a 400.
- configuration.md said the x-plugboard-* headers are not exposed to browsers, contradicting the line above it (exposed since 0.27.0).
- The history guide said usage reaches storage every ten seconds; it is written on every change since 0.21.2 (#241).
- development.md named host 2.0.27 and a two-host CI matrix; the pin is 2.0.30 and CI picks the oldest, a middle and the newest host.
- any-app.md pinned 0.26.0 and pointed at a README section that moved.
- The apps option row listed only some per-app fields.
- CHANGELOG: one Docs entry for the restructure.

Validation: docs build passes; the same anchor check finds nothing new.

**docs(examples): record live reruns on main ece50cd, refresh index** ([`3978aa5`](https://github.com/jjjermiah/opencode-plugboard/commit/3978aa540285228171cb5c09aed0d1b46ed3cf42))

Live reruns on main ece50cd (plugboard 0.48.0, served by the dev server after serve-ref.sh main; it was on 0.47.0 before) for the curl, openai-python, openai-js, n8n, pydantic-ai-anthropic and tool-bot examples. curl, n8n, pydantic-ai-anthropic and tool-bot pass now. The older records were stale: the curl S1 fail was intermittent and 12 later plain calls to fast passed, n8n's Responses checks were already unobserved (#343, closed), and pydantic-ai-anthropic's S7 gap was the x-api-key bug fixed in #399.

openai-python and openai-js stay partial. Their only gap is S2 previous_response_id, refused because plugboard is stateless (#104, open). That is a deliberate plugboard limit, not a client one, so the verdict is left as partial.

Filed #463: a tool call the request did not declare is forwarded to the client. The raw upstream body is in the curl 2026-10-12 record; it is not yet known whether plugboard or the upstream model garbled it.

Golden fixtures: examples/curl/runs/scripted (summary and transcripts) is CI-gated by `run.ts all --target scripted` plus git diff, so it already serves as the curl golden set. No new fixtures added.

Validation: examples-index.ts --check passes. The full `bun run validate --skip pack` was started and stopped by a pause before it finished, so it has not passed on this commit.

Refs #7

#### CI and tooling

**ci: approve the runs GitHub holds on host-bump pull requests** ([`82117f8`](https://github.com/jjjermiah/opencode-plugboard/commit/82117f8e0f7594d50b1618f147b6890956fddbfb))

A pull request that GITHUB_TOKEN opens gets its pull_request runs in action_required. The repo's approval policy (first_time_contributors) treats the github-actions bot as a first-time contributor, so the required checks (CI passed, Lint commit messages, Analyze) stay pending until someone approves the runs. #438 hit this: the workflow-dispatched runs on the same SHA passed, the pull_request runs waited, and a person had to approve them before auto-merge fired.

What changed
- host-bump.yml open-pr: a new step, before the auto-merge step, reads the pull request head SHA, lists the action_required pull_request runs on it (up to six tries, ten seconds apart), and approves each one with POST /repos/{repo}/actions/runs/{id}/approve. A list or approve failure warns and the job continues, so auto-merge and the breakage issue still run. The job already had actions: write.
- The existing gh workflow run dispatch of ci.yml, commits.yml and codeql.yml stays as it was.
- The comments in ci.yml, commits.yml and codeql.yml now say the runs are held for approval, not that a token-opened PR starts no workflow.
- docs/releasing.md: the host bump section says the runs are approved, and no longer that the required checks come from the dispatched runs.

Why this option GitHub's GITHUB_TOKEN docs say a pull_request run from a workflow-created PR waits for approval, and recommend a GitHub App token or a PAT to avoid that. Both need a secret the repo does not have, and the issue asks for a workflow-only change. Approving the runs keeps GITHUB_TOKEN.

Probe (throwaway branch, deleted after): a push-triggered workflow with actions: write called the approve endpoint on a completed run. It got 403 with the body "This workflow run is not waiting for approval", not a permission error, so the token passed the actions: write check. That is evidence, not proof: the first real bump PR is the test.

Rejected
- Changing the repo approval policy: a repo setting, out of scope here. Left as an option in the report.
- A GitHub App or PAT for the PR: needs a new secret. Not done here.
- Dispatching the real bump to test: host-versions reports 2.0.32 against a pin of 2.0.30, so it would open a real PR and enable auto-merge.

Validation
- bun run validate --skip examples: typecheck, test, manifest, pack and docs all pass.
- actionlint .github/workflows/*.yml: clean.
- The approve step, run with a fake gh: approves every run listed; no runs gives a notice; a list failure and an approve failure each warn and exit 0.

Not verified: the approve call succeeding on a real bot PR (only the 403 state check above), and whether auto-merge then lands unattended.

Refs #397

#### Dependencies

**build(deps): support opencode 2.0.32** ([`3122712`](https://github.com/jjjermiah/opencode-plugboard/commit/3122712d80d77c71f48d2b4fb64c6ed489f93ed3))

OpenCode published @opencode/plugin 2.0.32. The bump pins it, pins the effect version it uses, and widens the peer ranges only where needed. Opened and checked by .github/workflows/host-bump.yml.

</details>
<!-- commit-detail:end -->

## [0.48.0] - 2026-10-16: Turning the Pages

**Full diff:** [v0.47.0...v0.48.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.47.0...v0.48.0)

### Fixed

- `GET /v1/models` with `anthropic-version` pages like Anthropic's list. It honours `limit` (default 20, from 1 to 1000), `after_id` and `before_id`, and `has_more` says whether the page's direction has models left. Before, `?limit=2` returned all 388 models on a real deployment, so the SDKs' `models.list()` got one page and no paging. The cost: a caller that reads only the first page now gets 20 models, not the whole catalog. Iterate the list (the SDKs do this for you) to get all of them. An unknown cursor, both cursors, or a limit outside 1 to 1000 is a 400. The OpenAI list is not paged. Since 0.48.0 ([#457](https://github.com/jjjermiah/opencode-plugboard/issues/457)).
- The `count_tokens` estimate for Claude 5.x counts long prose closer to what the provider bills. A dense prose turn without tools counted 24 percent low on `claude-sonnet-5-5` (0.76 of real). The Claude 5.x rate for prose drops from 3.38 to 3.1 characters per token. Short turns and tool requests move little. Chat Completions and Responses have no count endpoint, by design. Since 0.48.0 ([#412](https://github.com/jjjermiah/opencode-plugboard/issues/412)).

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (3 commits)</summary>

#### Fixes

**fix(anthropic): page GET /v1/models with limit, after_id and before_id** ([`c351026`](https://github.com/jjjermiah/opencode-plugboard/commit/c3510264452fa875056019d9a8fad00cedea135a))

Since 0.47.0 GET /v1/models with anthropic-version answered Anthropic's list shape but ignored every paging parameter. ?limit=2 returned all 388 models on a real deployment with has_more false. The Anthropic SDKs auto-paginate models.list() through after_id, so they only ever saw the full catalog by accident.

What changed: the Anthropic list now honours limit (default 20, whole numbers from 1 to 1000, as Anthropic documents), after_id (the page after that model) and before_id (the page before it). has_more reports whether the page's direction has models left, and first_id and last_id are the cursors for the next page in each direction. The list keeps catalog order, because the cursors only need to be stable within one catalog.

Decisions: an invalid limit, both cursors together, or a cursor that is not a listed model is a 400 invalid_request. Anthropic's reference does not say what it returns for those, so these are our choices. The OpenAI list is not paged: it has no paging parameters and its clients never send anthropic-version.

Cost, stated in the changelog: a caller that reads only the first page now gets 20 models, not the whole catalog. The SDK iterators walk every page. The examples anthropic-python, anthropic-js and pydantic-ai-anthropic used to read page one only, so they now iterate the list. Their scripted catalogs have three models, so their transcripts did not change. The paging over the real catalog is checked live on the dev server, see the pull request.

Rejected: returning the whole catalog on one page with a large default. It hides the cursor contract from the SDKs and makes limit meaningless.

Validation: test/http/models-anthropic.test.ts gains nine #457 cases over a 45-model catalog (default page, a full walk with after_id, before_id in reverse, limit 1000, out-of-range limits, bad cursors, OpenAI unpaged). They failed before this change (4 failing on the old route) and pass after it. bun test test/http/models-anthropic.test.ts: 12 pass, 0 fail.

Closes #457

**fix(anthropic): count dense Claude 5.x prose closer to the provider's input** ([`4ba7176`](https://github.com/jjjermiah/opencode-plugboard/commit/4ba717623dddad826b76ca748ba7ebc2254439c0))

The count_tokens estimate for claude-sonnet-5-5 ran 24 percent low on long prose with no tools (585 counted, 770 real on the hub, 0.76). The 5.x profile charged 3.38 characters per token for Latin text, fitted to the 2072-character turn of the earlier refit (c762c0a / 2d73407). The hub's prose tokenizes denser than that turn, so the rate was too high for it.

What changed: CLAUDE_5.charsPerToken goes from 3.38 to 3.1. Nothing else in the profile moves: the fixed request cost (35), the message cost, the tool framing (299) and the per-tool cost (40) stay as fitted, so short turns and tool requests barely change.

Why 3.1: the window is set by two measurements. The hub's long no-tool row (about 1846 characters, 770 real) needs a rate at or below 3.2 to count at 80 percent or more of real. A prose sample of about 1770 characters that measured 525 real on the dev server (1.07 at 3.38) stays within 20 percent only at or above about 2.94. 3.1 sits in that window: offline, the hub row counts about 0.82 and the prose sample about 1.16 (both within 20 percent), the hub long-with-tool row about 0.88, and the two-tool and three-turn shapes about 1.05 and 1.07.

Rejected: a single factor on every 5.x count. It would move the tool cases, which the hub table already has within 20 percent. Rejected: a per-model table, the same reason as in 0.47.0.

Not reproduced: my own long prose on the dev server (live, before this change) reads 1.00 under 3.38, not 0.76. The hub text was not available, so the 0.76 row is taken from the issue, and the 3.1 rate is fitted to that number. The live confirmation runs on my shapes, not the hub's, so this commit is a Refs, not a Closes, for #412.

Checked: test/unit/tokens.test.ts (the #412 case now expects 3.1; it fails against 3.38), the whole token file passes (20 tests). The live shape measurements, before and after, are in the pull request body.

Refs #412

#### Tests

**test(examples): check the error type on both the OpenAI and Messages wires** ([`d864871`](https://github.com/jjjermiah/opencode-plugboard/commit/d86487163ba4e3a475095e11b4cf2b12e6b6f589))

The shared E1 and E2 scenarios checked the error code only. The Messages wire has error.type and no error.code, so the Anthropic examples had to mark the code checks unobserved, and a Gemini error has neither: only a status name. The error type is the one identity all of them share, because OpenAI and Messages use the same two strings (authentication_error and not_found_error, src/openai/response.ts and src/anthropic/response.ts).

What changed: examples/_shared/scenarios.json adds an "error type" check to E1 (authentication_error) and E2 (not_found_error), reading the observation "type". Every E1/E2 runner reports that observation: the OpenAI and Messages runners read error.type from the body or the SDK error, and the Gemini runners map Google's status (UNAUTHENTICATED, NOT_FOUND) to the same two values through a per-wire table. The Anthropic code checks stay unobserved, because a Messages error has no code; the type check now carries the identity they used to miss. The harness README names the type check. All scripted runs were regenerated; the four shapes checked twice produce identical bytes. examples/README.md index and the region check are current.

Decision: no new check kind in the three evaluators. The evaluators already apply "equals" to any observed path, so a shared check on "type" needs no new code and no schema change. The per-wire map lives in each runner, where the wire format is known. Rejected: a neutral check kind that reads "type" or "status" itself, because it moves the wire knowledge into the evaluator for no gain. This does not match the issue's literal wording, so it stays a Refs.

Validation: bun test for the examples harness, normaliser and index tests (46 pass, 0 fail). scripted regen: 18 summaries changed (E1/E2 rows and their check lists), all required scenarios pass. openai-python and openai-js were already partial at HEAD on an optional gap, unchanged. sillytavern and zed have no runnable scripted runner at HEAD and are not touched.

Refs #427

</details>
<!-- commit-detail:end -->

## [0.47.0] - 2026-10-16: Speaks Anthropic Fluently

**Full diff:** [v0.46.0...v0.47.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.46.0...v0.47.0)

### Fixed

- `GET /v1/models` and `GET /v1/models/{id}` accept `x-api-key`, as `POST /v1/messages` does, so `client.models.list()` in the Anthropic SDKs works. A request with `anthropic-version` gets Anthropic's list shape (`data`, `has_more`, `first_id`, `last_id`, each model with `type`, `id`, `display_name`, `created_at`); other requests keep the OpenAI shape. Since 0.47.0 ([#399](https://github.com/jjjermiah/opencode-plugboard/issues/399)).
- Chat Completions, Responses and Gemini now send `x-plugboard-thinking: unavailable` too, when a requested reasoning effort cannot apply because the model has no thinking variant. Until now only Messages said so. `none` never sets it. Since 0.47.0.
- A redacted reasoning block the provider returns is now sent back on the Messages route as one `redacted_thinking` block with its opaque data, in both the JSON and the stream. Before, the host's redacted reasoning was dropped, so a client never got a block it could replay. Like thinking, it is left out unless the request asked for thinking. Since 0.47.0 ([#385](https://github.com/jjjermiah/opencode-plugboard/issues/385)).
- The `count_tokens` estimate has its own profile for Claude 5.x models (for example `claude-sonnet-5-5`). The shared Claude profile was 0.51 to 1.42 of the real input count on Sonnet 5.5; Claude 4.x keeps its numbers. Since 0.47.0 ([#412](https://github.com/jjjermiah/opencode-plugboard/issues/412)).

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (12 commits)</summary>

#### Features

**feat(openai): send x-plugboard-thinking on Chat, Responses and Gemini when effort cannot apply** ([`b206c59`](https://github.com/jjjermiah/opencode-plugboard/commit/b206c59797d63810f6d941b9be2bdd5a4b36f212))

Until now only the Messages route answered x-plugboard-thinking: unavailable (#410). A request on Chat Completions, Responses or Gemini thinkingConfig that asked for an effort on a model with no thinking variant ran without thinking and said nothing. Those three routes now set the same header, so every front-end with a reasoning effort answers the same way.

The check lives in models.ts as effortUnavailable. It is true when an effort was requested, the effort is not none, and thinkingUnavailable says the resolved model has no thinking variant. none asks for no thinking, so it never sets the header. Each route calls it once the model resolves and before any response bytes, so the header is on the first byte.

Rejected: putting the header on the shared contract. The contract carries no presentation, and the header is a front-end matter (I20). The Messages route keeps its own check, which uses exchange.thinking, so its behaviour is unchanged.

Checked with test/http/thinking-header.test.ts: nine cases, three front-ends by three situations (no thinking variant, a variant it can run, no effort or none). The header cases fail before this change. test/http/messages.test.ts and models-anthropic.test.ts still pass.

Refs #410

**feat(anthropic): return redacted_thinking blocks on Messages when the host reports them** ([`9155d84`](https://github.com/jjjermiah/opencode-plugboard/commit/9155d84a6c3b033fa2e7a141ce955ad8249e6af2))

The host (OpenCode 2.0.30) keeps a redacted reasoning block as its start state, with redactedData in place of a signature. session.reasoning.ended carries that state merged with the end state (publish-llm-event.ts), so the plugin can read it there. Before this change events.ts only read signatures, so a redacted block never reached the Messages encoder, and a client never got a block to send back on the next turn.

The contract's reasoning-delta gains an optional redactedData. events.ts emits it as an empty-text reasoning-delta at the block's end, next to the signature. The Messages encoder turns it into one redacted_thinking block with its data and no deltas, the way the API sends it, in the JSON body and in the stream. Like thinking, it is left out unless the request asked for thinking. The cache stores it as its own event, so a replay keeps it and does not merge it with text.

Rejected: reading redactedData from session.reasoning.started. The ended event already carries the merged state, and the started event is not subscribed to. Rejected: a separate event type. A redacted block is a reasoning part, like a signature, so one more optional field on reasoning-delta is enough.

Checked with test/unit/anthropic-response.test.ts (two cases, the stream and the JSON body), test/session/collector.test.ts (the host state maps to the event) and test/unit/cache.test.ts, test/http/messages.test.ts, test/unit/stop-sequences.test.ts, which still pass (229 tests). The live round trip with the redaction trigger string is checked separately; see the PR.

Refs #385

#### Fixes

**fix(openai): accept x-api-key on GET /v1/models and answer Anthropic's list shape** ([`577c5af`](https://github.com/jjjermiah/opencode-plugboard/commit/577c5afb8693aa2848044e0b8ab7a7c9491caeb2))

GET /v1/models and GET /v1/models/{id} now authenticate through the same rule as POST /v1/messages: Bearer first, then x-api-key. A request that carries anthropic-version gets Anthropic's list shape, with data, has_more (always false), first_id, last_id, and each model as type "model", id, display_name and created_at. Without that header the OpenAI shape is unchanged.

The Anthropic SDKs send x-api-key on models.list() and got a 401 from the OpenAI-routed list, so client.models.list() failed on plugboard. The S7 gap in examples/anthropic-python and examples/anthropic-js is now a pass.

The shape follows the header, not the path, because the same path serves OpenAI clients too. Errors on these paths keep the OpenAI body: the status and type match Anthropic's, and the body shape is a follow-up. The catalog is one page, so limit is accepted and ignored. A separate /v1/models route for Anthropic clients was rejected: a second route table to keep in step, and the SDKs call the same path.

Checked with test/http/models-anthropic.test.ts (5 tests; x-api-key got 401 before the change). The scripted runs of anthropic-python and anthropic-js were regenerated, and S7 passes in both.

Refs #399

**fix(anthropic): give Claude 5.x its own count_tokens profile** ([`c762c0a`](https://github.com/jjjermiah/opencode-plugboard/commit/c762c0a292446cbe438f65756800dd9bef65aa55))

The count_tokens estimate used one Claude profile for every Claude id. The issue's measurements (0.46.0, one request per cell, against real usage.input_tokens) showed that Haiku 4.5 is within target and Claude Sonnet 5.5 is not: its ratios ran from 0.51 to 1.42, with the short no-tool case low and the short tool case high. The gap is in the family, not the request: Claude 5.x packs Latin text into about 2.5 characters per token, not 5, its fixed request cost is larger, and its tool framing is smaller.

The estimator now picks a profile by the model id. A Gemini id keeps the Gemini profile, a Claude 5.x id (claude-<family>-5-...) gets CLAUDE_5, and every other id keeps the Claude profile it had, so Haiku 4.5 is unchanged. CLAUDE_5 is fitted to the claude-sonnet-5-5 rows of the issue: the short and long no-tool requests, and the short and long tool requests. Its numbers are in tokens.ts, next to the profile they replace.

Rejected: a per-model table. Two model ids cannot show a family's tokenizer, and a table would grow with every release. Rejected: one scale factor. The fit needs the characters per token and the tool framing to move on their own, and a single factor misses the tool case.

Checked with test/unit/tokens.test.ts (a new #412 case: the request cost and the characters per token follow the family). The live ratios for claude-sonnet-5-5 and claude-haiku-5-5 are in the PR body, measured against real input tokens on the dev server.

Refs #412

**fix(anthropic): refit the Claude 5.x count profile on live usage** ([`2d73407`](https://github.com/jjjermiah/opencode-plugboard/commit/2d73407f9f1f54af257deb7daf0ec020527a7460))

The first Claude 5.x profile (c762c0a) was fitted to the issue's Sonnet 5.5 rows. Measured live on the dev server at a0efa4b, the same estimate ran 23 to 32 percent high on both claude-sonnet-5-5 and claude-haiku-5-5. The live rows, one request per cell, count from count_tokens and real from usage.input_tokens plus the cache tokens:

    model              shape  tool     count   real   ratio claude-sonnet-5-5  short  no tool    59     46    1.28 claude-sonnet-5-5  short  tool      517    421    1.23 claude-sonnet-5-5  long   no tool   862    652    1.32 claude-sonnet-5-5  long   tool     1320   1027    1.29 claude-haiku-5-5   (same four rows, the same counts and real tokens)

The long turn is 2072 characters. Its real tokens were all in cache_creation (648 of 652), which is why input_tokens alone reads 4. The two models agree row by row, so one profile covers the family.

The refit solves the four rows. The text rate is (2072 - 24) / (652 - 46), about 3.38 characters per token. The fixed request cost is 46 - 4 - 24 / 3.38, about 35. One tool adds 375 real tokens, of which the tool's own text (123 characters, about 36 tokens) is counted separately, so the framing is about 299 with perTool at 40. Offline, the new profile gives 47, 422, 653 and 1028 for the four rows, within 2 percent of real.

This is an in-sample fit: the same rows set the constants. The live counts were taken before the refit, so the post-refit ratios are predicted, not measured. Claude 4.x and Gemini are unchanged.

Rejected: keeping the issue's Sonnet fit. It was off by a quarter on this content.

Refs #412

#### Tests

**test(examples): drop the #399 S7 gap in pydantic-ai-anthropic and ratchet test floors** ([`f15c8c4`](https://github.com/jjjermiah/opencode-plugboard/commit/f15c8c463ce4d9fb08fb867db80bf08af0b55b9f))

With the fix from #399, GET /v1/models accepts x-api-key, so pydantic-ai-anthropic's S7 passes without its gap entry. The gap is removed from run.py, the regenerated scripted run is committed, and the comments that said the route refuses x-api-key are reworded in the Anthropic runners that send Bearer. The live records under runs/live are dated records and stay as they were.

The new tests from #399 and #410 raise the http and unit floors by the same count, so the ratchet is committed with them (.github/floors/test-count-floors.json).

Refs #399

**test(examples): record live S7 runs of anthropic-python and anthropic-js on a0efa4b** ([`bdca4af`](https://github.com/jjjermiah/opencode-plugboard/commit/bdca4af85afdaa17adf1fc5589bc6d5e5ae8c8a1))

Live target runs of the two Anthropic SDK examples on the dev server at a0efa4b (the #399 fix). S7 passes in both: models.list() with x-api-key, the list in Anthropic's shape.
Refs #399

**test(tests): repoint the I15 mutation anchor at the models auth line** ([`85b4f64`](https://github.com/jjjermiah/opencode-plugboard/commit/85b4f6495a49bbe3d599e6cd6685fc3994bc5748))

Since the change for issue 399 replaced the generic auth line in src/openai/route.ts with a ternary, the I15-unknown-route-before-auth anchor no longer matched. The mutation now targets the new const auth line and places the same guard before it. The mutation still kills, and the full validate with mutations passes.

Refs #399

#### Docs

**docs(changelog): note the Claude 5.x count profile and ratchet the unit floor** ([`a0efa4b`](https://github.com/jjjermiah/opencode-plugboard/commit/a0efa4b38ba66cc11c6b42c413b86bd0d1972da0))

The Claude 5.x count_tokens profile (#412) gets its CHANGELOG entry under Unreleased, with the measured range it replaces. The new #412 unit case raises the unit floor by one, so the ratchet is committed with it (.github/floors/test-count-floors.json).

Refs #412

**docs(examples): regenerate the examples index after the S7 gap flips** ([`ee7ec05`](https://github.com/jjjermiah/opencode-plugboard/commit/ee7ec0570847b6f33f0b330389130f0acf6b2426))

The scripted and newest live columns of examples/README.md come from the run records. The S7 gaps closed for #399 changed three rows: anthropic-js and anthropic-python now pass on their new live records, and pydantic-ai-anthropic passes scripted. The index is regenerated by examples-index.ts, so the examples CI check passes again.

Refs #399

#### CI and tooling

**ci(ci): make pr-wait wait for every required check** ([`e677e2d`](https://github.com/jjjermiah/opencode-plugboard/commit/e677e2d27c5d349e409e52cad7d984fdc8115243))

`bun run pr-wait 454 --merge` reported green with one check, right after a push: only CodeQL had registered on the new head, it had finished, and every listed check being done was the stop condition. The merge was then refused by the ruleset, and the real CI run later failed.

pr-wait now reads the checks the main ruleset requires (`GET /repos/{repo}/rules/branches/main`, `required_status_checks`) and waits until each of them is present on the head and every listed check has finished. A timeout lists the missing and pending names.

Validation: run against #454 at the same head, it waited for the full set and reported `red: 2 of 12 checks did not pass` (CI passed, Examples), the real outcome.

#### Dependencies

**build(deps): support opencode 2.0.30** ([`058a1f2`](https://github.com/jjjermiah/opencode-plugboard/commit/058a1f2e73e300fd8b9cdc3e542808aea3f708f4))

OpenCode published @opencode/plugin 2.0.30. The bump pins it, pins the effect version it uses, and widens the peer ranges only where needed. Opened and checked by .github/workflows/host-bump.yml.

</details>
<!-- commit-detail:end -->

## [0.46.0] - 2026-10-16: Honest Counts

**Full diff:** [v0.45.0...v0.46.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.45.0...v0.46.0)

### Fixed

- A thinking request on a model that lists no variant for its budget ran without thinking and said nothing. Claude Haiku 4.5 lists only `high` and `max`, so a `budget_tokens` of 1500 (effort `low`) was silently ignored. Now a requested effort runs on the nearest variant at or above it, else the model's highest one, on Messages, Responses, Chat Completions and Gemini `thinkingConfig` alike. A model with no thinking variant at all still runs without thinking, and the Messages answer says so with the new `x-plugboard-thinking: unavailable` header (since 0.46.0). [#410](https://github.com/jjjermiah/opencode-plugboard/issues/410)
- `count_tokens` and Gemini `countTokens` were off by up to 9 times with tools and 13 times with images, and undercounted CJK text by about four times. The estimate is now calibrated against live provider counts for Claude Haiku 4.5 and Gemini 3.x: tool-use framing and a per-tool cost, a fixed cost per request and message, one token per CJK character on Claude, and Anthropic's `width * height / 750` for each image from its header (a flat cost on Gemini). Chat Completions and Responses still have no count endpoint. [#412](https://github.com/jjjermiah/opencode-plugboard/issues/412)

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (3 commits)</summary>

#### Fixes

**fix(anthropic): calibrate the count_tokens estimate against live provider counts** ([`e899f29`](https://github.com/jjjermiah/opencode-plugboard/commit/e899f293c8b7018d763ffab26ea5e704e7da939e))

What changed: count_tokens (Anthropic) and countTokens (Gemini) now estimate from counts measured against the providers, not from characters / 4 plus a flat 1600 per image.

The Claude profile (any model id without "gemini") counts about five characters per token, one token per CJK character, 21 tokens per request, 4 per message, 35 per tool_use or tool_result block, and once tools are declared a 534-token tool-use preamble plus 40 per tool. An image costs Anthropic's width * height / 750 after its downscaling, read from the PNG, GIF, WebP or JPEG header; an unreadable one costs 1600.

The Gemini profile (a model id containing "gemini") counts about five characters per token, 0.67 per CJK character, and a flat 1090 per image.

Why: the red-team issue measured a count of 75 against 668 real tokens with two tools, and 1602 against 122 for a small PNG. Measured on claude-haiku-4-5 through the dev server, the old estimate was 5 against 29 for one line, 100 against 705 with two tools, 154 against 1033 for a tool transcript, 90 against 404 for CJK text, and 1604 against 35 to 1552 for images from 32 to 1568 pixels a side. The profile was fitted to those numbers; its live check is in the PR body.

Decisions: an estimate, not the provider's count endpoint, because the host exposes none. The profile is picked by the model id, since the two providers charge images and CJK text differently. Chat Completions and Responses still have no count endpoint.

Rejected: raising the one constant. A single chars-per-token figure cannot fit both the tool preamble and the image cost, which differ by an order of magnitude.

Validation: unit tests for each term of the estimate and for the PNG header reader; the existing count route tests move to the new numbers (same behaviour, arithmetic in the comments). Live before and after numbers are in the PR body.

Refs #412

**fix(anthropic): run a requested thinking effort on the nearest variant the model has** ([`b7e23fc`](https://github.com/jjjermiah/opencode-plugboard/commit/b7e23fc38a1c362de8e0cb8270ac50b9eda79cd5))

What changed: resolveModel picks a variant for a requested effort in three steps: the variant of that name, else the nearest one at or above it, else the model's highest one (effortVariant in src/models.ts). A thinking budget of 1500 is effort "low", and claude-haiku-4-5 lists only high and max, so the request now runs on high instead of silently without thinking. The same rule now applies to Responses and Chat Completions reasoning_effort and to Gemini thinkingConfig, since they share resolveModel.

A model with no thinking variant at all still runs without thinking. Messages now answers x-plugboard-thinking: unavailable in that case (thinkingUnavailable), listed in the CORS exposed headers and documented in messages.md, gemini.md and configuration.md.

Decisions: "none" and names outside minimal, low, medium, high, xhigh, max only match exactly, so a request for no thinking is never turned on. The header is set only on Messages, where the caller asked for thinking by name; Chat, Responses and Gemini ignore an unavailable effort silently, as before. That is a follow-up, not part of this change.

Rejected: mapping the budget to a fixed variant in effortOfBudget. The table is only a hint, and the model's own list decides, so the nearest-variant rule in the resolver is the one place that holds for every front-end.

Validation: unit tests for effortVariant (table), resolveModel with a Haiku-shaped catalog, and thinkingUnavailable; HTTP tests for the high variant on a 1500 budget, the header on a model with no thinking variant, and no header without thinking. The old test that expected max to be ignored now expects the highest variant. Live check on the dev server is in the PR body.

Refs #410

#### Tests

**test(anthropic): cover the image header readers and raise the floors (#412)** ([`aab0c34`](https://github.com/jjjermiah/opencode-plugboard/commit/aab0c3442a210d720b11a44fa28bd18f91a8798e))

The image size readers for GIF, WebP (lossy, lossless, extended) and JPEG were not covered, so line coverage fell below the floor (98.5% against 98.7%) and function coverage below 94.9%. Each format now has a header test, the JPEG one passing a restart marker, a fill byte, an application segment and a table segment before the frame header, and an unknown format, a missing frame header and a truncated PNG are checked to have no size.

The try/catch around the reads is gone: every read is already length-checked, so nothing in the reader can throw. Ratcheted with test-gates --ratchet: the floors only go up, and the new test counts and coverage are committed with the tests.

Refs #412

</details>
<!-- commit-detail:end -->

## [0.45.0] - 2026-10-16: Clean Endings

**Full diff:** [v0.44.0...v0.45.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.44.0...v0.45.0)

### Fixed

- **The Gemini CLI example no longer picks up the laptop's skills** ([#443](https://github.com/jjjermiah/opencode-plugboard/issues/443)). The CLI reads its home from `GEMINI_CLI_HOME` before `HOME`, so a machine that set it put its own skills into the scripted transcript. The example runner now clears every `GEMINI_CLI_*` override and sets its own home and an empty system settings file, so the transcript is the same on a laptop and in CI (since 0.45.0).
- **A stream committed before the deadline closes after its error frame** ([#441](https://github.com/jjjermiah/opencode-plugboard/issues/441)). When the request deadline passed after the 200 was sent, the stream ended with its error frame, but its socket stayed open until the grace timer cut it two seconds later. Now the socket closes once that final frame is flushed, so a keep-alive client never reuses it (since 0.45.0).
- **The Responses envelope echoes the caller's `store`** ([#442](https://github.com/jjjermiah/opencode-plugboard/issues/442)). Every response said `store: false`, including for requests that sent `store: true` or left it out. It now echoes the value sent, and `true` when the request leaves it out, as OpenAI does. An answer made with `store: false` is still not kept for retrieval (since 0.45.0).

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (5 commits)</summary>

#### Fixes

**fix(examples): isolate the gemini-cli scripted run from the laptop's skills** ([`db3d70b`](https://github.com/jjjermiah/opencode-plugboard/commit/db3d70bf6ac22734c1737773dc6883032a841ac0))

The scripted Gemini CLI transcripts changed on a machine with extra skills present. An antigravity-support skill from the maintainer's laptop went into the <available_skills> block of the system prompt, so the committed S1 and S3 transcripts no longer matched, and CI, which has no such skill, passed while the laptop failed.

The CLI environment is now built in one place, cliEnv in examples/gemini-cli/cli.ts. It drops every GEMINI_CLI_* variable the caller has set, then sets HOME and GEMINI_CLI_HOME to the run's home, and GEMINI_CLI_SYSTEM_SETTINGS_PATH to an empty settings file inside that home.

The CLI finds its user skills and extensions under homedir(), which reads GEMINI_CLI_HOME before HOME (bundle, function homedir). The runner already overrode HOME, but it spread process.env, so a laptop that exported GEMINI_CLI_HOME kept reading its own ~/.gemini and ~/.agents skills. CI does not set it, which is why CI passed.

Setting GEMINI_CLI_HOME explicitly was chosen over only deleting it. Deleting would also work today, since HOME then becomes the home, but an explicit value keeps the run's home first whatever the CLI reads first in a later version. The system settings path is redirected for the same kind of reason: with no override the CLI reads a machine-wide settings file from a fixed path (/Library/Application Support/GeminiCli on macOS, /etc/gemini-cli elsewhere).

The CLI's machine-wide policies directory has no environment override, so a policy installed system-wide still applies. Policies are not skills, and nothing on this laptop installs one. Noted, not handled.

Validation, on the laptop: a scratch home with a user antigravity-support skill was set as GEMINI_CLI_HOME, and the scripted gemini-cli target ran and passed with runs/scripted identical to the committed transcripts (git diff clean). The same run with the previous environment handling (GEMINI_CLI_HOME passed through) changed the transcripts, so the probe does reach the prompt. A run with the ambient environment is also identical. CI sets no GEMINI_CLI_* variable, so its output is unchanged. CI itself was not run here.

Closes #443

**fix(http): close a committed stream's socket once its deadline error is sent** ([`d49225b`](https://github.com/jjjermiah/opencode-plugboard/commit/d49225b54b57a8fdb70bc4c1e6d3012d1a2dd3fe))

A request that had already sent its 200 and streamed before the deadline passed ended its stream with the dialect's error frame. The response then finished, but the socket stayed open, and the grace timer armed at the deadline cut it two seconds later. A keep-alive client could meanwhile send its next request on that socket, which the grace timer then destroyed.

beginRequest now listens for the response's finish once the deadline has fired, and ends the request socket when the finish arrives. The end is a half-close the client answers, so the socket closes right after the final frame has been flushed. The grace timer stays armed as the fallback for a client that stops reading and never flushes, and it is still cleared when the socket closes.

Alternative rejected: clearing the grace timer at finish and leaving the socket open. A client that ignores the close would then hold the socket forever, because the server socket allows a half-open connection.

Alternative rejected: setting connection: close on the response. Headers are already sent on a committed stream, so the header cannot change. The 504 path of #422 keeps using it, since that answer has not been sent yet.

Test: test/http/transport.test.ts, "#441 a stream committed before the deadline ends with its error frame, then its socket closes without waiting for the grace". The handler is the route's shape (sseWriter bounded by the scope, the error frame written on the timeout, then the response ends), with a 60 second grace and a keep-alive client. It failed before this change (the socket stayed open for the whole second), and it passes now.

Closes #441

**fix(responses): echo the caller's store in the response envelope** ([`70ae1c6`](https://github.com/jjjermiah/opencode-plugboard/commit/70ae1c6d02c00466408efd22a4b79e2d355e8365))

Every Responses answer carried store: false in its envelope, whatever the request sent. The value was a constant in src/responses/request.ts, written when plugboard stopped keeping answers for retrieval (#426). A caller that sent store: true, or left the field out, got back a false it had not asked for. OpenAI echoes the value sent and defaults it to true.

The envelope now carries body.store !== false, so an absent or true value echoes true, and false echoes false. The route's keeps check in src/responses/route.ts already reads store the same way, so what the envelope reports and what plugboard keeps for retrieval now agree.

Alternative rejected: echoing the raw body.store value. A non-boolean would then reach the response unchanged. The request decoder has no check for store, and the boolean comparison keeps the echo a boolean without adding one.

Tests: test/http/responses.test.ts gains two cases (the default, an explicit true and an explicit false on the JSON answer, and both on the created and completed stream events). The existing JSON assertion that pinned store false for a request without store now expects true. test/unit/ responses-request.test.ts asserts the envelope for an absent and for a false store, and its old "always says store false" name is replaced.

Wire goldens: test/types/wire.ts is regenerated with bun test/types/generate.ts. The only change is the store field, from false to true, on the response and its stream events. The goldens still satisfy the SDK types, because the store field is typed boolean in the wire type. docs/responses.md and docs/clients/codex-cli.md said the response always reports store: false, and now say it echoes the value sent.

Closes #442

#### Tests

**test(examples): record the echoed store in the scripted Responses transcripts** ([`76f73db`](https://github.com/jjjermiah/opencode-plugboard/commit/76f73db4535dd629029e8597fe50d64f297c93aa))

The scripted runs of the client examples send Responses requests without a store field. Those requests used to get store false back, because the envelope had a constant false. The #442 fix echoes true for an absent store, as OpenAI does, so every scripted Responses transcript now records store true.

What changed: 136 lines across 84 files under examples/*/runs/scripted/ transcripts/, each one "store": false replaced by "store": true. Nothing else moved. The check was made with git diff -U0: every changed line matches "store", every removed line is false and every added line is true. The live runs under runs/live/ are historical records and are not regenerated.

Validation: bun examples/_harness/run.ts all --target scripted ran and wrote these transcripts. The examples step of bun run validate ends with git diff --exit-code examples/, so the committed files must match the run.

Refs #442

**test(mutations): catch a regression of the #441 socket close** ([`558699f`](https://github.com/jjjermiah/opencode-plugboard/commit/558699f5dffd7792e9ab22380fa626052810121a))

The socket close added for #441 ends a committed stream's socket once its response finishes after the deadline. The transport test that pins it fails without the line, but the mutation catalogue had no entry for that line, so a later edit could remove it and the mutation check would not notice. This adds mutation P441, which replaces the socket end with a no-op and must be caught by test/http/transport.test.ts.

The test count floor in .github/floors/test-count-floors.json is raised to the count the new #441 and #442 tests give, as the validate ratchet writes it.

Refs #441

</details>
<!-- commit-detail:end -->

## [0.44.0] - 2026-10-16: Tools That Remember

**Full diff:** [v0.43.0...v0.44.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.43.0...v0.44.0)

### Fixed

- **`tool_choice: "none"` offers no server tool without `tools`** ([#421](https://github.com/jjjermiah/opencode-plugboard/issues/421)). A trusted app's `serverTools` were still offered when a caller sent `tool_choice: "none"` and no `tools` array. The Chat Completions, Responses, Messages and Gemini request decoders dropped the choice in that case. Now `none` reaches the session and means no tools, server tools included (since 0.44.0).
- **A server tool's result reaches the next step** ([#417](https://github.com/jjjermiah/opencode-plugboard/issues/417)). A trusted app's `serverTools` ran, but the next step lost the call and its result, so the model asked for the same tool again until the step cap failed the request with 502 `server_tool_steps_exceeded`. Each step now keeps the tool call and result the host appended, after the caller's transcript, so the model answers from the result (since 0.44.0).
- **An app name is at most 255 characters** ([#418](https://github.com/jjjermiah/opencode-plugboard/issues/418)). The admin route minted a runtime key for an app name of any length, but every call with that key then failed with 502 `backend_failed`. The app's directory is named after the app, and a file name takes at most 255 bytes. The admin route now refuses a longer name with 400 `invalid_app`, and the config refuses it at load (since 0.44.0).

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (7 commits)</summary>

#### Fixes

**fix: keep tool_choice none when the caller sends no tools** ([`6fc8bbe`](https://github.com/jjjermiah/opencode-plugboard/commit/6fc8bbe4102aa7ccf63730990e90dd78fb5ede46))

With tool_choice "none" and no tools array, the four request decoders (Chat Completions, Responses, Messages and Gemini) dropped the choice. Each one gated toolChoice on tools.length > 0. The session then saw no choice, so remapSeedTools and sessionRequest still offered the app's serverTools. "none" must mean no tools at all, server tools included.

Decision: keep the gate for every other choice (auto, required, a named tool), so "tool_choice without tools is left out" still holds. Only "none" is kept without tools. The same rule covers Messages {type: none}, Gemini functionCallingConfig NONE and Responses "none".

Rejected: dropping serverTools in applyContext when the choice is missing. That would fix one reader of toolChoice and leave the decoders wrong for every other reader.

Validation: decoder tests for the four dialects and the route test in test/http/invariant-surfaces-r2.test.ts (flipped from test.failing) were red before the fix and green after. Full bun test: 2897 pass, 126 skip, 0 fail.

Closes #421

**fix: keep a server tool's call and result on later steps** ([`a0a0206`](https://github.com/jjjermiah/opencode-plugboard/commit/a0a0206fc5b58b6dba40bf494cb8fbec24b9318b))

A trusted app's serverTools run inside the host session. The host calls the context hook once per step, and applyContext replaced session.messages with the caller's transcript each time. Step 1's server tool call and its result were dropped, so the model asked for the same tool again. Every step ran the tool once more until maxServerToolSteps was reached, and the request failed with 502 server_tool_steps_exceeded. The live report reads three successful read calls and then the cap.

Decision: the context hook records how many messages the caller transcript took (RequestState.callerMessages). On a later step it keeps the host's messages from that index on, which are the tool calls and results the host appended, and puts them after the caller transcript. The first step has no record, so it is unchanged. The caller transcript is still rewritten on every step, and the appended messages are kept by identity, not copied.

Rejected: keeping the whole previous session.messages array. That would repeat the caller transcript on each step, and the rewrite would have to be undone. Rejected: a module-level map from session ID to count. The count belongs with the request state, which the store already releases.

Validation: the test.failing in test/session/server-tools.test.ts is now a plain test and was red before this change. A new test checks that a later step carries the caller transcript once, then the appended message by identity. Full bun test: 3024 tests, 0 fail. The live two-step read is in the PR body.

Closes #417

**fix: refuse app names over 255 characters at key creation and config load** ([`2401844`](https://github.com/jjjermiah/opencode-plugboard/commit/2401844b035895b7e022f72d714d2f5805bbc051))

An app name of any length matched APP_NAME_PATTERN, so the admin route minted a runtime key for a 300-character name (201). Every call with that key then failed with 502 backend_failed. ensureAppDir names the app's directory after the app, and a file name takes at most 255 bytes (NAME_MAX on Linux and ext4). A 255-character name worked, a 300-character one did not.

Decision: APP_NAME_MAX = 255 and isAppName(), the pattern plus the length, in config.ts. The config checks (keys and apps) and the admin route use it. The message names the limit, so a refused name says why. The admin route answers 400 invalid_app, the same code as a bad pattern.

Rejected: 63 characters, the DNS label limit suggested in the issue. It is not the limit that breaks here, and it would refuse names that work today. Not checked: the session title, which the issue also names. The 255 boundary matches the directory name limit, which is the path that fails here. Stored key records with a long name are left as they are: the key store already treats an unreadable record as no key.

Validation: a boundary test in test/http/admin.test.ts (255 mints, 256 gets 400 invalid_app and nothing is minted) and 256-character rows in the config and apps tables. All were red before the change. Full bun test green.

Closes #418

**fix: continue a server-tool run from the host's messages, not the caller's** ([`a10374a`](https://github.com/jjjermiah/opencode-plugboard/commit/a10374a2b3a4cb4506e6e3df37cf1d17fd95e4d0))

The review of #448 found that the first #417 fix sliced the host's messages at the caller's message count. The host does not pass back the caller's array. It reloads the session every step, so its messages are the stored prompt, then each earlier call and result. The slice only lined up for a caller transcript of exactly one message, so a system prompt plus history dropped the call and result again and the run looped to the cap.

Decision: the first context call of a request records how many messages the host had (RequestState.hostMessages). A later call keeps the host messages after that index and puts them after the rewritten caller transcript. The continuation is gated on apps with serverTools, so an untrusted app and a caller-tool-only request keep today's behaviour, and the host's synthetic continue or retry messages are not sent to them.

Rejected: recording the caller length, the first fix. It is the bug. Rejected: keeping the first host message by identity. It fails when the host stores more than one prompt message.

Tests: unit tests build step 2 and step 3 as fresh host-shaped arrays with caller transcripts of 1, 2, 3 and 5 messages, and check identity of the appended calls and results. An untrusted app keeps the old behaviour. A route test drives a multi-message request through a fake host that reloads the session each step, with a stub model that asks for read until its history holds the result. It returns one server call and the answer. The test.failing that already existed is still a plain test.

Also .github/floors/test-count-floors.json, ratcheted by the validate run.

**fix: keep tool_choice none for an app with tools false** ([`cba0c09`](https://github.com/jjjermiah/opencode-plugboard/commit/cba0c097cbc6fef2b3737eeacb0d32254fc0ac06))

applyToolPolicy dropped the tool choice for an app with tools: false, and none was among the choices dropped. With no choice, the session offered the app's serverTools. The same hole #421 closed for requests without tools, reached through the app's tools option.

Decision: keep none in that branch. It refers to no tool, so it stays, and the server tools stay out with it. Named and auto choices are still dropped, as before.

Also: plugboard's app name checks go through isAppName (config.ts), so the length cap from #418 applies to the request route, the usage query and the key store, not only to the config and the admin route. docs/configuration.md states the 255 character limit.

Validation: a session request test for tools: false with tool_choice none (it offers no server tool). The tests run green; the red run before this change was not repeated, the failing path was read in the code. Full validate with mutations green.

#### CI and tooling

**ci: wait for a running CI run before the release preflight** ([`ef13629`](https://github.com/jjjermiah/opencode-plugboard/commit/ef136291e15e5b526655d37c50c53b9aa1878a37))

The release preflight refused to start while the newest CI run on main's commit was queued or in progress ("Wait for it to finish"). A release then meant someone had to watch the run and start the script again. The script is a foreground tool, so it can wait.

What changed: waitForMainCi() in .github/scripts/release.ts polls the newest ci.yml push run on origin/main's commit every 20 seconds while it is queued or in progress, up to 40 minutes (MAIN_CI_TIMEOUT_MS). A completed run is judged as before: success proceeds, anything else stops the script with the conclusion and the run URL, and nothing is committed or pushed. No run, or a gh failure, still refuses at once. Dry runs keep the one-shot check, so the preview does not block. docs/releasing.md says the same.

Decision: poll, do not block on a single gh call. gh run watch would need the run id and would not cover a run that has not appeared yet.

Rejected: a longer timeout or no timeout. A stuck run would hold the release terminal indefinitely, and the bound is what lets the wait fail on red.

Validation: no committed test, because release.ts runs at module top level and the repo has none for it; the existing release checks were rehearsed the same way, outside the repo. Throwaway origin, stub gh: a queued run that completes with success proceeds past the preflight and pushes the release branch; a queued run that completes with failure stops with "concluded failure" and pushes nothing. Before the change, the queued run stopped the script at once. The 40 minute timeout branch was not exercised.

**ci: release preflight retries transient gh errors and waits for a new run** ([`822d215`](https://github.com/jjjermiah/opencode-plugboard/commit/822d2159b8e9c18f9dda66e6d76ca19fe251301d))

Review of #448 found two gaps in the preflight wait. A single failing gh run list ended a 40 minute wait, and a commit just pushed to main had no run for a short while, which still refused at once.

What changed: waitForMainCi() tolerates up to three consecutive gh failures before it refuses, and gives a commit with no run listed two minutes to get one. The timeout message derives its minutes from MAIN_CI_TIMEOUT_MS. The wait logs only when the run's status changes, not every poll. The dry run says "warning:" and "A --push run waits for it", since a real run now waits. The header comment and docs/releasing.md describe the behaviour.

Validation: throwaway origin and a stub gh. A flaky first gh call that then succeeds with a green run: it retried, and the release branch was pushed. A red run stops with "concluded failure" and pushes nothing. A green run pushes the branch. The two-minute no-run path and the 40 minute timeout were not rehearsed.

</details>
<!-- commit-detail:end -->

## [0.43.0] - 2026-10-16: Names, Not Placeholders

**Full diff:** [v0.42.0...v0.43.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.42.0...v0.43.0)

### Fixed

- **SECURITY.md lists the dashboard page** ([#419](https://github.com/jjjermiah/opencode-plugboard/issues/419)). A page that rebinds its name to the listener, behind a trusted loopback proxy, reaches the usage dashboard page and its files as well as `/healthz`, `/readyz` and the discovery page. The dashboard holds no data, and its data route still needs a key. SECURITY.md did not list the page (since 0.43.0).
- **The docs send a new user the right way** ([#413](https://github.com/jjjermiah/opencode-plugboard/issues/413)). The README quick start pins `opencode-plugboard@0.42.0` (it pinned 0.26.0). The README says a Gemini model id with a `/` gets a 404 `NOT_FOUND`, not a 401. `docs/gemini.md` says the Python SDK was not covered by its tests. The Vercel AI SDK page covers `@ai-sdk/anthropic` with a real Claude id, which needs `structuredOutputMode: "jsonTool"` (since 0.43.0).
- **Reasoning names tools as the caller does** ([#411](https://github.com/jjjermiah/opencode-plugboard/issues/411)). The model sometimes named a tool in its reasoning by the internal placeholder id it was shown (`mcp_` plus an encoding of the name). Plugboard now rewrites those ids to the caller's tool name in reasoning text, on Messages thinking, Chat Completions and Responses `reasoningOutput`, streamed and not, including an id split across stream deltas. Only an id that is one of the request's own tools is rewritten, in the forms the `@ex-machina/opencode-anthropic-auth` plugin sends (`mcp_T` and `mcp_H` for 2.0, the upper-cased name for 1.x). The answer text is not changed, only reasoning. A signed thinking block is replayed with the text it was signed for, from a bounded map in this process, so a later turn still verifies. After a restart or an eviction the block replays as the caller sent it (since 0.43.0). Gemini responses return no thought parts, so there was nothing to rewrite there.
- **A Messages `tool_use` block carries `caller`** ([#404](https://github.com/jjjermiah/opencode-plugboard/issues/404)). The `@anthropic-ai/sdk` types make `caller` required on a tool_use block. Plugboard sends `"caller": {"type": "direct"}` on each tool call, in the stream and in the final message (since 0.43.0).
- **A Messages text block carries `citations`** ([#405](https://github.com/jjjermiah/opencode-plugboard/issues/405)). The SDK types require `citations` on a text block, `null` when there are none. Plugboard sends `"citations": null` on each text block, in the stream and in the final message (since 0.43.0).
- **Messages answers carry the nullable fields the SDK types require** ([#406](https://github.com/jjjermiah/opencode-plugboard/issues/406)). The Message has `container`, `diagnostics` and `stop_details`, and its usage has `cache_creation`, `inference_geo`, `output_tokens_details`, `server_tool_use` and `service_tier`. plugboard sends `null` where it has no value. The message_delta event carries `container` and `stop_details` in its delta, and `output_tokens_details` and `server_tool_use` in its usage (since 0.43.0).

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (9 commits)</summary>

#### Fixes

**fix(anthropic): send caller on Messages tool_use blocks** ([`3703d8f`](https://github.com/jjjermiah/opencode-plugboard/commit/3703d8fd79a6198d3ec99c84e8a0791da25f243b))

What changed: a tool_use block in a Messages answer (the final message and the content_block_start of a stream) now carries `caller: {type: "direct"}`.

Why it was needed: the pinned @anthropic-ai/sdk (0.133.0) types make `caller` required on ToolUseBlock, and its doc says "Tool invocation directly from the model". Anthropic's programmatic tool calling docs show a direct tool_use block with `"caller": {"type": "direct"}`. Plugboard only returns direct calls, so the value is fixed.

Decisions made: a fixed value, not a field from the host. Plugboard has no server tool callers. The request decoder ignores `caller` on replayed tool_use blocks (it reads named fields only), so clients that echo the block still work.

Rejected alternative: omitting the field and waiving it in the conformance test. The SDK type says the field is always present, and a client that checks the type sees it missing.

Validation done: test/compat/conformance.test.ts "#404 a tool_use block carries caller" was test.failing and failed with the field missing before this change; it now passes. test/unit/anthropic-response.test.ts updated for the new exact shape. bun test test/compat test/unit/anthropic test/http/anthropic: 355 pass. bun run typecheck clean.

Fixes #404

**fix(anthropic): send citations on Messages text blocks** ([`64f2103`](https://github.com/jjjermiah/opencode-plugboard/commit/64f210348bc2b1e4dbb6aa735fe8bb2f0515d195))

What changed: a text block in a Messages answer (the content of the final message and the content_block_start of a stream) carries `citations: null`. Plugboard never produces citations, so the value is always null.

Why it was needed: the pinned @anthropic-ai/sdk (0.133.0) types make `citations` required on TextBlock: `Array<TextCitation> | null`. A client that checks the type sees the field missing. null is the value the type allows when there are no citations.

Decisions made: null, not an empty array, because the SDK's TextBlock doc says citations are "supporting the text block" and a plugboard answer has none. The same field is set on the stream's content_block_start, so the stream and the final message agree.

Rejected alternative: waiving the field in the conformance test. The type says it is always present.

Also in this commit: the scripted example transcripts under examples/ were regenerated (`bun examples/_harness/run.ts all --target scripted`). The diff is additive only (91 files, 257 insertions, no deletions): each gains `"citations": null` on text blocks, and some gain `"caller"` on tool_use blocks from the previous commit. The wire-format tests in test/types/wire.ts were regenerated with `bun test/types/generate.ts` after GAPS dropped the text citations gap. Exact-shape assertions in test/unit and test/compat now expect `citations: null`.

Validation: test/compat/conformance.test.ts "#405 a text block carries citations" was test.failing and failed with the field missing before this change; it now passes. bun test test/compat test/types test/unit test/http test/session test/runtime: 2870 pass before the examples run. bun run typecheck clean. bun examples/_harness/run.ts all --target scripted exit 0.

Fixes #405

**fix(anthropic): send the nullable fields the SDK requires on Messages answers** ([`ae0252b`](https://github.com/jjjermiah/opencode-plugboard/commit/ae0252b5905b415e869ce6a5819dbbca6cf8cb4a))

What changed: a Messages answer carries the nullable fields that the pinned @anthropic-ai/sdk (0.133.0) types mark required. On the Message (final and message_start): `container`, `diagnostics` and `stop_details`. On the Message usage: `cache_creation`, `inference_geo`, `output_tokens_details`, `server_tool_use` and `service_tier`. On message_delta: `container` and `stop_details` in the delta, and `output_tokens_details` and `server_tool_use` in the usage. Every value is null, because plugboard has no value for any of them.

Why it was needed: the SDK types make each field required, typed as nullable. A client that checks the type sees the field missing. null satisfies the type.

Decisions made: null for all of them, not a computed value. `cache_creation` could carry the cache write split by TTL, and `service_tier` could carry the tier; plugboard does not return those today, so null is honest. The message_delta usage keeps its narrower SDK shape (MessageDeltaUsage has no cache_creation, inference_geo or service_tier), so the strict conformance check accepts it.

Rejected alternative: keep the waivers in the conformance test. The waiver list is now empty, and the wire goldens (test/types/wire.ts) no longer need the ts-expect-error lines for the Message and events.

Not verified: which of these fields a live Anthropic response always carries. The SDK types and Anthropic's docs were the evidence, not a captured response.

Also in this commit: the scripted example transcripts under examples/ were regenerated (`bun examples/_harness/run.ts all --target scripted`). The new fields add lines; the deleted lines are the trailing commas after output_tokens. The summary files are unchanged. The pydantic-ai and smolagents runs are `partial` (the S7 GET /v1/models gap, #399), and the harness exited 1 with them. Its exit code on main was not checked.

Validation: test/compat/conformance.test.ts "#406 a Message carries the SDK's nullable fields" was test.failing and failed before this change; it now passes. bun test test/compat test/unit test/http test/session test/runtime test/types: 2870 pass, 0 fail. bun run typecheck exit 0.

Fixes #406

**fix(session): rewrite tool placeholder ids in reasoning text to tool names** ([`513542a`](https://github.com/jjjermiah/opencode-plugboard/commit/513542a16d24a07cd13782e29ffc063ecfc68b0c))

What changed: the collector (src/session/events.ts) rewrites an id of the form `mcp_` + `T` + base64url(name) in reasoning text to the tool's name, before the text becomes a reasoning-delta. The rewrite is in src/tool-placeholders.ts. It runs on the neutral event, so every route that returns reasoning gets it: Messages thinking (stream and final message), Chat Completions and Responses reasoningOutput (stream and final), and the signed text that is replayed.

Why it was needed: the model sees its tools under these ids and sometimes names them in its thinking (for example "a tool called mcp_TZ2V0X3dlYXRoZXI"). The tool_use block carries the right name, so only the reasoning leaked the encoding. A client that shows thinking exposed plugboard internals, and the mangled name went back to the provider on the next turn.

Decisions made: the rewrite decodes the id, and rewrites only when the decoded name is a plain tool name and re-encodes to the same id. That leaves `mcp_servers` and half ids alone. The decoder strips the leading `T`, which both examples in #411 carry. An id split across deltas is held back until it ends: the held text is only a run of id characters that starts with `mcp_` (or is a prefix of it). It flushes at the end of a reasoning block, before a text or tool event, and before the signature. Gemini returns no thought parts (its route drops reasoning-delta), so there is nothing to rewrite on that route.

Rejected alternatives: a map from the request's tool names. It needs the tool list threaded into three encoders and is no more precise when the encoding decodes cleanly. Rewriting in each encoder: three copies of the held-back logic, and the replay path would stay unrewritten.

Not verified: the leading `T` is inferred from two examples, not from the host source. The live check on the dev server shows whether a real Claude thinking run has no placeholder ids.

Validation: test/unit/tool-placeholders.test.ts (new) and test/session/collector.test.ts (two #411 cases) failed before this change and pass now. bun test (full): 3005 tests, 2879 pass, 0 fail. bun run typecheck exit 0. Mutation entries reasoning-placeholder-ids-not-rewritten, reasoning-placeholder-prefix-not-held and reasoning-held-text-not-flushed-at-block-end are in test/mutations/catalogue.ts; the mutation run is pending.

Fixes #411

**fix(session): replay signed reasoning as signed, rewrite only this request's ids** ([`90de386`](https://github.com/jjjermiah/opencode-plugboard/commit/90de386bfdddc4e5c4d359fe7e345a6b8c2cf1b0))

What changed:
- The placeholder rewrite (src/tool-placeholders.ts) matches exact ids only. An id is the whole run of id characters after `mcp_`, and it is rewritten only when that run is one of THIS request's aliases: `mcp_T` plus base64url(name) for a name of 44 bytes or fewer, `mcp_H` plus base64url(sha256(name)) for a longer one, and the 1.x form (`mcp_` plus the upper-cased name). The producer is @ex-machina/opencode-anthropic-auth 2.0.0-next.x, read at 2.0.0-next.6. The generic decode fallback is removed, so `mcp_servers`, `mcp_Tbm90` and `mcp_TZ2V0X3dlYXRoZXI_tool` are left as they are.
- The collector (src/session/events.ts) builds the aliases from the request's caller and server tool names (caller.ts passes `toolNames`).
- Held reasoning text goes out before a text delta, a tool call, a failure's error, a finish and the end of the stream. A block that ends with a signature and was rewritten is remembered under that signature.
- src/reasoning-replay.ts keeps those originals in a bounded LRU (1000 blocks, 8M characters, the lru-cache dependency). src/anthropic/request.ts restores the original text when a signed thinking block comes back. A signature the map does not hold replays as received.

Why: the caller sends the reasoning back with the signature the provider made for the original text. Anthropic checks a replayed thinking block against that signature, and a modified block is a 400. Before this change a rewritten block would have failed on the next turn. The aliases come from this request's tools because a text-level decode also changed model text that only looked like an id.

Decisions made: an exact alias lookup, not a decode. The map is per process; a restart or an eviction replays the text as received, which is the same as before the rewrite. Responses drops reasoning items on input, so there is nothing to replay there. Gemini returns no thought parts.

Rejected alternatives: making the rewrite opt-in (it would hide the leak from the default path); proving live that an edited summary replays (it may be accepted on some models and refused on others, and the map covers all of them).

Not verified in this commit: the live two-turn round trip on anthropic/claude-haiku-5-5#high (run after this commit, in the PR body).

Validation: test/unit/tool-placeholders.test.ts (aliases, H form, non-tool text, split ids, hold-back), test/session/collector.test.ts (flush before text, before a tool call, before an error, at the end with no reasoning.ended, after a server tool call; the H form; the replay record), test/unit/anthropic-request.test.ts (replay restores the original, unknown signature unchanged). Full chain: typecheck, bun test, coverage and ratchet (session 409, unit 1428), coverage manifest, pack, docs build, scripted examples, and the foreground-equivalent mutation run: 148 of 148 killed.

Fixes #411

#### Security

**docs(security): list the dashboard page in what a rebinding page reaches** ([`7390c42`](https://github.com/jjjermiah/opencode-plugboard/commit/7390c4271d0425de13ddc3099204d1b769fa54f5))

What changed: SECURITY.md says what a page that rebinds its name to the listener reaches when `listen.trustProxy` trusts a loopback proxy. The sentence listed `/healthz`, `/readyz` and the minimal discovery page. It now also lists the usage dashboard page (`/plugboard/dashboard`) and its files, with usage on, and says the data route `/plugboard/usage` still needs a key.

Why: the reporter (issue #419) reproduced it on plugboard 0.37.0 with listen.trustProxy: true and usage on. A keyless request with a forged Host of `evil.example` and X-Forwarded-Host from a loopback peer got 200 for /plugboard/dashboard and /plugboard/dashboard/app.js, and 401 for /v1/models, /plugboard/usage, /plugboard/status, /plugboard/metrics and /plugboard/admin/keys. The behaviour is correct: the page holds no data. Only the docs were short.

Decisions made: no code change. The reported behaviour is what the design intends (the dashboard page is a static page, as the discovery page is). The docs/configuration.md Reverse proxies section does not list the pages, so it is unchanged.

Validation: the repro in the issue was not re-run in this commit. The docs build (bun run docs:build) is run with the rest of the branch.

Fixes #419

#### Docs

**docs(docs): fix the four places that sent a new user the wrong way** ([`926cc40`](https://github.com/jjjermiah/opencode-plugboard/commit/926cc40a859ac00b9e22eeef8ff12665f6ebbe39))

What changed:
- README quick start and the full example pin `opencode-plugboard@0.42.0`, the version in package.json. They pinned 0.26.0, so a new user got a version without userHeader, thinking replay or Copilot replay.
- README Known gaps: a Gemini model id with a `/` from the AI SDK's Google provider or LangChain's google-genai gets a 404 NOT_FOUND that names the expected path. It said 401. docs/gemini.md and compatibility.md already said 404.
- docs/gemini.md: a paragraph says the tested run covers the JS SDK only. The Python SDK's image requests failed until #401 and #409, both fixed in 0.41.0.
- docs/clients/vercel-ai-sdk.md: `@ai-sdk/anthropic` with a real Claude id sends output_config.format for `Output.object`, which plugboard refuses with a 400. The page gives `providerOptions: { anthropic: { structuredOutputMode: "jsonTool" } }` and says the alias `fast` hides the problem.

Why: each one was reproduced on the hub by the reporter (issue #413). The README pin is the first thing a new user copies.

Decisions made: the pin is the current package.json version, not the release tag of the moment. The 401 is replaced by the 404 that compatibility.md already documents. The Vercel snippet is the reporter's verified form, not a new example run.

Validation: bun run docs:build exit 0. The Vercel snippet and the Gemini 404 were not re-run in this commit; the reporter's run is the evidence.

Fixes #413

#### CI and tooling

**ci(tests): ratchet the session and unit test-count floors for #411** ([`42a214e`](https://github.com/jjjermiah/opencode-plugboard/commit/42a214efea330e2f9460da86187ad63deadf70bc))

What changed: .github/floors/test-count-floors.json raises session from 400 to 402 and unit from 1414 to 1421, the counts after the #411 tests were added (the placeholder rewriter unit tests and two collector cases). The floors only go up.

Why: the test gate ratchets the per-layer floors with `test-gates.ts --ratchet` on each change that adds tests. This commit carries only that generated change.

Validation: bun test --coverage ... && bun .github/scripts/test-gates.ts .coverage --ratchet exit 0 on this branch.

**ci(ci): add one-command validate and pr-wait scripts** ([`4ff9d98`](https://github.com/jjjermiah/opencode-plugboard/commit/4ff9d985e90b52a1c8974d266aef9f679d943511))

Lanes ran the local validation chain as six separate commands, often in the background, and then polled log files in sleep loops to see when they ended. That wasted turns and wall time: the scripted examples alone take about six minutes, long enough for the shell tool to move a command to the background.

`bun run validate` runs the chain in order in one foreground process: typecheck, tests with the coverage gates (ratchet), the coverage manifest, pack and smoke, the docs build, and the scripted examples with a clean `examples/` diff. `--mutations` adds the mutation run, `--only` and `--skip` pick steps, `--keep-going` continues after a failure. Each step's full output goes to `.agents/validate/<step>.log` (ignored by git); the console shows one line per step with its time, and the last 30 lines of a failed step's log. The plain `bun test` step was dropped: the coverage run already runs every test.

`bun run pr-wait <n> [--merge]` waits in the foreground for every check on a pull request's head, reports a conflicting PR at once (GitHub runs no checks then), prints each failed check with its link and one verdict line, and optionally merges with a merge commit when everything passed.

Rejected: an OpenCode custom tool for this. A package script works for every agent and for humans, needs no plugin registration, and keeps the chain defined next to the code it checks.

Validation: a full `bun run validate` passed all six steps in 399s on this branch (examples 341s, the rest 58s). `bun run pr-wait 445` reported green for 12 checks. `--only`/`--skip` with an unknown or empty selection fail.

</details>
<!-- commit-detail:end -->

## [0.42.0] - 2026-10-16: Loose Ends Tied

**Full diff:** [v0.41.0...v0.42.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.41.0...v0.42.0)

### Added

- **Examples for five more Chat Completions clients** ([#105](https://github.com/jjjermiah/opencode-plugboard/issues/105)). LlamaIndex, Semantic Kernel, Haystack, Mastra and async-openai now run through the examples harness. Each scripted run is byte-identical across two runs. Each has a live run against the dev server, served build `git describe` v0.41.0-32-g9852300 (main); `fast` was served by its second chain entry, `anthropic/claude-haiku-4-5`. The scripted model now answers Semantic Kernel's prefixed tool name (`weather-get_weather`). Mastra's stream usage check is unobserved, because Mastra sends no `stream_options`. S5 to S7 and E1/E2 were not run for these clients. Still open: Cline/Roo, Msty, Raycast and Home Assistant (GUI, or they need a Home Assistant instance), and LangChain4j and Spring AI (no JDK on the machine that ran this).
- **Examples for the Gemini clients** ([#103](https://github.com/jjjermiah/opencode-plugboard/issues/103)). The Google GenAI JS and Python SDKs, LangChain's `ChatGoogleGenerativeAI`, the Vercel AI SDK's Google provider and the Gemini CLI (headless) each have a runnable example and a client page, with scripted and live runs. The examples show two model-id rules: a `#variant` goes as `%23` (the SDKs treat `#` as a URL fragment), and the Vercel provider needs a `/` in an id sent as `%2F`. The Python SDK's and LangChain's image requests needed [#401](https://github.com/jjjermiah/opencode-plugboard/issues/401), now fixed on main 0.41.0; their live runs pass on 0.41.0.
- **Anthropic Messages client examples** ([#102](https://github.com/jjjermiah/opencode-plugboard/issues/102)). Runnable examples for the Anthropic Python and TypeScript SDKs, LangChain `ChatAnthropic` (Python and JS), the Vercel AI SDK's `@ai-sdk/anthropic` provider and pydantic-ai's `AnthropicModel`, each with a scripted run and a live run against the isolated dev server. Required rows pass except S7 (`GET /v1/models`, which refuses `x-api-key`, [#399](https://github.com/jjjermiah/opencode-plugboard/issues/399)) for the two Anthropic SDKs and pydantic-ai. The LangChain and Vercel examples list models with a raw `fetch` or `httpx` call, not the client, so their S7 row is not a client check. The error-code checks are not observed (Messages errors carry `error.type`, no `error.code`). Claude Code has a manual `claude -p` probe only, not an example run.

### Fixed

- **A timed-out request no longer cuts the next one on its connection** ([#422](https://github.com/jjjermiah/opencode-plugboard/issues/422)). After a 504, the next request sent on the same keep-alive connection was dropped about 2 seconds in, when the grace timer closed the socket. A timed-out answer now says `Connection: close`, so the client opens a new connection (since 0.42.0).
- **An `n` > 1 chat stream opens every choice in index order** ([#423](https://github.com/jjjermiah/opencode-plugboard/issues/423)). The first chunk could carry choice index 1, which the OpenAI Python SDK's `stream()` helper rejects with an `IndexError`. Each choice now sends its role chunk, in index order, before any content (since 0.42.0).
- **Empty stop strings get a 400 that names `stop`; a thinking signature rejection names the signature** ([#424](https://github.com/jjjermiah/opencode-plugboard/issues/424)). `stop: ""` and a list with an empty entry are refused before the model call with `param: "stop"` (Gemini: `generationConfig.stopSequences`). A whitespace stop such as `\n` is matched in the answer text. When a provider rejects a replayed thinking block's signature, the 400 says the signature was rejected, without the provider's text (since 0.42.0).
- **A Responses answer cut by `max_output_tokens` has an incomplete message item** ([#425](https://github.com/jjjermiah/opencode-plugboard/issues/425)). The item open at the cut is `status: incomplete`, in the stream and in the final response, next to `status: incomplete` on the response (since 0.42.0).
- **Items of a `store: false` Responses answer cannot be referenced** ([#426](https://github.com/jjjermiah/opencode-plugboard/issues/426)). plugboard no longer keeps their output items, so an `item_reference` to them is the 400 `item_not_found` (since 0.42.0).

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (27 commits)</summary>

#### Features

**feat(examples): add Google GenAI JS and Python SDK examples** ([`987338b`](https://github.com/jjjermiah/opencode-plugboard/commit/987338ba7337bc8921b1f54401cb6401db0df362))

The Gemini clients listed in #103 had no example. This adds examples/gemini-js (@google/genai 2.30.0) and examples/gemini-python (google-genai 2.31.0). Each runs S1 to S7 and the two error paths through the harness, and the scripted runs are committed.

The SDKs build the URL, and a bare # starts a fragment, so the runners send the variant as %23. A / goes as it is, because the route decodes the segment. Gemini calls carry no id and errors name UNAUTHENTICATED or NOT_FOUND rather than invalid_api_key or model_not_found, so those checks are marked unobserved with the reason and the status is still checked.

The Python SDK sends inlineData as mime_type, which plugboard rejects. That row is a gap pointing at #401 until it is fixed.

Validation: the gemini-js scripted run passes. The gemini-python scripted run is partial, with only the S5 gap.

Refs #103

**feat(examples): add Gemini client examples and pages** ([`5f1e08c`](https://github.com/jjjermiah/opencode-plugboard/commit/5f1e08ccc0afc959e30137c15742736fba96ffe1))

The Gemini clients listed in #103 had no runnable example. This adds five: the Google GenAI JS SDK (gemini-js), the Google GenAI Python SDK (gemini-python), LangChain's ChatGoogleGenerativeAI (langchain-google-genai), the Vercel AI SDK's Google provider (vercel-ai-google) and the Gemini CLI run headless (gemini-cli). Each runs S1 to S7 and the error paths through the harness, with pinned dependencies, a scripted run committed and rerun for determinism, and a live run against the isolated dev server at 987338b. Each has a client page under docs/clients and a sidebar entry, and docs/gemini.md now points at them.

Two model-id rules came out of the runs. The SDKs build the URL and treat a bare
# as a fragment, so a variant goes as %23 (the runners do it). The Vercel
provider adds the models/ prefix only to ids without a /, so an id with a / goes as %2F there. Plugboard is correct in both cases; the examples and docs/gemini.md say so.

Two rows are gaps, not passes. The Python SDK and LangChain send inlineData as mime_type, which plugboard rejects (#401), so S5 is a gap there. The Gemini CLI runs its own built-in tools, so the custom-tool, structured, image and model list scenarios are not applicable to it, and its countTokens calls did not fire in a headless one-shot run.

Refs #103

**feat(examples): run five more Chat Completions clients through the harness** ([`7a7856d`](https://github.com/jjjermiah/opencode-plugboard/commit/7a7856d222730e2e06c5d6109faf024506398d18))

The compat matrix (see the issue for #105) lists Chat Completions clients beyond the first eight. Five of the headless ones had a copyable script but no harness runner, so no scripted or live record. This wires them in, the same way as the other examples: a runner that marks each scenario, scripted output committed and checked twice for determinism, and a live run against the isolated dev server.

What:
- llamaindex: run.py (pyproject and uv.lock, llama-index-llms-openai-like 0.8.1). S1 to S4. S3 usage left unchecked, because stream_chat sends no include_usage.
- semantic-kernel: run.py (semantic-kernel 1.45.0). S1 to S4. S2 and S4 are gaps on the scripted target only, see below.
- haystack: run.py (haystack-ai 3.4.0). S1 to S4. S3 asks for stream_options through generation_kwargs, since Haystack does not send it by default.
- mastra: run.ts (bun, @mastra/core 1.78.0, zod 4.6.7). S1 to S4. The runner maps Mastra's tool-calls step name to tool_calls for the observation; the wire is still checked by the harness.
- async-openai: src/bin/runner.rs and run.sh (relay), async-openai pinned to =0.42.2. S1 to S4 with include_usage on S3.
- Snippet regions in each copyable file, docs sections on the five client pages, examples/README index regenerated, CHANGELOG bullet.

Decisions:
- Semantic Kernel prefixes every plugin function on the wire (weather-get_weather). The scripted model answers only get_weather, and the client has no plugin-free registration (plugin_name=None and "" both fail in 1.45.0). Rather than change the shared scripted model, S2 and S4 are gaps on the scripted target only (gaps keyed by target), and the live run checks them normally. Live passes both.
- Scenarios S5 to S7 and E1/E2 are not in these five runners yet. They are left out rather than marked n/a, because n/a means the client lacks the feature. Listed as follow-ups.
- The async-openai runner is a second binary (src/bin/runner.rs), not a change to src/main.rs, so the copyable demo keeps its own prompts and URL.
- Mastra's agent.ts keeps its bare-id note; the runner uses plugboard/<id>.

Not done, and why:
- Cline/Roo, Msty, Raycast: GUI clients, no headless run.
- Home Assistant: needs a Home Assistant instance.
- LangChain4j and Spring AI: no JDK on the machine that ran this.
- Mastra, Haystack, Semantic Kernel and async-openai were not in the issue's list; they already had example directories, so they were wired rather than added.

Validation:
- Scripted, two runs each, git diff --exit-code clean: llamaindex pass, haystack pass, mastra pass, async-openai pass, semantic-kernel partial (S2, S4 gaps as above).
- Live against the isolated dev server at plugboard ef5be0e: all five pass. Runs in examples/<client>/runs/live/2026-10-16-ef5be0e.
- bun run typecheck: root, tui and examples/_harness pass. -p test fails with two errors in test/compat/clients.ts, a file this change does not touch; not checked on main.
- bun test: 2675 pass, 0 fail, 126 skipped (live suites need a server).
- coverage gates and coverage-manifest pass; check-pack and smoke-pack pass; docs:build passes; check-regions passes.
- bun examples/_harness/run.ts all --target scripted: exit 0, git diff --exit-code examples/ clean.

Refs #105

**feat(examples): record the Gemini client live runs on main 0.41.0** ([`c39f79f`](https://github.com/jjjermiah/opencode-plugboard/commit/c39f79fbdbf2d7d2df7922e007d7183704709bbb))

Main 0.41.0 fixed the Python SDK's inlineData (#401 and #409), so the image scenario now passes for gemini-python and langchain-google-genai. Their S5 gaps are removed and both scripted runs are regenerated; the scripted output is the same on a second run.

The five Gemini examples have new live runs on the isolated dev server at plugboard 0.41.0, labelled with the git describe of this branch (2026-10-16-v0.41.0-29-g2d6aac1). All five pass, with no quota-caused row. Each run has a REPORT.md that notes the fast alias falls through to Haiku when the Go provider returns 429, because the harness does not record the served model.

The client pages cite the new runs and no longer describe #401 as open, and the CHANGELOG bullet says the image requests now pass on 0.41.0. The examples index is regenerated.

Refs #103

**feat(examples): fix review findings on the five harness runs** ([`0d0149b`](https://github.com/jjjermiah/opencode-plugboard/commit/0d0149b6a7e538ba03f850f58aeae6bd2d19ebd3))

Review findings on the five-client PR, fixed here:

- The Semantic Kernel tool gap was keyed by target. The scripted model now answers a tool named *-get_weather with the name the client sent, so SK's S2 and S4 pass scripted. The gap, its verdict and its docs paragraph are gone.
- Mastra's S3 usage check passed with no usage requested on the wire. Mastra's stream() sends no stream_options, so the check is unobserved with the reason.
- The live records were labelled ef5be0e, which is not the build the shared server runs. They are rerun against the dev server, served build v0.41.0 (main, git describe v0.41.0-32-g9852300), with PLUGBOARD_COMMIT=9852300 because the checkout is the PR branch. The ef5be0e records are removed. Each live run has a REPORT.md with the label, the fallback and the scenarios not run.

Checks: every scripted run was run twice and the outputs were byte-identical, and no other example's scripted output changed. The earlier tsc -p test failure came from a polluted root node_modules (a stray bun add), not from the branch: a clean frozen install passes here, and so does origin/main.

Refs #105

#### Fixes

**fix(examples): pin the Gemini CLI example's session context for scripted runs** ([`a043a1a`](https://github.com/jjjermiah/opencode-plugboard/commit/a043a1abb961e357ccc26620db880b0515931ba9))

The CLI puts its project temp dir, its workspace listing and today's date into a <session_context> block on the wire. The first scripted runs of gemini-cli differed between two runs on the same day, because the temp dir was a random per-run home and the workspace listing included the example's own run folders.

This pins the HOME and workspace to fixed paths under the temp dir, empties the workspace each run, and turns off the directory tree with context.includeDirectoryTree. Two same-day scripted runs now match byte for byte.

Not fixed: the date in the context. The CLI writes "Today's date is ..." and has no setting to turn it off, so a committed scripted run for gemini-cli matches only on the day it was made. This needs a harness decision (redact the session_context block, or leave gemini-cli out of the scripted set); see the PR.

Refs #103

**fix(examples): normalise the Gemini CLI session context in scripted transcripts** ([`99cc82b`](https://github.com/jjjermiah/opencode-plugboard/commit/99cc82b13ca023eb556dddf6eb17cf9b58decfab))

The CLI writes today's date, the operating system, its temp dir and its workspace into a <session_context> block on the wire, and repeats its home path in its system prompt. Those differ by day and by machine, so a committed scripted run matched only on the machine and day it was made, and CI's run failed.

The harness now replaces those values with fixed placeholders when it writes a request body, inside the session context block only (plus the CLI's fixed home and workspace paths anywhere in a request). Nothing else in any transcript changes. The normaliser is tested in test/unit/examples-normalise.test.ts, and the rule is documented in examples/_harness/README.md under Redaction.

Two same-day regenerations of the gemini-cli scripted run are byte-identical, and no other example's scripted run changed.

Refs #103

**fix(examples): address review of the Responses examples** ([`4b47129`](https://github.com/jjjermiah/opencode-plugboard/commit/4b4712920404d2e86228f1dd29432e2b048ab596))

Review of the Responses examples (issue 104) found five things to fix and some nits. This commit changes what the examples and their records say; the runs are regenerated in the next commit.

What changed:
- vercel-ai-sdk: the store: false call has its own snippet-store-false region, so the docs page no longer imports a ternary that names an undefined variable. The default S2 region is unchanged.
- vercel-ai-sdk README: store-false claim reworded. Both S2 rows send the same shape (no item_reference, because S2 has no assistant text turn to replay). The item_reference path is described as a multi-turn case that is documented, not run.
- openai-agents-js: S4 (streamed tool call), S5 (image), E1 and E2 are written. finish_reason is read from the provider response status (providerData, and the response_done event for streams), not fixed to stop. S3 reads the status from its last event.
- langchain-js: the auto variant's finish_reason checks move from gap to unobserved, the same limitation langchain-python records (issue 104).
- codex-cli README: session-specific sentence cut to "not run".
- Removed the openai-python, openai-js, vercel-ai-sdk, langchain-python and openai-agents-js live runs labelled 8ef91b5. Their version label was wrong (the server ran 0.37.0 build, not 8ef91b5's package version).

Validation: openai-agents-js, vercel-ai-sdk and langchain-js pass scripted runs and typecheck (bunx tsc --noEmit). Full validation and the live reruns follow in the next commit.

Refs issue 104

**fix(examples): normalise the Gemini CLI checkout path in scripted transcripts** ([`0b5f1a6`](https://github.com/jjjermiah/opencode-plugboard/commit/0b5f1a66bc3c6810a427f1805bf9bd828a6de565))

The CLI lists its built-in skills by absolute path in its system prompt. That path starts at the checkout, which is /Users/... on a laptop and /home/runner/work/... on CI, so the CI examples job still failed after the session-context rule landed.

The normaliser now replaces only the checkout prefix of a path that runs through examples/gemini-cli/ with <checkout>. The rest of the path stays. It is tested in test/unit/examples-normalise.test.ts. Two same-day regenerations of the gemini-cli scripted run are identical, and no transcript outside gemini-cli changed.

Validated: the full scripted run passed on this commit. Not yet validated: the typecheck and the full test suite, which must run before a push.

Refs #103

**fix(http): close the connection of a 504 so the next request is not cut** ([`d50413a`](https://github.com/jjjermiah/opencode-plugboard/commit/d50413a4835235f449b7e32cb83bcd097edfda8b))

After a request timed out, the route wrote a 504 and the client kept the socket for its next request. The deadline had also armed a grace timer that destroys the socket after 2 s, so that next request was cut about 2 s in (#422). The grace timer is only cleared once the socket is gone, so a kept-alive socket was always cut.

What changed: `beginRequest`'s deadline handler sets `Connection: close` on the response when no headers have gone out yet. Every route then answers its 504 with `connection: close`, and the client opens a new connection. The responses, completions and gemini routes sent a plain 504 and hit the bug; the OpenAI and Messages routes already passed `close` on their timeout error.

Rejected: cancelling the grace timer when the response finishes. The grace timer exists for a response that never flushes to a client that stopped reading, and `finish` can fire before the bytes are out on some runtimes, so that would leave such sockets open.

Known limit: a stream that already committed its 200 before the deadline keeps its socket, and the grace timer still cuts it. That case is not a 504 status. It is left for a follow-up.

Checked: test/http/transport.test.ts reproduces it with a keep-alive agent. Before the change the second request fails with `socket hang up` (ECONNRESET); after it, both requests succeed.

Closes #422

**fix(openai): open every n > 1 chat stream choice in index order before content** ([`d1d1df6`](https://github.com/jjjermiah/opencode-plugboard/commit/d1d1df666dcf7c8fe51dab993758b336d6fdbf8f))

With `n: 2` and `stream: true`, the first chunk of a Chat Completions stream could carry `choices[0].index = 1`, because each choice wrote its own role chunk at its first content. The OpenAI Python SDK's `chat.completions.stream()` helper builds its choice list by appending in arrival order, so index 1 first raises an IndexError (#423).

What changed: the fan-out opens choices itself. `serveChoices` gives each choice an `open` callback through `StreamChoice`, and the encoder calls it before its first chunk instead of writing its own role. Opening choice k first opens every lower index, so the role chunks go out in index order whichever choice answers first, and each is written once. The chat codec supplies the role chunk through a new optional `opening` hook; completions has none and is unchanged. The single-choice stream path does not pass a choice and keeps its lazy role chunk.

Rejected: writing every role chunk up front when the stream commits. That would commit the stream before any model event, so a failure before output would stop getting its HTTP status. Rejected: buffering content until every choice has spoken, which would hold back the stream.

Checked: test/http/fanout.test.ts runs choice 1 first and checks the helper's arrival-order rule and the first two chunks. With the opener disabled the test fails with `Expected: 0, Received: 1`.

Closes #423

**fix(openai): refuse empty stop strings and name a rejected thinking signature** ([`c97c36c`](https://github.com/jjjermiah/opencode-plugboard/commit/c97c36c480111f520afceb495f168509cbf1f884))

Two opaque 400s came back as `provider_rejected_request` with no reason (#424). An empty stop string (`stop: ""`, or a list with an empty entry) matches everywhere, so it reached the model path and the caller got no pointer to `stop`. A replayed thinking block whose signature a provider refused got the generic provider message, so the caller could not tell that the signature was the part rejected.

What changed: the OpenAI parser refuses an empty stop sequence with a 400 on `stop` before any model call, and the Gemini parser does the same on `generationConfig.stopSequences`. A provider 400 or 422 (or one with no status) whose text names a signature is now classed as `provider_rejected_request` with the message "The model provider rejected the signature of a replayed thinking block". The provider's text is not sent; it is still logged once as `model.failed`, as for every class.

Whitespace stops: `\n` already reached the matcher, and `stopAt` already finds it in answer text. The new HTTP test pins that a newline stop passes and ends the answer before the newline. Unverified: I could not reproduce the opaque 400 for `\n` in-process, so the live check on the dev server decides whether the whitespace half of #424 is fixed.

Rejected: sending stop sequences to the host, which would change what the provider sees. Rejected: accepting an empty stop as a no-op, because the caller would get no answer cut where it asked.

Checked: test/http/stop-sequences.test.ts (the 400 before the model call, with the caller never called), test/unit/gemini-request.test.ts and test/session/collector.test.ts (the signature message, with no provider text in the event).

Closes #424

**fix(responses): mark the message item a cut answer leaves open as incomplete** ([`6c414d1`](https://github.com/jjjermiah/opencode-plugboard/commit/6c414d1f92f02df3a848418b10da2287a4fea4b7))

A Responses answer cut by `max_output_tokens` had `status: incomplete` on the response and `incomplete_details.reason: max_output_tokens`, but its last output item still said `status: completed` (#425). OpenAI's Responses API marks the item the cut left open as `incomplete`, so a client reading the item cannot tell it was cut.

What changed: `runResponse` now computes the cut before it closes the open items. When the finish is `length` (`max_output_tokens`) or `content-filter`, the open message item and the open reasoning item close with `status: incomplete`, in the `response.output_item.done` event and in the final response's `output`. `closeMessage` takes the status as an argument, defaulting to `completed`, so an answer that ends normally, or closes early for a tool call, is unchanged. The failure path keeps its own closing and is not changed here.

Rejected: marking only the message item and leaving reasoning `completed`. The reasoning item is open at the same cut, so the same rule applies to it.

Checked: test/unit/responses-response.test.ts runs a cut answer and checks the done event and the response output. Against the old code it fails with the item status `completed`. The Responses unit and HTTP files pass, 59 tests.

Closes #425

**fix(responses): keep no output items of a store:false answer for item_reference** ([`a2159a9`](https://github.com/jjjermiah/opencode-plugboard/commit/a2159a9df333bb0f76011c6fe010ac44f7f9eef8))

An answer sent with `store: false` still had its output items kept in the per-app store, so a later request could refer to them with `item_reference` and get a 200 (#426). OpenAI keeps nothing for `store: false`, so a reference to its items is a 404 or 400.

What changed: the route reads the request's `store` and skips `rememberAnswer` when it is `false`, on both the JSON path and the streamed path. A reference to such an item is then the existing 400 `item_not_found`. The envelope still echoes `store: false` for every request, as before: the wire snapshots in test/types pin that for a request with no `store`, so changing it is a follow-up.

The same commit also carries the shared files of this batch of red-team fixes: the CHANGELOG Fixed bullets for #422 to #426, the mutation catalogue entries for each new guard (P422 to P426), the ratcheted coverage and test-count floors, and the docs that changed (docs/responses.md, docs/architecture.md, docs/clients/codex-cli.md).

Rejected: rejecting `item_reference` by the app's request instead of not storing. Not storing is what OpenAI does and costs nothing extra.

Checked: test/http/responses.test.ts covers a JSON and a streamed store:false answer, each referenced and refused with 400 item_not_found. The P426 mutation (drop the check on the stream path) was killed only after the streamed test was added. Final runs on this branch: full suite 2995 tests, 0 fail; mutations 139 of 139 killed; typecheck, coverage gate, manifest, pack, docs build and the scripted examples all pass.

Closes #426

**fix(session): match a thinking signature rejection only when it names thinking** ([`29ed359`](https://github.com/jjjermiah/opencode-plugboard/commit/29ed359ab5d0b01eecef2fbd1dc5050cd237f2d2))

The classifier for a refused replayed thinking signature matched any provider 400 whose text contained the word "signature" (#424). Review on the pull request pointed out that this also catches unrelated signature errors and labels them as a refused replayed thinking block, which tells the caller the wrong thing.

What changed: the pattern now needs "signature" within 60 characters of "thinking" or "reasoning" on either side. Anthropic's real text for a bad replayed signature ("Invalid `signature` in `thinking` block") still matches, and the existing collector case for it still passes. A new test covers an unrelated signature error ("Invalid request signature"), which keeps the generic provider_rejected_request message. The mutation P424-signature-rejection-named still targets the unchanged guard line.

Rejected: a broader list of phrases. The thinking or reasoning window is the narrowest rule that covers the case the message is for.

Checked: test/session/collector.test.ts, test/http/stop-sequences.test.ts and test/unit/gemini-request.test.ts pass (185 tests). Full chain on this commit: typecheck, bun test (0 fail), coverage gate with ratchet, manifest, pack and smoke-pack, docs build, scripted examples, and mutations 139 of 139 killed. The live probe of the bogus replayed signature returned the same 400 message on the earlier build.

Refs #424

#### Tests

**test(examples): raise the unit test-count floor for the session-context normaliser tests** ([`85691ab`](https://github.com/jjjermiah/opencode-plugboard/commit/85691ab9604f82c1dec9fb6dbaa61fa10c6fadfe))

The coverage ratchet raised the unit floor from 1362 to 1368 for the six new normaliser tests. Floors only move up, so this is the ratchet's value, not a weakened gate.

Refs #103

**test(tests): add round 2 invariant regression suite for surfaces** ([`eb7567f`](https://github.com/jjjermiah/opencode-plugboard/commit/eb7567fc4037958fb4d3001e6383442deb852a6c))

Add HTTP and session-caller regression tests covering the four round 2 configuration areas: serverTools allowlists and permission ordering, remoteImages SSRF address and redirect validation, keyless loopback Host and Origin refusals, and response cache isolation across apps, sampling parameters and reasoningOutput.

The two mismatches reproduced on the isolated server stay as test.failing entries pointing at #417 (context hook drops server tool results on step 2) and #421 (tool_choice none without caller tools still offers serverTools).

Refs #408
Refs #417
Refs #421

**test(tests): address PR #428 review findings and re-ratchet floors** ([`aed8810`](https://github.com/jjjermiah/opencode-plugboard/commit/aed8810276f0a099d6df24d997e358775643b400))

Move session-layer serverTools checks (outside-directory permission ordering, unlisted tool stripping, prompt-injection resistance, and #417 step 2 context preservation) into test/session/server-tools.test.ts and assert the exact permission list and last-star index so trailing deny rules fail the test.

Move octal, dotted-hex and shorthand IPv4 address rows and streamed oversize body coverage into test/session/media.test.ts, trim overlapping cases in test/http/invariant-surfaces-r2.test.ts, use test.each for cache key variants without mutating tool_choice, split the #278 end-user cache tests, assert JSON error codes directly, drop stale line-number comments, and re-ratchet test count floors on top of origin/main.

Refs #408
Refs #417
Refs #421

**test(examples): raise the unit test-count floor after the merge with main 0.41.0** ([`4d821a2`](https://github.com/jjjermiah/opencode-plugboard/commit/4d821a25f33021bdb070545e2e0c752bcb58040f))

The coverage ratchet raised the unit floor from 1406 to 1412 on the merged tree. Floors only move up, so this is the ratchet's value, not a weakened gate.

Refs #103

**test(tests): count only a fetch's own hits in the maxItems media test** ([`fa4507a`](https://github.com/jjjermiah/opencode-plugboard/commit/fa4507a226f8934139ad6a4c5f57b7a72eb1205c))

The maxItems test in test/session/media.test.ts counted every request the loopback server saw against one shared `hits` counter. The hang test before it aborts a fetch after 1 ms, so its request can reach the server after that test has ended, and then land inside the maxItems window. CI then failed with `Expected: 13, Received: 14` on the OpenCode 2.0.30 host job (#434).

What changed: the maxItems test now fetches its own route, /max-items.png, and counts hits per path with a `served` map. The test also reproduces the race on purpose: it sends a /hang request that the server sees before the maxItems fetch runs, and waits until it arrives. Against the old global counter that run fails with `Expected: 15, Received: 16`, which is the reproduction.

Rejected: making the hang test wait for its request to land before it ends. The request may never arrive, because the 1 ms timeout can fire first, so that wait would hang or stay racy.

Checked: the media test file passes three runs in a row on this branch.

Closes #434

#### Docs

**docs(examples): add Anthropic Messages client examples** ([`06f71b0`](https://github.com/jjjermiah/opencode-plugboard/commit/06f71b0cc899b06943d55c2c04f656ea6041a850))

Adds runnable examples for the Anthropic Messages clients listed in #102: the Anthropic Python SDK (anthropic 1.15.0), the Anthropic TypeScript SDK (@anthropic-ai/sdk 0.135.0), LangChain ChatAnthropic in Python (langchain-anthropic 1.7.6) and JS (@langchain/anthropic 1.5.12), and the Vercel AI SDK's Anthropic provider (@ai-sdk/anthropic 4.0.81).

Each example follows examples/_harness/README.md: nine scenarios from _shared/scenarios.json (S1 to S7, E1, E2), exact pins with a lockfile, a runner, a scripted run that is byte-identical across two runs, and a live run against the isolated dev server at 127.0.0.1:4010 at plugboard 8ef91b5. Each has a docs page that imports its snippet regions.

Decisions:
- The Messages route speaks Anthropic's error envelope: errors carry error.type and no error.code. E1 and E2 read the type and are gaps, because the shared check expects OpenAI's code vocabulary.
- GET /v1/models ignores x-api-key, which the Anthropic SDKs send. S7 is a gap for the two SDKs; filed as #399. The LangChain and Vercel examples list models with a Bearer key, which the route accepts.
- Structured output is a forced tool. Plugboard refuses output_config.format by design (docs/messages.md), and the Vercel provider sends it for claude-haiku-4-5, so that row is a gap.
- Claude Code has no runner. CI has no claude binary, and a runner would break the scripted job. One manual `claude -p` probe against the dev server printed pong (stop_reason end_turn).
- Pydantic-ai's Anthropic model (in #102) is not covered.

Validation:
- bun run typecheck: pass.
- bun test: 2675 pass, 0 fail, 126 live skipped.
- coverage ratchet, coverage-manifest, check-pack, smoke-pack: pass.
- bun run docs:build: pass.
- examples/_harness/run.ts all --target scripted: exit 0; the new scripted runs are identical across two runs; no other example's committed output changed.
- live: five runs against 127.0.0.1:4010 at 8ef91b5, each partial with only the gaps above. No key in any written file.

Refs #102

**docs(examples): cover the Responses API in the client examples** ([`22b47df`](https://github.com/jjjermiah/opencode-plugboard/commit/22b47df356e50eaba790f6e979a83bdd44ceb9f9))

The issue 104 list names the clients that should exercise /v1/responses. Before this change, openai-python and openai-js ran only Chat Completions, LangChain Python pinned use_responses_api=False, the Vercel AI SDK ran only store: true, and there was no JS Agents SDK example.

What changed:
- openai-python, openai-js: a `responses` variant on S1, S2, S3, S5 and S6 (responses.create, responses.stream, responses.parse, output_text, input_image, text.format json_schema). S2 replays the whole history with store: false.
- openai-python, openai-js: S2 `responses-previous-id` runs previous_response_id. Plugboard refuses it by design (400 unsupported_parameter, docs/responses.md), so it is a gap (issue 104).
- vercel-ai-sdk: S2 `responses-store-false`, openai(id) with store: false.
- langchain-python: a `responses` variant (use_responses_api=True) on S1, S2, S3, S5 and S6. LangChain exposes no finish_reason on that route, so those checks are `unobserved`, the same limitation as langchain-js. S6 joins the text blocks the Responses path returns.
- openai-agents-js: new example, the Agents SDK for JS on the Responses API (S1, S2, S3, S6), pinned to @openai/agents 0.20.0.
- codex-cli README: states that codex is not installed here, so `codex exec` was not run.

Decisions:
- A `responses` variant is added beside `chat`, not in place of it, so each row keeps its meaning across runs.
- A plugboard refusal is recorded as a gap naming #104, not as a failure, because it is documented behaviour.
- finish_reason that LangChain does not expose is `unobserved`, not a gap. The gap label is for a known incompatibility, and this is a limit of the client.

Validation:
- Scripted: `bun examples/_harness/run.ts all --target scripted` exits 0 twice, and `git diff --exit-code examples/` is clean after the second run.
- Live against the isolated dev server (plugboard 8ef91b5, 0.37.0): openai-python partial (only the previous-id gap), openai-js partial (same), vercel-ai-sdk pass, langchain-python pass (finish_reason unobserved), openai-agents-js pass. Runs under runs/live/2026-10-16-8ef91b5.
- bun run typecheck, bun test on the examples unit tests (30 pass), bun run docs:build, examples-index --check, check-regions all pass.

Not verified: Codex CLI live (not installed), n8n on the Responses path beyond S1 (needs Docker, not run here), the Vercel item_reference 400 after expiry (documented, not triggered), and the Agents SDK streamed tool call and image rows (not written yet).

Refs #104

**docs(examples): document Responses rows and add the openai-agents-js page** ([`b3c958f`](https://github.com/jjjermiah/opencode-plugboard/commit/b3c958f2e0db7eee9d9e57d652a933614077d2f3))

Client pages for openai-python, openai-js, vercel-ai-sdk and langchain-python now import the Responses snippets. A new openai-agents-js page is in the sidebar. The langchain-python responses_model is a snippet region.

Live runs for the five examples are under runs/live/2026-10-16-b41c376, labelled as the commit b41c376 (package.json 0.37.0, git describe v0.37.0-17). Every failing row is the fast model, which returned 429 from the upstream provider. Compatibility rows and the README references to removed run directories are not done yet; this commit is local only.

Refs issue 104

**docs(examples): fix the Responses review findings and record live runs** ([`829132a`](https://github.com/jjjermiah/opencode-plugboard/commit/829132abb8846c1fa0ab7e52e3278a9fbd4c7ad9))

The review of the Responses examples asked for these changes. This commit finishes them.

What changed:
- Client pages for openai-python, openai-js, vercel-ai-sdk and langchain-python now import the Responses snippets. A new openai-agents-js page is in the sidebar, and the compatibility page has a row for it.
- vercel-ai-sdk: the store: false call has its own snippet region, and the README and docs page describe what the transcripts show: both S2 rows send the same shape, and item_reference is the multi-turn case, documented and not run.
- openai-agents-js: S4 (streamed tool call), S5 (image), E1 and E2 are written. finish_reason comes from the provider response status, not a fixed stop; streams read it from the response_done event.
- langchain-js: the auto variant's finish_reason checks are unobserved, not a gap.
- Live records are regenerated on the shared dev server at main 95261a4 (git describe v0.41.0-4-g95261a4, plugboard 0.41.0). The records from 8ef91b5 and b41c376 are removed; those labels were wrong or superseded.

Live results (runs/live/2026-10-16-95261a4):
- Every row on anthropic/claude-haiku-4-5 and openai/gpt-5.6-luna#low passes, in all five examples.
- Every failing row is on fast. The provider returned 429 (quota), so those rows say nothing about plugboard. The harness runs each example's fixed model list and has no model selection, so fast is in the record.
- openai-python and openai-js: the previous_response_id refusal is a gap (400 unsupported_parameter), as documented.

Validation (BROWSER=true):
- Scripted, all examples, run twice: byte-identical (git diff empty).
- Typecheck: pass. Full bun test: 2979 tests, 0 fail. docs:build: pass.
- examples-index --check and check-regions: pass.

Not done, left as follow-ups:
- The previous-id gap is still unconditional: any failure on that row is labelled a gap. Asserting the 400 needs harness support.
- S6 for Responses reads the raw create result only for the parse call; it is not compared to the raw result.
- The compatibility page lists only the agents-js row; the Responses variants of the other clients are on their own pages.

Refs issue 104

**docs(examples): rerun live records with the fast fallback** ([`5d07029`](https://github.com/jjjermiah/opencode-plugboard/commit/5d070292c7d90f9c647e69fa916a83d701acaa9d))

The dev server's fast alias now falls back from opencode-go/glm-5.3-flash to anthropic/claude-haiku-4-5. A Go quota 429 is served by Haiku (x-plugboard-model: anthropic/claude-haiku-4-5, x-plugboard-fallbacks: 1).

The live records from the earlier 95261a4 run failed on fast with a quota 429. They are replaced here with reruns of the six examples this PR touches, on the same main commit (95261a4, git describe v0.41.0-4-g95261a4, plugboard 0.41.0):

- openai-agents-js: pass (16 pass, S7 n/a)
- openai-python: partial (only the S2 responses-previous-id gap, 3 rows)
- openai-js: partial (same gap, 3 rows)
- vercel-ai-sdk: pass (48 pass)
- langchain-python: pass (30 pass)
- langchain-js: pass (23 pass)

The harness does not record the served model, so each run has a REPORT.md that says fast was served through the fallback chain and that a fast row is not attributed to Go or Haiku. The example READMEs and the client pages say the same.

The README and docs lines that called fast a 429 failure are updated. The compatibility row for the Agents SDK (JS) now reads from this run.

Refs issue 104

**docs(examples): address #415 review on the Anthropic clients** ([`63da3b4`](https://github.com/jjjermiah/opencode-plugboard/commit/63da3b4e2a9b191a4b0f33b27151a67d4dc27a9d))

- E1/E2 code checks are unobserved in the five Anthropic runners; the status checks stay enforced. Follow-up: #427.
- Vercel S6 sets structuredOutputMode "jsonTool" and passes on haiku.
- Adds examples/pydantic-ai-anthropic (AnthropicModel), docs page, index entry.
- Live records on main v0.41.0 (v0.41.0-13-g7e1fdcb): partial (S7 only) for the two SDKs and pydantic-ai; pass for Vercel and both LangChain examples. The fast alias falls back to Haiku on a Go 429, noted in each REPORT.md.
- Removes my earlier b41c376 records: their fast rows failed on quota.
- 8ef91b5 records keep REPORT.md label notes (server ran 0.37.0).
- Claude Code README: dated manual claude -p probe result.
- Root README client rows; CI typechecks the TS Anthropic examples.

Refs #102

#### CI and tooling

**chore(examples): typecheck the Gemini CLI example like the other TypeScript examples** ([`6c36e84`](https://github.com/jjjermiah/opencode-plugboard/commit/6c36e84c34fbad1e5e99482a5537834e8922d8b3))

The gemini-cli example had TypeScript files but no tsconfig, no typecheck script and no TypeScript dev dependencies, so nothing checked it. This adds the same tsconfig and the same pinned @types/bun 1.4.2 and typescript 7.0.2 as gemini-js, with a typecheck script, and locks them. The example type checks clean with bun run typecheck. Its scripted output does not change.

Refs #103

</details>
<!-- commit-detail:end -->

## [0.41.0] - 2026-10-16: Gemini Pictures Welcome

**Full diff:** [v0.40.0...v0.41.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.40.0...v0.41.0)

### Fixed

- **Gemini `inlineData` from the Python SDK** ([#401](https://github.com/jjjermiah/opencode-plugboard/issues/401), [#409](https://github.com/jjjermiah/opencode-plugboard/issues/409), since 0.41.0). The google-genai Python SDK sends `inlineData` with `mime_type` (snake_case), and plugboard answered 400 `inlineData needs mimeType and base64 data`. The inline MIME type is now read in either case, like the other Gemini fields. The SDK also sends `inlineData.data` as URL-safe base64 (`-` and `_`), which plugboard answered 400 `Image data URL is not valid base64`: it is now normalised to standard base64 before the image check. Data with any other character, or a length no base64 string has, is still refused. `fileData`, `functionCall` and `functionResponse` were already read in both cases and are covered by tests now.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (2 commits)</summary>

#### Fixes

**fix(gemini): read inlineData snake_case mime_type and URL-safe base64** ([`7e114e6`](https://github.com/jjjermiah/opencode-plugboard/commit/7e114e6c030c2cc1373e1c0dc7c1bbf7f4bb85f9))

The google-genai Python SDK sends inlineData with mime_type, and its bytes as URL-safe base64 (- and _). Plugboard answered 400 for both (#401, #409).

What: the inline MIME type is read with field(), like the other Gemini fields. inlineData.data is normalised to standard base64 (padded when unpadded) before the image check. Garbage characters and impossible lengths are still refused.

Why: a proto JSON parser accepts both names and both alphabets, so Google's API takes this body; plugboard was stricter than the API it proxies.

Decisions: the normaliser lives in src/gemini/request.ts, not image.ts, so the image check still sees standard base64 only. fileData, functionCall and functionResponse already read snake_case via field(); they gain tests only.

Validation: typecheck clean; bun test 2728 pass, 0 fail; coverage gates pass with the unit floor raised 1362 to 1369; coverage-manifest, check-pack, smoke-pack, docs:build, scripted harness and examples diff all pass. bun run mutations was started and stopped on owner pause; not complete.

Not verified: live run against 127.0.0.1:4010 (examples/gemini-python is not on main, so S5 cannot run). Scripted harness has no Gemini example.

Refs #401, #409

#### Tests

**test(floors): ratchet unit test floor to 1406** ([`7e3ad30`](https://github.com/jjjermiah/opencode-plugboard/commit/7e3ad30ac9bafa70a244887b823aa6534cf0e415))

The Gemini inlineData tests added in this branch (snake_case mime_type, URL-safe base64, the Python SDK body) raise the unit count from 1400 to 1406. Ratchet run after the merge of origin/main; floors are only ever raised.

Refs #401, #409

</details>
<!-- commit-detail:end -->

## [0.40.0] - 2026-10-16: Quick to Move On

**Full diff:** [v0.39.0...v0.40.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.39.0...v0.40.0)

### Added

- **First-event deadline for fallback chains** ([#391](https://github.com/jjjermiah/opencode-plugboard/issues/391), since 0.40.0). A fallback chain could not help when its first target hung: a provider that fails upstream with HTTP 520 kept the host retrying, and a request to that target hung for more than 90 seconds with no event and no failure. Option `fallbackAfterMs` sets a deadline for each target that is not the last. A target that has produced no model event within it is aborted (its OpenCode session is interrupted and retired, not left running) and the next target is tried. It is reported like any other fallback: `x-plugboard-fallbacks`, the `model.fallback` log line with reason `first_event_deadline`, and `plugboard_fallbacks_total`. The last target has no first-event deadline and is bounded only by `requestTimeoutMs`. Off by default. Global only, because a list entry is a plain model string. It is refused at load unless it is below `requestTimeoutMs` and below each app's `requestTimeoutMs`. Silence before the first event counts against it, including the setup of the attempt and an app's `serverTools` runs; read the rule in [configuration](docs/configuration.md#aliases-and-fallbacks) before setting it.

### Changed

- **A host retry before any output moves a fallback chain on at once** ([#391](https://github.com/jjjermiah/opencode-plugboard/issues/391), since 0.40.0). OpenCode retries a failed provider call itself, after a wait of up to about 84 seconds for an upstream 520. For an alias list with a target after the failing one, that wait now ends the attempt at once with reason `provider_retry`, so the chain falls through in seconds. The last target keeps the host's retries. This applies with or without `fallbackAfterMs`, so a rate limit that the host would retry also moves on at once: a change for alias lists that used to wait. Retries after output has been sent are unchanged, because the answer is committed.

### Fixed

- **An upstream HTTP 520 is answered as 502** ([#391](https://github.com/jjjermiah/opencode-plugboard/issues/391), since 0.40.0). A status that reached the client unchanged could be 520 to 527, which are not HTTP statuses (Cloudflare uses them). Such a status is answered as 502 `provider_unavailable`, the gateway class. Statuses 500 to 511 and the 4xx ones are unchanged.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (4 commits)</summary>

#### Features

**feat(fallback): add fallbackAfterMs, a first-event deadline for fallback chains** ([`9090202`](https://github.com/jjjermiah/opencode-plugboard/commit/9090202b12559b1d9643dae62e49af831186b808))

A list alias could not help when its first target hung. A provider that fails upstream with HTTP 520 kept the host retrying, and a request to that target hung for more than 90 seconds with no event and no failure. The chain only retries a failure that arrives before the first event, so a target that never answers blocked the whole request until requestTimeoutMs.

Option fallbackAfterMs (global, optional, off by default) sets a deadline for each target that is not the last. When a target has produced no model event within it, the chain aborts that attempt and tries the next target with reason first_event_deadline. The attempt's signal is AbortSignal.any of the request signal and the deadline, so the existing caller cleanup runs: the OpenCode session is interrupted and retired, not left running. The timer is cleared at the first event, so an answer that arrives in time is never aborted. The last target is bounded only by requestTimeoutMs, as before.

Reported like any other fallback: x-plugboard-fallbacks, the model.fallback log line with the reason, and plugboard_fallbacks_total. Nothing new in the metrics labels.

Decisions: the option is global only. A list entry is a plain model string, so a per-target deadline would need a new entry shape; that is a larger change and can come later if one deadline does not fit every provider. Rejected: a deadline on the whole attempt (a slow but progressing stream would be cut), and an abort without a reason (the log would not say why the target was skipped).

Validation: fake-host unit tests cover a target that never emits, a target that emits just before the deadline, two hangs before a third answers, and a slow last target. Config tests cover the bounds. The mutation fallback-first-event-deadline-does-not-abort is killed. Live check on an isolated OpenCode server built from this branch, with two loopback fake upstreams (one never answers): the alias hang answered from fast after 2.07 s with x-plugboard-fallbacks: 1, the aborted session ended interrupted, and no request guard was left.

Refs #391

**feat(fallback): fail over at once on a host retry before any output** ([`5179d81`](https://github.com/jjjermiah/opencode-plugboard/commit/5179d81467f3324510084dbb4aaac97379f4e4fe))

When a provider fails with a retryable error before any output (an upstream HTTP 520, a rate limit), OpenCode 2.0.27 schedules its own retries: up to 10 more calls, about 84 seconds of waiting for a 520. Plugboard ignored the session.retry.scheduled event, so an alias list with a next target waited out the whole schedule before it fell through (#391).

Now, for an attempt that has a target after it, the event before any output fails the attempt at once with reason provider_retry, and the chain moves on within seconds. The session caller reads the new CallContext.fallbackNext flag that the chain sets, and passes it to RequestCollector as failFastRetry. The collector emits an error with code provider_retry and stops the turn, so the attempt's OpenCode session is interrupted and retired like any other failed attempt. The last target gets no flag and keeps the host's retries.

Decisions: the behaviour is on for every alias list, with or without fallbackAfterMs, and it also covers rate limits the host would retry. That is a change for lists that used to wait, so the CHANGELOG says so. A retry after output has been sent is left alone, because the answer is committed and a restart would repeat text. To know whether a target follows, the chain now resolves the targets before the first attempt, one uncached model.list host call per list-alias request. Rejected: reading the retry event's delay and waiting less (the host would still run another step); treating it as a failure only when fallbackAfterMs is set (the 520 case needs no timer).

Validation: collector tests cover a retry with a target after it, without one, and after text or reasoning output. Fallback tests cover the fall-through, the flag on each attempt (true, true, false), and a last-target retry standing as the answer. Mutations provider-retry-ignored, provider-retry-after-output, output-not-recorded-for-retry and next-flag-always-set are killed.

Refs #391

#### Fixes

**fix(fallback): answer the review of the first-event deadline** ([`a893a5e`](https://github.com/jjjermiah/opencode-plugboard/commit/a893a5e1bd5959a7a94d9ea9fd0709a34f95ecf3))

The review of #392 asked for tests, docs and a load-time bound for fallbackAfterMs. This commit covers those; the two follow-ups for #391 come in their own commits.

- Tests: a target that streams reasoning first, and one that streams text first, are not aborted when their stream runs past the deadline, and the whole answer arrives. Removing the timer clear now fails a test (mutation fallback-first-event-deadline-never-cleared). The early event moves to 50 ms of a 400 ms deadline, so a slow runner cannot push it past.
- Docs: configuration.md defines "no event". Any plugboard event stops the clock. Silence includes the setup of the attempt (image fetches, a cold Location, creating the session), hidden reasoning before the answer, and, for an app with serverTools, the time an OpenCode tool runs. A deadline that fires during a tool call can make the next target run the tool again. The deadline is not a hard bound.
- Load: fallbackAfterMs at or past requestTimeoutMs, or past an app's own requestTimeoutMs, is refused at load, because that deadline ends the request first. The budget of the whole chain (fallbackAfterMs times the targets that are not last) is documented.
- Small fixes: the fallbacks line in config.ts keeps its indent; the loadCatalog comment says the catalog is read once per chain request. The CHANGELOG entry no longer names a private host.

Rejected: clamping the value to requestTimeoutMs silently. A value that cannot fire should fail at load, not change behaviour. Still open: a per-target or per-app fallbackAfterMs, since a provider's silent-thinking time differs.

Refs #391

**fix(session): answer an upstream status past 511 as a 502** ([`e09a0ec`](https://github.com/jjjermiah/opencode-plugboard/commit/e09a0ec3c08b99203c90cb1a137ed553a6a61a67))

An upstream status that the host passed through reached the client unchanged: a provider that fails with HTTP 520 (Cloudflare uses 520 to 527) made plugboard answer 520, which is not an HTTP status a client can read. The mapping in toPlugError used the upstream status as-is for every 5xx it did not classify.

Now a status of 512 or more is answered as 502 provider_unavailable, the gateway class, and the message is the same fixed text as before. Statuses 500 to 511 pass through as they did, and the 4xx mappings are untouched. The raw host text still goes only to the log (I13).

Decisions: the cut is 511, the last standard 5xx code, so every status the standard defines is kept. Rejected: mapping every 5xx to 502 (it would turn a provider's 503 overload, which the client can act on, into a generic gateway error). This matters for the fallback chain too: 502 with provider_unavailable is retryable, so a chain treats a 520 the same way whatever its status number.

Validation: collector tests cover a 520 reaching the caller (502, code provider_unavailable) and a 503 that keeps its status. Mutation upstream-520-passed-through is killed.

Closes #391

</details>
<!-- commit-detail:end -->

## [0.39.0] - 2026-10-16: Fair Shares for Everyone

**Full diff:** [v0.38.0...v0.39.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.38.0...v0.39.0)

### Fixed

- **Usage of a cut-short run is counted in usage and budgets** (since 0.39.0). A run that ended without its finish, because the caller left or the request timed out after the host had reported usage, was not recorded, so its tokens and cost did not count toward `budgets`. The usage the host reported is now recorded and charged on every route, stream and non-stream. A client that left is given the app's `settleMs` window (default 2000 ms) for its step to end: nothing waits for it, and the usage the host reports inside the window is charged when it arrives. A tool call or a further step inside the window stops the run at once, so no tool runs and no step starts for a client that left. A request timeout or a cancel by plugboard itself interrupts at once. A finish that was already yielded is charged once. A run whose host reported no usage is counted in `plugboard_usage_missing_total{reason="disconnect"}`.
- **One app's large uploads no longer use up the request-body room of the others** (since 0.39.0). Request bodies were read under one process-wide limit, so one app's large, slow uploads could make every other app's requests fail with 503 `server_busy`. With several apps each app holds a share of `limits.maxBodyBytesInFlight` in proportion to its largest body. The budget is unset by default and then grows with the apps (max of 128 MiB and the sum of the apps' largest bodies), so an upgrade with several apps and no setting keeps working. A set budget that cannot hold one largest body per app is refused at load, and a runtime key for a new app that would not fit is refused with 409 `body_budget_insufficient`. `limits.bodyReadTimeoutMs` is now an idle timer, so a body may take longer as long as its bytes keep arriving, and the new `limits.bodyReadMaxMs` bounds the whole body (5 minutes by default). Both answer 408.

### Changed

- **`apps.<name>.stopSettleMs` is renamed `apps.<name>.settleMs`** (since 0.39.0), because it now also applies to a client that left. Its first release was 0.38.0, so this breaks that option. The metric `plugboard_stop_usage_missing_total{app}` is renamed `plugboard_usage_missing_total{app,reason}`: dashboards that read the old name need updating. `limits.bodyReadTimeoutMs` restarts with every chunk (it was the whole body's deadline in 0.38.0), so slow uploads are admitted longer: that is intended, and the total is now `limits.bodyReadMaxMs`.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (4 commits)</summary>

#### Fixes

**fix(http): charge cut-short runs and cap body reads per app** ([`f75bb6c`](https://github.com/jjjermiah/opencode-plugboard/commit/f75bb6c5b2b1ce0dd41ba8cbb830362e7aa15ad8))

Two fixes on the request path.

Usage of cut-short runs. A run that ended without its finish (the caller left, or the request timed out after the host had reported usage) recorded nothing, so its tokens and cost did not count toward budgets. The session caller now reports the host's running usage through a new CallContext callback (onRunUsage). withUsage records it when the finish is absent, and the recorder charges the tokens whether or not the call was answered. A call that never reported usage is recorded as before. Applies on every route, stream and non-stream.

Per-app body reads. Request bodies were read under one process-wide byte budget, so one app's large, slow uploads could make every other app's requests fail with 503 server_busy. Each app may now hold half of limits.maxBodyBytesInFlight, charged in addition to the global budget and released on every exit path. The global cap and the 408 read deadline are unchanged, so clients that are not hogging the budget see no difference.

Decisions. The per-app share is a fixed half, not a new setting: raising maxBodyBytesInFlight raises both. Charging the share against the app's maxConcurrent was rejected because the body is read before the app's concurrency slot is taken.

Tests. test/session/cancel-usage.test.ts runs the session caller with the fake host: usage is reported, the client cancels, the usage is recorded and the next call is refused by the token budget; a cut-short run with no usage charges nothing. test/http/transport.test.ts covers two stalled uploads from one app (a third is 503, another app is 200, the stalled ones get 408 and free the share) and a stalled upload freeing its slot after the deadline. Mutation catalogue: four new entries, all killed.

Validation: typecheck clean; bun test 2772 pass, 0 fail, 126 skipped (live, no server); coverage ratchet met, floors raised and committed; coverage-manifest, check-pack, smoke-pack, docs:build and the scripted examples pass; bun run mutations 114 of 114 killed.

Docs: configuration.md (body share, usage tokens), architecture.md (I23, I28), errors.md (server_busy).

**fix(http): settle window for a client that left, and settleMs rename** ([`221f877`](https://github.com/jjjermiah/opencode-plugboard/commit/221f877794c094359906c2c46c6a5d1b20019855))

A client that left mid-run was interrupted at once, so the host's step usage was lost whenever the step had not finished. The stop-sequence path already gives the host a window (stopSettleMs) for its step to end. A client that left now gets the same window, and nothing waits for it: the caller is gone, so the usage is recorded when the host reports it.

Flow: a client that leaves (not a timeout, no stop match) is not interrupted. The caller starts a detached task. If the host ends its step (or the execution) within the window, its usage is charged and the host is not interrupted. If not, the host is interrupted and given the drain window to report. A run with no usage reported at all is charged nothing and counted in plugboard_usage_missing_total{reason="disconnect"}. A request timeout still interrupts at once.

Rename: the option is now apps.<name>.settleMs, since it applies to both cases. stopSettleMs was released in 0.38.0 only; the rename is breaking for that option and is noted in the CHANGELOG. The metric plugboard_stop_usage_missing_total{app} is now plugboard_usage_missing_total{app,reason}, reason stop or disconnect.

withUsage: a usage report that arrives after the run's record is charged on its own, once, so the late step usage is not lost.

Tests: test/session/cancel-usage.test.ts gains the window cases (step end inside the window is charged without an interrupt; a silent host is interrupted and counted; timeout still interrupts at once, with its usage charged; settleMs 0 interrupts at once). Two of them failed before this change. Mutation catalogue: three entries for the new behaviour. Full run: 117 of 117 killed.

Validation: typecheck clean; bun test 2776 pass, 0 fail, 126 skipped; coverage ratchet met (functions 94.7%, floors committed); manifest, pack, smoke-pack, docs:build and scripted examples pass.

**fix(http): stop a left client's run at once on a tool call, split the body budget per app** ([`0327ea3`](https://github.com/jjjermiah/opencode-plugboard/commit/0327ea3c6c901c4ebc4e13f4531aeb61de55c50f))

Review follow-ups on the settle window and the body budget.

Client that left. While the settle window runs, a tool call (client or server) or a step that asks for another step (a finish other than a plain stop, or server calls) stops the host at once, as the stop path does. No new step starts for a client that left. A finish already yielded when the client leaves is charged once: the window is only used when no finish was emitted. Only a real client disconnect gets the window. A timeout, and a cancel by plugboard itself (a sibling choice of n failed, now RequestAborted "cancelled"), interrupt at once.

Body budget. The shared pool with a reserve did not hold for a fresh app once two or more apps held bytes, so it is replaced: with several app keys each app may hold its even share of limits.maxBodyBytesInFlight. parseOptions refuses a budget that does not give each share one body of the largest size (limits.maxBodyBytes), and the error names the figure to raise it to. One key or none has no split.

Body deadlines. limits.bodyReadTimeoutMs is an idle timer that restarts with every chunk. The new limits.bodyReadMaxMs (default 5 minutes) bounds the whole body. Defaults keep a 10 MiB upload on a 2 Mbit/s link working (about 42 s). Both answer 408. The changed message is documented.

Tests: cancel-usage gains the tool call, server call, step end, single interrupt, yielded-finish race and internal cancel cases; body-admission covers the idle reset, the ceiling, a chunked body against its share, a body larger than its share, release after 413 and after a client abort, and the config split. The #196 late-call expectations now count the stop at the call. Mutation catalogue: six entries for the new guards. Full run 122 of 122 killed.

Validation: typecheck clean; bun test 2792 pass, 0 fail, 126 skipped; coverage ratchet met (functions 94.8%, floors committed); manifest, pack, smoke-pack, docs:build and scripted examples pass.

**fix(http): size the body budget by apps, not keys, so an unset setting never refuses to start** ([`3b2a8aa`](https://github.com/jjjermiah/opencode-plugboard/commit/3b2a8aaf68cf1b715891ab0d8b09427ea9dd252a))

The even split of the body budget by key count refused to start a config that sets nothing once it had five or more apps (5 x 32 MiB > 128 MiB). Upgrades must not break that config.

Apps, not keys. The split counts apps: the configured keys' apps and the runtime keys' apps, each once. Several keys of one app are one share.

Unset budget. limits.maxBodyBytesInFlight unset is now max(128 MiB, the sum of the apps' largest bodies), so every app always has room for one body of its largest size. The sum uses limits.apps.<name>.maxBodyBytes per app. Each app's share is proportional to its largest body, so a share always holds one body of that size whenever the budget covers the sum.

Set budget. Only an explicitly set budget below the sum fails at load, with the same clear error and the figure to raise it to.

Runtime keys. The admin key API refuses a key for a new app with 409 body_budget_insufficient when a set budget cannot hold it (nothing is created). Unset, the budget grows instead. The code is in PROBLEM_CODES and docs/errors.md.

Tests: six apps with defaults load and each admits a 32 MiB body; an explicit cap below their requirement fails at load; several keys of one app count once in the split; the admin 409 with a set budget and 201 without; the config split checks. Mutation catalogue: entries for the default growth and the admin refusal. Full run 124 of 124 killed.

Validation: typecheck clean; bun test 2797 pass, 0 fail, 126 skipped; coverage ratchet met; manifest, pack, smoke-pack, docs:build and scripted examples pass.

</details>
<!-- commit-detail:end -->

## [0.38.0] - 2026-10-16: Stops Where It Should

**Full diff:** [v0.37.0...v0.38.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.37.0...v0.38.0)

### Security

- **A crafted end-user value could corrupt shared counters** (since 0.38.0). Later requests could fail until restart, and usage stopped recording. Per-user records no longer resolve inherited names, and the reserved names (`__proto__`, `prototype`, `constructor`, `_other`) are refused as end users. The `?user=` filter still accepts them, so a name an older version stored stays queryable.
- **A metrics or usage write that fails no longer changes a request's answer** (since 0.38.0). The failure is logged once, with the write's name, and the access log line is still written.

### Fixed

- **Stop sequences apply to the answer text, not the reasoning** ([#390](https://github.com/jjjermiah/opencode-plugboard/issues/390), since 0.38.0). A reasoning model that quoted the prompt in its reasoning could end with no answer: `fast` (glm-5.3-flash) matched `END` inside its reasoning, the provider stopped there, and the client got an empty answer with `finish_reason` `stop` (2 of 8 calls on the dev server, 0 of 8 without the stop). Plugboard no longer sends stop sequences to the model. It scans the answer text as it streams, on every route, and the first sequence ends the answer: the text before it is returned, the sequence is removed, and reasoning is never matched. The app's `sampling.stop` default applies the same way, Responses included (Responses has no stop parameter of its own).

  Behaviour changes with it. A sequence anywhere in the answer ends it, not only at the end, and under `length` too. A tool call after the sequence is not sent. A tool call before it makes the turn a tool turn (`tool_use` on Messages, `tool_calls` on Chat Completions), with no `stop_sequence`. The response cache keys on the stop sequences, so a stop request is never answered from a no-stop entry.

  The host reports a step's usage only when the step finishes, so after a match the host gets up to 2 seconds to finish the step on its own, and only then is it interrupted. The window is set per app with `apps.<name>.stopSettleMs` (0 interrupts at once, and the step's usage is then lost). Inside the window a tool call or a step end ends the run at once, so no tool runs after the match, and a host failure finishes the answer as `stop` with a warning. The host answers the interrupt with an aborted step failure (`Step interrupted`), which is the expected end (Messages `stop_sequence`). A stop answer that closes without the host's usage is logged and counted in `plugboard_stop_usage_missing_total`; its usage fields are zeros, not an estimate. Chat (single choice and `n` > 1 streams), Responses and Messages always carry `usage`, zeros when the host reported none. The window never runs past the request deadline: a stop match close to the deadline finishes as `stop` with the usage so far, before the 504 would fire (the window is clamped to the time left, minus 250 ms).
- **A malformed client value is a 400 on every decoder** (since 0.38.0). A request whose `type` or `role` is an object with no usable `toString` used to throw `No default value` while the error message was built, and the request ended as an unhandled error. Chat, Messages, Gemini and Responses now name such a value as `object` in a 400. Found by the property tests in CI.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (18 commits)</summary>

#### Fixes

**fix(openai): match stop sequences on the answer text, never reasoning** ([`6745835`](https://github.com/jjjermiah/opencode-plugboard/commit/674583533803c2bf7ea49faaf95f3ade1935bf9a))

On aihub, `fast` (glm-5.3-flash) sometimes quoted the prompt in its reasoning, and the caller's stop word `END` matched there. The provider stopped the stream inside the reasoning, so the client got an empty answer with finish_reason "stop" (2 of 8 calls on the dev server; 0 of 8 without the stop word).

Cause: plugboard passed the caller's stop sequences to the host (appGeneration -> PlugRequest.generation -> session prompt options), and the provider applies a stop to every token it emits, reasoning included. The plugboard matcher (src/stop.ts) only saw answer text, so it could not help.

What changed:
- appGeneration (src/openai/sampling.ts) removes `stop` from the generation the model gets, on every route that calls it. Responses included.
- stopOf() gives the effective list the answer is matched on: the caller's stops, else the app default (apps.<name>.sampling.stop). Chat, completions, Gemini and Messages set it on their exchange.
- src/stop.ts: StopHoldback and stripStopTail are replaced by StopScan, which scans streamed answer text as it arrives. The first sequence ends the answer: text before it is sent, the sequence and what follows are not, and the route stops reading, so the session caller interrupts the host run.
- Chat, completions, Gemini and Messages (streamed and not) use StopScan. A match breaks the loop; reasoning and tool calls never reach the scan.

Decisions and rejected alternatives:
- Stop matching on the answer, not forwarding stops "when the model reasons". The route cannot know before the stream starts whether a model reasons, and a provider stop cannot be scoped to answer text, so forwarding stays wrong for any reasoning model.
- Scan the whole answer, not just its tail. The old tail rule relied on the provider cutting mid-answer stops; without a forwarded stop, a middle match must end the answer here. Changed behaviour: a sequence anywhere in the answer ends it, and a sequence ends it under finish_reason length too (the model produced it). A tool call after a sequence is not produced.
- Known gap, not fixed here: Responses has no stop parameter. An app's sampling.stop default used to reach the provider on Responses; it now neither reaches the provider nor is matched there. Matching needs a scan in src/responses/response.ts (follow-up on #390).

Validation:
- test/unit/stop-not-in-reasoning.test.ts (new): a provider that honours the forwarded stop, run through each route. Reproduced before the change: the quoted-reasoning cases fail on chat (streamed and not), completions, Gemini and Messages. Passes after.
- test/unit/stop-sequences.test.ts, anthropic-stop.test.ts, per-app-sampling updated for the new rule (listed in the PR).
- Mutations P390-stop-sent-to-model, P390-answer-scan-off and P390-app-default-stop-dropped: each killed. Full catalogue 89 of 89 killed.
- Live (dev server runs main, so it shows the bug only): 8 calls with stop ["END"] gave 2 empty answers with finish stop; 8 calls without gave none.

Refs #390

**fix(openai): apply stop sequences to the answer in one wrapper, count usage after a match** ([`e7d40e5`](https://github.com/jjjermiah/opencode-plugboard/commit/e7d40e59ed7b629451bdd1368267a51c76f49a25))

Review of #395 (stop sequences matched on the answer text) found that a stop match dropped the usage of the call, because the routes stopped reading at the match and the finish event (the only place usage comes from) never arrived. The response cache keyed on a request that no longer carried the stop. The Responses route ignored the app's sampling.stop default. A tool call before a sequence gave a stop_sequence where Anthropic reports a tool turn.

What changed:
- withStopSequences (src/stop.ts) wraps the session caller in index.ts, under the response cache. It scans the streamed answer text, and on a match it aborts CallContext.stopAnswer and keeps reading to the finish. Reasoning and tool calls are never matched; text, tool calls and reasoning after the match are not sent. The finish is passed on with the run's usage, forced to stop, and carries stopSequence.
- The session caller (src/session/caller.ts) interrupts the host run on stopAnswer and keeps the stream open. If the host does not end the run within 5 seconds, the collector finishes with the usage counted so far (RequestCollector.finishNow).
- The stop sequences stay on the request (appGeneration no longer strips them), so the cache key includes them. The host hook drops them before the host (src/session/context.ts), so the provider never stops inside reasoning.
- Responses gets the same scan through the wrapper, for the app's default.
- The four response encoders no longer scan. Messages reads stopSequence from the finish. A tool call before the sequence makes the turn tool_use with stop_sequence null (Anthropic does not report a stop after a call in the same turn), and chat reports tool_calls.
- Reasoning between text chunks no longer flushes a partial match (the wrapper never releases held text on reasoning).

Decisions and rejected alternatives:
- Usage by draining the stream to the finish, not by a synthetic finish from the route: the host's finish carries the real tokens, and the collector's running total is kept only as the 5 second fallback.
- The wrapper sits innermost, so the cache stores the answer as cut, under a key that includes the stop. Rejected: scanning per dialect in each encoder, which is how Responses was missed.
- Structured output (a forced respond call) is not scanned: its arguments are the answer, as before.

Validation: typecheck clean; bun test 2710 pass, 0 fail, 126 skip (live suite); coverage ratchet passes; mutation catalogue 93 of 93 killed, including P390-stop-sent-to-model, P390-answer-scan-off, P390-app-default-stop-dropped, P390-usage-after-stop and P390-cache-key-no-stop. The live check was not run: the isolated copy never loaded the worktree plugin (see the PR).

Refs #390

**fix(usage): keep end-user counters off the object prototype** ([`d37ebfc`](https://github.com/jjjermiah/opencode-plugboard/commit/d37ebfcec07ccf36c37340e8f0260a543fd1e559))

A crafted end-user value could write onto Object.prototype of the whole OpenCode process, after which later model requests failed (500) and metrics and usage stopped recording until restart.

Why: per-user records were plain objects, and the user slot lookup returned inherited properties for names like `__proto__`, `constructor`, `toString`, `hasOwnProperty` and `valueOf`. The `++` and `+=` on the counters then wrote onto the prototype chain. The metrics library also iterates inherited label keys, so every metrics write threw.

What: per-user and per-model records are null-prototype objects (in emptyDay, fromJson and sumUsers, and the report apps map). The slot lookup uses Object.hasOwn. The sanitizer refuses `__proto__`, `prototype`, `constructor` and `_other` like any other invalid user, so they get the existing x-plugboard-user-dropped header. `_other` is reserved so it cannot collide with the overflow slot. JSON on disk keeps its shape. Other lookups keyed by request-derived strings were checked (see PR body); the endpoint-by-route table and the dashboard asset table now use hasOwn too.

Also: the metrics and usage writes in the request finally block are wrapped. A throw there is logged once at error level and no longer replaces the answer or stops the access log.

Rejected: prefixing user keys (changes the stored shape and the query filter); only rejecting the names (leaves the store unsafe for any future name); a Map (the JSON shape and the existing report code would all change).

Validation: typecheck; bun test (full suite) with the new tests in test/unit/end-user.test.ts and test/http/end-user.test.ts; test gates with ratchet; coverage manifest; check-pack; smoke-pack; docs:build; examples scripted run with no diff. Mutation entries added for the null-prototype store, the sanitizer, and the write guard.

**fix(session): finish a stop-sequence run as stop when the host reports the interrupt** ([`b2e5478`](https://github.com/jjjermiah/opencode-plugboard/commit/b2e5478c800417df0106a29e4efa05246669eb58))

OpenCode 2.0.27 answers the interrupt that ends a stop-sequence run with an aborted step failure ("Step interrupted", no tokens) and execution.interrupted. The collector treated the aborted failure as an error, so every request whose answer contained a stop sequence failed with 502 model_run_failed on main.

markStopped (set when the wrapper matches a stop) makes that failure and the interrupt the expected end: the answer finishes with stop, with the usage of the step, else the running total. Any other failure still surfaces as an error.

Tests: the fake host answers the interrupt the way 2.0.27 does. The new test fails without the fix. Mutation P390-interrupt-stop-is-error is killed.

Refs #390

**fix(session): let the host finish a stop-sequence step before interrupting it** ([`16f3249`](https://github.com/jjjermiah/opencode-plugboard/commit/16f3249e6d9376fe9e4f18ae101517e1d7f891e9))

The live check on main (2026-10-16) showed the 502 gone but no usage on the Anthropic provider: chat non-stream had no usage, chat stream had no usage chunk, and Messages reported zero tokens. The host publishes a step's usage only when the step finishes. Anthropic reports input tokens on message_start and output tokens on message_delta; an interrupted step never reaches message_delta, so the usage is lost. Copilot's Claude reported usage because its stream finished before the interrupt landed.

Decision (a) from the review: after a stop match the caller no longer interrupts at once. It gives the host STOP_SETTLE_MS (2 seconds) to finish the step on its own, so the step's usage arrives with its finish. Only then is it interrupted. The fallback closes the stream with the running usage STOP_DRAIN_MS later.

The model writes what follows the sequence during the settle window; nothing of it reaches the caller. Rejected for now: (b), estimating usage from token counts. It would put estimated numbers in billing, and only needed if the window is too short.

Tests: the Anthropic event order is modelled (usage on message_start, text past the sequence, step end with output tokens). A new test fails on the previous caller (it interrupted at once). A second test covers a host that stays running past the window: it is interrupted, and the aborted failure ends with stop. Mutation P390-no-settle-window is killed.

Refs #390

**fix(openai): chat answers always carry usage, zeros when the host reported none** ([`654b8ae`](https://github.com/jjjermiah/opencode-plugboard/commit/654b8ae9f0f5247a1917ac64379c69cb73ac01c1))

After the settle-window change the live check showed usage on every stop answer. The one remaining gap is the chat body and its include_usage chunk, which dropped usage whenever the finish carried none. The contract says a chat answer always has usage, so the fields are now zeros in that case. Zeros are only the fallback for a host that reported no usage for the run; a real count is never replaced.

Tests: the non-stream body and the include_usage chunk assert zeros when the host reports none. Mutation P390-chat-usage-always (the previous behaviour) is killed.

Refs #390

**fix(responses): a malformed input item is a 400, not a crash** ([`d17402b`](https://github.com/jjjermiah/opencode-plugboard/commit/d17402b0b7159754f6dd6d14a0b7599c7e2a5a3b))

CI on the #429 head failed the #130 property test ("any request-shaped body is a 400 or a request"). The counterexample was an input item whose role is an object with a null toString. The decoder built its error message with String(item.role), and String() of that object throws "No default value", so the request ended as an unhandled error instead of a 400. The same String() sat in five other error messages in src/responses/request.ts (content part type, assistant part type, tool type, text.format type, input item type).

Decision: a helper `show` renders primitives as before and objects as "object". Messages for string and number values are unchanged. Rejected: validating every field type up front, which is a larger change for the same outcome.

Tests: a regression test for the counterexample (400) and an object type named as "object". Mutation P130-responses-message-string-throws is killed.

The property test was flaky only because fast-check rarely generates this shape; the fix is in the decoder, not the test. The test is unchanged.

Refs #390

**fix(session): finish a stop run at once inside the settle window** ([`67113b7`](https://github.com/jjjermiah/opencode-plugboard/commit/67113b793bc614c56d530d532dd6399d4354154e))

Review of #429: the settle window let a server tool call run after the match and start a next step, and discarded a complete answer when the host failed inside it.

Changes:
- The collector scans the text it emits for the request's stop sequences and marks the match itself (the stop wrapper only saw the text when it read it, so a tool call queued behind the matching text was not stopped). The owner starts the settle window from that hook.
- Inside the window a tool call ends the run at once with finish stop: no tool runs after the match, and the host is interrupted now. A plain step end finishes as stop with the step's usage and does not interrupt (the host ends the run). A pending client tool call still interrupts.
- A non-aborted host failure inside the window finishes as stop with the usage so far, and logs request.stop_step_failed. Failures before any match still surface.
- finishStopped finishes before it interrupts: an interrupt that reports back synchronously must find the run already over.
- A stop answer closed without the host's usage is logged (request.stop_usage_missing) and counted in plugboard_stop_usage_missing_total{app}. No estimate.
- apps.<name>.stopSettleMs (0 to 2147483647, default 2000): 0 interrupts at once. The default and the test seams are unchanged.
- n > 1 stream include_usage and the Responses object always carry usage, zeros when no host usage was reported, as the chat body does.
- The client-value helper moved to src/client-value.ts (show), and it is applied at every String(client value) site in the anthropic, openai and gemini decoders, not only Responses. One regression test per decoder.
- Tests: the window tests use a small stopSettleMs; the host fake answers an interrupt once (a fake that answers every interrupt with a failure looped when a guard was removed, which made the mutation hang instead of fail).

Not done: a stop match close to the request deadline still answers 504. The deadline is enforced by the request scope (http.ts boundEvents writes the 504 and ignores later events), so a complete answer past the deadline is not returned. Documented in the CHANGELOG.

Validation: typecheck clean; bun test 2747 pass, 0 fail, 126 skip; coverage ratchet passes (floors raised); mutations 104 of 104 killed, including the new guards P390-tool-in-window-runs, P390-step-failure-in-window-errors, P390-collector-scan-off, P390-no-stop-usage-count, P390-settle-option-ignored, P390-responses-usage-always, P390-fanout-usage-always, P130-shared-show-throws; manifest, pack, smoke, docs and the examples harness exit 0.

Refs #390

**fix(session): a stop match near the request deadline finishes as stop before the 504** ([`4d92bcb`](https://github.com/jjjermiah/opencode-plugboard/commit/4d92bcba6ada313f67fa0204cadd41d457d30fc7))

The stop settle window (2 s by default) could run past the request deadline, so a complete answer near the deadline was answered 504. The window does not need an HTTP change: the caller clamps it.

The caller now computes the time left before the request deadline (its own start plus the app's requestTimeoutMs, else the global one, passed in as requestTimeoutMs) minus a 250 ms margin. The settle window is min(stopSettleMs, time left), and the drain timer is clamped to the time left too. With no time left the window is 0: the host is interrupted at once and the answer finishes as stop.

Notes:
- The settle clamp alone is not observable: the drain clamp finishes the answer at the same moment. The mutation that is killed removes the drain clamp (P390-deadline-clamp-off); the settle clamp is kept because it stops the host run at the same point the answer ends.
- The margin is a constant (250 ms): the request starts in the HTTP layer before the caller's start time, and the margin covers that gap.

Tests: a short deadline (400 ms) with a match and a host that never reports the end finishes as stop with the usage so far, well before the deadline.

Refs #390

**fix(usage): the user filter accepts stored and reserved names** ([`06adb3b`](https://github.com/jjjermiah/opencode-plugboard/commit/06adb3bbcf5e467ddab27d450e3639b1fa411b06))

The `?user=` filter of GET /plugboard/usage and the usage RPC used the end-user sanitizer, so the reserved names (`_other`, `prototype`, `constructor`, `__proto__`) became 400 there. A day an older version wrote can hold those as users, and they could no longer be queried.

The filter now checks the charset and length only (validEndUser). The sanitizer still refuses the reserved names as end users.

Also: the write guard logs which write failed (`write` field on metrics.record_failed), the user.ts header comment lists the reserved names, the architecture I23 entry says a failed metrics or usage write never changes the answer or the access log, and the CHANGELOG bullets carry bold lead lines.

Checked: the filter tests cover the four names in the store, the route and the RPC; the userHeader path has a reserved-name row; the mutation catalogue has an entry that restores the reserved list on the filter. Full validation passed (typecheck, tests with ratchet gates, manifest, pack, smoke, docs, examples, mutations 110 of 110).

#### Tests

**test(session): name history.hidden tests for 0.30.0, not 0.29.0** ([`f1c5f92`](https://github.com/jjjermiah/opencode-plugboard/commit/f1c5f924a45c55f875bc3e4f9769f523e75bc9c1))

The describe title in test/unit/history-hidden-config.test.ts and the header comment of test/session/hidden.test.ts said "since 0.29.0". history.hidden shipped in 0.30.0 (CHANGELOG [0.30.0], #340), so both now say 0.30.0. Only the names changed. No assertion changed.

The lane named test/session/history-hidden-config.test.ts, but that file is at test/unit/history-hidden-config.test.ts, so that is the file edited.

Refs #337

**test(anthropic): pin thinking budget 2048 to the low variant** ([`0703c7b`](https://github.com/jjjermiah/opencode-plugboard/commit/0703c7bf3c6aee6f79118704c3f5c3a035826a73))

Reported in #394: a Messages `thinking.budget_tokens: 1024` on github-copilot/claude-haiku-5.5 got a provider 404 with tools, while 2048 worked. The mapping in src/anthropic/request.ts (effortOfBudget: budget <= 4096 -> low) sends both 1024 and 2048 to the `low` variant, so the mapping cannot explain a 1024-only failure. The existing table pinned 1024 and 4096 but not 2048. This adds 2048.

Live probe against the isolated dev server (/v1/messages, model github-copilot/claude-haiku-5.5, max_tokens 4096, 3 attempts each):

  budget  tools  attempts  status 1024    no     3         200 x3 1024    yes    3         200 x3 2048    no     3         200 x3 2048    yes    3         200 x3

All 12 served github-copilot/claude-haiku-5.5#low (server.log). No 404 reproduced, so no behaviour change. The probe sessions were deleted with DELETE /api/session/:id.

Test-only change: one new row in the existing test.each table. It passes before and after the change, since the behaviour is unchanged; it pins the 2048 boundary the issue is about.

Refs #394

**test(compat): validate Anthropic Messages responses against SDK-derived schemas** ([`6a7411b`](https://github.com/jjjermiah/opencode-plugboard/commit/6a7411b618fd908581ae241d07aa709ecc457fcd))

Anthropic publishes no machine-readable Messages spec. The Stainless spec URL the SDK repos once recorded in .stats.yml is gone from every version, and the copies on GitHub and in gists are not Anthropic's. The pinned SDK's types are what Anthropic ships, so test/fixtures/specs/vendor-anthropic.ts derives anthropic.json from @anthropic-ai/sdk 0.133.0 with the TypeScript compiler API (already a devDependency). The version is pinned and the generator fails if the installed SDK differs.

The conformance test now validates, over loopback with the fake host: one Message (text and tool_use), every stream event (text, thinking with signature_delta, tool_use with input_json_delta, error mid-stream, and ping checked as {type: "ping"} because the SDK's stream union omits it), the error body (401, 400, provider 429) and MessageTokensCount.

Each union variant is a $ref, so the strict unknown-field check applies to every content block and stream event. The existing rule that exempts composition branches is skipped for Anthropic, since its unions are discriminated by type. A negative test shows a stray field, including one in a content block, is a violation.

Three mismatches are open and named as test.failing cases, each with a bug issue: tool_use omits caller (#404), text blocks omit citations (#405), and the Message and usage omit nullable fields the SDK requires (#406). Plugboard is not changed. The Anthropic stream check is against the SDK types, not a live provider.

Validation: typecheck clean; bun test 2686 pass, 0 fail; conformance 23 pass; coverage gates met with ratcheted test-count floor; coverage-manifest, pack and smoke-pack, docs:build, and examples scripted run with no diff.

Closes #107

#### Docs

**docs(docs): answer whether SiYuan Q/A needs embeddings** ([`1524b81`](https://github.com/jjjermiah/opencode-plugboard/commit/1524b81aee1eec6f6bb716891ab6da2d45c54609))

The SiYuan page now says Q/A chat needs no embedding provider. Only semantic search uses embeddings, and it stays off until ai.embedding.enabled is turned on in the AI settings. Each claim cites a file:line from SiYuan at 7a7430d.

The issue asked which features fail without embeddings. The page said "Whether Q/A needs it was not checked", which was the one open acceptance item. The chat path (kernel/model/ai.go:53-59) and kernel/agent contain no embedding call, and the agent's fulltext search works without embeddings (kernel/mcp/tools/search.go:64-65). The semantic action is the only consumer (kernel/mcp/tools/search.go:50,66-67; search dialog method 4 in app/src/search/util.ts:119; isEmbeddingEnabled at kernel/model/embedding.go:624-627). The SIYUAN_OPENAI_EMBEDDING_* env vars set the config (kernel/conf/ai.go:508-518), but Enabled stays false (kernel/conf/ai.go:113-115), so an operator has to turn it on.

A live run was not used. Plugboard serves no embeddings route, so the source is the evidence. Not verified: a running SiYuan instance.

Closes #248

**docs(docs): say the four client pages run scripted in CI** ([`b110254`](https://github.com/jjjermiah/opencode-plugboard/commit/b1102540f4e4546c6463c4401fe08120003c78c1))

The go-openai, openai-dotnet, langfuse and smolagents pages no longer say there is no scripted test. Each now points to the "Client examples in CI" section of compatibility.md and to its committed runs/scripted/ directory. PRs #368 and #379 put these clients in the examples CI job, so the old sentence was wrong.

The smolagents page now states its turn-2 finish_reason gap as a gap. In the scripted run 5 of 6 round-trip checks pass. The sixth, that the final turn finishes with stop, fails because smolagents ends a run with a final_answer call, which finishes with tool_calls. I accepted the gap as the verdict and said so on the page, rather than weakening the check. The check is a real expectation, and changing it would hide how smolagents differs from the other clients. It is not a plugboard fault.

Closes #362

**docs(docs): fix the opencode dialect note on reasoning** ([`39be9d0`](https://github.com/jjjermiah/opencode-plugboard/commit/39be9d01416ad5ddc493bfb00d201a49cce162c0))

The opencode page said Chat Completions and Responses drop reasoning. Since 0.36.0, reasoningOutput: true returns it on both routes, as an opt-in. The line now says so and links the Reasoning output section. The advice to prefer the Anthropic dialect stays, with its reason: the Messages route keeps reasoning and thinking replay with no setting.

Whether OpenCode sends the returned reasoning back on the next turn over Chat Completions or Responses was not checked, and the page now says so. #255 stays open for it.

Refs #255

**docs(changelog): move the #390 entry under Unreleased as since 0.38.0** ([`369eb8d`](https://github.com/jjjermiah/opencode-plugboard/commit/369eb8d42162b2ba14f31d0af3ec607aadeb7182))

Main released 0.37.0 while this branch was in review, and the merge put the #390 bullet under the released 0.37.0 section. The fix ships in the next minor, so the bullet moves to Unreleased and its version marker becomes 0.38.0.

Refs #390

#### CI and tooling

**ci(ci): lint a dispatched branch's own commits, not the whole history** ([`0c0444c`](https://github.com/jjjermiah/opencode-plugboard/commit/0c0444cb5d07a1fc3283d0aa4bbad3e8bd81638c))

host-bump.yml starts ci.yml, commits.yml and codeql.yml on its pull request branch, because a PR opened with GITHUB_TOKEN starts no workflow. Those dispatched runs reported CI passed and Analyze, but Lint commit messages failed on both bump runs for deps/opencode-2.0.29 (2026-10-14 and 2026-10-15).

Why it failed: commits.yml picks the lint range from github.event_name. A workflow_dispatch has no before or base SHA, so it fell through to the push branch, which set from to the cutoff a54a703. The range became a54a703..HEAD: 426 commits of history, not the one commit the bump adds. Some older commit in that history fails the rules, so the check went red, while the bump's own commit passes (the pull_request run on the same head linted 1 commit, 0 problems).

What changed: a workflow_dispatch run now lints from the merge base of origin/<default branch> and the dispatched head, to the head. That is the commits the branch adds. The cutoff still applies: a base older than the cutoff starts at the cutoff, as before. push and pull_request keep their ranges.

Rejected: passing the PR base as a dispatch input. host-bump.yml would have to know it, and the merge base needs no input. Rejected: skipping the commit lint on dispatched runs. The required check must still mean "these commits are linted".

Check names: the dispatched runs report the names the ruleset requires. Checked on the 2.0.29 head 17db836: "CI passed", "Lint commit messages" and "Analyze (javascript-typescript)". No rename needed.

host-bump.yml: the warning for a failed dispatch no longer tells the reader to push an empty commit. It names the exact gh workflow run command.

docs/releasing.md: the host bump entry said Mondays (the schedule is daily at 06:23 UTC) and told the reader to push an empty commit or close and reopen the PR. Both now describe the dispatch.

Not changed: the bump version. host-versions.ts --latest already returns the newest stable version in the peer range (2.0.30 now). The 2.0.29 bump ran at 11:43 UTC on 2026-10-15, and 2.0.30 was published at 19:46 UTC that day.

Refs #397

</details>
<!-- commit-detail:end -->

## [0.37.0] - 2026-10-15: Copilot Thinks Too

**Full diff:** [v0.36.0...v0.37.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.36.0...v0.37.0)

### Fixed

- **Signed thinking replays to Copilot Claude** ([#386](https://github.com/jjjermiah/opencode-plugboard/issues/386), since 0.37.0). Replay of a client's signed `thinking` blocks was gated on the provider being `anthropic`, so Copilot's Claude models got the history without their earlier reasoning, even though Copilot serves Claude on the Anthropic messages route with the same `anthropic` metadata key. The gate now also admits `github-copilot` models whose id starts with `claude-`. The hook event carries only the model's provider and id, not its route, so plugboard cannot ask which route a model uses. The other Copilot routes (chat completions, responses) do not read that key, so a signature sent to them is dropped. Other Copilot models stay out.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (3 commits)</summary>

#### Fixes

**fix(session): replay signed thinking to Copilot Claude models** ([`86a4818`](https://github.com/jjjermiah/opencode-plugboard/commit/86a4818bd46d4a3f2f41c8c2f8560409699c2c3d))

Replay of a client's signed thinking blocks was gated on the request's provider being `anthropic` (#374). Copilot's Claude models were excluded, but Copilot serves Claude on the Anthropic messages route with the same `anthropic` providerMetadata key (github-copilot/models.ts in OpenCode v2.0.27 picks that route when a model lists /v1/messages), so the signature replays there as well.

Decision: the context hook event carries only model.providerID and model.id (the Model.Ref), not the route, package or protocol, so plugboard cannot ask which route a model uses. The gate is replaysSignedThinking(): provider `anthropic`, or provider `github-copilot` with an id starting `claude-`. Copilot's chat-completions and responses converters read only the copilot providerOptions and skip reasoning without an item id, so an anthropic-keyed signature is not sent on those routes even if a Claude model were served there. Other Copilot models stay out.

Rejected: an explicit list of Copilot Claude model ids (it goes stale with each new model); exposing the route on the hook event (needs an OpenCode change, out of scope here).

Validation: typecheck; bun test 2675 pass, 0 fail (live tests skipped); coverage ratchet raised test/session floor 351 to 353; mutations 88 of 88 killed, with two new P386 entries. Live, on an isolated server built from this branch, github-copilot/claude-haiku-5.5, a two-turn thinking plus record_answer tool round trip: turn 1 returns a signed thinking block (signature 932 bytes); turn 2 with the real signature returns 200; the same history with a forged same-length signature returns 400 from the provider; a control with thinking stripped returns 200. The same script on main (old gate) returns 200 for the forged signature, so the difference is the gate.

Closes #386

#### Docs

**docs(config): state that apps.<name>.maxN must not exceed maxN** ([`e6f7017`](https://github.com/jjjermiah/opencode-plugboard/commit/e6f7017bd1ecbba98eec4b758ea44ad9173c9e5e))

The two maxN rows said the per-app cap cannot be higher than the global one, but not what happens when it is. Source: parseApps in src/config.ts checks apps.<name>.maxN with positiveInt against the global maxN as the upper bound, so a larger per-app value throws while the options load and the plugin stops. Both rows now say so: the global row names the per-app rule, and the per-app row says it is a load error. The advice for letting one app take a larger n (raise the global maxN, then lower it for the other apps) is unchanged.

Rejected: clamping the per-app value to the global one. The code already fails loudly at config time, and a silent clamp would hide a config mistake.

Docs only. No behaviour change.

#### Dependencies

**build(deps): support opencode 2.0.29** ([`17db836`](https://github.com/jjjermiah/opencode-plugboard/commit/17db83617f02ebaa0e0cbce9e749ecfdecaf2ce5))

OpenCode published @opencode/plugin 2.0.29. The bump pins it, pins the effect version it uses, and widens the peer ranges only where needed. Opened and checked by .github/workflows/host-bump.yml.

</details>
<!-- commit-detail:end -->

## [0.36.0] - 2026-10-13: Show Your Work

**Full diff:** [v0.35.0...v0.36.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.35.0...v0.36.0)

### Added

- **Reasoning output, opt-in** ([#375](https://github.com/jjjermiah/opencode-plugboard/issues/375), since 0.36.0). Plugboard dropped the model's reasoning on Chat Completions and Responses. Option `reasoningOutput: true` returns it: `reasoning_content` and `reasoning` on Chat Completions deltas and messages (both, because clients split between the two names), and a `reasoning` output item with a `summary_text` part on Responses. Off by default, so existing clients see the same bytes. Per app, `apps.<name>.reasoningOutput` overrides the global switch in either direction. Structured output never carries reasoning, because its content is the answer. Checked with the option on against a scripted plugboard: openai-node and openai-python both read Chat Completions and Responses bodies and streams without error. Sending both chat names doubles the reasoning bytes, and a client that concatenates both shows the text twice; the docs say so.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (3 commits)</summary>

#### Features

**feat(openai): return reasoning on Chat Completions and Responses, opt-in** ([`af38b1a`](https://github.com/jjjermiah/opencode-plugboard/commit/af38b1aacc77f53bb5783fe35e51203226a7da0f))

Plugboard dropped the model's reasoning on Chat Completions and Responses, so a client that shows thinking got nothing. This adds the option `reasoningOutput` (default false, since 0.34.0) that returns it.

What it does when on:
- Chat Completions: `reasoning_content` and `reasoning` on each stream delta and on the final message, both with the same text. Clients split between the two names (DeepSeek and LiteLLM read `reasoning_content`; vLLM and OpenRouter read `reasoning`), and vLLM's docs warn that a client reading the wrong name silently gets nothing.
- Responses: one `reasoning` output item per run of reasoning, with one `summary_text` part, placed before the message or tool call. Streamed as `response.reasoning_summary_part.*` and `response.reasoning_summary_text.*` events, the shape the OpenAI spec and openai-agents use.
- Structured output (json_schema) never carries reasoning: its content is the answer's arguments.

Why opt-in and not on by default:
- The field name is not settled across clients, so a default-on change would add fields existing clients do not expect, for every app at once.
- Off keeps the bytes identical, so the scripted example transcripts did not change (`git diff --exit-code examples/` is clean; the scripted model emits no reasoning, so the transcripts could not change either way).

Checked against the official SDKs with the option on, against a scripted plugboard: openai-node (chat JSON and stream, responses JSON and stream) and openai-python (same paths) both read the responses without error. The extra fields land in the SDK's extra data, not in a typed field.

Rejected:
- Emitting reasoning_details (OpenRouter's structured form): only some models have it, and it needs replay rules not in scope here.
- Accepting reasoning items as replay input: already done (they were accepted and dropped). Chat assistant reasoning_content is ignored too.

Validation: typecheck clean; bun test 2650 pass, 0 fail, 126 skipped (live); coverage floors ratcheted (test-count-floors.json); manifest, pack smoke and docs build pass; examples scripted run exits 0 with no transcript diff; mutations 83 of 83 killed (new entry reasoning-output-off-still-returned).

Not verified: the live dev server runs main, so the option is checked only against the scripted fake and the loopback tests until this merges.

Refs #375

**feat(openai): per-app reasoningOutput and the review fixes for reasoning output** ([`d078de7`](https://github.com/jjjermiah/opencode-plugboard/commit/d078de76f01349f49433fb0e2475b9b4863fb11a))

Review of #384 asked for five changes and a few corrections. This commit makes them.

Per app: `apps.<name>.reasoningOutput` overrides the global switch. The app's value wins when set, in both directions, so an app can turn reasoning off while the global switch is on, or on while it is off (the same rule as history.hidden). The route resolves it with `reasoningOutputFor`, because the request decoders do not know the app. Covered by config tests and by HTTP tests on Chat Completions and Responses.

Tests added:
- n: 2 with reasoning, JSON and SSE: each choice keeps its own reasoning.
- Responses: a returned rs_ item sent back as item_reference is accepted, and its reasoning is not replayed to the model.
- Chat SSE: reasoning then a tool call (reasoning first, tool_calls finish); reasoning then a stop sequence (cut only where the text ends with it); held back text is flushed before reasoning arrives.
- Mutation entry reasoning-output-off-still-returned-responses for the Responses guard (the Chat entry already covered the JSON guard).

Behaviour: a Responses reasoning item cut short by a failure closes with status `incomplete`, not `completed`.

Docs: the Reasoning output section moved below the apps.<name>.model paragraph, so it no longer splits Models. It now says that sending both chat names doubles the reasoning bytes, that a client concatenating both fields shows the text twice, and that the Responses text is the provider's reasoning rather than a generated summary, with the item present whether or not reasoning.summary was set. The config row says Chat Completions and Responses.

CHANGELOG: the SDK line now says what was run. openai-node and openai-python were run with the option on against a scripted plugboard (chat JSON and stream, Responses JSON and stream); both read the bodies and streams without error. The earlier wording said the SDKs were not tested.

Validation: typecheck clean; bun test 2786 tests, 0 fail, 126 skipped (live); coverage ratchet passes (floors raised in .github/floors/test-count-floors.json); manifest, pack smoke and docs build pass; examples scripted run exits 0 with no transcript diff; mutations 84 of 84 killed.

Not verified: the live dev server runs main and has the option off, so the live check happens after merge, with reasoningOutput set in a config.

Refs #375

#### Docs

**docs(configuration): date the /v1/models fields to 0.35.0** ([`8cdd218`](https://github.com/jjjermiah/opencode-plugboard/commit/8cdd218a5aa96d403cf60969c3cd5eb96dbff8bc))

The configuration page said the context_length and pricing fields on /v1/models arrived in 0.34.0. They were merged after the 0.34.0 release was cut and shipped in 0.35.0, as the 0.35.0 changelog section says.

Refs #376

</details>
<!-- commit-detail:end -->

## [0.35.0] - 2026-10-13: Know Every Model

**Full diff:** [v0.34.0...v0.35.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.34.0...v0.35.0)

### Added

- **`/v1/models` carries `context_length`, `max_output_tokens` and `pricing`, and a generator writes OpenCode's `models` block** ([#376](https://github.com/jjjermiah/opencode-plugboard/issues/376), since 0.35.0). Each entry (and `GET /v1/models/{id}`) now has `context_length` and `pricing` under OpenRouter's names, so clients that read OpenRouter's list can read these too: `pricing` holds `prompt` and `completion` as USD-per-token decimal strings, plus `input_cache_read` and `input_cache_write` when the catalog reports them. `max_output_tokens` is plugboard's name for the output cap; OpenRouter puts that cap at `top_provider.max_completion_tokens`, which plugboard does not send. Context tiers are not in `pricing`; they stay in `plugboard.cost`. A fact the catalog does not know is left out, never zero. `bun .github/scripts/opencode-models.ts <hub>` turns a hub's `/v1/models` into an OpenCode client `models` block with `limit` and `cost`, so a custom provider stops getting OpenCode's 200k/32k default and zero cost.
- **Setting up OpenCode as a client of plugboard** ([#373](https://github.com/jjjermiah/opencode-plugboard/issues/373)). [docs/clients/opencode.md](docs/clients/opencode.md) has a custom OpenAI-compatible provider and the built-in Anthropic provider pointed at a hub, verified with OpenCode 2.0.27 on both: answers, a tool round trip, and the `maxTools` 400.

### Changed

- **Unknown cache prices are left out of `/v1/models`, not reported as zero** ([#376](https://github.com/jjjermiah/opencode-plugboard/issues/376), since 0.35.0). A catalog model with no cache price used to list `cache: { read: 0, write: 0 }` under `plugboard.cost`. It now omits the fields it does not know. The usage estimate still prices an unknown cache read or write at zero, as before, so `/plugboard/usage` costs do not change.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (2 commits)</summary>

#### Features

**feat(openai): add context_length and pricing to /v1/models, plus the opencode page** ([`1ae7695`](https://github.com/jjjermiah/opencode-plugboard/commit/1ae7695111c7450e826fc4b29808b4e6ae5807b9))

This commit holds all of #376 and the #373 client page. Earlier commits on this branch carried the page only, and the #376 code in the first commit shows up here, so this message describes the whole change.

#376: each /v1/models entry, and GET /v1/models/{id}, carries context_length and pricing under OpenRouter's names, plus max_output_tokens. pricing holds prompt and completion as USD-per-token decimal strings, and input_cache_read and input_cache_write when the catalog reports them. max_output_tokens is plugboard's name for the output cap; OpenRouter puts that cap at top_provider.max_completion_tokens, which plugboard does not send. Context tiers stay in plugboard.cost; pricing is the base entry only.

.github/scripts/opencode-models.ts turns a hub's /v1/models into an OpenCode models block with limit and cost. It skips ids with a #variant suffix, because OpenCode reads provider/model#variant as the base model plus a variant. It keeps limit.input.

Decisions:
- A fact the catalog does not know is omitted, never zero. Cache prices were coerced to 0 in host.ts; they are optional in CatalogCost now. plugboard.cost.cache omits unknown read and write. The usage estimate still prices an unknown cache at 0, so /plugboard/usage does not move.
- Prices print as plain decimals with no exponent. Numbers are rounded to 13 significant digits first, because float division leaves noise past the 16th digit (1e-13 came out as 9.9999...e-14).
- The #373 page writes OpenCode's `providers` key. The first draft wrote `provider`, which OpenCode v2 ignores, and that caused the failed checks.
- The page states 12 built-in tools, and that maxTools is reached only when a server sets codemode: false (MCP tools go through Code Mode by default).

Validation (branch merged with origin/main, no conflicts):
- bun run typecheck: clean
- bun test: 2635 pass, 0 fail
- coverage floors met, test-count floors raised and committed
- coverage-manifest: 0 gaps; check-pack and smoke-pack ok
- bun run docs:build: ok; scripted examples leave no diff
- Live, OpenCode 2.0.27, scratch HOME, opencode run --standalone, dev server 127.0.0.1:4010: anthropic/fast and plugboard/fast both answered pong; the reviewer's tool prompt, the 72-tool maxTools 400 and the 170-entry generated block were run on the PR worktree (see the page).
- mutations not run: no mutation entry pins the changed text

Not verified: opencode attach.

Closes #376
Closes #373

#### Docs

**docs(clients): add the opencode client page** ([`8afc736`](https://github.com/jjjermiah/opencode-plugboard/commit/8afc73630c0e51f48334044a49e70f88ad2d526f))

Adds docs/clients/opencode.md, the page #373 asked for: an openai-compatible block and an Anthropic block for OpenCode's custom and built-in providers, maxTools guidance for MCP-heavy clients, declaring limit and cost per model (with the generator from #376), the promptCache anchor on the hub, the Anthropic dialect for reasoning, and opencode attach as the alternative.

Decision: the blocks follow OpenCode v2.0.27's config schema. The issue body wrote options.baseURL; the schema uses settings.baseURL, so the page uses settings.

Findings from the live run (not passed; the page says so):
- @ai-sdk/openai-compatible is not in OpenCode v2.0.26's native provider map. A v2.0.26 client fails with "Unsupported package for <model>".
- The built-in anthropic provider returned "invalid x-api-key" on v2.0.26 with ANTHROPIC_API_KEY set, with and without settings.apiKey, and with ANTHROPIC_BASE_URL. The hub returns 200 pong to the same key sent as x-api-key with curl. The cause is not found.
- The tool-using prompt and the maxTools 400 check were not run.

Rejected: marking the page verified. The issue asks for a passing run, and none passed.

Validation:
- bun run docs:build: ok
- bun test: 2633 pass, 0 fail
- scratch OpenCode client home deleted after the run

Refs #373

</details>
<!-- commit-detail:end -->

## [0.34.0] - 2026-10-13: Thinking Carries Over

**Full diff:** [v0.33.0...v0.34.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.33.0...v0.34.0)

### Added

- **Go, .NET, Langfuse and smolagents examples run in CI against the scripted fake** ([#362](https://github.com/jjjermiah/opencode-plugboard/issues/362)). Until now these four clients were checked only by hand against the dev server. Each example now has a runner, so `run.ts all --target scripted` covers it and CI fails on a stale or non-deterministic run. The Go and .NET runners print raw observations, and a shared relay applies the same checks as the Python and TypeScript runners. The `examples` job installs Go 1.27.2 and the .NET SDK 8.0.423 for them. go-openai and openai-dotnet pass text, stream and a tool round trip. Langfuse passes the same three. smolagents passes text. Its stream and tool round trip are recorded as gaps, not passes: smolagents' stream does not return the finish reason, and the scripted fake answers a tool turn only after a `tool`-role message.

- **Signed reasoning replays to Anthropic models across turns** ([#374](https://github.com/jjjermiah/opencode-plugboard/issues/374), since 0.34.0). A client's `thinking` block with its `signature`, and each `redacted_thinking` block, now reach an `anthropic` model in the history. Until now plugboard dropped every thinking block, so the model lost its earlier reasoning on the next turn. Why: with the reasoning in context, the model keeps thinking across turns. Measured on `claude-opus-4-5`: turn 2 thought again only when the replayed block was sent. Dropping the block does not make Anthropic reject the request, since plugboard's host sends the interleaved-thinking beta. A forged signature gets a provider 400, so the provider checks it. Unsigned thinking is still dropped, and every other model still gets the history without reasoning, because a signature is only valid for the provider that issued it. Plugboard does not return `redacted_thinking` yet, so only a block the client got from elsewhere replays.

### Changed

- **Prompt-cache reads by provider, measured again** ([#277](https://github.com/jjjermiah/opencode-plugboard/issues/277)). The [prompt-cache affinity](docs/configuration.md#prompt-cache-affinity) section has a table for ChatGPT, GLM and Copilot Gemini: what OpenCode sends, what each provider documents, and cached tokens with and without `anchor`. `anchor` helped ChatGPT in both runs. GLM and Copilot Gemini showed no cache reads with `anchor` in this run. Their causes are not established.
- The client checks moved from `compat/` into `examples/`: each client has a runnable example with a scripted run that CI keeps current, and its dated live runs. The client pages now import their code and results from there. `compat/` is gone: its Python checks are examples too (`examples/aider`, `dspy`, `instructor`, `litellm-client` and `openai-agents`), each with a runner, a lockfile and a scripted run that CI keeps current. Why: the old kit's code and results could drift apart, and the results were prose nobody could diff. ([#174](https://github.com/jjjermiah/opencode-plugboard/issues/174), [#186](https://github.com/jjjermiah/opencode-plugboard/issues/186), [#187](https://github.com/jjjermiah/opencode-plugboard/issues/187), [#366](https://github.com/jjjermiah/opencode-plugboard/issues/366))

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (31 commits)</summary>

#### Features

**feat(examples): finish the examples docs and retire compat/ (#186, #187, #366)** ([`27f71e6`](https://github.com/jjjermiah/opencode-plugboard/commit/27f71e666c51e8dea6b3ef8070433499eae42e8a))

What changed
- The five remaining Python client checks are harness examples: aider, dspy, instructor, litellm-client and openai-agents. Each has a pyproject.toml with exact pins, a uv.lock, a runner (run.py, or run.sh for aider), scenario files with snippet regions, and a committed runs/scripted/ that run.ts writes and CI keeps current. Their 2026-10-12 live records were already migrated byte-identical in #367.
- The scripted plugboard answers DSPy's [[ ## answer ## ]] field format (only requests with those markers take this path, so the other examples' transcripts are unchanged).
- The five client pages (dspy, instructor, litellm-client, openai-agents, aider) are snippet includes. Their Tested lines point at the live record.
- compat/ is deleted, with test/support/fake-server.ts (its only caller was the compat runner). package.json loses compat:python. CI loses the compat job, and ci-passed no longer needs it. The shell syntax check moved into the examples job. Dependabot: /compat/py is replaced by one uv entry for each new example.
- docs: the examples overview (docs/examples.md) and an ExampleResult component on each client page. Both read docs/.vitepress/examples.json, which `bun .github/scripts/examples-index.ts --json` writes before every docs build (docs:build and docs:dev). A VitePress data loader was tried first; it put node:fs into the browser bundle, so the build writes plain JSON instead. The reader (docs/.vitepress/examples-model.ts) is shared with the generator, so the README table and the site show the same verdicts. The sidebar has an Examples overview entry.
- examples/README.md: the status tables are generated between examples-index markers. examples/_harness/index.json holds the Shows text per example. examples-index.ts --check fails when the table is stale, when an example has no Shows text, or when a <<< import in docs/ names a missing file or region. CI runs --check in the examples job.
- Docs and root files no longer name compat/ (AGENTS.md, STRUCTURE.md, docs/compatibility.md, test/README.md, bunfig.toml comment, CHANGELOG).

Decisions
- Scenario mapping. Each runner covers the scenarios its record covered, with the same prompts as scenarios.json. Structured output (S6) uses the scenario prompt and a Meal model, so the scripted answers match; the old "What is 6 times 7?" prompts are gone. Scenarios outside the record are n/a with a reason, not silently dropped.
- finish_reason and usage. DSPy 3.4 and the Agents SDK do not expose the wire finish_reason. DSPy reads its normalised response; the Agents SDK maps a function call in the last output to tool_calls and otherwise to stop, and the example says so. Aider sees only its answer, so its one check is "answer contains pong"; the transcript keeps the wire fields.
- Aider's message is the S1 prompt, not the old edit request, because the scripted model answers the scenario prompts only. A file edit is not checked by the example; the docs say so.
- Client helpers in each example are defined outside the snippet regions they use. Each page lists the names a snippet uses.
- The examples job timeout is now 30 minutes: the Python examples resolve and install their locked environments on first run.

Rejected
- A VitePress .data.ts loader imported by the components (see above).
- Keeping compat/py for the Agents and LiteLLM pins. Each example pins its own openai version, so no shared environment is needed.

Validation
- bun run typecheck, bun test (2704 pass, 0 fail), coverage-manifest, check-pack, smoke-pack, bun run docs:build: all pass.
- bun .github/scripts/examples-index.ts --check: current; 38 examples; all <<< imports in docs/ resolve.
- bun examples/_harness/check-regions.ts: pass.
- bun examples/_harness/run.ts all --target scripted run twice: every file under runs/scripted has the same sha256 both times.
- The #187 acceptance demo is recorded on the PR, separately.

Closes #186
Closes #187
Closes #366

**feat(examples): unobserved checks keyed by scenario id, in TypeScript and Python** ([`dfc19d4`](https://github.com/jjjermiah/opencode-plugboard/commit/dfc19d4f37fa187cb9ef0e8a2a17e7a2457dc45b))

RunOptions.unobserved only worked per variant, and the Python helpers had no unobserved at all. smolagents' S3 needs one: generate_stream does not return finish_reason, so that check cannot be observed. It was recorded as a gap, which reads as a fault, and the row never passed.

An unobserved entry may now be keyed by scenario id alone, which covers every model and variant of the scenario, or by id|variant as before. A check left out of its row is named in the note. An entry that names no planned scenario or check, or that would drop every check of its row, is refused before anything runs. The Python helpers, py/harness.py, get the same rules, and smolagents uses them for S3.

smolagents S3 now passes three of three checks, and its note says which check it does not make. Its S2 row keeps its gap: the final_answer turn finishes with tool_calls by design, so that check describes a different protocol and is not an unobservable check.

Tests: test/unit/examples-unobserved.test.ts covers the id-only entry, the missing entry, and the two refusals and the unplanned scenario. The Python path is exercised by the smolagents scripted run.

Refs #370

**feat(examples): the relay scores rows with the runAll rule, gaps and n/a included** ([`b4debc4`](https://github.com/jjjermiah/opencode-plugboard/commit/b4debc4383bd77a587ab35eac6767eed2ff40fd9))

The Go and .NET relay scored rows with its own copy of the status rule. It had no known gaps, no n/a scenarios and no unobserved checks, so a Go or .NET runner could not state a limit the way a TypeScript or Python runner can. The two paths could also drift.

The rule now lives in one place: scoreRow in ts/harness.ts. runAll and the relay both call it. The relay's plan line carries the runner's gaps, na, unobserved and variants, with the same meaning as RunOptions. The relay checks them against the planned scenarios with checkUnobserved, which is also exported now, and it emits the n/a rows itself, one per model and variant of each declared scenario. A runner still cannot print a result line. Only the plan line is trusted to declare limits, and the checks still decide every verdict.

runAll's output is unchanged: openai-js regenerates byte-identical.

Tests: test/unit/examples-relay.test.ts adds parity cases for a declared gap, declared n/a rows, an unobserved check with its note, and a refused unobserved entry that prints nothing.

Refs #370

**feat(anthropic): replay signed thinking to Anthropic models across turns** ([`d7e6074`](https://github.com/jjjermiah/opencode-plugboard/commit/d7e6074256347d8988e810d4f812d83a1e44d5dc))

Plugboard dropped every thinking and redacted_thinking block a client sent. A tool-use turn after thinking then failed Anthropic's rule that thinking comes before tool_use, because the reasoning was gone.

What changed:
- The neutral contract has a `reasoning` part (text, signature, redactedData). The Messages decoder keeps a `thinking` block that has a signature, and every `redacted_thinking` block. An unsigned thinking block is still dropped, because its empty signature is rejected.
- The context hook replays reasoning parts as host reasoning parts with providerMetadata.anthropic, which the host's Anthropic protocol lowers back to signed thinking and redacted_thinking blocks.
- Replay is gated on the request's model being provider `anthropic`. A signature is proof issued by one provider and is sent to no other. Other providers get the history with reasoning removed, as before.
- The stored transcript and token estimate handle the new part.

Decisions:
- Replay goes through the context hook, not the stored transcript. The stored transcript is text, so structured replay needs the hook.
- The gate reads `model.providerID` from the hook event. The event type gets an optional `model`, so a host that omits it replays nothing.

Rejected:
- Replaying unsigned thinking with an empty signature. Anthropic rejects it, and the decoder already dropped it for that reason.

Validation: typecheck, full bun test (2631 pass), coverage gates (floors raised to current counts), coverage manifest, pack and smoke pack, docs build, scripted examples (no diff), mutations (84 of 84 killed, two new #374 entries).

Not verified: a live Anthropic round trip. The dev server runs main, not this branch, so the live check runs after merge.

Refs #374

#### Fixes

**fix(examples): refuse runner verdicts in the relay and pin the .NET SDK** ([`c1922d6`](https://github.com/jjjermiah/opencode-plugboard/commit/c1922d61c1a5a4405e30d80a2294bda87d631cc2))

The relay passed any line that was not an observation through unchanged, so a runner could print a result line that said pass with no checks. It now accepts only plan, client and done from a runner, and it refuses the whole input before printing anything when another kind appears. Two tests cover a forged result line, one before done and one after it.

CI built the .NET runner with whichever SDK dotnet run found, not 8.0.423. examples/openai-dotnet/global.json now pins 8.0.423 with rollForward latestFeature, setup-dotnet installs from that file, and the job prints dotnet --version from the example directory. The Go setup now caches against examples/go-openai/go.sum, so setup-go no longer warns that there is no go.mod at the root. The job timeout goes back to 10 minutes; the last run took 86 seconds.

The copyable openai-dotnet example now needs an 8.0.4xx SDK. A reader with only a newer SDK gets an SDK-not-found error from global.json. That is the cost of one pinned version, and it is stated in the PR.

Refs #362

**fix(examples): pin the .NET SDK exactly, not to a feature band** ([`5840420`](https://github.com/jjjermiah/opencode-plugboard/commit/5840420513cbd4d89c2311f8a1960136509e8a8c))

The previous global.json used rollForward latestFeature. The CI check printed dotnet --version as 8.0.425, not 8.0.423: the runner image already has 8.0.425, and latestFeature resolves to the newest 8.0.4xx at or above the pin. The pin was not exact, so the runner did not build with the SDK the docs and CHANGELOG name.

global.json now uses rollForward disable, so only SDK 8.0.423 resolves. The cost is for readers: anyone on another 8.0.x SDK gets an SDK-not-found error from global.json and must install 8.0.423. That is the trade for a CI build that is reproducible. The local SDK is 8.0.423, and the four scripted runs are byte-identical after the change.

Refs #362

**fix(examples): pin aider's edit format so its scripted run is the same on every host** ([`e94c237`](https://github.com/jjjermiah/opencode-plugboard/commit/e94c2373c7dc50eb41df919bd52c24186eb37e26))

The examples job failed on the first CI run of #371. The file examples/aider/runs/scripted/transcripts/S1.anthropic-claude-haiku-4-5.json differed from a fresh run in CI. Aider chooses its edit format (editblock or whole) from model metadata, and the metadata it reads differs by host. The chosen format changes the system prompt the transcript records.

What changed
- examples/aider/run.sh: --edit-format whole on every call, so the prompt does not depend on the model metadata. LITELLM_LOCAL_MODEL_COST_MAP=True, so LiteLLM uses its bundled price map and does not fetch one from GitHub.
- examples/aider/runs/scripted: the anthropic transcript is regenerated (the other transcripts and the summary are unchanged).

Decisions
- whole, not editblock: the scripted model answers in plain text and the example checks only the answer, so the simpler format is enough. editblock would need the model to answer in SEARCH/REPLACE blocks, which the scripted model does not do.
- Pinning the edit format in run.sh rather than in a .aider.conf.yml in the temp repo: the runner creates the repo, so the flag is the one place it is set.

Validation
- bun examples/_harness/run.ts aider --target scripted, run twice: every file under examples/aider/runs/scripted has the same sha256 both times.
- Closes nothing: part of #187, whose examples job this keeps green.

Refs #187

**fix(examples): address review of #371: one shell check, docs links, unit tests** ([`7fb91eb`](https://github.com/jjjermiah/opencode-plugboard/commit/7fb91ebf2438eeb69188948ce7faba25646d2de0))

Review of #371 at ab26177. Refs #186, #187, #366.

What changed
- ci.yml: the "Syntax-check shell scripts" step was left in the host job when the compat job was removed, so it ran three times. The examples job runs it once; the step is gone from host. Examples job timeout: 15 minutes (a cold run takes under two).
- docs/releasing.md: the CI gate list no longer names "compat kit checks" (job gone), and the required-check replacement list drops "Compat kit checks". The release order names examples.
- docs/examples.md: the closing link goes to examples/README.md without the historical-records anchor; the rerun instructions are at the top of that file.
- ExampleResult.vue: the plugboard version and commit print as plain text, not inside markdown backticks (they showed literally on the built page). The stale comment names examples.json.
- test/unit/examples-scripted-model.test.ts: DSPy branch cases (S1 and S6 answers, the reasoning prefix, an unknown DSPy prompt gets the error, plain S1 unchanged).
- test/unit/examples-index.test.ts (new): renderTable rows and the no-Shows-text marker; snippet import checks (resolves, renamed region, missing file); readExamples (directories only, the newest live run by date then plugboard version, the scripted run, empty example).

Decisions
- examples/README.md:66 and :68 keep their compat/ paths. They are the migration notes that say where a removed script is (git show 3d3735c:<path>). Rewording them would lose the path. The PR body states that the acceptance greps match them on purpose.
- The generated README table does not check scenario statuses. The table prints only the verdict; scenario rows show on the client pages, from the same summary. The PR body says so.

Validation
- bun test test/unit/examples-index.test.ts test/unit/examples-scripted-model.test.ts: 20 pass.
- bun run typecheck, bun test, coverage-manifest, check-pack, docs:build, examples-index --check and check-regions: run after the merge (see the merge commit).

**fix(examples): decide a stream's done from the wire, not the runner's flag** ([`f0b6f4a`](https://github.com/jjjermiah/opencode-plugboard/commit/f0b6f4a2aea872551ace1972cde2aaeca145794b))

Every runner set done to true after its stream loop, so the S3 check "stream ended with [DONE]" could not fail. A stream cut off mid-answer passed. The capture proxy already has the bytes, so run.ts now decides the check from the wire: a chat completions stream must end with data: [DONE], a Responses stream with response.completed, a Messages stream with message_stop, and a Gemini stream with a finishReason. A row whose stream did not end normally is downgraded from pass to fail, and its done check is replaced by the harness's answer. The runners still send done, but the harness no longer uses it.

The check is renamed "stream ended normally", since it now covers four protocols. Eighteen summary.json files change name only. No row changed status, so every existing stream ended on the wire the way its runner claimed.

Tests: test/unit/examples-stream-end.test.ts covers a complete and a truncated stream for each protocol, and the rule that a row needs at least one stream. The downgrade itself is wired into writeExample and is exercised by the scripted run, not by a unit test.

Refs #370

**fix(examples): answer smolagents' tool observation with final_answer** ([`ac4ddf3`](https://github.com/jjjermiah/opencode-plugboard/commit/ac4ddf38ed99962d97a4da6fed28aea57eb8e413))

smolagents sends a tool result as user text ("Observation:") and ends a run only when the model calls final_answer. The scripted fake answered the tool turn only after a tool-role message, so the smolagents S2 run looped to max_steps and its final answer never came back. The fake now answers an Observation: turn with a final_answer call when the request offers that tool. Requests without the tool keep the old path, so other clients' runs are unchanged.

smolagents S2 now passes five of six checks: the tool call, its name, city and id, the first finish reason, and the final answer. The sixth, "turn 2 finish_reason is stop", stays a gap. The final_answer turn finishes with tool_calls by design, so the check does not describe smolagents' protocol. Calling that unobserved would hide a real difference, so the row keeps its gap and the note says why.

Only the smolagents S2 transcripts change (three models). Every other run is byte-identical.

Tests: test/unit/examples-scripted-model.test.ts covers the final_answer answer and the unchanged path without the tool.

Refs #370

**fix(examples): stop the aider runner opening a browser page** ([`aa1ae23`](https://github.com/jjjermiah/opencode-plugboard/commit/aa1ae2310bae45cb298a7ce14dd7fcc7f7367c86))

Every scripted or live run of the Aider example starts Aider in a fresh uv environment, so Aider treats it as the first run of its version and offers to open its release notes. The runner passes --yes-always, which accepts that offer, so each run opened a browser tab on the machine running it. Lanes regenerate the scripted runs often, so the owner's browser kept opening the Aider page.

The runner now passes --no-show-release-notes, which removes the offer, and exports BROWSER=true, so any other webbrowser.open Aider might reach (an "open URL for more info?" prompt under --yes-always) runs `true` instead of a browser. Nothing Aider sends to plugboard changes, so the scripted transcripts are unchanged.

Validation: bash -n on run.sh; the aider scripted run regenerated with no diff under examples/aider/runs and no browser tab opened.

**fix(examples): declare the scenario checks in run.ts's spec type** ([`11a2bc9`](https://github.com/jjjermiah/opencode-plugboard/commit/11a2bc949496bdbc266cb6301abfa86316d62b0e))

Item 1 (f0b6f4a) looked up a scenario's done check through the spec type, which did not declare checks. The examples typecheck (tsc -p examples/_harness) failed with an implicit any, so that commit was not typecheck-clean. ScenarioSpec now declares checks, and the typecheck passes.

Refs #370

**fix(examples): harden the harness checks the PR review flagged** ([`d9598cd`](https://github.com/jjjermiah/opencode-plugboard/commit/d9598cd37d6e90a440255739d9c20761564d5f75))

Review of #379 found five places where a check accepted something it should refuse. Each is fixed, and each has a test.

- A stream counts as ended only once its last SSE event's blank line has arrived. A capture cut inside "data: [DONE]" or a final event no longer passes. The WHATWG SSE rule dispatches an event at its blank line.
- Gemini's end is read from the last chunk's candidate finishReason, not by searching the payload text. A text part that says "finishReason" no longer passes.
- A row that failed only on the runner's own done flag becomes a pass when the wire shows a complete stream, so the wire decides. A pass whose stream did not end is still a fail.
- An unobserved key with more than one "|" is refused in TypeScript, and an empty variant ("S1|") is refused in Python. Before, the extra part was dropped and the exclusion was silently ignored.
- The relay refuses an observation for a scenario the plan does not run, including an n/a one, and refuses an error that is not text. Before, a malformed error was scored as a success.

The committed scripted runs are byte-identical after the change, so no existing row was downgraded by the stricter rules. The unit test floor moves with the new tests.

Refs #370

**fix(examples): a failed chat stream is not a normal end; pin aider to C.UTF-8** ([`41d8f8e`](https://github.com/jjjermiah/opencode-plugboard/commit/41d8f8e13f13043f9008450744b57835805d4f37))

The stream check accepted a chat completions stream that ended with an error frame and then [DONE]. That is what plugboard sends when a committed stream fails (src/openai/fanout.ts), so a late upstream failure could pass S3 and, with the done-only lift, turn a failing row into a pass. A chat or legacy completions stream now counts as ended only when its last frame is [DONE] and no data frame has a top-level error. A text delta or a non-JSON line does not count as an error. The Responses, Messages and Gemini checks already failed on their own error frames, and the doc comment now says response.incomplete does not count as ended.

"stream ended normally" can no longer be named in unobserved. The stream check is decided from the captured wire, so a runner cannot leave it out. TypeScript and Python both refuse it.

The aider runner pins LANG and LC_ALL to C.UTF-8. en_US.UTF-8 adds a "Reply in English." line to aider's prompt, which changes the committed transcripts, so C.UTF-8 is the pin. The comment says CI is the reference and that a host without C.UTF-8 fails the drift check.

The relay and README now say that the plan line's limits are trusted with the same reach as the TypeScript and Python options.

Tests: examples-stream-end covers the real failed-stream body for chat and legacy completions, a successful stream, a quoted "error" in a delta, and a non-JSON line. examples-unobserved covers refusing the stream check.

Refs #370

**fix(anthropic): state the measured reason for replaying signed thinking** ([`f0c1fa2`](https://github.com/jjjermiah/opencode-plugboard/commit/f0c1fa284aecde16b337309b17c3b79f6ab87fcd))

The first commit said Anthropic rejects a tool-use turn whose thinking is missing or unsigned. Live runs did not show that. The host always sends the interleaved-thinking beta, and a turn-2 history with the thinking block stripped returned 200 on claude-haiku-5-5, claude-sonnet-4-6, claude-haiku-4-5 and claude-opus-4-5.

What was measured (isolated dev server, plugboard from this branch, OpenCode v2.0.27, non-stream, thinking enabled with budget 2048):
- claude-opus-4-5: with the signed thinking block replayed, turn 2 kept thinking (signature 472). With it stripped, turn 2 had no thinking.
- A replaced signature (same length, junk value) returns 400 from the provider. The real signature returns 200. So the replayed signature reaches the host request, and the provider checks it.
- A forged redacted_thinking data value returns 400, so the redacted block also reaches the request.
- An unsigned block (signature "") returns 200, because it is dropped.
- A non-anthropic model (opencode-go/glm-5.3-flash) and Copilot Claude get the history without reasoning and return 200.

What this change does, then: the signed block reaches an anthropic model, so the model keeps its earlier reasoning across turns. It is a quality gain, not the fix for a 400. The reason text in CHANGELOG.md and docs/messages.md is corrected to match.

Also in this commit:
- Docs: plugboard never emits redacted_thinking on a response (follow-up #385), so a client replays one only if it got it from elsewhere. Copilot Claude is not replayed yet (follow-up #386).
- Tests: a host event without a model replays no reasoning and does not throw; an omitted-thinking block (empty text, signature) is kept as a signed reasoning part.
- Coverage floor for test/session ratcheted from 350 to 351; test/unit is unchanged at 1313.

Validation: typecheck, bun test (2632 pass, 0 fail, 126 live skips), coverage gates with ratchet, coverage-manifest, check-pack and smoke-pack, docs build, scripted examples (no diff), mutations (84 of 84 killed).

Refs #374

#### Tests

**test(examples): run the Go, .NET, Langfuse and smolagents clients in scripted CI** ([`ebdefb1`](https://github.com/jjjermiah/opencode-plugboard/commit/ebdefb1fc6cd296569a37c870fe721f2387f0548))

Four clients were checked only by hand against the dev server (#234, #236, #240, #228). Their pages said there was no scripted test, and CI could not notice if one broke. The examples job now runs each of them against the scripted fake, the same way it runs the other example runners.

Each example gets a runner. Langfuse and smolagents are Python: a pyproject.toml and uv.lock, pinned as the docs record, like openai-python. Go and .NET keep their example program untouched and add a runner sub-program (examples/go-openai/runner, examples/openai-dotnet/runner), built with go run and dotnet run. Those two print raw observations, and examples/_harness/ts/relay.ts applies the checks from scenarios.json, so the check logic is not copied into each language. The .NET example csproj excludes runner/** so the example keeps one entry point.

On the fake, go-openai, openai-dotnet and Langfuse pass text, stream and tool round trip on every model the scenario lists. smolagents passes text. Its stream and tool round trip are gaps, not passes. generate_stream does not return finish_reason. The fake answers a tool turn only after a tool-role message, and smolagents sends the observation as user text, so the agent runs to max_steps. The gap notes say this, and so does docs/compatibility.md.

Decisions: the shared fake is not changed. It sits outside examples/<client>, and changing it would make the smolagents tool gap pass without fixing the client. Runtime versions are recorded by major version only (Go 1, .NET 8, Python 3). setup-go is pinned to Go 1.27.2 and setup-dotnet to 8.0.423, the versions the runners were checked against.

Refs #362

**test(session): pin the agent's system prompt in the stored session prompt** ([`1d38c93`](https://github.com/jjjermiah/opencode-plugboard/commit/1d38c9342670adb2b7d8e5029dcf727f7b8a088e))

The session test for an `agent/<name>` request now reads the prompt the session receives (the text passed to `port.prompt`, rendered by `renderTranscript`). It asserts the transcript opens with `## system` and the agent's prompt, and that the caller's system text never appears in it. The Agents section of docs/configuration.md states the same shape and says it was checked live.

Issue #6 asked whether an agent's own persona is applied, not only whether the session is created as that agent. The caller-side tests already checked the session's agent name and the replaced `system` array, but nothing pinned the text the host receives, so a regression in the transcript could pass them.

Live proof on the isolated dev server (main, with a throwaway agent whose prompt is "Always answer in exactly three words, the last being BANANA." and a caller that sends "CALLER SYSTEM: reply in German."):
- `/v1/chat/completions` answered "Yellow ripe BANANA".
- `/v1/messages` answered "SUNNY RIPE BANANA".
- `/v1/responses` answered "It's a BANANA." (three words).
- Control, plain alias `fast`, same question: "The capital of France is Paris."
- OpenCode session via the dev API `/api/session/<id>/message`: agent `banana`, and the user text starts with "## system" then the agent's prompt, with no caller system text. Session permissions are `deny *` then the `plugboard_seed_*` allow.

No src change: the behaviour already held. Rejected: a live test in CI, because it needs a real model and key.

Validation: typecheck, bun test (2727 tests, 0 fail), coverage gates with ratchet (session and unit floors raised by the ratchet), coverage-manifest, check-pack, smoke-pack, docs:build, and the examples harness scripted with no diff under examples/.

Refs #6

#### Docs

**docs(examples): build client pages from examples/ snippets** ([`f85ad4d`](https://github.com/jjjermiah/opencode-plugboard/commit/f85ad4dc1635a601551a1b6413d9453fd6d88eeb))

Part of #174, step 1 of #186. Client pages showed code copied by hand from examples/ and a Tested line dated to older runs. Now the code is imported from the example's snippet region, and the Tested line links the newest live run in examples/<client>/runs/live/.

What changed
- docs/clients/{openai-python,openai-js,vercel-ai-sdk,langchain-python, langchain-js,pydantic-ai}.md: code blocks are <<< imports of the snippet regions (langchain-python tools use snippet-tool and snippet-round-trip). Prose and gotchas are kept.
- docs/clients/{n8n,open-webui}.md: Tested line points at the newest live run (n8n b92fb6f, partial; open-webui 0cf8030, pass). open-webui shows docker-compose.yml, not a docker run copy, and the compat/ link now points at examples/open-webui/README.md.
- examples/open-webui/docker-compose.yml: a snippet region around the services and volumes, so the page can import it. No change to the file's content.

Decisions
- Setup lines for openai-python, openai-js and pydantic-ai stay as short hand-written blocks. Their examples build the client inside an indented __main__ block, and a region there would paste with indentation.
- Snippets that sit inside a function keep that indentation in the page. VitePress does not dedent regions. Fixing it needs a markdown plugin or moved regions, so it is a follow-up.
- langchain-python's Tested line uses the live run already committed (2026-10-13-c97ac66). The 2026-10-11 record is migrated in the cleanup step.

Rejected
- Rewriting every dated claim in the prose. Only the Tested line is refreshed here, so gotchas that mention older runs may still read as dated.

Validation
- bun run docs:build passes. Rendered client pages contain the region text and not the whole example file (no "S1, plain chat" header in the output).
- bun examples/_harness/run.ts all --target scripted leaves git diff examples/ clean.
- bun examples/_harness/check-regions.ts passes.

**docs(examples): index every example with its run status** ([`ab2cade`](https://github.com/jjjermiah/opencode-plugboard/commit/ab2cade9c852c252975730c66ac5c3cfbee5e7b3))

Part of #174, step 2 of #186. examples/README.md listed 33 directories, left out the six client examples that have runs, and kept a curl section that duplicated examples/curl/. Now the README has two status tables that cover every example directory: the harness examples with their scripted verdict and newest live run, and the rest as "not run" or docs-verified.

What changed
- examples/README.md: a short section on what runs/scripted and runs/live hold, and how to rerun one example or all of them. The status tables. The curl section links to examples/curl/ (its README and runs/), which replaces the hand-written curl list. The line that said examples are kept out of compat/ is gone with compat's README.

Decisions
- Hand-written tables, not a generator. The generator and its --check belong to the examples-index part of #186 and are not in this commit. A tree that adds an example or a run changes this file by hand until then.
- Verdicts are copied from each newest summary.json (scripted and live). The curl live run is listed as fail, which is what its record says.
- A run's date and commit are read from the directory name. Same-day runs of different commits are listed by the name the harness gave them.

Rejected
- Listing "Last run" from the directory sort alone. Same-day runs sort by sha, not by time, so the index names the run it shows.

Validation
- Every link in the tables resolves to a file in the tree (checked by listing each path with git ls-files).
- The tables cover every directory under examples/ except _harness, _shared, _tools and _release.

**docs(cache): table of provider cache reads with and without anchor affinity** ([`3a0d858`](https://github.com/jjjermiah/opencode-plugboard/commit/3a0d858cb6627e37e9ec75babfa59f67c753e2ea))

The report in #277 said there were no prompt-cache reads from ChatGPT, GLM and Copilot Gemini. Anchor affinity has shipped since, so this re-measures all three on the isolated dev server with promptCache off and anchor, and writes down what each provider's cache is driven by.

The change is a table in the prompt-cache affinity section of docs/configuration.md (what OpenCode sends, what each provider documents, cached tokens per run with and without anchor, and the likely reason), plus a CHANGELOG bullet under Unreleased. There is no code change, so no "since" marker.

The result is that anchor helps ChatGPT (3712 cached tokens on repeat runs) and changes nothing for GLM or Copilot Gemini. Plugboard sends no key that would change GLM, and Copilot Gemini's affinity header is the same in both arms.

Google documents a 4,096-token minimum for Gemini 3.8 Flash. The doc does not claim it explains the Gemini result, because a 5,103-token repeat still got no reads. The 2026-10-12 paragraph stays in place, with the new run beside it.

Changing plugboard's cache routing for GLM or Gemini was rejected. Neither has a plugboard-side key to fix, so a code change would be a guess.

Validation ran typecheck, bun test (2704 tests, 0 fail), the coverage gates, coverage-manifest, check-pack and smoke-pack, docs:build, and the scripted examples with git diff examples/ clean. The live measurements are in the PR.

Refs #277

**docs(examples): fix review findings on the client pages and the index** ([`79ef3f8`](https://github.com/jjjermiah/opencode-plugboard/commit/79ef3f8feb0c20652243c467af4fa9ccffafe77e))

Review of #367 at 5412c51 (follow-up commit, Refs #174, #186, #187).

Dead links and snippets
- examples/_release/release-candidate.md: three link targets now point at the moved records (langchain-python and vercel-ai-sdk 2026-10-11 REPORT.md) and at examples/open-webui/README.md (was ../docker/README.md). Only link targets change; the text is otherwise the same.
- The seven historical 2026-10-11 REPORT.md copies still link release-candidate.md by a relative path. They are not edited, because a live directory is never rewritten. examples/README.md has a "Historical records" section that maps the old path.
- examples/langchain-python/llm.py: the snippet region now wraps the whole chat_model function (it was inside the body, so the page showed a bare return). Comment-only change, scripted runs unchanged.
- docs/clients/langchain-python.md: the snippet's module-level names (os, NO_RETRIES) and the names used by the chat and tool snippets are stated.
- docs/clients/pydantic-ai.md: the setup block has the pydantic-ai and asyncio imports, and the page says the snippets are the body of an async function taking client and model.
- docs/clients/{openai-python,openai-js,vercel-ai-sdk,langchain-js}.md: each snippet names the variables and imports it uses that are not in the region (client, model, messages, TOOL, PROMPT, Meal, variant, wireFinish).
- docs/clients/pydantic-ai.md: the Tested line names the two run directories (2026-10-13-c97ac66 fail, 2026-10-13-c97ac66-2 pass) instead of "the earlier record".

Index and records
- examples/README.md: the five clients with a 2026-10-12 live record and no scripted run are marked "live record only (compat/py/clients)".
- examples/_harness/README.md: "Record-keeping" section restores the rules from the old compat/README.md (template pointer, superseded-note convention, no session chatter, captures are sensitive, sessions.py).

CI and config
- .github/workflows/docs.yml: examples/** added to the trigger paths, so an example change rebuilds the client pages.
- .github/dependabot.yml: the comment now says what is covered and what is not (the smoke projects, async-openai, compat/py-litellm). No new entries.

Validation
- check-regions, bun run docs:build and bun run typecheck pass.
- bun examples/_harness/run.ts all --target scripted leaves no change under examples/*/runs.

**docs(cache): table of provider cache reads with and without anchor affinity** ([`f4a9fc3`](https://github.com/jjjermiah/opencode-plugboard/commit/f4a9fc3ae8aa57743b0af53124d7f6bf71fbefc0))

The report in #277 said there were no prompt-cache reads from ChatGPT, GLM and Copilot Gemini. Anchor affinity has shipped since, so this re-measures all three on the isolated dev server with promptCache off and anchor, and records what each provider's cache is driven by.

The change is a table in the prompt-cache affinity section of docs/configuration.md (what OpenCode sends, what each provider documents, cached tokens per run with and without anchor, and the likely reason), plus a CHANGELOG bullet under Unreleased, in the Changed section. There is no code change, so no "since" marker.

ChatGPT: anchor cached 2 of 3 later runs and off cached 0 of 3 in this run. Earlier, anchor cached 8 of 9 repeats and off 2 of 9. The mechanism comes from OpenCode's source comment, not from provider documentation.

GLM: OpenCode sends no body cache key, but it sends the affinity headers on every request, and anchor kept them stable. No reads followed. Whether the OpenCode Go route uses zai-chat, forwards these headers, or applies Z.ai's implicit cache is not established.

Copilot Gemini: below Google's 4,096-token minimum no read is expected. At 5,103 tokens both arms got HTTP 400 on run 1 and no reads on the repeats after it. Google's caching is best effort, so this is recorded as an open question, not a finding.

Changing plugboard's cache routing for GLM or Gemini was rejected. Nothing in plugboard has been shown to change either result, so a code change would be a guess.

Validation ran typecheck, bun test (2704 tests, 0 fail), the coverage gates, coverage-manifest, check-pack and smoke-pack, docs:build, and the scripted examples with git diff examples/ clean. The live measurements are in the PR.

Refs #277

**docs(examples): describe the stream check, gaps and unobserved checks** ([`aeab2c0`](https://github.com/jjjermiah/opencode-plugboard/commit/aeab2c03633736b39ba43a55b8ad7c3fcabd0d51))

The harness README now explains the four row outcomes (gap, unobserved, n/a, and the wire-decided stream check) and the relay's plan options. A reader who writes a runner no longer has to read run.ts to learn what a gap or an unobserved check does. docs/compatibility.md's smolagents row gives the current result: text and stream pass, five of six tool round-trip checks pass, and the sixth is a gap with its reason.

The unit test-count floor moves with the new tests (relay, unobserved, stream end, scripted model final_answer), recorded by test-gates --ratchet.

Refs #370

**docs(config): document the measured cost of the maxTools seed pool** ([`d6ca97f`](https://github.com/jjjermiah/opencode-plugboard/commit/d6ca97f9bad24f5d97297f9dd5b4125e78e86f2f))

The issue asks what each maxTools slot costs, because every slot is a registered placeholder tool in each app Location (src/session/context.ts, installSessionHooks). The cost was measured instead of guessed, and the numbers are small enough that no code change is needed.

Measured with the real installSessionHooks, the spy plugin context and a fake host transform editor (scratch harness, not committed): one Location per registration, a 36-tool Claude Code style request per hook call. Four runs agreed within a few microseconds.

- registration: 4 to 13 us per Location up to 256 slots, 16 to 19 us at 512, 25 to 29 us at 1024
- retained heap per Location: about 20 KiB at 64, 38 KiB at 128, 72 KiB at 256, 146 KiB at 512, 285 KiB at 1024 (linear, about 0.28 KiB per slot)
- context hook per request: 6 to 13 us up to 256, 30 to 37 us at 1024
- tool list sent to the host: 36 entries, 9,773 bytes at every cap; the seed pool size only changes what is handed to the hook, never what the model gets

Decision: at 256 the cost is negligible (about 70 KiB and under 15 us per Location), so lazy registration is not implemented. Lazy registration would rebuild the host tool transform on demand and change the descriptor-identity mapping in remapSeedTools, a riskier change than the cost justifies. The maxTools row in docs/configuration.md now gives the numbers in place of the stale "a few KiB per Location" claim. Rejected: the bench suite (test/bench) was not extended, because mitata measures request latency and this cost is per Location registration and memory, which it does not capture.

Validation: bun run typecheck ok; bun test 2627 pass, 0 fail; coverage gate ok with floors unchanged; coverage-manifest, check-pack, smoke-pack, docs:build and the scripted examples harness (git diff --exit-code examples/) all exit 0.

Closes #377

**docs(config): move the seed pool numbers into their own section** ([`6483833`](https://github.com/jjjermiah/opencode-plugboard/commit/648383359c2781f73c86f6626dcfd8ebc2652f68))

The maxTools row in docs/configuration.md held about 190 words of measurements, which is hard to read in the rendered table and in the source. The row now keeps the default and one sentence with the per-Location cost at 256, and links to a new "Cost of the seed pool" subsection that holds the method and a five-row table (64 to 1024).

The review asked for two notes, now in that subsection. The harness excludes the host's own per-tool cost and the seed descriptors the host hands the hook (about 35 KB at 256 and 140 KB at 1024). The retained heap includes about 2.6 KiB of harness baseline. The figures are unchanged from the earlier commit.

Validation: bun run docs:build exit 0, no dead-link warnings. No code changed.

Refs #377

#### CI and tooling

**chore(examples): retire compat/ except the Python checks with no example** ([`5412c51`](https://github.com/jjjermiah/opencode-plugboard/commit/5412c517d4b35f88c082e4760b086a9f8d290a07))

Part of #174, step 3 of #187. The client checks now live in examples/: each client has a runnable example, a scripted run that CI keeps current, and its dated live runs. compat/ keeps only the Python checks that have no example yet (aider, DSPy, Instructor, LiteLLM, OpenAI Agents SDK), tracked in #366. compat/ cannot be deleted until #366 is done.

Where each compat/ path went
- compat/results/{openai-python,openai-js,vercel-ai-sdk,pydantic-ai, langchain,n8n,open-webui}.md: already migrated byte-identical to examples/<client>/runs/live/<2026-10-11 dir>/REPORT.md. Checked with cmp before removing the copies here.
- compat/results/aider.md, dspy.md, instructor.md, litellm.md, openai-agents.md: git mv to examples/<client>/runs/live/2026-10-12-a67e176/ REPORT.md (aider, dspy, instructor, litellm-client, openai-agents).
- compat/results/release-candidate.md: git mv (verbatim) to examples/_release/release-candidate.md.
- compat/results/_template.md: git mv to examples/_release/_template.md, Env and Scripts lines now point at the examples.
- compat/fixtures/*: already in examples/_shared/ (byte-identical, checked).
- compat/docker/n8n/*.json: already in examples/n8n/workflows/ (checked; run.sh is replaced by the harness --docker option).
- compat/docker/open-webui.sh and compat/docker/README.md: replaced by examples/open-webui/docker-compose.yml, README.md and the harness.
- compat/js/*: replaced by examples/{openai-js,langchain-js,vercel-ai-sdk}.
- compat/py/{openai_py.py,langchain_py.py,pydantic_ai_check.py,smoke.py}: replaced by examples/{openai-python,langchain-python,pydantic-ai} and the examples/_harness smoke ports.
- compat/tools/logproxy.py: replaced by examples/_harness/capture.ts.
- compat/tools/sessions.py: already in examples/_tools/sessions.py (checked).
- compat/README.md: replaced by examples/README.md; a short README for the remaining files is kept.
- KEPT: compat/py/clients/* (aider, dspy, instructor, litellm, openai_agents, _common.py, run_all.py), compat/py/pyproject.toml, compat/py/uv.lock, compat/py-litellm/. No replacement yet; see #366.

CI and tooling
- ci.yml: the compat job lost the compat/js typecheck (the folder is gone) and keeps only the py_compile of compat/py/*.py. The examples job already ran the scripted runs and the region check; it now also runs the docs build and uploads the regenerated scripted runs as an artifact, so a contributor without uv can copy a fix. Docker examples are skipped (they need --docker and a daemon).
- dependabot.yml: /compat/js removed; /compat/py kept; one uv or npm entry for each example with a lockfile (openai-python, langchain-python, pydantic-ai, openai-js, vercel-ai-sdk, langchain-js, tool-bot).
- Docs and root files that named compat/ paths now name examples/ (AGENTS.md, CONTRIBUTING.md, STRUCTURE.md, README.md, docs/architecture.md, docs/development.md, docs/releasing.md, docs/history.md, docs/compatibility.md, bunfig.toml comment, test/README.md, example metadata). Historical runs/live REPORT.md files keep their text, as the migration rule requires, and so does release-candidate.md (verbatim).
- CHANGELOG [Unreleased]: one entry for the move.

Decisions
- compat/ is not deleted. The four clients and aider have no harness runner, so deleting their scripts would delete the only way to run them. Their pages in docs/clients still name compat/py/clients, which exists.
- release-candidate.md keeps links to deleted per-client records and to compat/docker/README.md. It is verbatim on purpose; those links are dead in examples/_release/ and need a follow-up decision.

Rejected
- Deleting the Python checks outright. That removes checks no example covers, and the epic does not allow it.
- Editing the historical REPORT.md files to fix their compat/ paths. The migration rule says byte-identical.

Validation
- bun run typecheck, bun test (2704 pass, 0 fail), coverage-manifest (67 covered, 0 gaps), check-pack and smoke-pack, bun run docs:build all pass.
- bun examples/_harness/check-regions.ts passes.
- bun examples/_harness/run.ts all --target scripted runs clean: git diff shows no change under examples/ from the scripted runs.
- python3 -m py_compile on the remaining compat/py files and bash -n on all tracked shell scripts pass.
- git grep for compat/ outside the allowed paths lists only the kept checks, the migration notes and test/compat. See the PR body.

**chore(tests): raise the unit test-count floor for the relay tests** ([`af9f0a2`](https://github.com/jjjermiah/opencode-plugboard/commit/af9f0a2b571c5d09b644688b09b9da7d3832d2b4))

The examples relay gained seven unit tests (test/unit/examples-relay.test.ts), so the unit floor moves from 1262 to 1269. The ratchet only raises floors, and this commit records the new count with the tests that raised it.

Validation: bun test passed with 2585 pass, 126 skip, 0 fail, and test-gates --ratchet reported all floors met.

**chore(examples): scratch, hand-edit a scripted summary (#187 demo)** ([`deb39d8`](https://github.com/jjjermiah/opencode-plugboard/commit/deb39d8d7681a3675099281c0a37e577425bd61b))

Demo only: changes the instructor scripted verdict by hand, so the examples job must fail. The next commit reverts this one. Not for merge.

**chore(examples): revert the #187 demo commit** ([`f915e3a`](https://github.com/jjjermiah/opencode-plugboard/commit/f915e3afa67f83c16c8c10f437ad6d7113e03ba6))

The scratch commit hand-edited examples/instructor/runs/scripted/summary.json to fail, and the examples job check failed on it as intended. This restores the regenerated run, so the tree matches the committed scripted output again. Refs #187.

**ci(examples): rerun the pull request checks on the review-fix head** ([`b062bcc`](https://github.com/jjjermiah/opencode-plugboard/commit/b062bcceb62c8a32d5c04092f285f64e9f4a1104))

GitHub sent no pull_request events for d9598cd. The push, and a close and reopen of the PR, both produced none, so the required checks never started on that head. A workflow_dispatch run of the same commit passed every job, including CI passed (run 38447420741). This empty commit gives the PR a new head that starts the checks. It changes no file.

Refs #370

#### Dependencies

**build(deps): support opencode 2.0.28** ([`de63d9b`](https://github.com/jjjermiah/opencode-plugboard/commit/de63d9b0122ae97bd87babd6419ba9e99d1ea037))

OpenCode published @opencode/plugin 2.0.28. The bump pins it, pins the effect version it uses, and widens the peer ranges only where needed. Opened and checked by .github/workflows/host-bump.yml.

</details>
<!-- commit-detail:end -->

## [0.33.0] - 2026-10-13: Stays Awake

**Full diff:** [v0.32.0...v0.33.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.32.0...v0.33.0)

### Fixed

- **The keep-alive now holds the location** ([#350](https://github.com/jjjermiah/opencode-plugboard/issues/350), since 0.33.0). Since 0.26.0 the keep-alive renamed one session every 30 minutes, but a rename does not restart OpenCode's 60-minute idle timer. Plugin calls publish their events without the Location, and the timer only counts events that carry one. The keep-alive now creates one child session every 30 minutes under a long-lived parent in its own Location, and removes the children the earlier ticks left. A child create carries the Location, so the timer restarts, and the lists show one stable parent row. The parent is reused from 0.26.0 to 0.32.0. A removal that fails is kept and retried on a later tick, and a failed write removes the child it just created, so nothing is left behind. Versions 0.26.0 to 0.32.0 still need the external timer in `docs/warm-up.md`.
- **`/readyz` stays ready after an idle app directory is evicted** ([#350](https://github.com/jjjermiah/opencode-plugboard/issues/350), since 0.33.0). Readiness used to follow the newest generation, so when OpenCode evicted the idle app directory after an hour, `/readyz` went to 503 until the next request. It now counts a confirmed app directory for the whole process.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (2 commits)</summary>

#### Fixes

**fix(runtime): hold the location with a session create, not a rename (#350)** ([`1654a3f`](https://github.com/jjjermiah/opencode-plugboard/commit/1654a3fd0497b3c4b85b4c3057b0f3c4b6bd7b87))

The keep-alive renamed one session every 30 minutes. OpenCode 2.0.27 still evicted the location after about an hour idle on aihub (location services evicted, then listener.closed). Renaming does not hold it.

Why: LocationActivity (packages/core/src/location-activity.ts) restarts the 60 minute TTL only for a durable session event whose envelope carries a Location. The bus takes that envelope Location from the publishing fiber's Location service (bus.ts publish). Plugin calls run in a fresh fiber without one, because the plugin host closes over its Location instead, so a rename (session.renamed, published by Session.rename) has no Location and the timer never restarts. The aihub timeline fits exactly: the first tick after startup creates the session (touch), the later renames do not, and eviction comes 60 minutes after the create.

What: each tick creates a new keep-alive session in this plugin's Location (session.create with no location argument, so the create's publish carries the Location explicitly), stores its id, then removes the session the previous tick stored. A session left by an older plugboard is removed on the first tick. A session already gone is not an error.

Decisions:
- Remove the old session after the create, so a failed create keeps the old one and never leaves the Location without a fresh touch.
- Keep the sessions out of the session store, the history index and usage, as before.
- Rejected: a child session per tick (parentID), which would need the same remove and would add a second session tree; a move (Session.move) or metadata update, which publish without a Location like the rename; a plugin-side Effect.provide of the Location, which the plugin API does not expose.

Validation: typecheck clean; bun test 2424 pass, 0 fail, 126 skipped; coverage gates met; coverage-manifest 67 covered, 0 gaps; mutations 65 of 65 killed (new I30-keepalive-tick-reuses-session); check-pack and smoke-pack pass; docs:build pass; examples scripted run clean. Live proof on the isolated dev server with this branch: see the PR body.

Refs #350
Refs #310

**fix(runtime): keep /readyz ready after an idle app directory, list one parent, stop leaks (#350)** ([`d0eb68e`](https://github.com/jjjermiah/opencode-plugboard/commit/d0eb68e9df73a5efa85abfa494b91071cdcab7ac))

Review of #358 found three problems in the create-based keep-alive, plus a readiness gap it exposed. Each is fixed here.

Readiness. `/readyz` followed the newest generation whose directory was confirmed. OpenCode evicts an idle app directory after 60 minutes, which disposes its generation, so the fallback generation (the plugin's own Location, never confirmed) became the serving one and `/readyz` went to 503 with "no app directory has been used since start". The listener was up and the next request would boot the directory again. Readiness now uses a process-wide fact: an app directory has been confirmed in this process (`rt.confirmed.size > 0`). Nothing in the confirmed set is removed on a generation's disposal. `servingConfirmed` keeps its name, so the status shape does not change, and its meaning is documented as process-wide.

Churn. Each tick used to create a new root session and remove the old one, so the lists flashed a new row every 30 minutes. Now one parent, titled `plugboard keep-alive`, is created once in the plugin's Location and kept under `keepalive/session` (a parent from 0.26.0 to 0.31.0 is reused). Each tick creates a child under it. A child takes its parent's Location (Session.create publishes with `{ location }` from the parent), so the create still restarts OpenCode's 60 minute timer. Children are hidden from root lists. A missing parent is created again.

Leaks. The children still to remove are tracked in `keepalive/children` (a JSON array). Each tick writes the new child into that list before it removes anything, then removes the tracked ones and writes back only the ones that failed. A failed remove is retried on a later tick. A failed write of the list removes the child just created. A list that is not JSON counts as empty. A crash between the create and the first write still leaks one child: closing that needs a durable intent record before the create, which the plugin host does not offer. Rare and bounded to one session.

The host port is `createRoot`, `createChild` (undefined when the parent is gone) and `remove` (NotFound counts as removed). The remove wrapper is a plain `Effect.catch`.

Rejected: a child for every app directory (more churn, and the first request after an idle still needs no boot if readiness is process-wide, which it now is); keeping the rename for the parent (a rename never touches).

Validation: typecheck clean; bun test 2578 pass, 0 fail, 126 skip; test gates with --ratchet met (floors raised for runtime and unit counts); coverage- manifest 67 covered, 0 gaps; mutations 82 of 82 killed (new I30-keepalive-children-never-removed; I30-keepalive-tick-reuses-session retargeted to the child create); check-pack and smoke-pack pass; docs:build passes; examples scripted run clean. Not re-run: the idle live proof (the dev server is in use by another agent, and these changes do not change the eviction timing).

Refs #350
Refs #310

</details>
<!-- commit-detail:end -->

## [0.32.0] - 2026-10-13: Every App Its Own Dials

**Full diff:** [v0.31.0...v0.32.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.31.0...v0.32.0)

### Added

- **Eval harness clients checked against the live server** ([#106](https://github.com/jjjermiah/opencode-plugboard/issues/106)). promptfoo passes its two checks, and lm-evaluation-harness passes a generate-until task with `local-completions` and `local-chat-completions` (the chat type was flaky once, 0.5 then 1.0 on rerun). Loglikelihood tasks (multiple choice scored by log probability) cannot run here: plugboard does not serve `logprobs`. The client matrix now also covers a legacy prompt array with `n` (two prompts, `n: 2`, four choices, each checked against the prompt it answers), so its fake server allows `maxN` 4.
- **Per-app request deadline** ([#257](https://github.com/jjjermiah/opencode-plugboard/issues/257)). `apps.<name>.requestTimeoutMs` (since 0.32.0) gives one app its own deadline in place of the global `requestTimeoutMs`, higher or lower, so a batch job and a chat widget can differ. The timeout error names the option that set the deadline. Unset, the global value applies unchanged.
- **Per-app request body cap** ([#258](https://github.com/jjjermiah/opencode-plugboard/issues/258)). `limits.maxBodyBytes` (since 0.32.0) sets the largest body for every app, at most 32 MiB, and `limits.apps.<name>.maxBodyBytes` lowers it for one app. A body over the app's cap gets 413 before it is read, so a chat widget can be held to a few hundred kilobytes while a bot keeps a larger one. Unset, the 32 MiB cap applies as before.
- **Per-app output token cap** ([#263](https://github.com/jjjermiah/opencode-plugboard/issues/263)). `apps.<name>.maxOutputTokens` (since 0.32.0) bounds one answer of an app. A caller with no limit gets the cap, a higher limit is lowered to it, and a lower one is kept, on Chat Completions, Responses, legacy completions, Messages and Gemini. On Messages a thinking budget the cap cannot hold gets the existing 400, not a silent change to thinking.
- **Per-app model pin** ([#261](https://github.com/jjjermiah/opencode-plugboard/issues/261)). `apps.<name>.model` (since 0.32.0) runs every request of one app on one model, so a widget with a model name baked in can move to a cheaper model without a change on its side. The caller's `model` and `reasoning_effort` are ignored. The pin must pass the global `models` and the app's own `models`, so it never widens access, and a pin the server does not have is the usual 404.
- **Per-app end user header** ([#272](https://github.com/jjjermiah/opencode-plugboard/issues/272)). `apps.<name>.userHeader` (since 0.32.0) reads the end user from a request header, such as one a reverse proxy sets, so a bot that never sends `user` still gets per-user history and usage. The body's `user` is the fallback when the header is absent or empty. A credential header (`authorization`, `x-api-key`, `x-goog-api-key`, `cookie`, `proxy-authorization`) is refused at load, since its value would be logged as the user. Gemini is not covered, as it has no end user today.
- **Per-app sampling defaults** ([#264](https://github.com/jjjermiah/opencode-plugboard/issues/264)). `apps.<name>.sampling` (since 0.32.0) sets `temperature`, `topP`, `maxTokens`, `stop` and the penalties for one app. A default fills a request only where the caller sent none, so an app's answers stay stable when the model changes. A default a model rejects is dropped and reported like a caller's value.

### Changed

- **An over-size request body is `request_body_too_large` (breaking for clients that match on the old 413).** The 413 on the OpenAI-shaped routes and on `/plugboard/` routes now carries the code `request_body_too_large` where it had none. Clients that matched the codeless 413 must match the code instead. Messages (`request_too_large`) and Gemini (`code: 413`) keep their own shapes, which did not change. The body cap is `limits.maxBodyBytes` (32 MiB by default) or the app's `limits.apps.<name>.maxBodyBytes`.
- **Anthropic `cache_control` `ttl: "1h"` is carried on requests without tools** ([#275](https://github.com/jjjermiah/opencode-plugboard/issues/275), since 0.32.0). A caller's 1-hour breakpoint now reaches the model as a 1-hour breakpoint when the request has no tools (no caller tools and no server tools, or `tool_choice` `none`). Plugboard then gives 1h to every breakpoint before it, so no 5-minute breakpoint comes before a 1-hour one, which Anthropic requires. Earlier 5-minute caller blocks are raised to 1h; that adds no cost, because the caller's 1h block already bills everything before it as a 1-hour write. With tools the block stays 5 minutes, because OpenCode's last-tool breakpoint comes first and is always 5 minutes. The rules are in [Prompt caching](docs/messages.md#prompt-caching). `cache_control` on `tools` stays ignored, because the context hook cannot set a tool's cache hint.

### Fixed

- Release script: a `git fetch` that loses a ref-lock race with a parallel worktree (`cannot lock ref`) is retried, 4 attempts with a short backoff, instead of stopping the release ([#352](https://github.com/jjjermiah/opencode-plugboard/issues/352)). `--resume` now handles a release pull request that is already merged: it waits for CI on the merge commit and tags that commit only when the run succeeded. If the tag is already on origin, it says so and watches the release. Before, a fetch that failed after the merge left the tag to a hand push. Tooling only, not in the package.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (26 commits)</summary>

#### Features

**feat(config): per-app request deadline with apps.<name>.requestTimeoutMs** ([`a79e9ee`](https://github.com/jjjermiah/opencode-plugboard/commit/a79e9ee918edb3db019227bef143b9ccb2b11344))

One global deadline cannot fit a batch job and a chat widget on the same server. The widget wants a stuck request to free its slot quickly, and the batch wants minutes. The new option apps.<name>.requestTimeoutMs (since 0.29.0, issue #257) gives an app its own deadline. It replaces the global value for that app's requests, higher or lower. The deadline is still one timer created once, now from the app that requestApp read from the credentials, so the commit before this one made the value reachable before the timer starts.

The option is per app and not per model, as the issue proposes: the app is the unit operators reason about. Validation uses the same integer check as the global option, 1 to 2147483647, so the value always fits a timer. An app without the field gets the global value, and a request whose credentials match no app gets it too. The timeout error keeps its text, which still names requestTimeoutMs; naming the app's option there is a follow-up.

A timer re-armed after authentication was rejected. It would split the deadline in two and let the credential read run without one.

New tests in test/http/per-app-timeout.test.ts cover a short app deadline that times out, a long one that outlives the global deadline, two apps on one server, and an unknown key that keeps the 401. test/unit/config.test.ts accepts 1 and the ceiling and rejects 0, a fraction, a string and the ceiling plus one, each naming the option. The mutation P257-app-deadline- ignored pins the lookup. Typecheck passes and the config tests (189) pass.

Closes #257

**feat(http): per-app request body cap with limits.apps.<name>.maxBodyBytes** ([`ed7d41f`](https://github.com/jjjermiah/opencode-plugboard/commit/ed7d41fbda10a906be154b0203610124de4286d1))

The body cap was 32 MiB for every app, and the in-flight budget is one number for the whole process, so a large upload from one app took room from every other app. limits.apps.<name>.maxBodyBytes (since 0.29.0, issue #258) lowers the largest body for one app, and limits.maxBodyBytes sets it for every app. Both can only lower the 32 MiB hard cap, and an app's value cannot be above the global one. Unset, the cap is 32 MiB as before.

The check stays where it was. readJsonBody compares the declared Content-Length and the bytes as they arrive against the cap it is given, so a body over the app's cap is refused before it is buffered (I28). Every route that reads a body (chat, Responses, legacy completions, Messages, Gemini) passes the app that authenticated, which serve already knows before the read. The admin route keeps the default.

Decisions: the cap lives under limits.apps, as the issue proposes, and not under the app's own block, so it sits with maxConcurrent and requestsPerMinute. It is rejected under limits.perApp, because a per-app cap there would apply to every app. The 413 keeps its existing text and carries no error code. The issue asks for request_body_too_large, but a code would change the shape every existing 413 answers with, so that is a follow-up.

Rejected: a second budget per app. The process budget stays as it is, since the issue asks for a cap on size, not on the total held.

BodyLimits.maxBodyBytes is optional, so existing callers and tests that build the object by hand compile unchanged. bodyLimits() always fills it in. The test that compares the whole bodyLimits() object now expects the new field, which is the one change to an existing test in this commit.

Validation: test/http/per-app-body.test.ts (an app over its cap gets 413 while another app with no cap is accepted, the declared length is checked before the read, the global cap applies to every app, and neither field leaves the 200 path alone). test/unit/config.test.ts covers the resolved value, the ceilings, the zero value and the perApp rejection. Mutations P258-app-body-cap-ignored and P258-body-read-ignores-cap guard the lookup and the read. Typecheck passes and all 752 config and http tests pass.

Closes #258

**feat(openai): per-app output token cap with apps.<name>.maxOutputTokens** ([`5a48a3f`](https://github.com/jjjermiah/opencode-plugboard/commit/5a48a3fa1fc7939af624116479e798c043ae93da))

A widget that forgets max_tokens can produce a long and expensive answer, and budgets only limit the spend after the fact. The new option apps.<name>.maxOutputTokens (since 0.29.0, issue #263) bounds one answer of an app. It is 1 to 2147483647. A caller with no limit gets the cap, a higher limit is lowered to it, and a lower one is kept. The cap is never raised, so a caller cannot use it to get more output than the operator allows.

The cap is applied on every route: Chat Completions, Responses, legacy completions and Gemini apply appGeneration to the parsed generation, before dropRejected, so the sampling drop sees the capped value and the model call gets it. Messages is different. Its max_tokens is required and the thinking budget rule (budget below max_tokens) runs in the parser, so the cap lowers max_tokens before the parse. A budget the cap cannot hold then gets the existing 400 and no model call, rather than a thinking block that was switched off without a word.

Rejected: applying the cap after parsing on Messages. The thinking check would have to be repeated there and the budget is not kept on the parsed request. Rejected: a new 400 for a cap below the budget. The existing message already says the rule, and the issue asks for that 400.

New tests in test/http/per-app-output-cap.test.ts cover each route with a caller that sends no limit, a higher one and a lower one, the other app that keeps its own limit, the Messages budget refusal, a budget the cap does hold, and the load-time range. Mutations P263-app-output-cap-raises and P263-messages-cap-after-parse pin the rule and the Messages order. The http and unit suites pass (1780 tests), and typecheck passes.

Closes #263

**feat(config): per-app sampling defaults with apps.<name>.sampling** ([`4de02ec`](https://github.com/jjjermiah/opencode-plugboard/commit/4de02ec0d2ecaf8b2bbe58c340e3b5af9f8cb835))

An app that never sends temperature gets whatever default the provider picks, and that default is not the same for every model. So the same app answers differently after a model change, with nothing in the app changed. The new option apps.<name>.sampling (since 0.29.0, issue #264) sets temperature, topP, maxTokens, stop and the two penalties for one app. A field fills a request only where the caller sent none, so the caller's value always wins. This is the opposite of systemMode replace on purpose: it fills a gap and does not force.

The defaults go through appGeneration, the same seam as the output cap (#263), before dropRejected. A default that a model is known to reject is therefore dropped and reported in x-plugboard-dropped-params, like a caller's value, and cannot turn a working app into a 400. The ranges and the stop limit are the request field's own, checked at load with the option named in the message.

Rejected: a global default. The issue asks for it per app, because the reason to set sampling is specific to one app. Rejected: forcing the value over the caller's, which is systemMode replace for sampling and would hide a caller's deliberate choice. Messages requires max_tokens, so the default maxTokens has no effect there; the docs say so.

New tests in test/http/per-app-sampling.test.ts cover the defaults on Chat Completions, the caller's value winning with the rest still filled, an app without sampling, Responses and Messages, and the appGeneration rules: fill only unset fields, the cap after the default, and a rejected default dropped by dropRejected. The load-time ranges and unknown fields are tested too. The mutation P264-app-sampling-overrides-caller pins the fill-only rule. Typecheck passes and the http and unit suites pass (1797 tests).

Closes #264

**feat(config): pin an app to one model with apps.<name>.model** ([`505204f`](https://github.com/jjjermiah/opencode-plugboard/commit/505204fb50675a97941dd4f95fdee29a69b1ee5c))

A widget with a model name baked in breaks when the operator wants a cheaper model. The existing apps.<name>.models refuses the old name with 404, and the widget cannot be changed. The new option apps.<name>.model (since 0.29.0, issue #261) runs every request of one app on one model. The caller's model and reasoning_effort are ignored, and the answer names the pinned model in its model field.

The pin is a canonical id or an alias name. A provider pattern cannot pin one model, so it is refused at load. A canonical id must pass the global models, and when the app has models it must be listed there; an alias must be listed by name. So the pin never widens access. A pin the server does not have is the usual 404 model_not_found, not a silent fallback to the caller's model.

Decisions: the caller's reasoning_effort is dropped under a pin, because the pinned id already names the variant (the issue's rule). The pin is applied where each route resolves its model (chat, Responses, completions, Messages and Gemini, both the generate and count paths), through one helper, requestedModel, so the rule is in one place. The request's model field follows the pin too, so the session title and metadata name the model that runs.

Rejected: checking the pin against the catalog at load. The catalog loads later, so the request-time 404 is the check that works, and the pin is refused at load only where the config alone can decide.

New tests in test/http/per-app-model.test.ts cover a pinned app with a caller's other model, a caller's reasoning_effort ignored, an app without a pin, a pinned alias, a pin the server lacks (404), and the pin on Responses, Messages and Gemini. The load rules (pattern, global models, app models, alias listing, malformed id) are tested too. Mutations P261-app-pin-ignored and P261-pin-outside-global-models-allowed pin the rule. Typecheck passes and the http and unit suites pass (1831 tests).

Closes #261

**feat(config): read the end user from a request header with apps.<name>.userHeader** ([`7b0b2e8`](https://github.com/jjjermiah/opencode-plugboard/commit/7b0b2e8442375f5cdbc600e7bd69d0b2c7eb4ce8))

Plugboard reads the end user from the body only: the user field, or metadata.user_id on Messages. A bot behind a reverse proxy often already knows the user, but the proxy sets a header and not a body field, and many clients never send user. So every request of that bot lands in one history and one usage pile. The new option apps.<name>.userHeader (since 0.29.0, issue #272) names a header to read the end user from. The body is the fallback when the header is absent.

The header is not trusted more than the body. The same sanitizer decides (trimmed, at most 64 characters of the allowed set), and a present but refused header is dropped with x-plugboard-user-dropped: 1 rather than falling back to the body, so a bad header cannot quietly swap in another user. The name must be lower case, 1 to 64 letters, digits or hyphens. A credential header (authorization, x-api-key, x-goog-api-key, cookie) is refused at load, since its value is a key and the end user is logged and counted.

Decisions: requestUser picks the value and withEndUser puts it back into the body, so the existing parsers for Chat Completions, Responses, legacy completions and Messages stay as they are. A request without userHeader gets the same body back, unchanged. Gemini is not covered: it has no end user today and the issue names the other routes. The option lives under apps.<name>, next to the other per-app request fields.

Rejected: a parser argument for the user. It would change four decoders to carry a value that a route can already put in the body.

New tests in test/http/per-app-user-header.test.ts cover the header ahead of the body, the body when the header is absent, a refused header dropped without a fallback, an app without the option, Messages reading the header ahead of metadata.user_id, and the load rules (case, empty, length, type and credential headers). Mutations P272-user-header-ignored and P272-credential-header-allowed pin the lookup and the refusal. Typecheck passes and the http and unit suites pass (1847 tests).

Closes #272

**feat(anthropic): carry cache_control ttl 1h on requests without tools** ([`d83eaf5`](https://github.com/jjjermiah/opencode-plugboard/commit/d83eaf54a3954b77a69d0fd26979aed15dbc149a))

A caller's Anthropic block with cache_control ttl "1h" reached the model as a 5-minute breakpoint (#275). This commit carries the 1h TTL when the request has no tools, and keeps 5m when it has tools.

Why the rule has two sides: Anthropic needs every 1h cache entry before every 5m one. OpenCode adds 5m breakpoints by itself (its AUTO policy: the last tool, the first and last system part, the last text part of the last message), and plugboard sends no cache policy, so that placement always runs. With tools, the last-tool 5m breakpoint comes before every message, so a 1h block cannot precede it and stays 5m. Without tools there is no last-tool breakpoint, so the only earlier 5m hints are the system and tail ones, and plugboard can set them itself.

What it does, in src/session/context.ts (orderOneHourHints), on a request without tools (session.tools empty after the rewrite, which is what Anthropic receives, so tool_choice none counts): every hinted part before the last 1h block gets 1h, including a caller's 5m block there (raised, so it is billed at the 1h write price); the system first and last part and the tail part get 1h when OpenCode would otherwise give them 5m before that block; parts after the last 1h block keep 5m. The four-slot budget is respected, so no slot is added beyond the cap. With tools, every 1h hint is set back to the 5m default.

Parts are replaced, never mutated, because a host media object can be shared with the host's own prompt.

src/contract.ts gains cacheTtl ("1h") on text, media and tool-result parts; src/anthropic/request.ts sets it for ttl "1h" (any other ttl stays 5m).

Rejected alternatives: forwarding ttlSeconds without the ordering pass (the AUTO 5m hints would precede it; Anthropic documents that as an error, and no live request has shown it); turning OpenCode's placement off with cache none (loses caching for every caller); raising the 1h hint on tools (the context hook cannot set a tool's hint).

Tests: test/session/context.test.ts pins the wire order and TTLs of the host request for the tool-less cases (system first/last, earlier 5m raised, tail pinned, budget of 4 and of 3, tool_choice none) and for the with-tools case; test/unit/anthropic-request.test.ts and test/http/messages.test.ts now expect cacheTtl (the old assertions pinned the dropped TTL). Two mutation entries (P275-*) kill the with-tools downgrade and the raise loop.

Validation: typecheck; bun test 2433 pass, 0 fail; coverage gates met (floors raised and committed); coverage-manifest; check-pack and smoke-pack; docs:build; examples harness with no diff; bun run mutations 66 of 66 killed.

Not verified: a live request with a tool-less 1h block against Anthropic. The dev server runs main, so this needs the merge first; the check is in the PR. Also not verified: that Anthropic accepts the order on every model; the docs state the rule, and no 400 was observed.

Docs: docs/messages.md has a Prompt caching section; docs/configuration.md links to it. CHANGELOG under Unreleased, since 0.31.0.

Refs #275

#### Fixes

**fix(http): close the review of the per-app options with the 413 code and wire tests** ([`b9e7391`](https://github.com/jjjermiah/opencode-plugboard/commit/b9e73916bd5d79915c47bd514cc314ce5871fb7e))

The review of the per-app options found a count_tokens refusal caused by the output cap, a 413 with no code, a timeout that named only the global option, and gaps in the wire tests. Each is fixed here. A count never uses max_tokens, so the cap no longer applies to count_tokens, and a count with a thinking budget the cap could not hold answers 200 again. The 413 for an over-size body now carries the code request_body_too_large in every dialect, which is a breaking change for clients that matched on the old codeless 413; that is accepted for this project. The 504 names the option that set the deadline, apps.<name>.requestTimeoutMs for an app that has its own. A budget refused because the cap lowered max_tokens names the app option in the same 400. Responses echoes the capped max_output_tokens and the effective temperature and top_p, so a client reading the object back sees what the model got.

Tests: a dropped sampling default appears in x-plugboard-dropped-params on the wire; the deadline on Messages (x-api-key and Bearer) and on Gemini (the header and the query key) is the app's own; the body cap on Messages and Gemini is the app's, in each dialect's error shape; count_tokens is not refused by the cap. The README per-app example gains the maxOutputTokens and sampling lines, the configuration rows are corrected, and I19 states that the key digests read is the one await before the deadline. The mutation id P263-messages-cap-after-parse is renamed P263-messages-cap-removed, since it removes the cap, and two guards are added: the count path skipping the cap and the timeout option naming.

Validation: bun run typecheck passes; bun test test/http test/unit passes (1818 tests, 0 failures).

Refs #257, #258, #263, #264

**fix(ci): retry release git fetches and resume an already-merged release** ([`550f8a8`](https://github.com/jjjermiah/opencode-plugboard/commit/550f8a8c8ddc47d4a7c4a53eaa71a068ba2b3569))

Parallel worktrees share one .git. On 0.30.0, `git fetch origin main` lost a ref-lock race ("cannot lock ref") right after the release pull request merged. The script exited before it waited for the merge commit's CI or tagged it, so the tag had to be pushed by hand.

What changed in .github/scripts/release.ts:
- Every git fetch goes through fetchOrigin: 4 attempts with a 2s, 4s, 6s backoff. Each retry is logged.
- A fetch that still fails after the merge stops with nothing tagged and prints the --resume command.
- --resume on a pull request that is already MERGED (its branch is deleted by the merge) skips the version and changelog checks, fetches main, and waits for CI on the merge commit. It tags that commit only when that run concluded success (tagAfterMergeCi, shared with the normal path).
- If the tag is already on origin, --resume says so, checks that it points at the merge commit, watches the release and exits with the watch result. It never moves the tag.

Decisions:
- Retry only fetches. Pushes and merges keep their single attempt: a retried push could hide a real rejection.
- The merged-PR check uses `gh pr view <branch>` (the same lookup mergedCommit uses), and runs before the version checks, which a merged release has already moved past.
- The merged resume does not fast-forward local main. The normal path still does.

Rejected:
- A committed test for release.ts. The script shells out to git, gh and npm, and the release-gate lane rehearsed it against a throwaway bare origin with stub gh. Same approach here (the rehearsal is kept out of the repo).

Validation:
- Rehearsal (throwaway bare origin, stub gh/git/npm on PATH), all pass: A fetch lock failure once, then the retry succeeds and the release tags the merge commit. B merged, post-merge fetch fails (nothing tagged), --resume tags after green merge CI. C already merged, --resume, merge CI failure: exit 1, no tag. D tag already on origin: --resume says so, watches, exits 0, tag not moved. E every fetch fails before the merge: exit 1 after 4 attempts, no branch pushed.
- bun run typecheck: clean. bun test: 2424 pass, 0 fail, 126 skip (live).
- coverage gates --ratchet: all floors met, no floor changed. coverage-manifest: 0 gaps.
- check-pack and smoke-pack: ok. docs:build: ok. examples scripted: no diff.

Not verified:
- A real GitHub merge, gh behaviour on a merged branch lookup, and a real ref-lock race. The rehearsal stubs them.
- The live opencode dev server check: not needed, no src/ change.

Closes #352

**fix(config): review fixes for the per-app options: 0.31.0 labels, userHeader gaps, alias pin rule** ([`3f8b7c1`](https://github.com/jjjermiah/opencode-plugboard/commit/3f8b7c12b20e0be53bbce9fa95f3c5699e407ce1))

A follow-up review of #345 found version labels that were wrong, a missing problem code, and gaps in userHeader and the model pin. 0.30.0 is already released (it shipped hidden app sessions, #337), so every "since" marker this PR added now says 0.31.0. The #337 and #262 markers keep their versions. CHANGELOG [Unreleased] holds only this PR's bullets again, and the 413 change is a "Changed" bullet calling it breaking.

Breaking: an over-size body on the OpenAI-shaped and /plugboard/ routes now answers the code request_body_too_large (it had none). The code is in PROBLEM_CODES and has an anchor in docs/errors.md, so the admin route's problem body names it too. Messages (request_too_large) and Gemini (code 413) did not change.

userHeader: a blank header value is absent, so the body's user is used, and a proxy that always sets the header no longer hides every body user. The credential denylist adds proxy-authorization, api-key and x-auth-token. The header is read as an own property, so a name such as constructor cannot read an inherited value. Metadata that is an array is not spread into an object. Tests cover the blank header, Responses and legacy completions, the new denylist names, and the own-property lookup. The Gemini limit is in the option's table row.

Model pin: the load rule for an alias now matches the request check (inAppScope): an alias is accepted when the app lists its name or when its target matches one of the app's models patterns. Before, a pin that the request would admit was refused at load. The docs say so. Tests check x-plugboard-model and the echoed model on Chat, Responses, Messages and Gemini, and that a missing pinned model's 404 names the pinned model.

Validation: bun run typecheck passes; bun test passes (2530 tests, 0 failures); coverage gates, manifest, pack, smoke-pack, docs build and the examples harness pass with no drift; bun run mutations runs 78 of 78 killed in the foreground. The new guards P272-blank-header-hides-body and P261-alias-target-refused-by-app-models are in the catalogue, and P272-user-header-ignored is re-anchored to the new requestUser body.

Refs #257, #258, #261, #263, #264, #272

**fix(ci): check a merged release before --resume tags its merge commit** ([`bf51ddb`](https://github.com/jjjermiah/opencode-plugboard/commit/bf51ddb0b976f6e20b2522a4269c2b63df54337a))

Review of #361 found that the merged resume trusted whatever pull request gh returned for the release branch, and fell through to the normal resume when gh failed. This commit closes both.

What changed in .github/scripts/release.ts:
- A merged pull request is tagged only when it was merged into main, its merge commit is an ancestor of origin/main, and that commit's package.json says the release version. Each failure stops with "Nothing is tagged".
- A gh pr view failure is an error with gh's message. It no longer falls through to the normal resume, which said the branch was not on origin.
- A local tag already at the merge commit (an earlier push failed) is pushed, not created again. A local tag anywhere else stops the run before anything is pushed.
- --no-watch is honoured when the tag is already on origin.
- From a clean main, a merged resume fast-forwards local main to origin/main, as the normal run does.
- The cancelled-CI message and docs/releasing.md now point to `gh run rerun` followed by --resume, not a hand-made tag. The two docs bullets that split the list are one list now.

Decisions:
- The guards read gh's baseRefName and the git objects, not gh's ordering. gh picks the newest PR for a branch name, so the guards decide whether that PR is the release being cut.
- The local tag case is handled, not documented: pushing an existing tag at the right commit is the only way out that does not need a hand step.

Merged origin/main (0.31.0) into this branch, a merge and not a rebase, so the commits already pushed stay as they are. The CHANGELOG bullet stays under [Unreleased].

Validation:
- Rehearsal (throwaway bare origin, stub gh/git/npm on PATH): ALL PASS, 14 cases. A to E as before. New: F tag on origin at another commit, G base other than main, G2 merge commit not on origin/main, G3 another version's release, H gh pr view failure, I local tag at the merge commit pushed, J local tag elsewhere refused, K --no-watch on the tag-present path. B also checks that local main is fast-forwarded.
- bun run typecheck: clean. bun test: 2567 ran, 0 fail (126 live skips).
- Coverage gates --ratchet: pass, floors unchanged. coverage-manifest: 0 gaps.
- check-pack and smoke-pack: ok. docs:build: ok. Scripted examples: no diff.

Not verified: a real GitHub merge, gh behaviour on a deleted release branch (the review checked this live), and a real ref-lock race. The rehearsal stubs them.

Refs #352

#### Refactors

**refactor(http): read the app from the credentials before arming the deadline** ([`df0e652`](https://github.com/jjjermiah/opencode-plugboard/commit/df0e65276d7481361fa4055ba9ef754062007d0a))

The request deadline was armed in `run` before anything knew which app the caller was, so the per-app request timeout (#257) had no app to read. This commit moves the credential read ahead of `beginRequest`. `requestApp` in `src/openai/route.ts` applies the same rules `serve` uses (the Messages x-api-key fallback, the Gemini key forms, the keyless default) and returns the app name or nothing. It answers nothing, so every refusal, the 401 and the probes stay where they were, in the same order (I15).

The body read and the model resolution were already after authentication in every route (`serve` authenticates before `readJsonBody`, and each dialect resolves its model after that), so no route changed. Only the deadline moved.

Decisions: the deadline is still the global `requestTimeoutMs`. `requestTimeoutFor` takes the app now and ignores it, so #257 changes one function and no call site. Rejected: arming the timer later with a setter on the scope, because the handoff asked for the app before `beginRequest` and a late timer would also change when a disconnect is noticed. A socket that closes during the credential read is still caught, because `beginRequest` checks the socket state when it is created.

Validation: `bun run typecheck` passes; `bun test test/http` passes unchanged (544 tests, 0 failures). I19 in docs/architecture.md now says where the scope starts.

Refs #257, #258

#### Tests

**test(tests): ratchet the test floors and re-anchor the output cap mutation** ([`61d3b12`](https://github.com/jjjermiah/opencode-plugboard/commit/61d3b12b047f495f6a065c82923e2c330b79aa42))

The new per-app tests raised the unit-layer test count, so `test-gates --ratchet` moved its floor to the current value. Floors are only ever raised, and the ratchet wrote them, so .github/floors/test-count-floors.json changes with the tests that caused it.

The #263 mutation P263-app-output-cap-raises pointed at the line that #264 rewrote, so its anchor no longer occurred and the run could not apply it. The anchor now names the new cap line. It still breaks the same guard: the cap sets maxTokens without the min, so a caller's higher limit is raised to the cap rather than lowered. The full catalogue then runs 68 of 68 killed, exit 0.

Validation: `bun test` 2436 pass, 0 fail (2562 tests); coverage gates pass; `bun run mutations` 68 of 68 killed.

**test(examples): observe tool-bot S2 from the capture round trip** ([`38ff63c`](https://github.com/jjjermiah/opencode-plugboard/commit/38ff63ccb3ad743bcfc213ace4fb27aedaa9ad92))

The tool-bot runner printed the bot's stdout, which holds only the final answer. So the S2 checks that read the tool call (finish_reason, the get_weather name, the city, the call id) had nothing to read, and S2 was a gap with verdict partial.

The runner now reads its own round trip from the capture proxy. The capture gains GET /__exchanges, which waits for the in-flight requests and returns the exchanges of the current mark. The first chat completion of the round trip is the tool call; the second is the answer after the tool result. The runner maps them to the S2 observations. The bot is unchanged.

Decision: the issue's first option. The runner cannot read the transcript file, which the parent writes after the runner exits, so the capture gets a read route instead of the file being parsed in the runner. The second option (the bot writes observations on stderr behind a flag) would have changed what the bot prints.

Rejected: a second capture or a separate log file. Those duplicate the exchanges the capture already holds.

Validation: bun examples/_harness/run.ts tool-bot --target scripted gives pass with 6/6 checks on fast, anthropic/claude-haiku-4-5 and openai/gpt-5.6-luna#low. The transcripts are unchanged; only the summary changed (the S2 gap is gone). The live tool-bot run is not regenerated here.

Closes #320

**test(examples): give the scripted n8n S6 answer the output wrapper** ([`01f88a9`](https://github.com/jjjermiah/opencode-plugboard/commit/01f88a9d011594ca9c495046b83a8a65d4396209))

n8n's Structured Output Parser asks the model for its JSON with an `output` wrapper: the prompt carries the schema instance {"type":"object","properties":{"output":{...}}}. The live model writes the wrapper, so n8n S6 passed live. The shared scripted model answered the S6 prompt with bare MEAL JSON, which the parser rejects. S6 was a whole-row gap on the scripted target only.

The scripted model now keys the answer on the request. When the user text carries that schema (`"properties":{"output"`), it answers {"output": MEAL}. Other clients send only the bare S6 prompt, so their S6 answer is unchanged. The n8n runner loses its scripted-only S6 gap.

Decision: key on what the request asks, not on the client name. The scripted model sees requests, not clients, and the schema text is the thing the parser needs.

Rejected: changing the shared answer to the wrapper. That changes the committed transcripts of every client that sends the bare prompt.

Validation: bun examples/_harness/run.ts n8n --target scripted --docker (Colima running): S6 passes 3/3 on fast, anthropic/claude-haiku-4-5 and openai/gpt-5.6-luna#low. Only the n8n S6 transcripts changed in examples/; the other examples' scripted runs are byte-identical. The verdict is still partial: S1 (responses) is the #343 gap, fixed in the next commit.

Closes #344

**test(examples): record n8n's Responses limitation instead of a gap** ([`c89987d`](https://github.com/jjjermiah/opencode-plugboard/commit/c89987d47b4fddaec18110fe61efdadd7ff0f9ae))

The n8n S1 responses variant was a gap as a whole row. Its two failing checks are n8n's own: the Responses node records no finish_reason, and the usage it records is tokenUsageEstimate, not tokenUsage. A gap covers the whole row, so any regression in the answer text would have hidden in it too. The variant could never pass, so the gap was permanent.

The fix reads what n8n does expose, and stops reporting the one check n8n never produces:

- n8n/n8n.ts turns(): usage falls back to tokenUsageEstimate when tokenUsage is absent. The estimate is n8n's guess, and the note says so.
- The harness gains RunOptions.unobserved, keyed id|variant: a check name to a reason. The row leaves that check out and its note names it. It is for a permanent client limitation, so it does not hide a bug. Anything else that fails on the row is a fail, not a gap.
- n8n/run.ts declares "finish_reason is stop" unobserved on S1|responses. The S1 responses row is 2/2 and passes.
- render.ts shows the note of a passing row, so summary.md says which check was left out. Only passing rows: n/a rows carry notes too, and they keep their current rendering.

Decision: unobserved checks are per row and named, not a whole-row gap. That keeps the regressions the gap used to hide visible.

Rejected: keeping the gap with a better note. It would still be a perpetual gap, and it would still hide a text regression. Rejected: reporting finish_reason as "stop" for this variant. n8n does not give that value, so the check would pass on a fact the run did not observe.

Validation: bun examples/_harness/run.ts all --target scripted --docker (Colima running), run twice: the second run's diff of the working tree is identical to the first. n8n is pass; summary.md shows the S1 responses rows as pass with the not-checked note. Only n8n's summary changed in this commit. Full test suite: 2424 pass, 0 fail.

Closes #343

**test(tests): cover prompt array times n on legacy completions and record live eval-harness runs** ([`1bd69f1`](https://github.com/jjjermiah/opencode-plugboard/commit/1bd69f1faea2b22177ecacdc7a0a8e47c6b76833))

The legacy /v1/completions case of the n scenario (test/compat/clients.ts) now also sends two prompts with n 2. It checks four choices with indexes 0 to 3, usage summed over the four calls, and the same indexes in a stream. The matrix server (test/compat/matrix.test.ts) raises maxN from 2 to 4 so that request is allowed. Docs: docs/clients/promptfoo.md gets a live Verified record for 2026-10-13, docs/clients/lm-eval.md is new, and the README client table and the vitepress sidebar link it.

Issue 106 left two things open. A prompt array times n had no coverage, because the matrix allowed only two calls and two prompts with n 2 make four. The eval harnesses (lm-evaluation-harness, promptfoo) had no live record.

No new scenario was added. The existing n scenario already covers legacy n and streamed n, so the prompt-array case goes there. A separate prompt-array-n scenario would add a todo or n/a row to every client for one case. The matrix cap is raised for the whole server because it has one maxN. The other cases send n 2 at most, so the wider cap only lets this case through.

Live runs against 127.0.0.1:4010 (main, model fast, max_tokens 1024):

- promptfoo 0.124.1 (npx, pinned), the example config with max_tokens 1024 added in a scratch copy: 2 of 2 pass (text, tool call).
- lm-eval 0.4.13 (venv, lm-eval[api]), local-completions on a generate_until task with --limit 2: exact_match 1.0 (pong, 4).
- lm-eval local-chat-completions on the same task: 1.0 on the rerun, 0.5 on the first run (one empty answer from the reasoning model, recorded in the docs).
- Loglikelihood tasks cannot run: plugboard answers logprobs with 400 unsupported_parameter.
- The dev server has maxN 1, so n 2 gets 400 too_many_choices there. The live runs send no n.

bun test: 2424 pass, 0 fail, compat at its floor of 236. Typecheck clean. Coverage ratchet, coverage manifest, check-pack and smoke-pack pass. docs:build passes. The examples harness passes with no diff under examples/.

Not verified: loglikelihood tasks (the server refuses logprobs), full benchmark suites, and which prompt each choice answers. The fake returns the same text for both prompts, so the matrix cannot tell the mapping apart. The unit tests in test/unit/completions.test.ts cover that.

Closes #106

**test(tests): ratchet test-count floors after merging origin/main** ([`3856024`](https://github.com/jjjermiah/opencode-plugboard/commit/38560246929b7477652489a84b50ca64d35b2f56))

The merge of origin/main brought new tests, so the ratchet raised the test-count floors to the counts on the merged tree (2450 pass, 0 fail). The floors never go down; this commit only records the new counts so the next run starts from them.

Validation: bun test 2450 pass, 0 fail; test-gates.ts --ratchet met.

Refs #275

**test(examples): address the review of #357** ([`a74488a`](https://github.com/jjjermiah/opencode-plugboard/commit/a74488aeab9a09a9e4b5da4e1a27b2599c944c89))

The review found four SHOULDs and some NITs. Each is fixed here.

1. The capture's control routes leaked keys. `--docker` binds the proxy to 0.0.0.0, and GET /__exchanges returned every request header, so a live run's plugboard key was readable from the LAN. Both control routes (POST /__mark, GET /__exchanges) now answer only loopback callers (403 otherwise). GET /__exchanges returns only seq, path (no query), status and the response body, with every credential the caller sent replaced by <redacted> in the body. The proxied routes are unchanged: a container still reaches them. Tests in test/unit/examples-capture.test.ts: the loopback rule, and the route from loopback with a key in the header, the query and an echoed body. A test cannot put a LAN peer on the socket, so the rule is tested as the isLoopback function.

2. The region name form was documented but not enforced, and openai-js broke it (parse, raw, wrong-key, unknown-model). check-regions.ts now enforces the form (`snippet` or `snippet-<kebab-case>`), that each endregion closes the region it names, that regions do not nest and that none is left open. It skips Markdown, whose prose quotes the markers. The four openai-js regions are renamed to snippet-parse, snippet-raw, snippet-wrong-key and snippet-unknown-model (comments only). The logic is in regionProblems(), tested in test/unit/examples-regions.test.ts.

3. tool-bot's roundTrip() asserted exactly two chat calls. The SDK retries and the loop can run more turns, so a live 429 or 5xx would have thrown. It now reads only the status-200 chat completions, takes the first one that asks for a tool and the last one, and assumes no count.

4. n8n's S1 responses row passed `usage present` on n8n's own estimate, which says nothing about plugboard's usage. That check is now listed under `unobserved` with its reason, next to finish_reason, so the row checks only the answer text (1/1). n8n.ts is back to main: nothing reads tokenUsageEstimate now.

The harness refuses an `unobserved` entry that names no planned scenario variant or check, or that would drop every check of its row (test/unit/examples-unobserved.test.ts). A renamed check cannot leave a stale entry, and a row cannot pass with no checks.

NITs: the summary section is titled "Failures, gaps and unchecked items", since a passing row with a note now appears there. The README's Snippet regions section says `snippet` is the first region and lists what the check enforces. The n8n README gives the Responses limit its own bullet. The long capture guard is wrapped.

Validation: bun run typecheck, the examples tsc (openai-js, tool-bot), bun test (2563 tests, 0 fail), test-gates --ratchet (test-count floor raised to unit 1236, committed here), coverage-manifest, check-pack and smoke-pack, docs:build, check-regions. The scripted run with --docker was run twice; the working-tree diff is identical after both. The langchain-js summary changed only in its section title.

Refs #186

**test(tests): ratchet test-count floors after the round-2 tests** ([`4fed3fa`](https://github.com/jjjermiah/opencode-plugboard/commit/4fed3fa356405411bce8e2b66d18f85bf9908df4))

The two new context tests and the merge of origin/main moved the test counts, so the ratchet raised the test-count floors to the merged tree (2453 pass, 0 fail). Floors never go down; this only records the new counts.

Validation: bun test 2453 pass, 0 fail; test-gates.ts --ratchet met.

Refs #275

**test(tests): ratchet the unit test floor to 1249** ([`7d65b38`](https://github.com/jjjermiah/opencode-plugboard/commit/7d65b385df31243fd6314d70f5d73c689c00eb1c))

The gates ran after the merge commit and raised the unit-layer test count floor from 1248 to 1249, the count the tests now report. Floors only ever go up, and the ratchet wrote the file, so the floor moves with the tests that caused it.

Validation: test-gates --ratchet passes on this tree; bun test passes (2559 tests, 0 failures).

Refs #257, #258, #261, #263, #264, #272

#### Docs

**docs(anthropic): explain why caller cache_control TTL 1h is not forwarded** ([`2f5dd69`](https://github.com/jjjermiah/opencode-plugboard/commit/2f5dd69ad5f5cd4bbed8cba40b83c45e9c124f2c))

Callers of the Anthropic Messages route can put cache_control with ttl "1h" on a message block. Plugboard already sends such a block as the default 5-minute breakpoint (#275, earlier change). This commit does not change that. It documents why the 1h TTL stays dropped, in docs/messages.md and CHANGELOG.md, so the next person does not repeat the investigation.

Why 1h cannot be forwarded yet:

- Anthropic requires 1-hour cache breakpoints to come before 5-minute ones in a request (prompt caching docs, "Mixing different TTLs").
- OpenCode builds the request with no cache policy, so its automatic placement always runs for an Anthropic-messages model: a 5-minute breakpoint on the last tool and on the first and last system block (packages/ai/src/cache-policy.ts, AUTO).
- A caller's 1h breakpoint on a message block comes after those system and tool breakpoints. Anthropic would reject the request with
  400. Forwarding it would turn a working caller into a failing one.
- The context hook cannot fix either part. It sets the session's messages, system, tools and options. It has no request cache policy, and it cannot set a tool's cache hint (it rewrites only name, description and schema).

Rejected alternatives:

- Forward ttlSeconds on the part's CacheHint. The host schema accepts it, but the auto breakpoints still precede it, so it is unsafe.
- Turn OpenCode's automatic placement off (cache "none") to make room. That gives up the caching plugboard gets today, for every caller.
- Map ttl to the request's cache policy TTL, the first step in #275. The hook cannot reach the request policy, and a policy TTL only changes the automatic breakpoints, not the caller's.

What would lift the limit: OpenCode orders the breakpoints or lets a hook set the request cache policy. Either is an upstream change, not plugboard's.

Checked: existing tests already pin the host hint as exactly { type: "ephemeral" } (test/session/context.test.ts) and the decoder drops ttl (test/unit/anthropic-request.test.ts). No code changed, so no new test. Validation: typecheck, bun test (2424 pass, 126 skip, 0 fail), coverage gates, coverage-manifest, check-pack, smoke-pack, docs:build and the examples harness all exit 0.

Not verified: a live request through the dev server with a 1h breakpoint. The live check needs main with this change merged and is listed in the PR.

Refs #275

**docs(anthropic): fix 1h release marker to 0.32.0 and correct the 1h cost note** ([`a0e7cce`](https://github.com/jjjermiah/opencode-plugboard/commit/a0e7cceaca2d4ec444b68ad6afe5ae5e03c9532b))

Round-2 review of #353. The 1h TTL change ships in the next minor, 0.32.0; 0.31.0 is released. docs/messages.md and the CHANGELOG bullet said "since 0.31.0", so both now say 0.32.0.

The cost note was wrong. Anthropic bills a 1-hour write for every token up to the highest 1-hour breakpoint (positions A and B in its "Mixing different TTLs" section), whatever breakpoints come before it. So raising an earlier 5m caller block to 1h adds no cost: the caller's 1h block already prices everything before it as a 1-hour write. The docs and CHANGELOG now say so, and say that without the raise Anthropic's documented order is broken.

Code: a comment in orderOneHourHints records a known gap. The host's replaceMedia can swap a part after this pass (a text-only model, or images over the byte budget), and a hint-less replacement can become the tail, which gives 1h, 5m, 1h. It needs an Anthropic-protocol route with those conditions, and the request then fails with Anthropic's order error. Not handled here.

Tests (test/session/context.test.ts): two 1h blocks with a 5m block between them (the 5m is raised, the 5m after the last 1h stays 5m); a whitespace-only hinted text part before the 1h block (raised like any part; the lowering skips it before it spends a slot, checked in packages/ai/src/protocols/ anthropic-messages.ts:905,929); a whitespace-only hinted tail after the 1h block (stays 5m, not pinned).

Validation: see the PR comment for the merged-tree run.

Refs #275

#### CI and tooling

**ci(examples): reject duplicate snippet region names** ([`0e67279`](https://github.com/jjjermiah/opencode-plugboard/commit/0e67279ec08cf425b66ccdba13533f3afa8d1070))

The examples contract allowed one `snippet` region per file, but examples/langchain-python uses named regions and VitePress imports one region with `<<< file#name`. The rule is now: a region is `snippet` or `snippet-<name>`, and each name appears once per file. The rule is written in examples/_harness/README.md under Snippet regions.

examples/_harness/check-regions.ts scans the tracked files under examples/ and fails on a duplicate region name. The examples CI job runs it before the scripted runs. Before this change it failed on examples/curl/{chat,completions,gemini,messages,responses}.sh and examples/openai-python/structured.py, which each declared `snippet` more than once.

The fix renames the later regions after what they show: `snippet-s1`, `snippet-s2`, `snippet-s3`, `snippet-s5` in the curl scripts, and `snippet-raw` in structured.py. The first region of each file keeps `snippet`. Comments only, so no scripted transcript changes.

Not changed: examples/openai-js/errors.ts (`wrong-key`, `unknown-model`) and structured.ts (`parse`, `raw`) use names outside the rule. The check allows them, since it only looks for duplicates. Renaming them is a follow-up.

Closes #338
Refs #186

**ci(examples): rerun the PR checks on the review fixes** ([`c95ea4d`](https://github.com/jjjermiah/opencode-plugboard/commit/c95ea4d5b58f59c381447334a484060383d060bd))

The pull_request workflows did not start for the commit that answers the review (a74488a), so the PR showed the checks of the commit before it. Closing and reopening the PR did not start them either. The branch CI was run with workflow_dispatch and passed, but those runs do not attach to the PR. This empty commit gives the PR a new head so the pull_request workflows run on the reviewed tree. It changes no file.

Refs #186

**ci: re-run checks on the merged head** ([`8d5ce84`](https://github.com/jjjermiah/opencode-plugboard/commit/8d5ce84fa164cf6b7248f0de0a74054b530229a4))

Actions created no runs for 959d21a (the merge with the review fixes), so the PR showed only CodeRabbit. This empty commit is a new push to the same branch and triggers the pull_request workflows again. No content changes, no history rewritten.

Refs #106

</details>
<!-- commit-detail:end -->

## [0.31.0] - 2026-10-13: Know Your Versions

**Full diff:** [v0.30.0...v0.31.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.30.0...v0.31.0)

### Added

- **Package and OpenCode versions on `/plugboard/status`** ([#347](https://github.com/jjjermiah/opencode-plugboard/issues/347), since 0.31.0). The route now names `packageVersion`, the plugboard package version from `package.json` (read once when the plugin loads), and `opencodeVersion`, the host OpenCode version from the plugin context (`ctx.app.version`). `opencodeVersion` is left out when the host gives none, or reports `unknown` or `local` (an unreleased build). `packageVersion` is left out if `package.json` cannot be read, and the plugin still loads. The route keeps its auth. The examples harness reads both from the server when its key can read the route, and falls back to git otherwise, and within 5 seconds.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (6 commits)</summary>

#### Features

**feat(discovery): add package and OpenCode versions to /plugboard/status** ([`da4dc91`](https://github.com/jjjermiah/opencode-plugboard/commit/da4dc9190280b5163267bcc5f3db504c5a9f813d))

The examples harness records which plugboard and OpenCode a live run hit, but the server could not say. It took the version from the checkout's package.json at a commit, and recorded OpenCode as null.

/plugboard/status now names packageVersion, the package.json version read once when src/version.ts loads. It works from a checkout and from an npm install, since src/ sits one level below the package root in both. It also names opencodeVersion, which is ctx.app.version from the plugin context. The host exposes it on Context.app, so no other source is needed. opencodeVersion is left out when the host gives none. The route keeps its auth, and the admin key path answers the same fields.

The harness reads both versions from /plugboard/status when PLUGBOARD_KEY can read it. Otherwise it falls back to git as before. The commit is still checked against the checkout first, so a commit the checkout lacks still stops the run.

Validated: bun run typecheck, bun test (2433 pass, 126 live skips), coverage ratchet, check-pack and smoke-pack, docs:build, and the scripted harness with no examples/ output drift. Against the dev server on main, the new route returns no packageVersion and the harness falls back to git.

Closes #347

#### Fixes

**fix(discovery): drop placeholder host versions and guard the package.json read** ([`7dedbc8`](https://github.com/jjjermiah/opencode-plugboard/commit/7dedbc88f425f3558541b27b0f012038e5935734))

Review of #354 found four gaps in the status versions change.

A dev or unbundled OpenCode host reports the version "unknown" or "local". Those were shown as opencodeVersion, and the harness would record them in a committed live run. They are now omitted, the same as a host that gives no version (hostVersion in src/version.ts).

The package.json read ran at import time with no fallback. A bundled or vendored install would fail to load the plugin to lose one field. The read now returns undefined on any failure, and packageVersion is omitted.

The harness status fetch had no timeout, so a server that accepted and never answered stalled the run before any scenario started. It now aborts after 5 seconds (the timeoutMs argument of servedVersions) and falls back to git.

Tests added: the admin-key branch of /plugboard/status, the index.ts wiring from ctx.app.version (through the spy context, with a placeholder case), the placeholder and unreadable-file cases, and the harness timeout. The duplicate PACKAGE_VERSION check in observability.test.ts is dropped, and the stale #335 test title now says no OpenCode version was reported. Fields stay visible to app keys, as the route already shows uptime.

Merged origin/main (0.30.0). The CHANGELOG bullet moved from the 0.30.0 section back under [Unreleased], marked since 0.31.0.

Validated: bun run typecheck, bun test (2441 pass, 126 live skips), coverage ratchet (floors committed), mutation check (64 of 64 killed), coverage manifest, check-pack and smoke-pack, docs:build, and the scripted harness with no examples/ run output drift.

Refs #347

#### Docs

**docs(docs): add Dify client page (OpenAI-API-compatible provider)** ([`5b25b67`](https://github.com/jjjermiah/opencode-plugboard/commit/5b25b674fbfcd5874bfc6195c9d20e6271101820))

Adds docs/clients/dify.md for Dify's OpenAI-API-compatible model provider, with a row in the README client table and a Clients sidebar entry. The page gives the Add Model fields, the plugboard options (own app key, models and aliases), and what the plugin sends through plugboard.

Decisions: Dify's default Function Call Type is Not Support, so the page says to set Tool Call for agents and tool nodes, and says why. Video, audio and document support stay off because plugboard refuses non-image data URLs as image_url (invalid_image) and accepts a file part only as a PDF data URL (invalid_file). The examples/dify/ compose note from the issue is not added: the page needs no config file, and a compose note would not be run here.

Verified against Dify's docs (read 2026-10-13) and the plugin source at dify-official-plugins 24d1b81 (plugin 0.0.68): provider/openai_api_compatible.yaml for the fields and defaults, models/llm/llm.py for the chat/completions path, the save-time ping (max_tokens 5, a thinking field), and the image and json_schema handling. Not run: no Dify instance was pointed at plugboard, so no chat, stream, agent or structured-output call is confirmed. Dify's own key storage and the behaviour of plugboard on the thinking field were not checked.

Refs #238

**docs(docs): add Home Assistant Extended OpenAI Conversation client page** ([`5df9b8a`](https://github.com/jjjermiah/opencode-plugboard/commit/5df9b8af12398926345e30ee53fc63e49f3cc82a))

Adds docs/clients/home-assistant-extended-openai.md for the Extended OpenAI Conversation custom component, with a README client row and a Clients sidebar entry. The page gives the plugboard options, the setup fields (API Key, Base Url with /v1, Skip Authentication), the Chat model field, and the change_config service for moving an existing entry to plugboard.

Decisions: the issue's "maxTools default 32" is stale. The plugboard default is 64 (configuration.md; 32 was before 0.25.0, per claude-code.md), so the page says that. The default function list is one tool, so maxTools matters only with many custom Functions. The page also says that setup checks GET /v1/models but not the chat model, so a wrong chat model fails on the first turn. The examples/home-assistant/ snippet from the issue is not added: it would only repeat the change_config call in the page, and it could not be run here.

Verified against the component at extended_openai_conversation 66aafab (manifest 3.0.0): config_flow.py and strings.json for the setup fields, helpers.py for the models.list check, services.py for change_config (the entry is updated only after the check passes, and a base URL equal to https://api.openai.com/v1 is removed), const.py and entity.py for the default model parameters, the reasoning-model pattern, the one default function and the stream options. Not run: no Home Assistant instance called plugboard, so no voice or text turn and no service call is confirmed.

Refs #237

**docs(docs): correct Dify structured output, save check and image claims** ([`3c4da72`](https://github.com/jjjermiah/opencode-plugboard/commit/3c4da72f7e0c4c6eeb9f8d2f294c9cdb7ad13ed9))

Fixes docs/clients/dify.md after review of #355. Four claims were wrong or unchecked; the page now states what the pinned sources do.

Structured output: with Structured Output set to Support, the SDK sends response_format {"type": "json_schema", "json_schema": <schema as typed>} with no name or strict wrapper of its own (dify-plugin-sdks 86e81e7, openai_compatible/llm.py, lines 524 to 549). Plugboard requires json_schema.schema to be an object (src/openai/request.ts, parseResponseFormat), so a bare schema gets 400. The Add Model table now lists the field, and the section says the wrapper form is what passes. Whether Dify's schema editor adds the wrapper is not checked.

Save-time check: the first check is the SDK's {model, max_tokens: 5, messages} (SDK lines 236 to 241). The thinking field is added only on a retry after an error that mentions thinking or budget_tokens (plugin llm.py, lines 145 to 149). The max_completion_tokens branch matches the pattern at plugin lines 48 to 50, which allows a dotted prefix. Plugboard ignores unknown body fields (src/openai/request.ts), so thinking and similar fields are not rejected.

Images: Dify sends base64 data URLs by default (MULTIMODAL_SEND_FORMAT=base64, Dify enterprise environment docs), so remoteImages is not needed. url mode sends an http(s) URL from FILES_URL, which plugboard fetches only with remoteImages on.

Also: Model Name and endpoint name wording no longer says "only if" for an empty field, the Stream function calling, Compatibility mode and Thinking Mode rows are in the table, and the URL join is cited to the SDK (lines 562 to 568).

Not run: no Dify instance was pointed at plugboard, so none of these shapes is confirmed on the wire.

Refs #238

**docs(docs): correct Home Assistant functions, AI Task and sampling claims** ([`054b20c`](https://github.com/jjjermiah/opencode-plugboard/commit/054b20c2b4ca0f73a2ebc53f072fb7ad6847ab36))

Fixes docs/clients/home-assistant-extended-openai.md after review of #355.

Functions: a non-empty Functions value replaces the default execute_services tool (conversation.py, lines 225 to 247), so the old "each entry adds one tool" line was wrong. The page now says to copy execute_services in to keep it.

AI Task: with a structure, the component sends response_format json_schema with name (slugified), strict true and schema (entity.py, lines 315 to 323). That is the wrapper plugboard accepts. Marked not run. The conversation agent does not send it.

Reasoning names: gpt-5 and o1 to o4 names also get reasoning_effort (default low) and service_tier (default flex) (entity.py, lines 285 to 294; const.py, lines 241 to 248). Plugboard reads reasoning_effort and not service_tier.

Sampling: with the sample alias claude-sonnet-4-6, HA sends temperature 0.5 and top_p 1. Claude 4.6 and older refuse both together, so plugboard drops top_p and reports it in x-plugboard-dropped-params (src/openai/sampling.ts). Claude 4.7 and newer, and 5.x, drop both. Rules key on the resolved model, not the alias name.

Not run: no Home Assistant instance called plugboard, so none of these shapes is confirmed on the wire.

Refs #237

</details>
<!-- commit-detail:end -->

## [0.30.0] - 2026-10-13: Out of Sight

**Full diff:** [v0.29.0...v0.30.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.29.0...v0.30.0)

### Added

- **Hidden app sessions, opt-in** ([#337](https://github.com/jjjermiah/opencode-plugboard/issues/337), since 0.30.0). `history.hidden` (global, or `apps.<name>.history.hidden` per app, default off) makes each app's request sessions children of one parent session titled `plugboard: <app>`. OpenCode's session lists show root sessions only, so the requests leave the TUI and app lists and the parent shows instead. The parent reuses the prompt-cache anchor machinery: it is made once, recreated once if deleted, and shared with an app-scope `promptCache`. Deleting the parent deletes its requests, and existing sessions are not moved. Not hidden: the settings workspace view. A `promptCache` scope of `user` with `history.hidden` is refused at load.
- **RAGFlow self-hosted page** ([#250](https://github.com/jjjermiah/opencode-plugboard/issues/250)). `docs/self-hosted/ragflow.md` sets plugboard as the chat model for RAGFlow's OpenAI-API-Compatible provider, and names the embedding and rerank providers it still needs. Docs-verified against the upstream source, not run.
- **Onyx self-hosted page** ([#245](https://github.com/jjjermiah/opencode-plugboard/issues/245)). `docs/self-hosted/onyx.md` sets the OpenAI-Compatible LLM through plugboard. Indexing needs an embedding model, which plugboard does not serve, so the page names the local default and the cloud and LiteLLM options. Docs-verified against the upstream source, not run.
- **LLM Vision self-hosted page** ([#247](https://github.com/jjjermiah/opencode-plugboard/issues/247)). `docs/self-hosted/llm-vision.md` gives the Custom OpenAI provider fields and the vision alias. Images go as base64 JPEG data URLs, so `remoteImages` can stay off. The page warns against LocalAI, which sends no key. Docs-verified against the upstream source, not run.
- **paperless-ai self-hosted page and example** ([#243](https://github.com/jjjermiah/opencode-plugboard/issues/243)). `docs/self-hosted/paperless-ai.md` says what works through plugboard: text suggestions and chat, with no vision and no embeddings, because the RAG index runs locally. `examples/self-hosted/paperless-ai` is a compose file and `.env.example` for the custom provider. Docs-verified against the upstream source, not run.
- **Rust (async-openai) client page and example** ([#235](https://github.com/jjjermiah/opencode-plugboard/issues/235)). `docs/clients/async-openai.md` and `examples/async-openai` run a text call, a stream and one tool round trip against plugboard with model `fast`. The crate reads `OPENAI_BASE_URL`; the example sets the base with `with_api_base`.
- **CrewAI client page and example** ([#231](https://github.com/jjjermiah/opencode-plugboard/issues/231)). `docs/clients/crewai.md` and `examples/crewai` run a text call, a stream and a crew task with one tool call against plugboard with model `fast`.
- **AutoGen client page and example** ([#230](https://github.com/jjjermiah/opencode-plugboard/issues/230)). `docs/clients/autogen.md` and `examples/autogen` use the classic `autogen` 0.14.1 `config_list` API. A text call, a stream and a two-agent tool round pass on the OpenAI route with model `fast`. The Anthropic route is not run yet.
- **Semantic Kernel client page and example** ([#229](https://github.com/jjjermiah/opencode-plugboard/issues/229)). `docs/clients/semantic-kernel.md` and `examples/semantic-kernel` run a text call, a stream and a plugin function call against plugboard with model `fast`, on the Python route.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (17 commits)</summary>

#### Features

**feat(session): opt-in history.hidden parents app request sessions under one per-app parent** ([`18eb180`](https://github.com/jjjermiah/opencode-plugboard/commit/18eb180fe8a51344ff038536ae41e8c71183a777))

OpenCode's session lists (TUI, app home, session switcher) show root sessions only. Every plugboard request is a session, so an API app fills those lists with requests nobody opens. Issue #337 asks for an opt-in way to keep them stored and reachable but out of the lists.

What changed:
- Option history.hidden (global) and apps.<name>.history.hidden (per app, overrides the global one; an explicit false keeps an app visible). Default off, so today's top-level sessions are unchanged.
- When on, each request session is a child of one parent titled "plugboard: <app>". The parent is the app-scope prompt-cache anchor: same record (affinity/<app>/anchor/app/), same creation, same single recreate when OpenCode reports the parent deleted (affinity.anchor_recreated).
- A promptCache app-scope anchor and history.hidden on one app share that parent, so the provider cache key stays stable.
- promptCache scope "user" with history.hidden on the same app is refused at config load. The hidden parent is one per app; it cannot also be the per-user anchor without merging users' cache keys.
- If the app is at maxAnchors, the request runs top-level and the warn line history.hidden_parent_unavailable is written.

Decisions:
- Reuse the anchor store rather than a second parent store, so recovery, the cap and the storage keys stay one code path.
- Hidden is kept out of HistoryLimits pruning fields: limitsFor does not copy it and it starts no sweep (the sweep still indexes the child sessions).
- Existing sessions are not moved, because OpenCode cannot reparent one.
- The parent title is "plugboard: <app>" only for the hidden parent. A promptCache-only anchor keeps "plugboard anchor: <app>", so the existing affinity tests and anything reading that title are unchanged.

Rejected:
- Hiding by filtering in OpenCode or in the app: OpenCode has no hidden flag and no plugin call sets one (see the issue's research).
- Letting the hidden parent win over a per-user anchor: silently merges users' provider cache keys, which is the thing promptCache user scope exists to prevent.

Not verified:
- Live on the dev server. It runs main, so this branch cannot be loaded there. The parentID is proven on the fake host in test/session/hidden.test.ts.
- The settings workspace view still lists children (known leak, documented).
- The iOS app is not in this repo and was not checked.

Validation:
- bun run typecheck: clean.
- bun test: 2525 tests, 2399 pass, 126 skip (live), 0 fail.
- test gates --ratchet: all floors met; session 319 -> 325, unit 1200 -> 1210 (floors raised, committed in .github/floors).
- bun run coverage-manifest: 67 covered, 0 gaps.
- check-pack and smoke-pack: ok.
- bun run docs:build: complete.
- examples harness scripted: pass, git diff examples/ empty.
- bun run mutations: 63 of 63 killed, including I30-hidden-off-still-top-level.

Refs #337

**feat(examples): runnable n8n example with scripted and live runs** ([`dc8af3f`](https://github.com/jjjermiah/opencode-plugboard/commit/dc8af3fb348aa6f0e46be4fc6cd3776f606aba68))

examples/n8n/ now has a bun runner (run.ts) that starts the n8n 2.42.6 container, creates an owner, a public API key and an OpenAI credential pointed at the capture proxy, imports and activates the workflows, and runs each scenario through its webhook. The observations come from the webhook answer and the execution's run data (GET /api/v1/executions/{id}): the model's finish reason and token usage from the chat model node, and the tool call from the AI Agent's run metadata. Each scenario has a copyable file (chat, tools, stream, stream_tools, image, structured, models) with a region snippet. E1 and E2 are n/a: n8n shows plugboard's message and LangChain's error class, not the error codes invalid_api_key and model_not_found.

The workflows are the old compat/docker/n8n JSON, copied unchanged except s1-responses-default.json, whose model is now read from the webhook body like the others (it was fixed to fast, and S1 runs every model). The 2026-10-11 record is migrated byte-identical to runs/live/2026-10-11-f351307/REPORT.md; compat/ is not touched.

S1 runs twice: chat (Use Responses API off, the workflows' setting) and responses (the node's default). The responses path answers correctly through plugboard's /v1/responses, but n8n records no finish reason and only an estimated usage, so that variant is a gap (issue 343). S6 is a gap on the scripted target only: n8n's Structured Output Parser needs the output wrapper that the live model writes, and the shared scripted answer has none (issue 344). Changing the shared answer would change other clients' transcripts, so that stays for a later change.

The harness changes are small. PLUGBOARD_TARGET is passed to runners, because a gap can differ by target. A gap key may name a variant (id|variant), so the Responses gap does not touch the chat variant.

Validation: scripted (bun examples/_harness/run.ts n8n --target scripted --docker) gives verdict partial, with every required scenario pass or gap and E1 and E2 n/a. Two runs are identical (sha256 of every file). Live (same command with --target live, against the isolated dev server at plugboard b824d17) gives verdict partial, with the same single gap as scripted and S6 passing. Recorded in runs/live/2026-10-13-b824d17 with a REPORT.md. bun run typecheck passes, the examples unit tests pass, and bun examples/_harness/run.ts all --target scripted exits 0 with no file changed under any other example. The compat key appears in no file under examples/n8n.

Not verified: the n8n UI, Chat Hub, memory sub-nodes, parallel tool calls, reasoning_effort and extra body. The sampling-option (S8) and JSON-mode (S6b) workflows are kept in workflows/ but are not scenarios here.

Closes #184

#### Fixes

**fix(examples): n8n review fixes: execution ids, signal cleanup, live record** ([`aa6ebbf`](https://github.com/jjjermiah/opencode-plugboard/commit/aa6ebbf4dbfa6d7f1eeeb8a61b523751ed746028))

A review of #346 found that lastExecution could read the previous run's execution. It took the newest execution after the webhook answered, but n8n saves a run after it answers, so the previous scenario's run (same workflow, next model, or S3 then S4) could still be the newest, and it returned at once because that run was finished. Now invoke() reads the newest execution id before the webhook call and waits for an execution with a larger id that has a terminal status. An empty list is an error, not a poll on /executions/undefined.

The container and its volume are removed on SIGINT and SIGTERM as well as at the end of the run, because finally does not run on a signal. The volume holds the plugboard key n8n stores in its credential.

The Responses section of the README now says only plain chat was run on that path, and advises leaving Use Responses API off, as docs/clients/n8n.md does. The README no longer links to compat/; it names the migrated record. It also says a gap covers the whole row, because the harness has no per-check gaps. The issues #343 and #344 say the same.

The Python harness (py/harness.py) accepts the id|variant gap key that the TypeScript one does, and the harness README documents PLUGBOARD_TARGET and the gap key forms.

The live record for b824d17 reported plugboard 0.27.0, but that came from a working tree on another branch, not from the commit. Its three version labels are corrected by hand to 0.28.0 and its REPORT.md says so. A new live run is recorded in runs/live/2026-10-13-b92fb6f (plugboard 0.29.0, the main checkout's HEAD when the run started): verdict partial, with the S1 Responses gap as the only gap, and S6 passing live. Which code the dev server on :4010 ran is not verified, because its status endpoint reports no commit.

Validation: the scripted run was made twice (bun examples/_harness/run.ts n8n --target scripted --docker) and the two outputs are identical. bun run typecheck passes; the examples unit tests pass (24); bun examples/_harness/run.ts all --target scripted exits 0 with no change outside examples/n8n and the harness docs. The compat key appears in no file under examples/n8n.

SIGTERM was tested: the runner was blocked after its container started, got SIGTERM, exited 143, and left no container and no volume. Not verified: which code the dev server runs, since its status endpoint reports no commit.

Refs #184

#### Docs

**docs(docs): add paperless-ai self-hosted page and example** ([`2cba6c9`](https://github.com/jjjermiah/opencode-plugboard/commit/2cba6c90ffd481afbf9f5179e3b1ee655154eb3c))

Adds a self-hosted page for paperless-ai, a runnable example, and the index, sidebar, examples README and CHANGELOG rows for them. The page records what works through plugboard: text suggestions and chat, with no vision and no embeddings.

What: docs/self-hosted/paperless-ai.md, examples/self-hosted/paperless-ai (compose file, .env.example, README), the paperless-ai row in docs/self-hosted.md, a sidebar entry, an examples/README row and one CHANGELOG bullet.

Why: #243 asks which paperless-ai features work through plugboard. Checked at upstream d2fda69, the current main head. The custom provider (services/customService.js) sends a text-only chat.completions call. It fetches the document thumbnail and caches it, but never puts it in the request, so no image reaches plugboard. Its RAG index is built locally in main.py (paraphrase-multilingual-MiniLM-L12-v2 and a ms-marco cross-encoder through sentence-transformers), so plugboard needs no embeddings or rerank route. Chat is text, streamed.

Decisions: the example publishes the web UI on 127.0.0.1 only. The upstream compose file publishes on all interfaces, and the setup route is open until setup is done. The example keeps the upstream cap_drop and security_opt. Provider settings come from .env through the compose env_file. dotenv does not overwrite an existing variable, so a value changed in the web UI is ignored while .env sets it. The page documents this and the example README says to edit .env. The app is not changed.

Rejected: a vision alias (the app never sends images). Documenting the upstream rewrite (it is not on main).

Validation: bun run docs:build passes. The example is not run: no live paperless-ai instance was started, so the acceptance check in #243 (a live suggestion through plugboard) is still open. Every claim cites upstream source at d2fda69. The page says "docs-verified, not run".

Refs #243

**docs(docs): add LLM Vision self-hosted page** ([`ce3e84d`](https://github.com/jjjermiah/opencode-plugboard/commit/ce3e84dca49d362c15f7dcdc1b6e37574c80d46a))

Adds a self-hosted page for LLM Vision for Home Assistant, plus its index, sidebar and CHANGELOG rows. The page records that vision works through the Custom OpenAI provider, and that the LocalAI provider cannot be used with plugboard keys.

What: docs/self-hosted/llm-vision.md, the LLM Vision row in docs/self-hosted.md, a sidebar entry and one CHANGELOG bullet. No example: the integration is configured in the Home Assistant UI, not by env or compose.

Why: #247 asks whether LLM Vision can run its image analysis through plugboard, and which image form it sends. Checked at upstream b81d626, the head of main on 2026-09-17. Its Custom OpenAI step (custom_openai in config_flow.py) takes an API key sent as a Bearer token and a full endpoint URL. The OpenAI provider (providers.py) sends images as data:image/jpeg;base64 URLs. It sends no http(s) image URL, so the remoteImages option can stay off. Plugboard accepts max_completion_tokens and json_schema, and checks each data: image's signature (PNG, JPEG, GIF or WebP). The media encoder saves snapshots as JPEG, so they pass.

Decisions: the page points users at Custom OpenAI and names the vision alias. It says not to use LocalAI. That provider builds its request with an empty header set (providers.py, around line 1601), so the plugboard key is never sent and plugboard refuses the call once keys are set. The page states this from source and does not change the integration.

Rejected: a live example (the setup is in the HA UI, so it cannot be a file). Documenting the text-only path: #237 owns it.

Validation: bun run docs:build passes. The page is not run: no Home Assistant instance was set up against plugboard, so the acceptance check in #247 (a snapshot analysed through a vision alias, and whether remoteImages was needed) is still open. The sources were read at b81d626. The page says "docs-verified, not run".

Refs #247

**docs(docs): add Onyx self-hosted page** ([`a4f77a5`](https://github.com/jjjermiah/opencode-plugboard/commit/a4f77a5e125e25984de4916065166ad8a405a162))

Adds a self-hosted page for Onyx, plus its index, sidebar and CHANGELOG rows. The page records that Onyx can use plugboard for chat only: its indexing and search need an embedding model, and plugboard serves none.

What: docs/self-hosted/onyx.md, the Onyx row in docs/self-hosted.md, a sidebar entry and one CHANGELOG bullet. No example: Onyx's LLM provider is set in its admin UI, so there is no env file or compose change to ship.

Why: #245 asks which model roles Onyx needs, and which ones plugboard can serve. Checked at upstream e89ebea, the head of main on 2026-10-13. Onyx's OpenAI-Compatible provider (openai_compatible) sends chat through LiteLLM's openai route, with the base coerced to /v1 (multi_llm.py) and a placeholder key when none is set. Its model list comes from <base>/models (_get_openai_compatible_server_response in api.py). Plugboard's /v1/models lists the aliases for the calling app's key (src/openai/route.ts passes the app, and listAvailableModels narrows the list). The default embedding model is nomic-ai/nomic-embed-text-v1 on Onyx's own model server, and the cloud embedding providers all need their own endpoint. The LiteLLM embedding path posts to whatever URL it is given and reads data[].embedding, so plugboard cannot serve it either.

Decisions: the page sets plugboard as the LLM only and names the embedding options outside plugboard (keep the local default, a cloud provider, or a gateway with /v1/embeddings). The reranker is optional and off by default in the env config. Whether the admin defaults add one was not traced, and the page says so.

Rejected: an example directory (the setup is the admin UI). Claiming the UI labels verbatim: the page names the admin routes and the form fields from the source, and does not quote button text.

Validation: bun run docs:build passes. The page is not run: no Onyx instance was set up against plugboard, so the acceptance check in #245 (the page names each role and its provider, and a live answer through plugboard) is still open. Every claim cites upstream source at e89ebea. The page says "docs-verified, not run".

Refs #245

**docs(docs): add RAGFlow self-hosted page** ([`1b42d3b`](https://github.com/jjjermiah/opencode-plugboard/commit/1b42d3b148bad17fd3e32f59ea95ef9a42b6ba1b))

Adds a self-hosted page for RAGFlow, plus its index, sidebar and CHANGELOG rows. The page records that plugboard can be the LLM for RAGFlow's OpenAI-API-Compatible provider. Dataset embeddings and an optional reranker need another provider.

What: docs/self-hosted/ragflow.md, the RAGFlow row in docs/self-hosted.md, a sidebar entry and one CHANGELOG bullet. No example: RAGFlow keeps model providers in its web UI, so there is no env file or compose change to ship.

Why: #250 asks which RAGFlow roles plugboard can serve. Checked at upstream ae1d8fb, the head of main on 2026-10-13. The provider's URL map (conf/models/openai-api-compatible.json) sends chat to chat/completions, embeddings to embeddings and rerank to rerank, all under the base URL. The chat driver joins the base to chat/completions with a slash (openai_api_compatible.go). So the base must end in /v1, which the docs also say to check. Dataset creation needs an embedding model: the docs say so (dataset_list_and_creation.md) and the embedding setting rejects an empty embd_id (internal/service/dataset/embedding.go). Retrieval uses a rerank model only when one is set (chunk.go).

Decisions: the page sets plugboard as the chat model only. It names the embedding and rerank providers as needing another endpoint, and it does not suggest one. It tells users to leave Thinking off for the plugboard alias: the driver then adds a thinking object or chat_template_kwargs (vllm.go), and plugboard's handling of those fields was not checked. It also warns that auto-listed models are filtered by name-based type inference, so the alias may need adding by hand.

Rejected: an example directory (the setup is the web UI). Quoting UI button text (the page gives the menu path and the field names from the docs).

Validation: bun run docs:build passes. The page is not run: no RAGFlow instance was set up against plugboard, so the acceptance check in #250 (a document uploaded, chunked and answered, with plugboard as the LLM and a separate embedding provider recorded) is still open. Every claim cites upstream source or docs at ae1d8fb. The page says "docs-verified, not run".

Refs #250

**docs: add Rust (async-openai) client page and example** ([`e1fa8da`](https://github.com/jjjermiah/opencode-plugboard/commit/e1fa8da52f91adab1e8a3e3df0c5f0e5566df5bd))

Adds docs/clients/async-openai.md, examples/async-openai (a cargo binary with a text call, a stream and one tool round trip), a Clients sidebar row, a README client-table row, an examples/README row and a CHANGELOG bullet.

Issue #235 says OPENAI_API_BASE is the env var. Checked in async-openai 0.42.2 src/config.rs: the crate reads OPENAI_BASE_URL. The page and the example set the base with with_api_base instead of relying on either env var. Docs: https://docs.rs/async-openai/latest/async_openai/config/struct.OpenAIConfig.html

Acceptance in #235 is met: the client answers and streams through plugboard, and the page is in the README client table. The automated fake-server test in the issue's proposed deliverables is not written here, and the page is not in docs/compatibility.md.

Validation:
- cargo build in examples/async-openai (async-openai 0.42.2, feature chat-completion, cargo 1.98.1): clean after cargo fmt.
- Live run against the dev server 127.0.0.1:4010, model fast, compat key, 2026-10-13: text "pong"; stream "1, 2, 3" (2 text deltas); tool call get_weather({"city":"Lisbon"}) then a final answer that uses the tool result. Exit 0.
- bun run docs:build: pass.

Not verified: Responses API and structured output.

Closes #235

**docs: add CrewAI client page and example** ([`5b39084`](https://github.com/jjjermiah/opencode-plugboard/commit/5b3908469d701495cce8b5d1d44620187b67812f))

Adds docs/clients/crewai.md, examples/crewai/crew.py (a PEP 723 script, run with uv run: a text call, a stream and a crew task that must call one tool), a Clients sidebar row, a README client-table row, an examples/README row and a CHANGELOG bullet.

Acceptance in #231 is met: a crew completes a task with a tool call through plugboard, and the page is in the README client table. Closes #231.

The page checks the config against the CrewAI LLM docs (https://docs.crewai.com/en/concepts/llms). It uses the native OpenAI path (model openai/fast, base_url, api_key). The Anthropic route with custom_openai=True is not run here, and structured output is not exercised.

Validation:
- uv run crew.py in examples/crewai, crewai 1.15.27, against the dev server 127.0.0.1:4010, model fast, compat key, 2026-10-13: text "pong"; stream "1, 2, 3"; tool calls ['Lisbon']; crew answer names sunny, 24 C. Exit 0.
- Raw SSE check: 3 data events from plugboard for a stream request. CrewAI reported 1 non-empty chunk event; the page says so.
- bun run docs:build: pass.

Closes #231

**docs: add AutoGen client page and example (OpenAI route)** ([`42b86a1`](https://github.com/jjjermiah/opencode-plugboard/commit/42b86a1ff3783cd4c5a953b6a41d99b29f4a4b06))

Adds docs/clients/autogen.md, examples/ag2/chat.py (a PEP 723 script, run with uv run: a text call, a stream and a two-agent chat in which the assistant calls one tool), a Clients sidebar row, a README client-table row, an examples/README row and a CHANGELOG bullet.

Package choice: #230 says "autogen or ag2". The classic config_list / ConversableAgent API is in autogen 0.14.1 on PyPI. ag2 1.x (module ag2) is a redesigned API with no ConversableAgent, so the example and page pin autogen.

Refs #230. Acceptance is only partly met: the issue asks for a two-agent conversation with a tool call on both the OpenAI and Anthropic routes. Only the OpenAI route is run here, so the issue stays open. The page and README say "partial".

Validation:
- uv run chat.py (autogen 0.14.1, Python 3.13) against the dev server 127.0.0.1:4010, model fast, compat key, 2026-10-13: text "pong"; stream "1, 2, 3"; two-agent tool round: get_weather(Lisbon) executed, assistant final answer "sunny ... 24°C" from the tool result. The run stops on Maximum turns (4) after the answer; the script's exit code is 0.
- Config checked against the installed LLMConfig and ConversableAgent signatures in autogen 0.14.1.
- bun run docs:build: pass.

Not verified: Anthropic Messages route (api_type anthropic); the scripted fake-server test from the issue.

**docs: add Semantic Kernel client page and example (Python)** ([`08479c5`](https://github.com/jjjermiah/opencode-plugboard/commit/08479c5ea269af0bc550a9abae6fb7e4b3f74657))

Adds docs/clients/semantic-kernel.md, examples/semantic-kernel/chat.py (a PEP 723 script, run with uv run: a text call, a stream and a plugin function call through automatic function calling), a Clients sidebar row, a README client-table row, an examples/README row and a CHANGELOG bullet.

Acceptance in #229 is met: a Semantic Kernel plugin call round-trips through plugboard, and the page is in the README client table. Closes #229.

Scope: the Python route only. The .NET route (AddOpenAIChatCompletion with an endpoint) is documented from the issue and not run. The README row says so.

Validation:
- uv run chat.py (semantic-kernel 1.45.0, Python 3.13) against the dev server 127.0.0.1:4010, model fast, compat key, 2026-10-13: text "pong"; stream "1, 2, 3" (one non-empty content update); plugin calls ['Lisbon']; tool answer "sunny ... 24°C" from the plugin result. Exit 0.
- bun run docs:build: pass.

Not verified: the .NET route; structured output; the Responses-API agent.

**docs: add Spring AI client page (docs-verified, not run)** ([`89625b6`](https://github.com/jjjermiah/opencode-plugboard/commit/89625b63645de6706369cfb159b0603df41f5a27))

Adds docs/clients/spring-ai.md, a Clients sidebar row and a README client-table row. The row says "docs-verified, not run".

Refs #232. Acceptance is not met: it asks for a Spring AI chat client that answers and streams through plugboard, and that was not run. No Java build or run here: Maven is not installed, so there is no example and no CHANGELOG bullet.

The page checks the property names against the Spring AI reference (https://docs.spring.io/spring-ai/reference/api/chat/openai-chat.html): spring.ai.openai.base-url and api-key. Two points stay unverified and are marked as such: the /v1 path behaviour per Spring AI version, and the completions-path property named in the issue, which is not in the Connection Properties table.

Validation:
- bun run docs:build: pass.

Not verified: any Spring AI run against plugboard; streaming, tools and structured output.

**docs: add LangChain4j client page (docs-verified, not run)** ([`1c936d4`](https://github.com/jjjermiah/opencode-plugboard/commit/1c936d4800aac1dfad4d99de11e3a366144954b5))

Adds docs/clients/langchain4j.md, a Clients sidebar row and a README client-table row. The row says "docs-verified, not run".

Refs #233. Acceptance is not met: it asks for a LangChain4j chat and tool call to complete through plugboard, and that was not run. No Java build or run here: Maven is not installed, so there is no example and no CHANGELOG bullet.

The page checks the dependency (langchain4j-open-ai 1.22.0) and the builder (baseUrl, apiKey, modelName) against the LangChain4j OpenAI-compatible page (https://docs.langchain4j.dev/integrations/language-models/openai-compatible/). Unverified and marked: the trailing slash on baseUrl, accumulateToolCallId for plugboard, and whether the OPENAI_BASE_URL path applies to the langchain4j-open-ai-official artifact.

Validation:
- bun run docs:build: pass.

Not verified: any LangChain4j run against plugboard; streaming, tools and structured output.

**docs: address review of client pages (#348)** ([`9f06521`](https://github.com/jjjermiah/opencode-plugboard/commit/9f065214574da33845a614283282cf2d72575d8e))

Fixes from the review of PR 348:

- Spring AI: the model property is spring.ai.openai.chat.model, per the current reference (Configuration Properties table), not spring.ai.openai.chat.options.model. The page now says the reference was read on 2026-10-13 and that the review identifies it as Spring AI 2.0.1.
- LangChain4j: a quirk for the HTTP/1.1 note before 1.23.0, which the review cites. The note was not found in the OpenAI-compatible page sections read here, so the page says it is unconfirmed and not run against plugboard.
- Semantic Kernel: the stream gave one or two content updates across runs; the SSE-count claim is removed because it was not measured.
- Rename examples/ag2 to examples/autogen (git mv), with the page, the examples index and the CHANGELOG link updated.
- AutoGen: the unknown-model line is about autogen's price table, not plugboard.
- CHANGELOG: the async-openai bullet states the env var the crate reads without the internal wording.
- examples/async-openai/Cargo.toml: drop default-features = true (the default). No cargo build was run for this change.
- async-openai page: the OPENAI_BASE_URL / OPENAI_API_BASE quirk is reworded and cites src/config.rs:60.

No behaviour change. Refs #230, #232, #233; #235 still needs its comment.

**docs: keep client bullets under Unreleased after the 0.29.0 merge** ([`8e4d81e`](https://github.com/jjjermiah/opencode-plugboard/commit/8e4d81eee80e80770edb2f8de6296e8669b24785))

Merging origin/main (release 0.29.0) put the four client-page bullets under [0.29.0], which has already shipped without them. Moved them back to [Unreleased] ### Added; [0.29.0] is again identical to origin/main.

Refs #230, #232, #233. Closes #229, #231, #235 when this PR merges.

**docs(docs): correct the self-hosted pages after review of #342** ([`a281531`](https://github.com/jjjermiah/opencode-plugboard/commit/a2815316c29cfea956ed55c5044d92feb3f90211))

Fixes what the review found wrong or unsettled in the four pages and the paperless-ai example. Every change is checked against plugboard source or upstream source at the pinned commits.

paperless-ai: the web UI does not get "ignored while .env sets it". At d2fda69, saveConfig (services/setupService.js, lines 238 to 243) writes data/.env and sets process.env, so a UI change applies at once. After a recreate, the compose env_file value wins again, because dotenv does not overwrite an existing variable. The page's gotcha, the example README and the example .env.example now say so. The page also says the upstream repo is unmaintained (README line 9), cites the rewrite and the paperless-ngx integration (lines 10 and 11), and states that plugboard does not clamp max_tokens (request.ts line 262, context.ts line 47). The example notes that SYSTEM_PROMPT comes from finishing setup.

RAGFlow: the Thinking toggle does nothing through plugboard. parseChatRequest reads only the fields it knows, so thinking and chat_template_kwargs are dropped without an error. The thinking code lives in vllm.go (the compatible driver calls it), and the block is added only when the chat config sets Thinking. The page adds the sampling note: the chat setter sends top_p with temperature, so a Claude 4.6 target drops top_p and reports it in x-plugboard-dropped-params. With dropUnsupportedParams: false the call gets a 400.

LLM Vision: the same sampling note (temperature 0.5 and top_p 0.9 by default). reasoning_effort is never sent for the vision alias, because the provider adds it only for GPT-5 names. The provider docs page is now read: it lists Ollama, Open WebUI and LocalAI as self-hosted and does not list Custom OpenAI, so the page says that step comes from source.

Onyx: "plugboard's image input is data URLs only" was wrong. data: URLs are the default. http(s) URLs are fetched only when remoteImages is on, which is off by default (src/config.ts). The API row now says image generation, not images.

Merge of origin/main is a separate commit, so this diff shows only the page fixes.

Validation: bun run docs:build passes after these edits.

Refs #243, Refs #245, Refs #247, Refs #250

#### CI and tooling

**chore(examples): regenerate the Open WebUI scripted run for the runtime major** ([`da31d65`](https://github.com/jjjermiah/opencode-plugboard/commit/da31d659902513489eca2d3c33ec0f1c485a1a8a))

The harness now records only the runtime's major version in summary.json (see emitClient in examples/_harness/ts/harness.ts), so the committed Open WebUI scripted run says bun 1 where it said bun 1.4. Nothing else changed: the transcripts and the checks are byte-identical. Without this, the Docker run that CI cannot execute would be the one stale record on main, and a local regeneration would show a diff.

Regenerated with bun examples/_harness/run.ts open-webui --target scripted --docker. The diff is two lines in summary.json and summary.md.

</details>
<!-- commit-detail:end -->

## [0.29.0] - 2026-10-13: Every Step on the Record

**Full diff:** [v0.28.0...v0.29.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.28.0...v0.29.0)

### Added

- **Per-step debug lines** ([#262](https://github.com/jjjermiah/opencode-plugboard/issues/262)). At `logLevel: debug`, each model request writes one line per step: `request.received` (app and model asked), `model.resolved` (the target that answered, its failed fallbacks, whether it was a list alias), `session.created`, `model.first_event` and `model.finished` (finish reason, input and output tokens, duration). They hold ids, counts and enums only, never a prompt, body or key. Each is checked against the level before its fields are built, so at `info` none of them is built. The `logLevel` row in [configuration](docs/configuration.md) lists them.

### Changed

- **Releases wait for every check, and the tag is made only on a tested commit.** The release script used to enable auto-merge, which waits only for the required checks, and it tagged the merge commit without checking CI on it. Two gaps let a red commit ship: the host matrix was not a required check, and the merge commit was never tested (v0.25.0 failed on Examples and needed 0.25.1). Now the release pull request merges only after every check on it passes (the advisory benchmark aside), the tag is pushed only after CI passes on the merge commit, and `main` requires one aggregate check, `CI passed`, that needs every CI job. The GitHub release still appears only after npm has the version. See [docs/releasing.md](docs/releasing.md).

### Fixed

- **Live example runs record the version of the commit they name** ([#335](https://github.com/jjjermiah/opencode-plugboard/issues/335)). The harness wrote the checkout's `package.json` version next to a commit from `PLUGBOARD_COMMIT`, so a run of an older commit named the wrong version. It now reads that commit's `package.json`, and refuses a commit the checkout does not have before the runner starts. The server exposes no OpenCode version, so new live runs record `opencode` as `null` with a note in `summary.md`. Existing live records are not rewritten.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (11 commits)</summary>

#### Features

**feat(log): per-step debug lines for a model request at logLevel debug** ([`8f9273f`](https://github.com/jjjermiah/opencode-plugboard/commit/8f9273f3cb199b949e62ddc9565c23f5936940b0))

#262 asked for debug lines that show what one request did, step by step, so an operator who lowers logLevel to debug can follow it. The logLevel and logRequests switches already shipped (3c38d39); the per-step lines were the open part. This adds one line per step through the existing logger:

- request.received: the app and the model the client asked for. The route is not in the caller; it is on the access line with the same request id.
- model.resolved: the target that answered (served), its failed fallbacks, and whether the alias is a list. Written from reportServed (src/fallback.ts), so every route that echoes x-plugboard-model reports it.
- session.created: the OpenCode session id of the request.
- model.first_event: the type of the first event the model produced.
- model.finished: the finish reason, input and output tokens, and duration.

Decisions:
- Each line is one logDebug. The level is checked with debugEnabled() before the fields are built, so info builds no objects for them. A plain logDebug call would still build its object literal at info.
- Only ids, counts, durations and enums are logged. No prompt, body, URL or key, so I14 and the redaction list are unchanged. A test checks that prompt text does not reach a step line.
- Route is not threaded through CallContext. That would be a contract change for one debug field, and the access line already carries route and the same id.
- The access line (request, request.finished) is unchanged at info.

Rejected: a line per streamed delta. It is noise even at debug, and model.first_event answers "did the model start".

Validation: caller.test.ts, fallback.test.ts and log.test.ts pass (69 tests). Not run against the pre-change tree, so the new tests were not shown to fail before the change. Docs: docs/configuration.md logLevel row lists the lines; CHANGELOG under [Unreleased].

Closes #262

**feat(examples): runnable Open WebUI example with scripted and live runs** ([`75b3f46`](https://github.com/jjjermiah/opencode-plugboard/commit/75b3f4651074270f28044abc21109ae629cd163e))

examples/open-webui/ now has a bun runner (run.ts) that starts the Open WebUI 0.12.0 container, signs in, and drives the scenarios through Open WebUI's own HTTP API, with no browser. It has one copyable file per scenario (chat, tools, stream, stream_tools, image, structured, models, wrong_key), each with a region snippet. E2 is n/a: Open WebUI answers an unknown model itself with 400 Model not found, so nothing reaches plugboard.

The harness gains --docker. A container cannot reach the capture proxy on loopback, so with --docker the proxy binds 0.0.0.0 for the length of the run and the runner gets PLUGBOARD_CONTAINER_URL (http://host.docker.internal:<port>). Without --docker the proxy and its environment are unchanged, and `all` still skips Docker examples.

This replaces compat/docker/open-webui.sh with runnable, committed evidence. The old dated record moves under runs/live/ unchanged; compat/ is not touched.

The runner starts the container with docker run, not compose, so it owns the port, volume and env. The image is read from docker-compose.yml, so the pin lives in one place, and the compose file is unchanged for the live setup in the README. Background generation is off (ENABLE_TITLE, TAGS, FOLLOW_UP, AUTOCOMPLETE and SEARCH_QUERY_GENERATION, names checked in the pinned image), because otherwise title, tag and follow-up calls reach the scripted model with prompts it does not answer. The key goes to docker through the environment (-e OPENAI_API_KEY), so it never shows in the process list. Every chat call sends max_tokens 1024, since fast is a reasoning model.

S2 and S4 read the tool call from the stored chat record. Open WebUI runs the tool loop only on the streamed path, and it answers a completion sent with chat_id at once with a task id, so the runner polls until the stored message is done. Parsing the SSE for S4 was rejected for that reason. The bind address was not made per-host: 0.0.0.0 for the run only is simpler, and the proxy never holds a key, it forwards the caller's.

Validation: scripted (bun examples/_harness/run.ts open-webui --target scripted --docker) gives verdict pass with 16 scenario rows passing and E2 n/a, and a second run is identical (sha256 of every file). Live (same command with --target live, against the isolated dev server at plugboard 0cf8030) gives verdict pass, recorded in runs/live/2026-10-13-0cf8030 with a REPORT.md. bun run typecheck passes, bun test gives 2383 pass and 0 fail, and bun examples/_harness/run.ts all --target scripted exits 0 with no file changed under any other example. check-pack, smoke-pack, docs:build, the coverage ratchet and coverage-manifest pass. The compat key appears in no file under examples/open-webui.

Not verified: browser rendering, file upload, RAG and web search, multiple connections, and any Open WebUI image other than 0.12.0.

Closes #183

#### Fixes

**fix(examples): live runs record the version of the commit they name** ([`5286e64`](https://github.com/jjjermiah/opencode-plugboard/commit/5286e6482a16db7d2637b784493d626a6a0ac0a0))

The harness read plugboard.version from the checkout's package.json, but the commit it recorded came from PLUGBOARD_COMMIT. In #328 that gave 0.25.1 for c97ac66, the 0.26.0 release merge, and the four summaries were fixed by hand.

What changed:
- plugboardVersion(commit) reads `git show <commit>:package.json` in the checkout. livePlugboard() pairs that with the commit the run names.
- The commit and version are resolved before the runner starts, so a commit the checkout does not have stops the run up front. The old code recorded "unknown" for that, and the run finished before anyone saw it.
- opencode is recorded as null. The server exposes no OpenCode version. /plugboard/status returns runtimeVersion, which is the plugin runtime's VERSION constant and not the package version. Nothing else I checked exposes either version, so there is nothing to read from the server under test.
- run.schema.json allows opencode null. render.ts writes "OpenCode version not recorded" in summary.md when it is null.
- ROOT is removed, since it was only used for the package.json read.

Rejected:
- Reading the version from the server. Nothing exposes the package version, so the commit is the only source, as the issue asks.
- Rewriting the existing live records. They stay as they are; only new runs use the new rule.

Validation: test/unit/examples-harness.test.ts covers a throwaway repo whose checkout is 0.26.0 while the named commit is 0.25.1. It checks that the named commit's version is recorded, that HEAD is not, and that an unknown commit is refused. It also checks that a live summary with opencode null validates.

Closes #335

**fix(examples): correct the open-webui live version, readme tool count and docker errors** ([`6d8035b`](https://github.com/jjjermiah/opencode-plugboard/commit/6d8035b8dc39a56962ff5b35ce02a692fc49a530))

Review fixes for the Open WebUI example.

The 2026-10-13 live record named plugboard 0.27.0 for commit 0cf8030, whose package.json says 0.28.0: the harness read the version from its own checkout, the bug #335 fixes. The summary, its markdown and the report are corrected by hand and the report says so.

The README said the API-only scenarios send none of Open WebUI's built-in tools. The S2 and S4 transcripts carry 33 tools per request, the example's own tool plus Open WebUI's, so the note now says that and points at maxTools. The install snippet pins the current 0.28.0.

run.ts discarded docker's stderr, so a failed docker run reported only an exit code. The error now includes docker's message.

Refs #183

**fix(examples): address review of #339 (version marker, guard test, harness checkout)** ([`2916391`](https://github.com/jjjermiah/opencode-plugboard/commit/291639176b9e4469cba781aa7a7066c6c98d8280))

The review of PR #339 found six things to fix, and two test gaps.

- The debug-line marker said "since 0.28.0". 0.28.0 is released, so the lines ship in 0.29.0. configuration.md now says 0.29.0. The "pays nothing" wording is now "none of their fields is built at info", which is what the guard does.
- debugEnabled() had no test of its own. The info-level tests passed even with the guard forced to true, because pino drops the line anyway. A new test asserts debugEnabled() is false at info and warn, and true at debug, so an always-true guard fails it.
- The harness default checkout was a hardcoded home path. It is the harness's own repo again (ROOT), as before #335. Setting PLUGBOARD_COMMIT alone no longer needs that path to exist.
- A missing commit now reports git's stderr, and says whether the checkout was PLUGBOARD_CHECKOUT or the default. No path is printed.
- A PLUGBOARD_COMMIT that starts with `-` is refused before git sees it.
- The caller tests now assert the answer text ("Hi", "!") is absent from the step lines too. model.finished gains an outcome field. Tests cover it on a failed prompt (outcome error:502:prompt_failed, no finish) and on a cancelled request (outcome cancelled, no finish).

Rejected: a spy on the field builder. The fields are object-literal arguments built inline, so there is no builder to spy on without a refactor. The guard test checks the value the callers branch on.

Validation: bun test 2397 pass, 126 skip, 0 fail. Coverage ratchet met; the session and unit floors rise to 323 and 1210 and are committed here. Manifest, pack, smoke, docs:build and the scripted harness pass.

Refs #262, Refs #335

**fix(gemini): a non-string role is a 400, not a throw** ([`4685782`](https://github.com/jjjermiah/opencode-plugboard/commit/468578280f91c4047b16ea9c2ecee3472c58f978))

CI on #339 failed one random property run: "any request-shaped body is a 400 or a request" for the Gemini decoder. The shrunk counterexample was a content whose role is an object with `toString: null`. The unsupported-role check built its 400 message with String(role). String() on an object whose toString is not callable throws a TypeError, so the decoder threw where it should refuse. The bug predates this branch. The property test only reaches it on some random seeds, which is why local runs passed.

What changed:
- The message names a non-string role by its type ("object"), not by String(role). A string role gives exactly the same message as before.
- A regression test pins the shrunk counterexample: a 400 with that message.

Rejected:
- JSON.stringify(role). It echoes the client's object into the message, and throws on a value JSON cannot hold.
- Fixing the property test or pinning its seed. The test found a real bug, and the decoder has to refuse it.

Validation: test/unit/properties.test.ts passes (14 tests) on three runs. Full bun test: 2524 tests ran, 126 skipped (live suites), 0 fail. The unit floor rises to 1211 with the new test.

Refs #339

#### Tests

**test(tests): raise the session and unit test floors for #262 and #335** ([`a21d494`](https://github.com/jjjermiah/opencode-plugboard/commit/a21d4947bbc2fd2ad050c0cd3fa041779c23e668))

The ratchet (`bun .github/scripts/test-gates.ts .coverage --ratchet`) counts the tests that ran per layer. The new tests raise two floors: test/session goes from 319 to 321 (the per-step debug line tests in caller.test.ts) and test/unit goes from 1200 to 1206 (the model.resolved tests in fallback.test.ts, the live-version and null-opencode tests in examples-harness.test.ts). The floors only move up. They are committed here, with the tests that raise them, as LANE.md asks.

Validation: bun test passes (2391 pass, 126 skip, 0 fail); the gate reports all floors met after the raise.

#### CI and tooling

**ci: gate releases on every CI job and watch the release checks** ([`5a15d1e`](https://github.com/jjjermiah/opencode-plugboard/commit/5a15d1eaa3b486c737e9a044e65eda10e8d0d0c2))

Releases could ship with a red job. The release script enabled auto-merge, which waits only for the required checks. Examples and CodeQL were not all required, so the release pull request merged and tagged while they were red. v0.25.0 failed that way (Examples red, npm never got 0.25.0, so 0.25.1 had to follow). v0.23.0's Publish run also failed: npm got the version, then the GitHub release step failed ("failed to run git: not a git repository") and a release was made by hand afterwards.

What changes:

- ci.yml: a new aggregate job, "CI passed". It needs every gating job (package, host-versions, host, compat, examples), runs with if: always(), and passes only when each needed job result is "success". Skipped and cancelled count as not passed. The advisory benchmark is not in needs. It runs on push, pull_request, workflow_call and workflow_dispatch, so publish.yml (which calls ci.yml) is gated by it too. The main ruleset should require this one check instead of the individual jobs, because matrix job names change with each host version.
- release.ts --push, step by step:
  1. Preflight: the newest CI run for origin/main's commit must be completed and successful (gh run list --workflow ci.yml --commit). No run, a run in progress or a failed run stops it before anything is committed or pushed. Local main must equal origin/main and the tree must be clean, as before.
  2. Opens the release pull request. Auto-merge is no longer enabled.
  3. Polls gh pr checks until every check has reported and passed. The advisory benchmark is ignored. The required checks must have reported (CI passed, Lint commit messages, Analyze), so an empty list is not a pass. A failing, cancelled or skipped check stops at once: the pull request stays open, the failing checks are printed, nothing is merged or tagged, and the exit code is 1. A 60 minute limit applies.
  4. Merges with gh pr merge --merge --delete-branch --match-head-commit <the head that passed>, so a commit pushed after the check cannot ride along. Then it tags the merge commit and pushes the tag.
- --dry-run prints the CI state of origin/main too, and never fails when gh is missing.
- docs/releasing.md and CONTRIBUTING.md: the release rule, the required checks, the failed-release recovery (fix on main and cut the next patch; never move a pushed tag).

Decisions and rejected alternatives:

- Aggregate job, not a list of matrix job names in the ruleset. The host matrix job names change with each @opencode/plugin version, so listing them would break on every host bump.
- A poll of gh pr checks --json instead of gh pr checks --watch. --watch would also wait for the advisory benchmark, and it cannot exclude a check.
- Merge with --match-head-commit, not auto-merge. Auto-merge gates only on the required checks, which is the bug this fixes.
- CodeQL and Commits stay separate workflows. CI passed cannot include them without merging codeql.yml into ci.yml, which is a bigger change.
- publish.yml is unchanged. Its release job needs publish and attest, and publish needs ci (which now carries CI passed), so a red CI or a failed publish or attestation creates no GitHub release. Confirmed from run history: the v0.25.0 Publish run had its publish, attest and release jobs skipped, and no v0.25.0 GitHub release exists.

Validation:

- actionlint with shellcheck on all workflows: clean.
- bun run typecheck, bun test (2483 tests, 0 failures), test gates with --ratchet, coverage-manifest, check-pack, smoke-pack, docs:build, and the scripted examples (git diff clean).
- release.ts rehearsal against a throwaway bare origin, with a stub gh that emulates the PR merge:
  - dry run: prints the diff, the plan and the CI state; changes nothing.
  - green: merges with --match-head-commit, no --auto, tags v0.27.1 on the merge commit, the release branch is deleted.
  - one required check fails: exit 1, no merge, no tag, PR open.
  - CI on main concluded failure: refuses before any branch is pushed.
  - a check pending and a required check not yet reported: waits, then merges once all pass; the advisory benchmark failing is ignored.

Not verified here: the real GitHub ruleset and gh behaviour (the stub approximates it), and the gh release create step in a checkout-less job (gh release view works without git when GH_REPO is set, which is what the release job sets).

**ci: tag only tested release commits and fix the release gate's gaps** ([`baf3873`](https://github.com/jjjermiah/opencode-plugboard/commit/baf38733ca4448c858ae5e8d58b9e93d97599ae0))

Review of #334 found three gaps. The release script could tag a merge commit that nobody tested: the checks ran on the pull request head, and the merge commit is a new commit. It died when the pull request had no checks yet. And the docs claimed things the code did not do. Also, the Examples check depended on the runner's tool versions.

What changes:

- release.ts, tagging: after the merge, the script waits for the ci.yml push run on the merge commit and tags only when it concluded success. A failed run, a cancelled run or no run within 45 minutes stops the script with nothing tagged, and prints what to do next. A cancelled run is re-run by hand, and only a commit whose CI passed is tagged by hand.
- release.ts, checks: an empty check list, "no checks reported yet" and transient gh errors keep the watch going, bounded by the 60 minute limit. A required check that has not reported after 10 minutes fails the release with its name. The old comment about gh exiting non-zero with JSON was wrong: the exit code is not used, only the parsed list.
- release.ts, --resume: after a failed check and a fix pushed to the release branch, run the same command with --resume from a clean main. It watches the same pull request again and merges the head that passed. A second run without --resume refuses, because the branch exists.
- release.ts, --dry-run fetches origin/main first, so its CI line is not stale. The fetch touches only the remote-tracking ref.
- ci.yml: runs on main are no longer cancelled by a newer push (cancel-in-progress is off for main). Without this, a second push during a release cancelled the run on the merge commit, and the release could not be verified.
- codeql.yml gets workflow_dispatch, and host-bump.yml starts it on its branch with ci.yml and commits.yml. Without it, a host-bump pull request opened with GITHUB_TOKEN never got the required Analyze check, and its auto-merge waited forever.
- Scripted examples: the python and bun harnesses record the runtime's major version only, like curl and bash already do. Python 3.12 on the CI runner against 3.13 on a laptop was the cause of the Examples diff that failed v0.25.0. The scripted runs were regenerated; two runs in a row give identical output.
- docs/releasing.md: the release rule, the ruleset change (only after this change is on main; open pull requests need a new push), how to continue after a failed check (fix on the release branch, then --resume; never merge or tag by hand), which checks gate (every check except the advisory benchmark, skipped counts as not passed, CodeQL and external checks included), and the recovery for a failed or cancelled merge-commit run. The false sentence that the pull request checks ran on the tagged commit is gone.
- CHANGELOG: the Changed bullet names the two real gaps (the host matrix was not required, and the merge commit was never tested).

Decisions and rejected alternatives:

- Stop and tell the operator on a cancelled merge-commit run, instead of re-running it from the script. A re-run is a write to Actions that the operator should choose to make, and the operator can see the run is cancelled.
- The 10 minute grace for a required check, instead of deriving the expected names from the pull request. A pull request does not say which checks are required, so the names stay in the script, and a missing one fails fast with its name.
- An external check such as CodeRabbit gates too. A check that must never block goes into ADVISORY_CHECKS in a reviewed change. This is fail-safe, and the docs say so.

Validation:

- actionlint with shellcheck on all workflows: clean.
- bun run typecheck: exit 0.
- bun test: 2483 tests, 0 failures. test-gates --ratchet: floors met. coverage-manifest: matches. check-pack and smoke-pack: ok. docs:build: exit 0. Scripted examples: run twice, identical.
- release.ts rehearsal against a throwaway bare origin, with a stub gh that emulates the PR merge, the CI runs on main and on the merge commit, and gh's "no checks reported" answer:
  - green: merged with --match-head-commit, the merge commit's CI passed, v0.27.1 tagged on the merge commit.
  - a required check fails: exit 1, no merge, no tag, PR open.
  - no checks reported at the start: waited, then merged and tagged.
  - CI on the merge commit failed: exit 1, merge made, no tag.
  - CI on the merge commit cancelled: exit 1, no tag, re-run hint printed.
  - --resume after a fix is pushed to the release branch: merged the fix head, tagged the merge commit.
- The real GitHub dry run (--dry-run, origin/main): prints the CI state.
- PR checks on the real repository: see the PR.

Not verified here: the grace period expiring (it needs 10 minutes of a check that never reports), the real GitHub behaviour of the ruleset, and a live host-bump run dispatching codeql.yml (it runs on a schedule).

**ci(examples): regenerate the pydantic-ai scripted run with the major version** ([`4b0f413`](https://github.com/jjjermiah/opencode-plugboard/commit/4b0f4136549a46c8a0af2aafbe68daaa44730102))

The Examples check failed on the release-gate PR: main added the pydantic-ai example and its committed scripted run records python 3.13, while the runner ran 3.12 and the harness recorded the minor. The check globs every examples/*/runs/scripted, so this run went stale.

The harness now records the runtime major only (see the previous commit), so the regenerated summary says python 3. Regenerated with `bun examples/_harness/run.ts all --target scripted`, twice: the second run is byte-identical to the first. Only examples/pydantic-ai changed.

**ci: key main's CI runs by commit and wait for the PR head before judging** ([`e6bedd0`](https://github.com/jjjermiah/opencode-plugboard/commit/e6bedd0121e423a278cd8917ce9bdb1c57a57939))

Follow-up review of #334 found two gaps in the release gate.

First, a push to main used the branch as its concurrency group, so a newer push could replace the merge commit's pending run. The group for pushes to main is now keyed by the commit SHA: no later push can cancel or replace an earlier one. Pull request and branch runs keep their groups, so an older run on the same ref is still cancelled by a newer one. The ci.yml comment and docs/releasing.md now say exactly this.

Second, --resume could judge the checks of the previous head: right after a push GitHub can still report the old head of the release branch. The script now waits until the pull request's headRefOid equals the commit it fetched or pushed (waitForHead, bounded by the 60 minute limit) before it watches the checks. The checks it judges are then the ones for that commit. The merge still uses --match-head-commit, so a head that moves after the check is refused.

The CHANGELOG bullet is back under [Unreleased]. The auto-merge of the 0.28.0 release had put it inside the released section; it is removed from there.

Also: the scripted runs of openai-js and tool-bot, which main added, record the runtime major only, like the other examples. Regenerated with `run.ts all --target scripted`, twice; the second run is identical.

Validation:
- actionlint with shellcheck: clean.
- typecheck: exit 0. bun test: 2509 pass, 0 fail. test-gates --ratchet, coverage-manifest, check-pack, smoke-pack: ok. docs:build: exit 0.
- release.ts rehearsal (throwaway origin, stub gh): green path tags the merge commit; a failed check, a fix pushed, then --resume while GitHub still reports the previous head: waited on the stale head, then merged the fix head and tagged the merge commit; merge-commit CI cancelled: nothing tagged.

Not verified here: the SHA-keyed concurrency group on GitHub (only actionlint, which parses the expression); the 10 minute grace expiry; a live host-bump run.

</details>
<!-- commit-detail:end -->

## [0.28.0] - 2026-10-13: Counts That Add Up

**Full diff:** [v0.27.0...v0.28.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.27.0...v0.28.0)

### Added

- **`examples/openai-js` runs the OpenAI JS SDK against plugboard** ([#178](https://github.com/jjjermiah/opencode-plugboard/issues/178)). Every scenario (chat, tools, streaming with and without usage, streamed tool calls, images, structured output, models, errors) is one copyable file, and the scripted run is checked in CI. `examples/tool-bot` gets a runner too; its tool-call checks are a gap until [#320](https://github.com/jjjermiah/opencode-plugboard/issues/320).
- **LangChain JS example** ([#181](https://github.com/jjjermiah/opencode-plugboard/issues/181)). `examples/langchain-js` runs S1 to S7 and the two error paths against a scripted plugboard in CI. Chat Completions and the Responses route are both run for `openai/gpt-5.6-luna#low`; the Responses route is recorded as a gap, because LangChain does not expose a `finish_reason` for it.

### Fixed

- **`count_tokens` and Gemini `countTokens` count what the session sends** ([#201](https://github.com/jjjermiah/opencode-plugboard/issues/201)). The count left out an agent's prompt, a skill's content and the schemas of `serverTools`, so Claude Code could budget against a number that was too small. The count now runs the same builders as the session caller, so it cannot drift from the request: it counts only the caller tools the request offers (none for `tool_choice: none`, one for a named choice), and it refuses what the request would refuse. An app with `tools: false` is also counted without the caller's tools that the request drops. The tool schemas are an estimate: they are converted without OpenCode's draft-07 step.

<!-- commit-detail:start -->
<details>
<summary>Commit-level detail (17 commits)</summary>

#### Features

**feat(examples): add the Vercel AI SDK runnable example** ([`4277849`](https://github.com/jjjermiah/opencode-plugboard/commit/427784937c1bf708967377a5043311cb31589953))

Adds examples/vercel-ai-sdk, the Vercel AI SDK (ai 7) against plugboard, replacing the Vercel AI SDK part of compat/js/vercel_ai.ts. One scenario file per S1-S7, E1 and E2, each with a region snippet readers can copy, a runner on the harness helpers, a README and the committed runs.

What:
- Three ways in, run as variants of each scenario: compat (createOpenAICompatible, Chat Completions), openai-chat (openai.chat(id)) and responses (the default openai(id), POST /v1/responses). Issue #179 asks for all three; the lane brief named two.
- Exact pins in package.json (ai 7.0.137, @ai-sdk/openai-compatible 3.0.67, @ai-sdk/openai 4.0.91, zod 4.6.6, typescript 7.0.2, @types/bun 1.4.2), locked in bun.lock. bunx tsc --noEmit passes.
- Every call sets maxOutputTokens 1024; fast is a reasoning model.
- Finish reasons map tool-calls to tool_calls so the shared checks apply.
- Images go as a file part; the image content part is deprecated in v7.
- S6 uses Output.object. generateObject is deprecated and not used.
- S7 is a plain GET /v1/models with fetch: the SDK has no model-list call.
- CI's examples job runs the scripted target and fails on a diff.
- The 2026-10-11 record moves to runs/live/2026-10-11-3fcedc7/REPORT.md, byte-identical to compat/results/vercel-ai-sdk.md. compat/ is untouched.

Decisions:
- The scenario function takes a client (id -> model) rather than a provider, so one file serves all three ways in.
- The unflagged createOpenAICompatible (no supportsStructuredOutputs) is documented as a gotcha, not run as a variant. The harness keys gaps by scenario id, not variant, so a gap on the unflagged run would also hide real failures on the other variants.

Validation (run from the worktree):
- bun examples/_harness/run.ts vercel-ai-sdk --target scripted: verdict pass, 45 rows (S1-S6 on 3 ways in, S7, E1, E2).
- second scripted run, git diff --exit-code examples/vercel-ai-sdk/runs: byte-identical.
- bun examples/_harness/run.ts all --target scripted, then git diff --exit-code examples/: no diff.
- bun run typecheck: pass. bun test: 2306 pass, 126 skip, 0 fail.

Not verified:
- Live run. The dev server at 127.0.0.1:4010 was not listening when this was written, so no runs/live directory for this example is committed. The lane rules forbid starting or restarting the shared server.

Refs #179
Refs #174

**feat(examples): add LangChain Python example with committed scripted runs** ([`29e629e`](https://github.com/jjjermiah/opencode-plugboard/commit/29e629ee1ab30320428368f13824ac2b0bb4ea3b))

What changed: examples/langchain-python is a standalone uv project that runs the LangChain Python client (langchain-openai's ChatOpenAI) against plugboard. One file per scenario (chat, tools, stream, stream_tools, image, structured, models, errors) plus llm.py, the shared client factory. Each copyable part sits between region markers. run.py is the runner the harness starts and writes nothing. runs/scripted holds the deterministic run; runs/live/2026-10-11-3fcedc7 holds the old compat record, copied byte-for-byte as REPORT.md (cmp-identical to compat/results/langchain.md).

Why this change: part of the runnable-examples epic (#174). compat/ holds the LangChain Python check as a script with no committed output; this makes it a self-checking example whose results can be diffed.

Decisions made:
- Exact pins copied from compat/py: langchain-openai 1.7.0, langchain-core 1.6.9, openai 3.29.0, httpx 0.28.1, pydantic 2.14.1. Python 3.13 in .python-version, the interpreter the old record used. uv 0.12.18 (CI's pin) generated uv.lock.
- use_responses_api=False on every call, so a gpt-5.6 id cannot switch to /v1/responses (the JS client's failure in the old record).
- fast gets max_tokens 1024. LangChain sends it as max_completion_tokens.
- S6 checks the json_schema method, which is what the contract names. The function_calling and json_mode outcomes run in the same scenario and are recorded in observations, not checked. The old record saw json_mode on fast return {}; the scripted model answers every S6 prompt, so the scripted run cannot show that and it stays a live-only question.
- No gaps and no n/a in the scripted run. LangChain has no list call, so S7 lists through root_client.models.list().
- CI's examples job runs langchain-python with the other scripted runs. It takes a few seconds on top of the existing uv install.

Rejected alternatives:
- One shared client object passed to every file: a factory is needed because fast takes max_tokens and each scenario builds other model ids.
- Checking json_mode as a scenario failure: that would turn a known model behaviour into a required failure before the live run has been looked at.

Validation (worktree, scripted target):
- bun examples/_harness/run.ts langchain-python --target scripted: pass, 16 rows, all checks ok. Run twice, git diff --exit-code clean.
- bun examples/_harness/run.ts all --target scripted && git diff --exit-code examples/: exit 0, clean.
- bun run typecheck: exit 0. bun test: 2306 pass, 0 fail, 126 skip.
- bun test --coverage plus test-gates --ratchet: floors met, no floor changed. coverage-manifest: ok. check-pack and smoke-pack: ok. docs:build: ok.

Not done yet: the live run. The isolated dev server on 127.0.0.1:4010 was not listening at the time of the run (connection refused), and it is shared with other lanes, so it was not restarted. Live directory and REPORT.md are still to be recorded.

Refs #180

**feat(anthropic): count the persona, skill and server tools in count_tokens** ([`c8c504f`](https://github.com/jjjermiah/opencode-plugboard/commit/c8c504f4d4ea365d3e7339eb75156cf6824f1a94))

count_tokens and Gemini countTokens estimated the caller's parsed request only, plus the app's system policy and the tool-choice steering (#201). The session also adds an agent's prompt (agent/<name> replaces the system prompt), a skill's content (a skill alias leads it) and the schemas of the app's serverTools, so Claude Code sized its context against a number that was too small.

What changed: sessionRequest (src/session/caller.ts) builds the request the way the session caller does, with personaPrompt shared by both, so the count cannot drift from what is sent. It applies the app's tools policy (tools: false drops the caller's tools in the count too, as in the request), the persona prompt, requestSystem, and the serverTools schemas unless tool_choice is none. The session port gets directToolSchemas, and RouteHost gets an optional session that index.ts fills with the same callerDeps the session caller uses. With no persona and no serverTools the count reads nothing from the host, as before.

Decisions: a skill or agent that is missing, a server tool the location does not offer, and a refused backend get the error the request would get, so a count never reports a size for a request that would fail. Tool schemas are converted like OpenCode core does (standard JSON Schema, Effect schema, plain object) but without core's draft-07 step, because core's conversion is internal and plugboard may not import it. The count is still an estimate.

Rejected: reading the schemas from the session's context hook (no session exists when counting); importing OpenCode's tool conversion (internal to core, and session code may not import core at runtime).

Validation: bun run typecheck clean; bun test 2316 pass, 0 fail; coverage 98.6% lines and 94.5% functions, at the floors; coverage-manifest, check-pack, smoke-pack, docs:build and the scripted examples pass. New tests in test/http/messages.test.ts and test/http/gemini.test.ts cover skill, agent, missing skill, server tools, tool_choice none, unavailable server tool and the backend refusal; test/session/server-tools.test.ts covers directToolSchemas.

Closes #201

#### Fixes

**fix(examples): pydantic-ai S6 reads the output tool before the text** ([`daae0f9`](https://github.com/jjjermiah/opencode-plugboard/commit/daae0f9733cdc202a3f33e9445b897f9aa2f56ee))

Claude answers tool-mode structured output with a text part and a final_result tool call in one message. The observation took the first part, the text, and failed to parse it as JSON on the live run at c97ac66 (JSONDecodeError). pydantic-ai had already validated the tool call.

Now the output tool arguments are read first, text only when there is no tool call. The scripted run is unchanged: its transcripts did not move.

Refs #182

**fix(examples): record the live run as plugboard 0.26.0 and split the error scenarios** ([`14c70d3`](https://github.com/jjjermiah/opencode-plugboard/commit/14c70d32dc647af8c72d81f3c2fee703fc025b53))

Review of #323 (SHOULD and NIT items). Five changes:

1. Live record version. runs/live/2026-10-13-c97ac66 said plugboard 0.25.1. The commit is c97ac66, the 0.26.0 release merge, so the record was wrong. The harness reads the version from the checkout's package.json, and this branch was based on 3e6960a (0.25.1), so the two disagreed. The branch now merges origin/main, so package.json reads 0.26.0 at c97ac66. Fix: edited plugboard.version in summary.json and the header line in summary.md (0.25.1 -> 0.26.0). The harness has no render-only path, and re-running the live target would write a second directory, so I edited the two files. Nothing else in them changed; the transcripts are the 0.26.0 server's and were not touched. The live directory name stays 2026-10-13-c97ac66. The earlier commit subject and body (96873f3) still say 0.25.1; this commit supersedes them. The README known-gaps line now says 0.26.0.

2. errors.ts split. It held two regions named "snippet", which VitePress reads ambiguously, and two scenarios in one file. Now wrong_key.ts (E1) and unknown_model.ts (E2), each with one region, and run.ts imports both. The requests are the same as before by inspection; the live run was made with the combined file and not re-run after the split.

3. README. The table lists the two files. The known-gaps and gotchas name the new file names and 0.26.0.

4. docs/clients/vercel-ai-sdk.md. Header: tested live 2026-10-13 at 0.26.0, all 45 rows pass; the 2026-10-11 record is older. Responses gotcha: the 2026-10-11 record failed every scenario on openai(id) with a 404 (no route yet); the 2026-10-13 live run passes all 45 rows on it. The old "All 17 scenarios passed" sentence was wrong against the migrated record.

5. examples/README.md. It is hand-written (no generator exists on this branch), so I added the vercel-ai-sdk row.

Decisions:
- "Show both settings" (#179) is not fully met. The unflagged createOpenAICompatible case is a README gotcha, not a run variant. The harness keys gaps by scenario id, not variant, so a gap on that run would hide real failures on the other variants. The unflagged failure is shown only by the 2026-10-11 record, not a current run.
- No gap entries. The live run passes everything.

Validation (from the worktree, after the merge):
- bunx tsc --noEmit in examples/vercel-ai-sdk: exit 0.
- bun examples/_harness/run.ts vercel-ai-sdk --target scripted, twice, git diff --exit-code examples/vercel-ai-sdk/runs/scripted between them: exit 0. The runs match the committed state.
- bun examples/_harness/run.ts curl and openai-python --target scripted, then git diff --exit-code on their runs: exit 0.
- bun run typecheck: exit 0. bun test: 2483 tests, 0 fail.

Closes #179
Refs #174

**fix(anthropic): count only the tools a request sends, and refuse what it refuses** ([`85a45b1`](https://github.com/jjjermiah/opencode-plugboard/commit/85a45b1240eeb0febf1e7db52c59b42964008a25))

Review of #329 found that the count answered a size for requests the session would never send or would refuse, and that its docs said otherwise.

The count listed every caller tool. The session seeds only what seedToolsFor returns: none for tool_choice none, only the named tool for a named choice. sessionRequest now uses seedToolsFor, and the test that asserted the drifted number (a caller tool counted under none) now expects 1. A named choice case is added.

sessionRequest also runs the pure refusals stream runs, in the same order and before any host read: checkAppModel, checkAppTools and checkServerToolNames. It runs the ungranted server-tool check against the operator's agent rules too (ungrantedServerTool, the same as the request), so a count reports no size for a request that would be refused with 400. Image preparation is still not run; the request's decoders already enforce the global tool cap.

test/session/session-request.test.ts covers the tools policy (caller tools and steering dropped; a structured tool kept, forced), model scope, maxTools, the name clash, the operator refusal, tool_choice none, a named choice, granted server tools, and the no-session fallback. The route tests in messages.test.ts add the named choice and the unoffered-tool refusal.

The count paragraph in docs/messages.md is now a short list plus one sentence on side effects (app directory, Location boot, possible 503, the host's tool and agent reads). docs/gemini.md points there. Mirroring the operator check was cheap, and a size for a refused request would mislead budgeting, so the gap is not documented instead.

Validation: typecheck clean; bun test 2327 pass, 0 fail; coverage at the floors (98.6% lines, 94.5% functions); the ratchet raised the test-count floors (http 532, session 311); coverage-manifest, check-pack, smoke-pack, docs:build and the scripted examples gate pass; bun run mutations 53 of 53 killed.

Refs #201

**fix(examples): correct the LangChain Python example after review** ([`87bd680`](https://github.com/jjjermiah/opencode-plugboard/commit/87bd680f51972a3bd47bf8d5e95ca8b1ebf4941c))

What changed:
- Merged origin/main into the branch (a merge commit, not a rebase).
- Live record runs/live/2026-10-13-c97ac66: plugboard version is 0.26.0 in summary.json, summary.md and REPORT.md. The earlier 0.25.1 came from the worktree's package.json, which was older than the main checkout at c97ac66.
- Reverted the examples/README.md index row. The index has no generator and no "generated" marker, and #174 gives it to the docs issue, so the example does not touch it.
- Snippet regions: tools.py and errors.py had duplicate "snippet" names, so each region is now named (snippet-tool, snippet-round-trip, snippet-wrong-key, snippet-unknown-model). stream_tools.py moves get_weather inside its snippet region. llm.py keeps max_retries out of the copyable region: it is now a module-level NO_RETRIES constant.
- docs/clients/langchain-python.md: the Tested header names the 2026-10-13 live run against c97ac66 (0.26.0), and the error classes at the gotchas are openai.AuthenticationError and openai.NotFoundError, which the example catches. Docs pages belong to the docs issue; this is the one edit made here on the reviewer's request.
- README Known gaps names the live pass.

Why: review asked for unique region names so the docs can include the S2 round trip and the unknown-model case, a copyable region that holds only the example's own code, and a live record that names the right plugboard version.

Decisions: the scripted run is regenerated twice and is byte-identical across both runs. Live transcripts are unchanged; the code change moves a constant and renames markers, so the wire traffic does not change.

Rejected: rerunning the live record under a new directory, since the record is being corrected, not re-measured, and a new run would need a live server round trip. Rebasing onto origin/main, which the review did not ask for.

Validation: bun run typecheck exit 0. bun test: 2483 tests, 0 fail. Coverage ratchet met with no floor change. coverage-manifest, check-pack, smoke-pack and docs:build all exit 0. bun examples/_harness/run.ts all --target scripted then git diff --exit-code examples/: exit 0, no diff.

Refs #180

**fix(docs): make the vercel-ai-sdk live record a code path, not a link** ([`c77cf51`](https://github.com/jjjermiah/opencode-plugboard/commit/c77cf5117a15c2dd552eb12119fcfeea3c8ad08c))

CI's docs build failed: VitePress reads a link to a file outside docs/ as a dead link. docs/clients/vercel-ai-sdk.md linked to examples/vercel-ai-sdk/runs/live/2026-10-13-c97ac66/summary.md. The path is now plain code. `bun run docs:build` passes locally.

Refs #179

#### Tests

**test(examples): pydantic-ai runnable example with scripted runs (#174, #182)** ([`032caa1`](https://github.com/jjjermiah/opencode-plugboard/commit/032caa1e7cbee49d66463c3d0920db03a1d15099))

Adds examples/pydantic-ai, the pydantic-ai (OpenAIChatModel, Chat Completions) client example from the runnable-examples epic. It replaces the pydantic-ai part of compat/py for the examples track; compat/ itself is not touched.

What
- One copyable file per scenario: chat.py (S1), tools.py (S2), stream.py (S3), stream_tools.py (S4), image.py (S5), structured.py (S6), models.py (S7), errors.py (E1, E2). Snippets sit between region markers.
- run.py, the runner the harness starts. It writes nothing.
- Exact pins: pydantic-ai-slim[openai]==2.55.0, openai==3.29.0, pydantic==2.14.1, httpx==0.28.1. .python-version 3.13, uv.lock.
- runs/scripted: the deterministic run, all 3 models pass every scenario.
- runs/live/2026-10-11-3fcedc7/REPORT.md: the old compat/results record, copied byte for byte.
- ci.yml examples job: the scripted run and the stale-run diff now include pydantic-ai.

Decisions
- Every scenario is async and runs on its own event loop. run.py opens a client per scenario and closes it inside that loop. A pooled httpx connection cannot cross loops (RuntimeError: bound to a different event loop), and pydantic-ai's run_sync makes a loop per call.
- max_tokens 1024 on every model (ModelSettings), so fast has room to reason.
- finish_reason: pydantic-ai names the wire value tool_calls "tool_call". The observation maps it back so the shared checks stay unchanged.
- S3 done: pydantic-ai reads the stream to its end, and the SDK consumes the [DONE] frame. The observation is "the stream ran to its end without error"; the transcript keeps the raw frame.
- S6 uses tool mode (output_type=Meal). The observation reads a tool call or text, because the provider decides which.
- S7 uses the OpenAI client under the provider: pydantic-ai has no list-models API.
- Rejected: ImageUrl data URL (the old record's second form). BinaryContent already goes out as a data URL, so one form covers S5.

Validation
- bun examples/_harness/run.ts pydantic-ai --target scripted: pass, all 3 models, every required scenario. Second run byte-identical (diff -r against a snapshot of the first).
- Known scripted limit: pydantic-ai sends tool_choice "required" for tool mode, not a named tool, so the scripted model answers S6 as text. The forced-tool branch of scripted-model.ts is not exercised by this example.

Not verified
- Live run. The dev server at 127.0.0.1:4010 was not listening when this was written (connection refused), and the lane rules forbid restarting it. runs/live has only the historical record. The checkbox in #182 stays open.

Refs #182

**test(examples): add the LangChain JS example, with scripted runs and a CI check** ([`768d3c5`](https://github.com/jjjermiah/opencode-plugboard/commit/768d3c52dbb1f4c71d546d920625d37e95282d89))

Part of the runnable-examples epic (#174). examples/langchain-js/ replaces the LangChain JS parts of compat/js. It runs S1 to S7 and the two error paths through @langchain/openai, one copyable file per scenario, and writes the scripted run under runs/scripted/ through the harness.

What changed
- Standalone bun project with exact pins from compat/js: @langchain/openai 1.6.2, @langchain/core 1.2.17, openai 7.32.0, zod 4.6.6, typescript 7.0.2, @types/bun 1.4.2. bun.lock is committed; CI installs with --frozen-lockfile through run.ts.
- chat.ts, tools.ts, stream.ts, stream_tools.ts, image.ts, structured.ts, models.ts, errors.ts: one scenario each, snippet between // #region snippet markers, import.meta.main block so each file runs alone.
- run.ts: the runner. Imports the scenario functions, passes the proxy URL and key from the environment, emits the client line, calls runAll. Writes nothing.
- README.md: what each file shows, setup, the gotchas (checked against this run), and the known gaps.
- runs/scripted/: summary.json, summary.md, one transcript per scenario and model. The verdict is partial: S1 and S2 on openai/gpt-5.6-luna#low are gaps.
- .github/workflows/ci.yml: the examples job runs langchain-js with the scripted target and includes its runs/scripted in the freshness check.
- CHANGELOG.md: one bullet under Unreleased.

Decisions
- Every scenario sets maxTokens 1024, not only fast. It maps to max_tokens on chat models and max_output_tokens on the Responses path, so one setting covers all three models, as messages.sh does in examples/curl.
- gpt-5.6* ids go to /v1/responses. @langchain/openai forces that route for the id and ignores useResponsesApi: false, so no setting avoids it. The example does not work around it; the run records the real route.
- The Responses path sets no finish_reason in response_metadata (the reply has status "completed"). S1 and S2 on gpt-5.6-luna#low are recorded as gap with #104 (Responses API clients) as the tracking issue. No new issue, since #104 already covers Responses client behaviour. The tool-call and text checks pass.
- S6 checks the jsonSchema (text) and functionCalling (forced tool) forms, as the contract asks. jsonMode runs too but is not checked: on fast it returned {} in the 2026-10-11 record. Its request is in the S6 transcripts.
- S7 uses the openai SDK directly. LangChain has no list-models call.
- The old 2026-10-11 record (compat/results/langchain.md) is not moved here. It covers Python and JS and moves with examples/langchain-python.

Rejected
- Wrapping the error checks in a helper. The snippet has to be complete for a reader who copies it, so each error path keeps its own try/catch.
- Running the Chat Completions path for gpt-5.6 via a different model id. That would hide the route the docs say plugboard serves.

Validation
- bunx tsc --noEmit in examples/langchain-js: clean.
- bun run typecheck: clean.
- bun test: 2306 pass, 126 skip, 0 fail.
- bun examples/_harness/run.ts langchain-js --target scripted, twice: the second run gives git diff --exit-code with no change (DIFF=0). Verdict partial, exit 0.
- No key literal in runs/: grep for the scripted key finds nothing.

Not verified
- Live run: the dev server on 127.0.0.1:4010 was not listening (no listener on the port; connection refused). The lane says not to restart it, so the live run is not recorded here and runs/live/ does not exist yet.

Refs #181

**test(examples): record the LangChain Python live run against plugboard c97ac66** ([`65f16d3`](https://github.com/jjjermiah/opencode-plugboard/commit/65f16d36cf4c65c61b126c53f960d694c9a42e1b))

What changed: examples/langchain-python/runs/live/2026-10-13-c97ac66 holds the live run of the LangChain Python example against the isolated dev server at 127.0.0.1:4010, which loads the main checkout at c97ac66. The directory has summary.json, summary.md and the transcripts, written by the harness, plus a REPORT.md with the human notes. Every scenario passed on every model: fast, anthropic/claude-haiku-4-5 and openai/gpt-5.6-luna#low. The ChatGPT model was not quota-limited on this run. Nothing failed, so no gaps and no issues were filed.

Why this commit: the scripted run was already committed in 29e629e. The acceptance in #180 also asks for a recorded live run. With it recorded, the example is complete, so this commit closes the issue.

Decisions: the live directory is named by the run's UTC start date, which is 2026-10-13 here. The local date was still 2026-10-12, so the name follows the harness, not the local clock. PLUGBOARD_COMMIT was set to c97ac66, the main checkout's HEAD, because the dev server loads that checkout, not this branch. The app key was read from the isolated config into an environment variable and never printed; grep finds it in no file under the example.

Rejected: rewriting the scripted run or the old 3fcedc7 record. Both stay as they were.

json_mode on fast, which the contract does not check, returned valid JSON on this run (one sample). The empty-object answer from the 2026-10-11 record did not reproduce, so no gap entry is needed. The sample is not a fix claim.

Validation: bun examples/_harness/run.ts langchain-python --target live exited 0 with verdict pass, 16 rows. The app key appears in no file under the example. Scripted run from the earlier commit is unchanged.

Closes #180

**test(examples): record the vercel-ai-sdk live run against plugboard 0.25.1** ([`96873f3`](https://github.com/jjjermiah/opencode-plugboard/commit/96873f34f665081089ecf85129e9dcd70edfb682))

Runs the Vercel AI SDK example against the isolated dev server (127.0.0.1:4010, main at c97ac66) with the compat app key. Verdict pass: all 45 rows pass on all three ways in (compat, openai-chat, responses), including openai(id) on /v1/responses, which the docs page and the 2026-10-11 record listed as failing.

Why: the example's live target had never run, so the scripted pass proved only the harness path. This is the first real provider run.

Decisions:
- No gaps. Nothing failed, so no issue was filed and no gaps entry was needed.
- README "Known gaps" now names this run. The 2026-10-11 record stays unchanged, and its superseded note points at this run.
- docs/clients/vercel-ai-sdk.md was not edited: it never said openai(id) fails. It already says the Responses path passes.

Validation:
- PLUGBOARD_COMMIT=c97ac66 bun examples/_harness/run.ts vercel-ai-sdk --target live -> "vercel-ai-sdk live: pass", exit 0.
- Directory runs/live/2026-10-13-c97ac66 holds summary.json, summary.md and 46 transcripts (45 scenario rows plus _background.json).

Refs #179
Refs #174

**test(examples): record the LangChain JS live run at c97ac66** ([`2291dae`](https://github.com/jjjermiah/opencode-plugboard/commit/2291daea6795e86a3807c52cd57e13fd4d91cbc1))

Live run against the isolated dev server (plugboard 0.25.1 at c97ac66, compat app key). Verdict partial, the same as the scripted run: S1 and S2 on openai/gpt-5.6-luna#low are gap (#104, no finish_reason on the Responses path). Everything else passes, including S5 and S6 on the ChatGPT model, so no quota limit during the run. jsonMode on fast returned a correct object once (not checked; see REPORT.md).

Refs #181

**test(examples): scripted model forces a single tool on tool_choice required** ([`34ba924`](https://github.com/jjjermiah/opencode-plugboard/commit/34ba924b95bd0f757f625477e7505338be9e1043))

The scripted model answered only named forced tools. pydantic-ai's tool-mode structured output sends tool_choice "required" with its one output tool, so the scripted S6 run answered as text and never reached the forced-tool branch.

What
- scripted-model.ts: tool_choice "required" with exactly one tool forces that tool. Named tool choices and auto/none are unchanged.
- Regenerated scripted runs: only examples/pydantic-ai/runs/scripted S6 transcripts for fast, anthropic/claude-haiku-4-5 and openai/gpt-5.6-luna#low changed (the answer is now a final_result tool call). curl and openai-python runs did not change.

Decisions
- Matching on "required" with one tool, not on the tool name, so any client that sends the same shape gets the same answer.
- Rejected: a pydantic-ai-specific answer in the scenario. The harness owns the scripted behaviour.

Validation
- bun examples/_harness/run.ts all --target scripted: exit 0, every scripted example passes.
- Second run: examples/ byte-identical to the first (diff -r).

Refs #182

**test(examples): pydantic-ai live run against the isolated server at c97ac66** ([`853ac18`](https://github.com/jjjermiah/opencode-plugboard/commit/853ac183b798cfcbf6225708b55e5d12c8e47816))

First live run of the pydantic-ai example on the isolated dev server, with the scripted-model and S6 fixes in this PR. Closes #182.

What
- runs/live/2026-10-13-c97ac66-2: all 16 rows pass on fast, anthropic/claude-haiku-4-5 and openai/gpt-5.6-luna#low. S7 lists the models, E1 gets 401 invalid_api_key, E2 gets 404 model_not_found.
- runs/live/2026-10-13-c97ac66: the first attempt, kept as the record. S6 on Claude failed in structured.py, which read the text part before the tool call. REPORT.md there explains the cause and the fix (daae0f9).
- runs/live/2026-10-11-3fcedc7: the old record, unchanged (earlier commit).

Decisions
- The live directory is named for the plugboard commit the server runs (PLUGBOARD_COMMIT=c97ac66, the checkout HEAD). The second run gets -2, since live directories are never rewritten.
- No gaps: nothing failed plugboard-side.
- Keys: read from the isolated config into the environment, never printed or written. The writer refuses any file containing the key.

Validation
- bun examples/_harness/run.ts pydantic-ai --target live: pass (the -2 run); the first run failed only on the structured.py bug.
- bun examples/_harness/run.ts all --target scripted, then git diff --exit-code examples/: exit 0.
- bun run typecheck: exit 0. bun test: 2432 tests, 0 fail.

Closes #182

**test(examples): address review of the LangChain JS example (#181)** ([`5ae8a7a`](https://github.com/jjjermiah/opencode-plugboard/commit/5ae8a7a5c9ad230ab27ef5b83bb5cb435f3b7ec4))

Review of #327 (PR comments, 2291dae). What changed, and why.

Variants (S1, S2)
- chat.ts and tools.ts take a variant: "chat" uses ChatOpenAICompletions, which always calls /v1/chat/completions; "auto" uses ChatOpenAI, which sends gpt-5.6* ids to /v1/responses.
- On luna the chat variant passes both scenarios. The auto variant stays a gap (#104), with the note "LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)". Plugboard's reply is correct; the client does not expose the field.
- The gap is keyed per scenario and model, not per variant, so a future failure of the chat variant on luna would also show as a gap. Accepted for now; the harness has no variant key.

errors.ts split (VitePress allows one snippet region per file)
- wrong_key.ts (E1) and unknown_model.ts (E2), one region each. errors.ts removed.

Checks that could not fail
- stream.ts: done is true only when the stream produced a message (it was hard-coded true).
- structured.ts: extra_keys is read from the raw model text (includeRaw). Zod drops unknown keys from parsed, so the old check was always empty.

Snippets
- The prompts, fixtures and tool definitions move inside the region, so a copied snippet runs without the rest of the file. Imports stay outside.
- stream_tools.ts reads the shared get_weather result like tools.ts; S4 streams the call and never runs the tool body.

Scripted run
- Regenerated twice; git diff --exit-code clean after the second run.

Live record
- New run runs/live/2026-10-13-c97ac66-2 at the same commit c97ac66 (a second live run, with the variants). REPORT.md explains it.
- Hand edit, not a harness output: the harness reads plugboard.version from the worktree's package.json (0.27.0 after the merge), and c97ac66's package.json says 0.26.0. The version is corrected to 0.26.0 in summary.json, summary.md and REPORT.md of the -2 directory, and in summary.json, summary.md and REPORT.md of the first directory (2026-10-13-c97ac66, which said 0.25.1). Nothing else in the live records was edited.

Docs and README
- README: the variants, ChatOpenAICompletions snippet, the two error files, a relative link to the 2026-10-11 JS record (in examples/langchain-python, moved by #326), and the known-gaps table with the variant.
- docs/clients/langchain-js.md: Tested header now the 2026-10-13 run (linked on GitHub: VitePress reads a relative link out of docs/ as dead), and the Responses gotcha says which scenarios pass on which route.

Validation
- bun run typecheck: clean. bunx tsc --noEmit in examples/langchain-js: clean.
- bun run docs:build: built (one dead-link error fixed by the GitHub link above).
- bun examples/_harness/run.ts all --target scripted: exit 0, clean diff.
- bun test: 2483 pass, 0 fail, 126 skip.

Refs #181

**test(examples): split errors, fix live plugboard version, harden scripted tools** ([`7ff395c`](https://github.com/jjjermiah/opencode-plugboard/commit/7ff395c906b4c26d9c5099a0576f0673c8500bd9))

Review fixes for #328.

Split errors.py (both examples)
- The contract allows one "# region snippet" per file. errors.py had two in pydantic-ai and openai-python, so VitePress would include the wrong part or the whole file.
- Now wrong_key.py (E1) and unknown_model.py (E2) per example, each with one region and its own __main__. errors.py is removed. Runners and the two READMEs follow. Observations are unchanged.
- langchain-python/errors.py uses snippet-wrong-key and snippet-unknown-model region names, which the contract does not allow. Not touched here (another lane's file).

Live records: plugboard version corrected by hand
- runs/live/2026-10-13-c97ac66 and -c97ac66-2 said "plugboard 0.25.1" (summary.json "version" and summary.md line 4). c97ac66 is the 0.26.0 release merge (git show c97ac66:package.json). The harness read the version from this branch's base, not from the commit it names.
- Hand edit, as the review asked: the four summaries now say 0.26.0. Nothing else in those directories changed. REPORT.md in c97ac66 records the correction. Follow-up: the harness should read the version from the commit it names.

Scripted model: required forces only what it can fill
- forcedTool(): a named choice forces its tool as before. "required" forces only a single tool that has a "calories" property (the meal), and only before any tool result. Any other "required" request takes the same paths as "auto". Without this, a required get_weather call got an empty forced input, and turn 2 could loop on the forced call.
- test/unit/examples-scripted-model.test.ts: five cases for the tool choices (fillable required, unfillable required, named, auto, required after a tool result).

README
- pydantic-ai: the file table lists wrong_key.py and unknown_model.py. The S6 gotcha says the scripted run takes the tool path too. The live section names runs/live/2026-10-13-c97ac66-2 as the latest and -c97ac66 as the failed first attempt.
- openai-python: the file table lists the two new files.

Merge
- origin/main merged into the branch (merge, not rebase). ci.yml keeps both examples: the scripted run and the RUNS array now list openai-python, langchain-python and pydantic-ai.
- test-count floor raised by the ratchet (2488 tests), committed with the tests.

Validation
- Scripted runs regenerated with all --target scripted, twice: the second run is identical to the first (diff -r). No scripted transcript changed.
- bun run typecheck: exit 0. bun test: 2488 tests, 0 fail.
- coverage + test-gates --ratchet: all floors met.
- coverage-manifest, check-pack, smoke-pack, docs:build: all exit 0.

Refs #182

</details>
<!-- commit-detail:end -->

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

[Unreleased]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.49.0...HEAD
[0.49.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.48.0...v0.49.0
[0.48.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.47.0...v0.48.0
[0.47.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.46.0...v0.47.0
[0.46.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.45.0...v0.46.0
[0.45.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.44.0...v0.45.0
[0.44.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.43.0...v0.44.0
[0.43.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.42.0...v0.43.0
[0.42.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.41.0...v0.42.0
[0.41.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.40.0...v0.41.0
[0.40.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.39.0...v0.40.0
[0.39.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.38.0...v0.39.0
[0.38.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.37.0...v0.38.0
[0.37.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.36.0...v0.37.0
[0.36.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.35.0...v0.36.0
[0.35.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.34.0...v0.35.0
[0.34.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.33.0...v0.34.0
[0.33.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.32.0...v0.33.0
[0.32.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.31.0...v0.32.0
[0.31.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.30.0...v0.31.0
[0.30.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.29.0...v0.30.0
[0.29.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.28.0...v0.29.0
[0.28.0]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.27.0...v0.28.0
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
