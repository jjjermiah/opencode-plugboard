# Architecture

opencode-plugboard serves OpenAI Chat Completions, Responses, legacy completions, Anthropic Messages and Gemini endpoints from inside an OpenCode V2 server and answers with the server's own providers. Each model call becomes one kept OpenCode session in an app directory under the plugboard data root. The plugin steers that session: it swaps in the caller's system prompt, messages and tools, then ends the turn when the model asks for a tool. For a file-by-file map and where new code goes, see [STRUCTURE.md](../STRUCTURE.md).

Supported OpenCode version: **2.0.26** (`@opencode/plugin` 2.0.x, `effect` 4.0.0-rc.112). The host session API is not stable across versions, so the plugin is pinned to one. Type-level gates (`HostContextMatches` in `src/session/host.ts`, the checked `Parameters<...>` casts) make `bunx tsc --noEmit` fail when the pinned host changes shape. To upgrade: bump the dev dependency, run the type check, then re-run the live checks against an isolated server.

## Invariants

These are the rules a change must not break. Tests, reviews and the mutation catalogue cite them by number, so a number is never reused. The sections below explain why each holds.

- **I1. Setup only registers and returns.** Plugin setup makes no call on `ctx` that waits for Location readiness and awaits nothing from the session or model APIs (`index.ts`).
- **I2. Finalizers are synchronous and never call `ctx`.** `Registration.dispose` only mutates in-memory state and arms an unref'd timer, and teardown never awaits `session.interrupt` or any host call (`src/runtime.ts`, wired in `index.ts`).
- **I3. Setup touches no filesystem, `ctx.storage` or `ctx.session`.** Which Location is an app directory is decided later, from request handling, by `ensureAppDir` and `ensureBackend` (`src/session/history.ts`, `src/runtime.ts`).
- **I4. The plugin is inert outside the data root.** The context hook, the agent deny and the seed tools are registered everywhere but do nothing until `confirmed()` is true for the Location (`src/session/context.ts`, `src/runtime.ts`).
- **I5. A rejected generation installs and serves nothing, and options that differ never replace live ones.** A different `listen`, different options or a foreign runtime means rejection, so a project config entry cannot weaken authentication (`src/runtime.ts` `registerGeneration`, `index.ts`).
- **I6. Process-wide state lives on `globalThis` under a versioned key.** Changing the shape of the runtime means bumping `VERSION`, and a runtime of another version is never touched, which leaves this module inert (`src/runtime.ts`).
- **I7. The event pump starts lazily from request handling and is never awaited.** Events of sessions that are not registered are dropped before anything is buffered (`src/runtime.ts` `ensurePump`, `src/session/state.ts`).
- **I8. Request sessions deny every real tool.** They are created with `deny *` then `allow plugboard_seed_*`, so no step can run an OpenCode tool (`src/session/seeds.ts` `REQUEST_PERMISSIONS`, used by `src/session/caller.ts`).
- **I9. Tool calls are returned to the caller, never executed.** A seed tool settles at once with a fixed result and the turn is interrupted when the step ends with tool calls (`src/session/seeds.ts`, `src/session/events.ts`, `src/session/caller.ts`).
- **I10. Seed descriptors are mutated in place and never copied.** The host maps a rewritten tool back to its registered tool by object identity (`src/session/context.ts` `remapSeedTools`).
- **I11. No session is created before `ensureBackend` succeeds.** A session in a directory with no context hook would answer from the raw transcript (`src/session/caller.ts`, `src/runtime.ts`).
- **I12. The request guard outlives the HTTP response.** It is released by `session.execution.*` or by a bounded cleanup, and nothing in teardown waits for it (`src/session/state.ts`, `src/session/caller.ts`).
- **I13. Provider and host error text never reaches callers.** Host errors map to a stable code and a fixed message, unexpected errors answer a generic 500, and image fetch failures share one message; the raw text goes to the log only (`src/session/events.ts` `toPlugError`, `src/openai/route.ts`, `src/session/media.ts`).
- **I14. Keys are never logged or shown.** Logs carry ids and outcomes only, the discovery pages never include a key, and keys are compared in constant time (`src/log.ts`, `src/discovery.ts`, `src/config.ts` `authenticate`).
- **I15. Authentication comes before route existence.** An unauthenticated caller gets a 401 for every path except `/healthz` and the discovery pages, and the Messages route answers 405 to a non-POST method first (`src/openai/route.ts`, `src/anthropic/route.ts`).
- **I16. Loopback endpoints check Host and Origin.** On a loopback listen the Host header must name a loopback host and the listen port, a keyless endpoint rejects any Origin, and a keyless endpoint must listen on loopback (`src/http.ts` `checkOrigin`, `src/config.ts` `parseOptions`).
- **I17. Remote images pass an SSRF filter.** The fetch is off by default, resolves the host first, accepts only public addresses unless allowed, connects to the address it checked, follows no redirect and has size and time caps (`src/session/media.ts`).
- **I18. The first wire byte decides the HTTP status.** Nothing is committed until the first output event, so an earlier failure is a real HTTP error and a later one is an error frame (`src/http.ts` `sseWriter`, every `route.ts`).
- **I19. One deadline and one disconnect abort cover a request, and an abandoned request never reaches the model caller.** The scope is created before the first `await` (`src/http.ts` `beginRequest`, `src/openai/route.ts`).
- **I20. Front-ends talk to the back end only through `src/contract.ts`.** Wire presentation state stays in the front-end's `Exchange`, and the pure codecs import no `node:http`, Effect, filesystem or host types (`src/contract.ts`, `src/*/request.ts`, `src/*/response.ts`).
- **I21. The history index is written only while a limit is set.** Sweeps start from request handling, do bounded work and skip a session whose request guard is still active (`src/runtime.ts` `trackSession`, `src/session/prune.ts`).
- **I22. The request id is made by the server.** It is never taken from the client, because it is echoed in a header and written to logs (`src/openai/route.ts` `handle`).

