# Architecture

opencode-plugboard serves an OpenAI-compatible endpoint from inside an OpenCode V2 server and answers with the server's own providers. Each model call becomes one kept OpenCode session in an app directory under the plugboard data root. The plugin steers that session: it swaps in the caller's system prompt, messages and tools, then ends the turn when the model asks for a tool.

Supported OpenCode version: **2.0.26** (`@opencode/plugin` 2.0.x, `effect` 4.0.0-rc.112). The host session API is not stable across versions, so the plugin is pinned to one. Type-level gates (`HostContextMatches` in `src/session/host.ts`, the checked `Parameters<...>` casts) make `bunx tsc --noEmit` fail when the pinned host changes shape. To upgrade: bump the dev dependency, run the type check, then re-run the live checks against an isolated server.

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

- **the HTTP listener**: one port per process. The first generation binds it, later ones join. When the last generation goes, the listener waits a grace period, because a config reload recreates every generation at once, then closes. A request with no live generation gets a 503.
- **the generation list**: `registerGeneration` returns `{ accepted, dispose, confirmed, ready }`. A generation is rejected when its `listen` differs from the bound one, or its options (compared as key-sorted JSON) differ from the live ones; a rejected generation registers no hook or seed and never serves. When no generation is live, the next one's options are adopted. Requests are served, and the model catalog is loaded, by the newest accepted generation whose Location is a confirmed app directory (the "owner"), falling back to the newest accepted one.
- **the confirmed directories**: app directories (real path strictly inside the canonical data root) that `ensureBackend` has verified. Setup touches no filesystem, so ownership of a Location is unknown at setup and stays "not an app directory" until a request confirms it (fail closed). The runtime also counts rejected generations per directory, to tell "rejected" from "no generation yet".
- **the session store** (`src/session/state.ts`): request state keyed by session ID. The serving generation registers it; the app-directory generation's context hook looks it up; the event pump dispatches bus events to it. It has to be shared, because those are different generations.
- **the event pump**: one fiber subscribed to the server-wide bus, forwarding events of registered request sessions. Events of unregistered sessions are dropped before anything is buffered. If the pump dies, every in-flight request fails with a 502 (`event_stream_lost`); the next request starts a new pump.
- **the history sweep state**: when the last sweep ran and whether one is running (see [History pruning](#history-pruning)).

If a runtime written by a different version (runtime `VERSION`, currently 4) already owns the process, this module stays inert (no listener, no pump) and logs once that the server needs a restart.

### Backend readiness: `ensureBackend`

The session caller awaits `ensureBackend(app, signal)` (`src/runtime.ts`, wired in `index.ts`) right before `session.create`, so a session is never prompted in a directory where no context hook would rewrite it (the model would answer the raw transcript). It runs from request handling only and resolves `undefined` or a `PlugError`:

1. `ensureAppDir` creates and canonicalizes `<dataRoot>/<app>` asynchronously; a path that resolves outside the canonical data root (symlink) is `app_dir_outside_root`.
2. The real path is added to the confirmed set, before booting, so a Location that boots now sees it at setup.
3. No generation there yet: the entry calls `ctx.agent.list({ location: { directory } })`, which makes the host build that Location and load the plugin there. The call is abandoned (not interrupted) if the request ends.
4. A generation that was set up before its directory was confirmed (for example someone opened the app directory in OpenCode first) gets its agent and tool transforms rebuilt (`ctx.agent.reload()`, `ctx.tool.reload()`), once.
5. It waits, bounded by the request signal and 15 s, until an accepted generation there has installed its hook. A rejected generation (options or `listen` differ), a failed boot, a timeout or an aborted request is a 503 `backend_unavailable`.

### Request guard vs response

The store entry is the guard that makes the context hook rewrite a session. It outlives the HTTP response: the caller releases it only when the host reports `session.execution.*`. After the response, the caller interrupts the turn if it is still running and retires the entry with a 30 s bound; if the host never confirms, the runtime logs `session.cleanup_timeout`, retries the interrupt and releases. Nothing here is awaited in teardown. As a backstop, request sessions are created with permissions `deny *` then `allow plugboard_seed_*`, so even a second step that slips past the interrupt cannot run a real OpenCode tool.

## History pruning

Every request leaves a session in the host, so history grows without bound unless it is pruned. The plugin session API (`ctx.session`) has `get` and `remove` but no `list` (OpenCode 2.0.26, `packages/plugin/src/effect/session.ts`), so plugboard cannot ask the host which sessions are its own. It keeps an index instead, in the plugin's own host storage (`ctx.storage`: a key-value table in the host database, namespaced by plugin id, shared by every Location, no file of ours; `packages/core/src/plugin/host.ts` `storage`, `packages/core/src/kv.ts`). If upstream adds a session list or archive call, use it and drop the index.

- **Index**: the session store's `register` hook (request handling, right after `session.create`) writes one key per request session, `history/<app>/<created ms, 15 digits>/<sessionID>`. Key order is creation order, so a prefix scan returns an app's sessions oldest first and the key holds everything the sweep needs. It is written always, whatever the limits, so turning pruning on later covers every session since the index existed. Sessions created before that are not indexed and never pruned.
- **Option** `history: { maxSessions?, maxAgeDays? }`, global, applied to each app separately (apps are only key names; there is no per-app config). Unset means keep forever, the default. Both set: the stricter wins.
- **Sweep** (`src/session/prune.ts`, driven by `maybeSweep` in `src/runtime.ts`): started by a request, after its session was indexed, never by setup and never by a timer. At most one runs, and none starts within 10 minutes of the last, or 1 minute when the last left work behind. It finds the apps in the index, reads each app's entries oldest first, and deletes the prefix that exceeds `maxSessions` or is older than `maxAgeDays` through `ctx.session.remove` (the host interrupts and awaits an idle session first). A session whose request guard is still in the session store is skipped; a session the host no longer has only loses its index entry; a failed delete keeps its entry for the next sweep. Idle servers do no work: nothing is pruned until the next request.
- **Bounded work**: at most 200 deletions per sweep, at most 20,000 index entries read per app (a capped read undercounts, so it deletes fewer sessions than the limit asks for, never more), a 60 s deadline checked between host calls, and a hung host call cannot block later sweeps. One log line per sweep with counts only: `history.swept apps scanned removed missing failed active more durationMs`.
- **Manual path**: `compat/tools/sessions.py` lists and deletes one app's sessions through the host API, including sessions that predate the index.

## Freeze-safety rules

A plugin effect that blocked once froze every prompt in a project. The rules:

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

## Module map

```text
index.ts                    the plugin: compose one generation, gated app-directory registrations, synchronous finalizer
src/contract.ts             neutral vocabulary: PlugRequest/PlugEvent/PlugError, CatalogModel, ModelCaller
src/config.ts               options type, defaults, parseOptions (rejects `__proto__` aliases and duplicate keys), authenticate, loopback check (localhost, 127.0.0.1, ::1: the Host check's set)
src/models.ts               allowlist/alias policy: resolveModel, listAvailableModels (neutral)
src/log.ts                  one-line logger; ids and outcomes only, never keys, bodies or URLs
src/runtime.ts              process singleton: generations, confirmed directories, ensureBackend, listener lifetime, event pump, session store, history sweep state
src/http.ts                 ingress: body limits, origin checks, disconnect abort, deadline, JSON/SSE transport
src/openai/route.ts         Chat Completions and /v1/models orchestration
src/openai/request.ts       decode a Chat Completions body (pure)
src/openai/response.ts      encode completions, SSE, errors, model list (pure); OpenAiExchange
src/session/host.ts         the host adapter: Effect plugin API to Promise port, catalog, hook-event shapes
src/session/caller.ts       one model-call lifecycle: create session, prompt, relay events, release
src/session/context.ts      context hook, seed tools, agent deny (all gated on confirmation); re-keys seeds onto the caller's tools
src/session/events.ts       turns one session's bus events into PlugEvents (collector)
src/session/state.ts        cross-generation session ownership store
src/session/history.ts      data root, app directory (async, symlink containment), session title and transcript
src/session/prune.ts        history index keys, `recordSession`, the bounded `sweepHistory` (see History pruning)
src/session/media.ts        bounded image preparation (data URLs; opt-in remote fetch)
src/session/seeds.ts        seed name prefix and result text
```

Dependency direction: `index` -> `runtime` / `session/*` / `openai/route`; `openai/route` -> `http`, `models`, `config`, `openai/request`, `openai/response` -> `contract`; `runtime` -> `history` (`ensureBackend`), `prune`, `state`; `session/caller` -> `history`, `media`, `events` -> `contract`; `session/context` -> `state`, `seeds`. Pure codecs (`openai/request`, `openai/response`) import no `node:http`, Effect, filesystem or host types. Session code does not import the OpenAI front-end or reach for a global accessor: the process store is passed in.

## Conventions

- Relative imports use `.js` specifiers.
- Errors cross layers as `PlugError` values (checked with `isPlugError`); only the OpenAI encoder maps `kind` to the wire `type`.
- Casts that erase host types live in `src/session/host.ts` and state the invariant that makes them safe.
- There is no test suite; checks are `bunx tsc --noEmit` and live runs against an isolated OpenCode server.
