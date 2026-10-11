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
- **the generation list**: `registerGeneration` returns `{ accepted, dispose }`. A generation is rejected when its `listen` differs from the bound one, or its options (compared as key-sorted JSON) differ from the live ones; a rejected generation registers no hook, seed or pump and never serves. When no generation is live, the next one's options are adopted. Requests are served, and the model catalog is loaded, by the newest accepted generation whose Location is inside the data root (the "owner"), falling back to the newest accepted one.
- **the session store** (`src/session/state.ts`): request state keyed by session ID. The serving generation registers it; the app-directory generation's context hook looks it up; the event pump dispatches bus events to it. It has to be shared, because those are different generations.
- **the event pump**: one fiber subscribed to the server-wide bus, forwarding events of registered request sessions. Events of unregistered sessions are dropped before anything is buffered. If the pump dies, every in-flight request fails with a 502 (`event_stream_lost`); the next request starts a new pump.

If a runtime written by a different version (runtime `VERSION`, currently 2) already owns the process, this module stays inert (no listener, no pump) and logs once that the server needs a restart.

### Request guard vs response

The store entry is the guard that makes the context hook rewrite a session. It outlives the HTTP response: the caller releases it only when the host reports `session.execution.*`. After the response, the caller interrupts the turn if it is still running and retires the entry with a 30 s bound; if the host never confirms, the runtime logs `session.cleanup_timeout`, retries the interrupt and releases. Nothing here is awaited in teardown. As a backstop, request sessions are created with permissions `deny *` then `allow plugboard_seed_*`, so even a second step that slips past the interrupt cannot run a real OpenCode tool.

## Freeze-safety rules

A plugin effect that blocked once froze every prompt in a project. The rules:

- Plugin setup only **registers** and returns. It makes no call on `ctx` that waits for Location readiness, and awaits nothing from the session or model APIs.
- Finalizers are **synchronous** and call nothing on `ctx`. `Registration.dispose` only mutates in-memory state and arms an unref'd timer.
- Forbidden in a finalizer or teardown path: awaiting `session.interrupt`, any session/model/event call, any filesystem or network work, anything that can wait on the host. Cleanup that needs the host is the job of the request code or the runtime, outside teardown.
- The event pump starts lazily from request handling and is never awaited.
- Nothing is registered outside the data root: in real projects the plugin adds no hook, tool or agent change (`isInsideDataRoot`, compared by realpath).
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
  |                           |                              |--------------------------->| prepare images, app dir     |
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
index.ts                    the plugin: compose one generation, location gate, synchronous finalizer
src/contract.ts             neutral vocabulary: PlugRequest/PlugEvent/PlugError, CatalogModel, ModelCaller
src/config.ts               options type, defaults, parseOptions, authenticate, loopback check
src/models.ts               allowlist/alias policy: resolveModel, listAvailableModels (neutral)
src/log.ts                  one-line logger; ids and outcomes only, never keys, bodies or URLs
src/runtime.ts              process singleton: generations, listener lifetime, event pump, session store
src/http.ts                 ingress: body limits, origin checks, disconnect abort, deadline, JSON/SSE transport
src/openai/route.ts         Chat Completions and /v1/models orchestration
src/openai/request.ts       decode a Chat Completions body (pure)
src/openai/response.ts      encode completions, SSE, errors, model list (pure); OpenAiExchange
src/session/host.ts         the host adapter: Effect plugin API to Promise port, catalog, hook-event shapes
src/session/caller.ts       one model-call lifecycle: create session, prompt, relay events, release
src/session/context.ts      context hook, seed tools, agent deny; re-keys seeds onto the caller's tools
src/session/events.ts       turns one session's bus events into PlugEvents (collector)
src/session/state.ts        cross-generation session ownership store
src/session/history.ts      data root, location gating, app directory, session title and transcript
src/session/media.ts        bounded image preparation (data URLs; opt-in remote fetch)
src/session/seeds.ts        seed name prefix and result text
```

Dependency direction: `index` -> `runtime` / `session/*` / `openai/route`; `openai/route` -> `http`, `models`, `config`, `openai/request`, `openai/response` -> `contract`; `session/caller` -> `history`, `media`, `events` -> `contract`; `session/context` -> `state`, `seeds`. Pure codecs (`openai/request`, `openai/response`) import no `node:http`, Effect, filesystem or host types. Session code does not import the OpenAI front-end or reach for a global accessor: the process store is passed in.

## Conventions

- Relative imports use `.js` specifiers.
- Errors cross layers as `PlugError` values (checked with `isPlugError`); only the OpenAI encoder maps `kind` to the wire `type`.
- Casts that erase host types live in `src/session/host.ts` and state the invariant that makes them safe.
- There is no test suite; checks are `bunx tsc --noEmit` and live runs against an isolated OpenCode server.
