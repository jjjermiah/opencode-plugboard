# Changelog

Everything notable about `opencode-plugboard` lands here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with one liberty: entries explain why a change was made, not just what changed. If a decision cost something, the cost is written down next to it.

## Versioning

The project follows [Semantic Versioning](https://semver.org/). While the major version is 0:

- A minor bump (0.1 to 0.2) may break things: an option renamed, a default changed, an error code moved.
- A patch bump (0.1.0 to 0.1.1) is for fixes only.
- The peer range on OpenCode is part of the contract. Plugboard talks to an unstable host API, so a change to the supported OpenCode range is at least a minor bump.

Work is tracked in [GitHub issues](https://github.com/jjjermiah/opencode-plugboard/issues). The [v0.1 milestone](https://github.com/jjjermiah/opencode-plugboard/milestone/1) is what had to be true before the first release. The [later milestone](https://github.com/jjjermiah/opencode-plugboard/milestone/2) holds everything that was deliberately left out.

## [Unreleased]

### Fixed

- **The Gemini front-end is actually in the package now.** 0.9.0's notes describe the Gemini API, but a botched merge on my side tagged 0.9.0 without the `src/gemini/` code, so `/v1beta/...` answered 401/404 in that version. This release contains the code exactly as it was live-tested. If you installed 0.9.0 for Gemini, upgrade.

## [0.9.0] - 2026-10-11: Speaks Fluent Gemini

**Full diff:** [v0.8.0...v0.9.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.8.0...v0.9.0)

### Added

- **Gemini API** ([#5](https://github.com/jjjermiah/opencode-plugboard/issues/5)). Plugboard now speaks Google's dialect too: `POST /v1beta/models/{model}:generateContent`, `:streamGenerateContent?alt=sse`, and `GET /v1beta/models[/{model}]`. The Google GenAI SDKs, and the tools built on them, can now run on any OpenCode provider: checked live with `@google/genai` on an OpenCode Go model, Claude Haiku 5.5 and GPT-5.6 Luna, covering text, streaming, parallel function calls with a full round trip, chats, JSON schemas (array schemas included) and thinking levels.

  It decodes `contents` (text, images, `fileData` URLs, function calls and responses), `systemInstruction`, function declarations (Gemini's uppercase OpenAPI-style schemas are converted to JSON Schema), `toolConfig` modes and allowed names, `generationConfig` including structured output and `thinkingConfig` (mapped to a model variant when one fits). Answers come back as `GenerateContentResponse` JSON or SSE chunks with `usageMetadata`, errors use Google's body shape, tokens count in `/metrics`, and every response carries `x-plugboard-request-id`.

  Point a client at the plugboard root as its base URL and pass an alias as the model name (ids with `/` work literally; `#` must be written `%23`). The key works as `x-goog-api-key`, `?key=` or a Bearer token. Hosted tools such as `googleSearch` and `codeExecution`, `candidateCount` above 1 and `cachedContent` get a 400; `countTokens` and embeddings a 404. Gemini function calls carry no id, so responses are paired with calls by name and order.

## [0.8.0] - 2026-10-11: Many Voices

**Full diff:** [v0.7.0...v0.8.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.7.0...v0.8.0)

### Added

- **Legacy `/v1/completions`** ([#75](https://github.com/jjjermiah/opencode-plugboard/issues/75)). Older scripts and some tools' "completion" mode still POST here. A prompt becomes one user message with no system prompt, a prompt array makes one call per prompt, `suffix` becomes an instruction (best effort; chat models have no insert mode), `echo` works, and so do streaming and `stream_options.include_usage`. `logprobs`, `best_of` above 1 and token-array prompts get a 400.
- **Several answers per request with `n`** ([#58](https://github.com/jjjermiah/opencode-plugboard/issues/58)). Eval and sampling tools ask for `n: 3` and expect three choices. Plugboard now runs one model call per choice, in parallel, each in its own session, and merges them: one `choices` array, summed usage, and in a stream the chunks carry their choice `index` and interleave. If any choice fails, the request fails and the others are cancelled, because a silently short set of samples skews whatever the caller is measuring. Each choice is a full model call, so this is opt-in: set `maxN` (default 1, max 64). Checked live with `n: 3` on Go and a streamed `n: 2` on Claude.

### Changed

- **Breaking:** `n` above the cap now returns 400 `too_many_choices` instead of `unsupported_parameter`.

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

## [0.5.0] - 2026-10-11: Lights On

**Full diff:** [v0.4.1...v0.5.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.4.1...v0.5.0)

### Added

- **A setup page at `GET /` and `GET /v1`** ([#73](https://github.com/jjjermiah/opencode-plugboard/issues/73)). Point a browser at plugboard and it tells you what it is serving: the listen address, the endpoints, a curl example, and a paste-ready `models` suggestion built from what your OpenCode server actually offers. An empty `models` list used to mean a 403 on every call with no clue why; now the page says so. With `keys` set, strangers only see the address and endpoints, and a valid key sees its own app and the allowlist, never other apps or any key.
- **Prices and limits in `/v1/models`** ([#74](https://github.com/jjjermiah/opencode-plugboard/issues/74)). Each entry now carries the model's context and output limits, input and output modalities, cost per million tokens (with context tiers), status, family and release date, straight from OpenCode's catalog. UIs can show price and limits instead of guessing.
- **Prometheus metrics and a status endpoint** ([#56](https://github.com/jjjermiah/opencode-plugboard/issues/56)). Opt in with `metrics: true` and scrape `GET /metrics`: requests and durations by app and route, in-flight requests, tokens by kind (input, cache read and write, output, reasoning), dropped sampling params, history sweeps and event pump health. `GET /v1/status` answers "is it healthy and what is it doing" in one call. `/healthz` stays a cheap liveness check.
- **JSON logs and a request id** ([#76](https://github.com/jjjermiah/opencode-plugboard/issues/76)). `logFormat: "json"` writes one JSON object per line for log pipelines. Every response carries `x-plugboard-request-id`, and the same id is on every log line written while that request runs, so a client error can be matched to the server's side in one search.

### Changed

- Internal runtime version 5. Restart OpenCode after upgrading.

## [0.4.1] - 2026-10-11: First Impressions

**Full diff:** [v0.4.0...v0.4.1](https://github.com/jjjermiah/opencode-plugboard/compare/v0.4.0...v0.4.1)

### Changed

- **A README you can try in a minute** ([#62](https://github.com/jjjermiah/opencode-plugboard/issues/62), [#66](https://github.com/jjjermiah/opencode-plugboard/issues/66)). The top of the page is now a one-line pitch, a diagram, a pinned install, the warm-up call and a curl that prints `pong`. A "What this is not" section says plainly that plugboard is V2 only, which API formats it serves, and how it differs from a standalone gateway such as LiteLLM, which needs its own provider keys. The long reference sections moved to `docs/configuration.md`, `docs/history.md` and `docs/warm-up.md`; the README went from 231 to 119 lines.
- **Pin the version you install** ([#83](https://github.com/jjjermiah/opencode-plugboard/issues/83)). A bare `"opencode-plugboard"` makes OpenCode track `latest`, and a global plugin runs inside OpenCode in every project, next to your provider logins. The docs now recommend `opencode-plugboard@<version>` and say why.
- Release and CI scripts moved to `.github/scripts/` ([#92](https://github.com/jjjermiah/opencode-plugboard/issues/92)). `bun run release` works as before.

## [0.4.0] - 2026-10-11: No Awkward Silences

**Full diff:** [v0.3.0...v0.4.0](https://github.com/jjjermiah/opencode-plugboard/compare/v0.3.0...v0.4.0)

### Fixed

- **Streams start right away** ([#49](https://github.com/jjjermiah/opencode-plugboard/issues/49)). A reasoning model could think for over a minute before saying anything, and plugboard sent nothing at all until then, not even headers, so clients with a header timeout gave up. Now the 200 and SSE headers go out at the first model event (reasoning counts), followed by a `: keepalive` comment after every 15 seconds of silence, including long pauses while a tool call's arguments are generated. A failure before that first event is still a real HTTP error; after it, it's an SSE error frame. The same applies to `/v1/responses`.
- **`json_object` answers come back as plain JSON** ([#50](https://github.com/jjjermiah/opencode-plugboard/issues/50)). Claude sometimes wrapped them in a markdown code fence, which broke strict parsers. If the whole answer is one fence and the inside parses as JSON, you get the inside. A fenced answer in a stream arrives as one chunk; unfenced answers stream as before.

### Changed

- **Sampling parameters a model rejects are dropped, not fatal** ([#30](https://github.com/jjjermiah/opencode-plugboard/issues/30)). Apps like n8n and Open WebUI let users set `temperature`, `top_p` and the penalties, and several models refuse some of them with a 400: older Claude won't take `temperature` and `top_p` together, newer Claude and the GPT-5/6 family refuse them outright, and two OpenCode Go models only accept fixed values. Plugboard now drops what the target model is known to reject and tells you in the `x-plugboard-dropped-params` response header and the request log line, so nothing changes silently. The table comes from probing every model on a live server, not from docs. A model plugboard doesn't know still gets everything as sent. Set `dropUnsupportedParams: false` to turn this off.

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

[Unreleased]: https://github.com/jjjermiah/opencode-plugboard/compare/v0.9.0...HEAD
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
