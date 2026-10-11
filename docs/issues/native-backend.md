# Native backend: an upstream `ctx.llm.stream` for plugins

Plugboard v0.1 reaches providers through a session: a throwaway session per request, a `context` hook that swaps in the caller's messages, a pool of placeholder tools that never execute, and an interrupt once the model has emitted its tool calls. It works on four providers, but it is a workaround. It writes history we then have to manage, it needs the plugin loaded in every directory, and it pays for session setup on each call.

What we want is a plugin API that runs one provider turn: take a request in the shape of `@opencode/ai`'s `LLMRequest`, stream `LLMEvent`s back, and do it through the same hook pipeline sessions use, so auth plugins (Claude via an auth plugin) and provider fixes still apply. A direct `LLMClient` call is not enough, because those plugins only exist as session `http.request` and `http.response` hooks.

## Design notes

The hook pipeline is built in `packages/core/src/session/model-request.ts`: `prepare` builds the `LLMRequest`, then installs `session.model.request` (baseURL and headers) and `session.http.request` and `session.http.response` on the stream. A plugin-facing `ctx.llm.stream(request)` would run that same preparation with a synthetic scope and no session persistence, in roughly 100 to 200 lines. I have not tried the patch yet, so treat that size as an estimate.

Related upstream issues:

- #35001 (closed): "V2: refine LLM generate and stream API mouthfeel". It already describes a one-turn `generate` and `stream` that does not own the loop, tool execution, retries or persistence. Use it as the design anchor.
- #49549 (open): widen `experimental/generate` from `{ prompt, model }` to accept `messages` and generation options. The closest precedent, but non-streaming and without hooks.
- #31724 (bot-closed, never answered): the original request for an OpenAI-compatible endpoint from the server.

Open: the API name, where it sits on the plugin context, Effect and Promise spellings, and whether to open an issue before the PR. Plugboard already has the seam: `ModelCaller.stream(PlugRequest)` returns `PlugEvent`s, and its names mirror `@opencode/ai`, so the backend swap should not touch the front-ends.

## Acceptance

- An upstream issue exists, then a PR, linked here.
- A native `ModelCaller` backend passes the same provider matrix as the session backend: plain text, a tool call returned unexecuted, a tool-result turn, an image.
- With the native backend, requests create no session and the per-app history directories become optional.