## Three lifetimes

Most bugs in this design come from mixing these up.

| Lifetime | Starts | Ends | Owns |
|---|---|---|---|
| **Generation** | OpenCode loads the plugin for a Location (one per project directory, and again on config reload) | the Location's plugin scope closes | the parsed options, the route, the session port bound to that Location's `ctx` |
| **HTTP request** | a request reaches the listener | the response ends, the client disconnects or the deadline passes | the abort signal, the response writer, the event stream the model caller returns |
| **Host execution** | `session.prompt` starts running the session | the host reports `session.execution.*` (succeeded, failed or interrupted) | the session's model steps and tool dispatch inside OpenCode |

The three do not line up. The generation that serves an HTTP request is a different plugin instance from the one running inside the app directory, and either can be replaced at any moment. A response can finish while the host execution is still winding down (`session.step.ended` arrives before the runner decides whether to continue). Code must say which lifetime it belongs to before it holds a resource.

## Why state is process-wide

OpenCode may load this module once per Location, or re-evaluate it on reload. Anything that has to outlive one generation lives on `globalThis` under a versioned key (`src/runtime.ts`):

- **the HTTP listener**: one port per process. The first generation binds it, later ones join. When the last generation goes, the listener waits a grace period, because a config reload recreates every generation at once, then closes. A request with no live generation gets a 503. If the bind fails (another process holds the port), nothing can receive requests, so the failure is made loud instead: `listener.address_in_use` at error level (repeated every 5 minutes), `listener.not_serving` at error level for every generation that registers while the port is held, and a silent retry every 15 s, so plugboard takes the port over when it is released. Loopback gives no isolation between local users; keys are the only boundary (#87).
- **the generation list**: `registerGeneration` returns `{ accepted, dispose, confirmed, ready }`. A generation is rejected when its `listen` differs from the bound one, or its options (compared as key-sorted JSON) differ from the live ones; a rejected generation registers no hook or seed and never serves. When no generation is live, the next one's options are adopted. Requests are served, and the model catalog is loaded, by the newest accepted generation whose Location is a confirmed app directory (the "owner"), falling back to the newest accepted one.
- **the confirmed directories**: app directories (real path strictly inside the canonical data root) that `ensureBackend` has verified. Setup touches no filesystem, so ownership of a Location is unknown at setup and stays "not an app directory" until a request confirms it (fail closed). The runtime also counts rejected generations per directory, to tell "rejected" from "no generation yet".
- **the session store** (`src/session/state.ts`): request state keyed by session ID. The serving generation registers it; the app-directory generation's context hook looks it up; the event pump dispatches bus events to it. It has to be shared, because those are different generations.
- **the event pump**: one fiber subscribed to the server-wide bus, forwarding events of registered request sessions. Events of unregistered sessions are dropped before anything is buffered. If the pump dies, every in-flight request fails with a 502 (`event_stream_lost`); the next request starts a new pump.
- **the history sweep state**: when the last sweep ran and whether one is running (see [History pruning](#history-pruning)).
- **the metrics registry and start time**: counters and histograms must survive a generation being replaced, so they live here too (see [Observability](#observability)).

If a runtime written by a different version (runtime `VERSION`, currently 6) already owns the process, this module stays inert (no listener, no pump) and logs once that the server needs a restart.

**Key revocation (#90).** Every accepted generation runs with the same options (the fingerprint rule above), so authentication uses the listener's options whichever generation serves. A config edit makes the host reload every Location's plugin at once (verified live: a removed key answered 401 on the next request, an app directory in use included), and the next generation adopts the new options. A generation with different options is never allowed to override live ones, because a project config entry must not be able to weaken authentication; so a Location that somehow kept an old generation alive past a reload would keep the old options until the server restarts.

### Backend readiness: `ensureBackend`

The session caller awaits `ensureBackend(app, signal)` (`src/runtime.ts`, wired in `index.ts`) right before `session.create`, so a session is never prompted in a directory where no context hook would rewrite it (the model would answer the raw transcript). It runs from request handling only and resolves `undefined` or a `PlugError`:

1. `ensureAppDir` creates and canonicalizes `<dataRoot>/<app>` asynchronously; a path that resolves outside the canonical data root (symlink) is `app_dir_outside_root`.
2. The real path is added to the confirmed set, before booting, so a Location that boots now sees it at setup.
3. No generation there yet: the entry calls `ctx.agent.list({ location: { directory } })`, which makes the host build that Location and load the plugin there. The call is abandoned (not interrupted) if the request ends.
4. A generation that was set up before its directory was confirmed (for example someone opened the app directory in OpenCode first) gets its agent and tool transforms rebuilt (`ctx.agent.reload()`, `ctx.tool.reload()`), once.
5. It waits, bounded by the request signal and 15 s, until an accepted generation there has installed its hook. A rejected generation (options or `listen` differ), a failed boot, a timeout or an aborted request is a 503 `backend_unavailable`.

### Request guard vs response

The store entry is the guard that makes the context hook rewrite a session. It outlives the HTTP response: the caller releases it only when the host reports `session.execution.*`. After the response, the caller interrupts the turn if it is still running and retires the entry with a 30 s bound; if the host never confirms, the session store logs `session.cleanup_timeout`, retries the interrupt and releases. Nothing here is awaited in teardown. As a backstop, request sessions are created with permissions `deny *` then `allow plugboard_seed_*`, so even a second step that slips past the interrupt cannot run a real OpenCode tool.

## History pruning

Every request leaves a session in the host, so history grows without bound unless it is pruned. The plugin session API (`ctx.session`) has `get` and `remove` but no `list` (OpenCode 2.0.26, `packages/plugin/src/effect/session.ts`), so plugboard cannot ask the host which sessions are its own. It keeps an index instead, in the plugin's own host storage (`ctx.storage`: a key-value table in the host database, namespaced by plugin id, shared by every Location, no file of ours; `packages/core/src/plugin/host.ts` `storage`, `packages/core/src/kv.ts`). If upstream adds a session list or archive call, use it and drop the index.

- **Index**: the session store's `register` hook (request handling, right after `session.create`) writes one key per request session, `history/<app>/<created ms, 15 digits>/<sessionID>`. Key order is creation order, so a prefix scan returns an app's sessions oldest first and the key holds everything the sweep needs. It is written only while a limit is set, so with pruning off the host database gains nothing (#85). Sessions created while no limit was set are not indexed and never pruned.
- **Option** `history: { maxSessions?, maxAgeDays? }`, global, applied to each app separately (apps are only key names; there is no per-app config). Unset means keep forever, the default. Both set: the stricter wins.
- **Sweep** (`src/session/prune.ts`, driven by `maybeSweep` in `src/runtime.ts`): started by a request, after its session was indexed, never by setup and never by a timer. At most one runs, and none starts within 10 minutes of the last, or 1 minute when the last left work behind. It finds the apps in the index, reads each app's entries oldest first, and deletes the prefix that exceeds `maxSessions` or is older than `maxAgeDays` through `ctx.session.remove` (the host interrupts and awaits an idle session first). A session whose request guard is still in the session store is skipped; a session the host no longer has only loses its index entry; a failed delete keeps its entry for the next sweep. Idle servers do no work: nothing is pruned until the next request.
- **Bounded work**: at most 200 deletions per sweep, at most 20,000 index entries read per app (a capped read undercounts, so it deletes fewer sessions than the limit asks for, never more), a 60 s deadline checked between host calls, and a hung host call cannot block later sweeps. One log line per sweep with counts only: `history.swept apps scanned removed missing failed active more durationMs`.
- **Manual path**: `compat/tools/sessions.py` lists and deletes one app's sessions through the host API, including sessions that predate the index.

## Observability

All of this runs from request handling. Setup registers nothing new and makes no host call for it.

- **Log format** (`logFormat`: `text` default, or `json`). `src/log.ts` holds the format and an `AsyncLocalStorage` on `globalThis` (the module may be evaluated per Location). `registerGeneration` sets the format when it accepts a generation, and accepted generations share the live options, so the format is the live one. JSON lines are `{"time","level","service","event",...fields}`; a field cannot overwrite those four keys. Same rule as before: ids and outcomes only, never keys, bodies or URLs.
- **Request id**. `handle` in `src/openai/route.ts` makes a 12 hex char id per request, never taken from the client, and sets `x-plugboard-request-id` before anything else can fail, so every response carries it (a 503 from a listener with no live generation does not: no route code ran). The route runs inside `withRequestId`, so every log line emitted in that async chain carries the same `id`, including `request.finished` from the session caller (which also has its own `requestID`, the one stored in session metadata) and cleanup lines that fire after the response. Work that merely starts from a request but is not about it runs in `outsideRequest`: the history index and sweep, and the event pump.
- **Metrics** (`metrics: true`, off by default). `src/metrics.ts` is a hand-rolled registry in the Prometheus text format (0.0.4) with no dependency. Nothing is recorded and no event stream is wrapped while the option is off, and `GET /metrics` is then an ordinary 404. Series: `plugboard_requests_total{app,route,status,outcome}`, `plugboard_request_duration_seconds{app,route}` (histogram), `plugboard_requests_in_flight`, `plugboard_tokens_total{app,kind}` (non-overlapping kinds: `input` is uncached prompt tokens, `cache_read`, `cache_write`, `output` excludes `reasoning`, `reasoning`), `plugboard_dropped_params_total{param}`, `plugboard_history_sweeps_total{result}`, `plugboard_history_sessions_removed_total`, and gauges `plugboard_generations`, `plugboard_event_pump_up`, `plugboard_session_guards`, `plugboard_start_time_seconds`. Labels are bounded by construction: `app` is a key name (or `_none` before authentication succeeded; app names cannot contain an underscore), `route` is a known route or `unknown`, `outcome` is one of `ok`, `rejected` (4xx), `failed` (5xx, or an error after the response committed), `timeout`, `disconnected`. There is deliberately no model label: with `provider/*` allowlists it would be unbounded. Tokens are read by wrapping the `ModelCaller` in the route (`metered`), so both front-ends are counted and the contract is unchanged. The scrape does not count itself as in flight; successful scrapes and health probes are not logged.
- **Auth for `/metrics` and `/v1/status`**: the same `authenticate` step as `/v1`, so keyless loopback endpoints serve them to local callers, and keyed endpoints need a valid key.
- **`GET /healthz`** stays `{"ok":true}` with no auth and no host call (a liveness probe must be cheap). **`GET /v1/status`** (authenticated) adds the facts a person wants: runtime version, start time and uptime, listen address and whether it is bound, accepted generation count, whether the serving Location is a confirmed app directory, event pump state, outstanding request guards, and the model count (`catalog` base models, `available` ids `/v1/models` lists). The counts come from `processStatus()` in `src/runtime.ts` (synchronous, no host call); the model count loads the catalog like `/v1/models` does and is reported as `{ "error": "catalog_unavailable" }` when that fails.
- **Discovery** (`src/discovery.ts`): `GET /v1` (JSON) and `GET /` (a small HTML page built from the same document: inline style only, no script or external asset, every dynamic value HTML-escaped, a restrictive `Content-Security-Policy`). Both run after the Host and Origin checks, so the DNS-rebinding and keyless cross-origin rules apply to them. They contain the listen address, the endpoint list, a curl example, and, when allowed to show it, the app name, the allowlist and aliases, and a paste-ready `models` suggestion (one `provider/*` per provider in the catalog, plus per-provider model counts and examples). An empty `models` option is reported with its consequence (every call is a 403 `no_models_configured`) and an example to paste. Disclosure rule: on a keyless (loopback) endpoint everything is shown. When `keys` are set, a request with no `Authorization` header gets a minimal page (address, authentication requirement, endpoints, curl example) and the catalog is not even loaded; a request with a valid key also gets its own app name only (not the other apps' names), the allowlist, aliases and suggestion; a wrong key is a 401. Keys are never in any of it. The base URL is built from the configured `listen`, never from the request's Host header.
- **Model entries** (`/v1/models`, `/v1/models/{id}`): `plugboard` carries `capabilities` and `contextLimit` as before plus what the host catalog (`Model.Info`) knows: `limit` (`context`, `input`, `output`), `modalities` (`input`, `output`), `cost` (USD per million tokens: `input`, `output`, `cache.read`, `cache.write`; an entry with `aboveContext` applies once the prompt exceeds that many tokens, the one without is the base price), `status`, `family` and `released` (ISO 8601). `toCatalog` in `src/session/host.ts` keeps only well-formed values; absent facts are omitted, never zero-filled.

## Freeze-safety rules

A plugin effect that blocked once froze every prompt in a project. The rules (invariants I1 to I4 and I7, with the detail):

- Plugin setup only **registers** and returns. It makes no call on `ctx` that waits for Location readiness, and awaits nothing from the session or model APIs.
- Finalizers are **synchronous** and call nothing on `ctx`. `Registration.dispose` only mutates in-memory state and arms an unref'd timer.
- Forbidden in a finalizer or teardown path: awaiting `session.interrupt`, any session/model/event call, any filesystem or network work, anything that can wait on the host. Cleanup that needs the host is the job of the request code or the runtime, outside teardown.
- Setup also makes no `ctx.storage` or `ctx.session` call: the history index and sweep run from request handling only.
- Plugin setup touches no filesystem, sync or async. Which Location is an app directory is decided by `ensureAppDir` / `ensureBackend` from request handling, compared by realpath.
- The event pump starts lazily from request handling (handler and catalog load, never setup) and is never awaited.
- Every accepted generation registers the context hook, the agent deny and the seed tools, but they are no-ops until `Registration.confirmed()`: in real projects the plugin adds no tool, agent change or context rewrite. Rejected generations register nothing.
- Events are filtered by session ID before they are buffered.

## Seed tools and descriptor identity

The host only advertises tool definitions that match a **registered** tool, and it maps a rewritten tool back to its registered tool by the **identity of the descriptor object** it handed to the `context` hook. So plugboard registers a pool of placeholder tools (`plugboard_seed_0..N-1`, `N` = option `maxTools`) in the app directories, and the hook re-keys them:

- the caller's tool name becomes the key in `session.tools` (what the provider sees);
- the seed keeps its own `name` (what the executor dispatches on);
- the descriptors are mutated in place and re-inserted under the new keys. Never copy them.

Every agent denies the seeds; request sessions are created with a session permission that denies everything else and allows them, so a person prompting inside an app directory never sees them and a request session never sees a real tool. Before dispatch the caller checks that the seed pool and the prepared attachments cover the request (`backend_preparation_failed` otherwise); nothing is dropped silently. A seed settles at once with a fixed result so history shows a completed call. The runner would start a second model step after any tool result, so plugboard interrupts the session once the first step has ended with tool calls (`session.step.ended`), and the request finishes as `tool-calls`. Code and docs make no claim of stronger ordering than that.

## Request and event flow

```text
client                    HTTP listener (runtime)       OpenAI route               session caller                OpenCode host
  | POST /v1/chat/completions |                              |                            |                             |
  |-------------------------->| owner (or newest) generation |                            |                             |
  |                           |----------------------------->| checkOrigin, authenticate  |                             |
  |                           |                              | readJsonBody               |                             |
  |                           |                              | parseChatRequest ->        |                             |
  |                           |                              |   PlugRequest + OpenAiExchange                           |
  |                           |                              | loadCatalog, resolveModel  |                             |
  |                           |                              | caller.stream(PlugRequest) |                             |
  |                           |                              |--------------------------->| prepare images              |
  |                           |                              |                            | ensureBackend: app dir,     |
  |                           |                              |                            |   boot Location, hook ready |
  |                           |                              |                            | session.create ------------>|
  |                           |                              |                            | store.register(state)       |
  |                           |                              |                            | session.prompt (transcript)>|
  |                           |                              |                            |                             | context hook (app-dir generation):
  |                           |                              |                            |                             |   store.lookup -> swap system,
  |                           |                              |                            |                             |   messages, tools, options
  |                           |                              |                            |                             | model step runs
  |                           |   event pump: bus event      |                            |                             |
  |                           |   -> store.dispatch -------->| (to the request's collector)                             |
  |                           |                              |                            | collector -> PlugEvents     |
  |                           |                              |<---------------------------| text / tool-call / finish   |
  |<--------------------------|<-----------------------------| encode JSON or SSE (OpenAiExchange)                      |
  |                           |                              |                            | step ended + tool calls:    |
  |                           |                              |                            |   interrupt session ------->|
```

The model call is neutral: `ModelCaller.stream(PlugRequest, { app, signal })` returns `AsyncIterable<PlugEvent>`. Response presentation (streaming, usage chunks, structured-output unwrapping, wire error types) is `OpenAiExchange` state owned by `src/openai/` and never reaches the caller.

## Second front-end: Responses

`POST /v1/responses` is a front-end beside `src/openai/`, on the same neutral seam. `src/openai/route.ts` does the shared work (Host and origin check, authentication, JSON body, deadline) and hands the parsed body to `src/responses/route.ts`, which decodes it into a `PlugRequest` (`input` items, `instructions`, function tools, `text.format`, `reasoning.effort` as the variant), calls the same `ModelCaller` and encodes the `PlugEvent`s. The contract did not change. The Responses presentation state (`ResponsesExchange`: stream flag, echoed request fields, structured-output mode) lives in `src/responses/` and never reaches the caller, as `OpenAiExchange` does for Chat Completions.

One state machine (`runResponse`) produces both the JSON body and the SSE events, so they cannot disagree. It is stateless like the rest: `previous_response_id`, `conversation` and `item_reference` are rejected, and nothing is stored. Structured output reuses the Chat Completions mechanism (a forced `respond` tool unwrapped into the message text). Details and the supported field list: [responses.md](responses.md).

## Third front-end: Anthropic Messages

`POST /v1/messages` is a front-end on the same seam, but it takes the request over earlier than Responses does. `src/openai/route.ts` hands every request for `/v1/messages*` to `src/anthropic/route.ts` right after the route name is known, because three things differ from the OpenAI routes from the first check on: errors use Anthropic's body (`{"type":"error","error":{"type","message"}}`, mapped from the neutral error `kind` in `src/anthropic/response.ts`), `x-api-key` authenticates as well as `Authorization: Bearer` (same key store, `authenticate` is called with whichever header carries a valid key), and there is no `[DONE]`. The route then repeats the shared steps itself (origin check, JSON body, deadline, model resolution, `dropRejected`) and rethrows body, abort and unexpected errors after answering in its own shape, so the shared handler still logs the outcome. The contract did not change.

`src/anthropic/request.ts` decodes `system`, content blocks (text, image, document, tool_use, tool_result), custom tools, `tool_choice`, sampling and `thinking`; `src/anthropic/response.ts` has one state machine (`runMessage`) for the message object and the SSE events. Anthropic's `input_tokens` excludes cache tokens while `PlugUsage.inputTokens` includes them, so the encoder subtracts. Details and the supported field list: [messages.md](messages.md).

## Fourth front-end: legacy completions

`POST /v1/completions` is another front-end on the same seam, handed over by `src/openai/route.ts` the same way (`src/completions/route.ts`). `request.ts` turns `prompt` into one user message per prompt (a `suffix` becomes the only system prompt), `response.ts` encodes the legacy `text_completion` body and chunks. It always goes through the fan-out below, a single prompt being the case of one choice. Details: [completions.md](completions.md).

## Several choices (`n`)

`n` above 1 needs no contract change: `src/openai/fanout.ts` calls the `ModelCaller` once per choice, concurrently, each call with its own session, and merges the answers. The wire encoders stay per-choice and come in as a `ChoiceCodec` (Chat Completions in `fanout.ts`, legacy completions in `src/completions/response.ts`), so the fan-out knows nothing about either wire format.

- The choices share a group signal: the request's (disconnect, deadline) plus one that aborts when any choice fails. A failed choice fails the request and cancels the rest, so there is never a partial answer set.
- JSON: each choice's body is encoded alone, then `choices[0]` of each is renumbered by index and the `usage` objects are summed.
- SSE: one `sse.paced` serves all choices (one backpressure wait, one keepalive). A merge pulls at most one event ahead per choice, tags it with its choice, and feeds one queue per choice, which that choice's encoder reads. Encoders write their own chunks with the shared `id` and their `index`; the error frame, the summed usage chunk and `[DONE]` are written once, by the fan-out.
- `maxN` (default 1) caps the calls per request, because each is a full model call and a kept session.

## Fifth front-end: Gemini

`POST /v1beta/models/{model}:generateContent` and `:streamGenerateContent?alt=sse`, plus `GET /v1beta/models[/{model}]`, are a front-end in `src/gemini/` on the same seam. `src/openai/route.ts` matches the path (`matchGeminiRoute`), checks the origin, authenticates in the shared step (before route existence is revealed, so an unauthenticated Gemini path gets a 401 in Google's body) and dispatches to `src/gemini/route.ts` with the metered caller. Two things differ from the other front-ends. The model is in the URL, not the body, and the credential may be `x-goog-api-key` or `?key=` as well as `Authorization` (`geminiAuthorization` normalizes it into the Bearer form `authenticate` reads). And every error on a Gemini path, including the shared ones (auth, origin, body, timeout), uses Google's `{error:{code,message,status}}` body: the route remembers which responses are Gemini ones and picks the encoder in `fail`.

One state machine (`runGenerate`) produces both the JSON body and the SSE chunks. Gemini function calls carry no id, so the decoder assigns ids and pairs each `functionResponse` with the earliest unanswered call of the same name; the response omits ids. Structured output reuses the forced `respond` tool (a non-object schema is wrapped in one property and unwrapped). The contract did not change. Details and the supported field list: [gemini.md](gemini.md).

## Module map

```text
index.ts                    the plugin: compose one generation, gated app-directory registrations, synchronous finalizer
src/contract.ts             neutral vocabulary: PlugRequest/PlugEvent/PlugError, CatalogModel, ModelCaller
src/config.ts               options type, defaults, parseOptions (rejects `__proto__` aliases and two apps sharing a key value), authenticate, loopback check (localhost, 127.0.0.1, ::1: the Host check's set)
src/models.ts               allowlist/alias policy: resolveModel, listAvailableModels (neutral)
src/log.ts                  one-line logger (text or JSON), ambient request id; ids and outcomes only, never keys, bodies or URLs
src/metrics.ts              Prometheus registry and text rendering (pure, no I/O)
src/discovery.ts            `GET /`, `GET /v1` and `GET /v1/status` documents, HTML page (pure builders), `sendText`
src/runtime.ts              process singleton: generations, confirmed directories, ensureBackend, listener lifetime, event pump, session store, history sweep state, metrics registry
src/http.ts                 ingress: body limits, origin checks, disconnect abort, deadline, JSON/SSE transport
src/openai/route.ts         front door and Chat Completions and /v1/models orchestration; dispatches POST /v1/messages, /v1/responses, /v1/completions and the Gemini paths
src/openai/fanout.ts        n > 1: one model call per choice, group cancellation, JSON merge, SSE interleave; ChoiceCodec
src/openai/sampling.ts      per-model table of sampling parameters to drop (`dropRejected`, #30)
src/openai/request.ts       decode a Chat Completions body (pure)
src/openai/response.ts      encode completions, SSE, errors, model list (pure); OpenAiExchange
src/completions/route.ts    legacy completions orchestration (after the shared origin, auth and body steps)
src/completions/request.ts  decode a /v1/completions body (pure)
src/completions/response.ts encode text_completion bodies and chunks (pure); CompletionsExchange
src/responses/route.ts      Responses orchestration (after the shared origin, auth and body steps)
src/responses/request.ts    decode a Responses body (pure)
src/responses/response.ts   encode the response object and its SSE events (pure); ResponsesExchange
src/anthropic/route.ts      Anthropic Messages orchestration (takes the request over from openai/route; own errors and auth)
src/anthropic/request.ts    decode a Messages body (pure)
src/anthropic/response.ts   encode the message object, its SSE events and errors (pure); MessagesExchange
src/gemini/route.ts         Gemini path matching, credential sources, orchestration (after the shared origin and auth steps)
src/gemini/request.ts       decode a generateContent body (pure): contents, tools and schema conversion, toolConfig, generationConfig
src/gemini/response.ts      encode GenerateContentResponse chunks, the model list and Google-shaped errors (pure); GeminiExchange
src/session/host.ts         the host adapter: Effect plugin API to Promise port, catalog, hook-event shapes
src/session/caller.ts       one model-call lifecycle: create session, prompt, relay events, release
src/session/context.ts      context hook, seed tools, agent deny (all gated on confirmation); re-keys seeds onto the caller's tools
src/session/events.ts       turns one session's bus events into PlugEvents (collector)
src/session/state.ts        cross-generation session ownership store
src/session/history.ts      data root, app directory (async, symlink containment), session title and transcript (control and bidi characters stripped)
src/session/prune.ts        history index keys, `recordSession`, the bounded `sweepHistory` (see History pruning)
src/session/media.ts        bounded image preparation (data URLs; opt-in remote fetch: public addresses only unless allowed, resolved address pinned)
src/session/seeds.ts        seed name prefix and result text
```

Dependency direction: `index` -> `runtime`, `session/*`, `openai/route`. `openai/route` -> `http`, `models`, `config`, `discovery`, `metrics`, `runtime` (only the `processMetrics` / `processStatus` defaults, overridable through `RouteHost`), `openai/request`, `openai/response`, `openai/fanout`, `openai/sampling` and the other routes (`anthropic/route`, `completions/route`, `gemini/route`, `responses/route`). Each of those imports from `openai/route` only the `RouteHost` type, and otherwise `http`, `models`, `contract` and its own `request` / `response`. Extras: `anthropic/route` -> `config` (`authenticate`) and `openai/sampling`; `completions/route` -> `openai/fanout`, `openai/sampling` and the Chat error encoder; `responses/route` -> the Chat error encoder (same body shape); `gemini/route` -> `openai/sampling`. `runtime` -> `session/history` (`ensureAppDir`), `session/prune`, `session/state`; `session/caller` -> `config` (app name pattern), `history`, `media`, `events`, `seeds`; `session/events` -> `contract`; `session/context` -> `state`, `seeds`; `config` -> `session/media` (`parseAllowEntry`). Pure codecs (`openai/request`, `openai/response`, `completions/request`, `completions/response`, `responses/request`, `responses/response`, `anthropic/request`, `anthropic/response`, `gemini/request`, `gemini/response`) import no `node:http`, Effect, filesystem or host types. Session code does not import the OpenAI front-end or reach for a global accessor: the process store is passed in.

## Error text and route existence

Provider and host error text never reaches the caller (#88): `toPlugError` in `src/session/events.ts` maps a host `SessionError` to a stable `code` and a fixed message per class (`rate_limited`, `quota_exceeded`, `context_length_exceeded`, `provider_auth_failed`, `content_filter`, `provider_timeout`, `provider_unavailable`, `provider_rejected_request`, `model_run_failed`) and logs the raw text once as `model.failed`. The route authenticates before it says whether a path exists, so an unauthenticated caller sees 401 for every path except `/healthz` and the discovery pages (#91). The one exception is the Messages route, which answers 405 to a non-POST method before it authenticates.

## Conventions

- Relative imports use `.js` specifiers.
- Errors cross layers as `PlugError` values (checked with `isPlugError`); each front-end's own encoder maps `kind` to its wire error type (`encodeError` in `src/openai/response.ts` and `src/anthropic/response.ts`, `encodeGeminiError` in `src/gemini/response.ts`).
- Casts that erase host types live in `src/session/host.ts` and state the invariant that makes them safe.
- Checks are `bun run typecheck`, `bun test` (see `test/README.md`; the freeze-safety rules above are asserted in `test/runtime/plugin.test.ts`) and live runs against an isolated OpenCode server.
