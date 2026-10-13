# Vercel AI SDK

The Vercel AI SDK (`ai` 7) against plugboard, through its three ways in: `createOpenAICompatible` (Chat Completions), `openai.chat(id)` (Chat Completions through `@ai-sdk/openai`), and the default `openai(id)` (the Responses API). Plain chat, a tool round trip, streaming, streaming tool calls, an image, structured output, the model list, and the two error paths. Each scenario is one file you can copy, and the copyable part sits between `// #region snippet` markers. Part of the runnable-examples epic [#174](https://github.com/jjjermiah/opencode-plugboard/issues/174).

## What it shows

| File | Scenario | What the snippet does |
| --- | --- | --- |
| `providers.ts` | setup | the three constructions: `createOpenAICompatible`, `createOpenAI` with `.chat(id)`, and `openai(id)` |
| `chat.ts` | S1 | one `generateText` call |
| `tools.ts` | S2 | a `get_weather` tool; the SDK runs it and sends the second turn itself |
| `stream.ts` | S3 | `streamText` parts, with usage, and a second stream without `includeUsage` |
| `stream_tools.ts` | S4 | a streamed tool call with no `execute`, so the SDK hands back the assembled call |
| `image.ts` | S5 | a red PNG as a `file` part in a multi-part message |
| `structured.ts` | S6 | `Output.object` with a zod schema, sent as `json_schema` |
| `models.ts` | S7 | `GET /v1/models` with `fetch` (the SDK has no model-list call) |
| `errors.ts` | E1, E2 | a wrong key (401) and an unknown model (404), as `APICallError` |

Each file has a `run` function that takes a client (a function from a model id to a model) and returns the observations the checks read. `run.ts` is the runner the harness starts; it prints results and writes nothing. Every scenario runs on each of the three ways in (the `variant` in the run is `compat`, `openai-chat` or `responses`), except S7, E1 and E2, which use `compat`.

## Setup

```sh
cd examples/vercel-ai-sdk
bun install --frozen-lockfile
```

The versions are exact pins (`ai` 7.0.137, `@ai-sdk/openai-compatible` 3.0.67, `@ai-sdk/openai` 4.0.91, `zod` 4.6.6), locked in `bun.lock`. Bun 1.4.2 is what CI and the record use.

## Run one file

```sh
export PLUGBOARD_BASE_URL=http://127.0.0.1:4010/v1   # ends in /v1
export PLUGBOARD_KEY=<your app key>
bun chat.ts
```

Each file calls its scenario with the `compat` way and the model `fast`, and prints the observations as one JSON line.

## Run the whole example

Through the harness, which captures the traffic and writes the run under `runs/`:

```sh
bun examples/_harness/run.ts vercel-ai-sdk --target scripted   # local, no provider
bun examples/_harness/run.ts vercel-ai-sdk --target live       # the isolated server only
```

## Type check

```sh
bunx tsc --noEmit
```

## Gotchas

- **Structured output needs `supportsStructuredOutputs: true` on `createOpenAICompatible`.** Without it the SDK sends `response_format: {"type":"json_object"}` with no schema anywhere. The model guesses the keys and `Output.object` throws `NoObjectGeneratedError`. The 2026-10-11 record saw this for all three models. The flag is set in `providers.ts`. `@ai-sdk/openai` always sends `json_schema`, so it needs no flag.
- **The default `openai(id)` calls `POST /v1/responses`.** The 2026-10-11 record failed every scenario on it (404, no such route). Plugboard serves that route now, and this example runs S1 to S6 on it. Multi-turn works with the default `store: true`. `providerOptions: { openai: { store: false } }` also works and sends earlier turns in full. [Responses API](../../docs/responses.md).
- **Streaming usage needs `includeUsage: true` on `createOpenAICompatible`.** Without it the stream has no usage chunk. `openai.chat(id)` and `openai(id)` always ask for it.
- **The SDK says `tool-calls`; the wire says `tool_calls`.** The scenario checks read the wire name, so `providers.ts` maps it (`wireFinish`).
- **`maxOutputTokens: 1024` on every call.** `fast` is a reasoning model, and a small budget leaves no room for the answer.
- **Use `Output.object`, not `generateObject`.** `generateObject` is deprecated in `ai` v7 and sends the same request.
- **Use a `file` part for an image, not an `image` part.** The `image` content part is deprecated in `ai` v7.
- **Tool call ids differ by model** (`call_...`, `toolu_...`, bare UUIDs). Don't parse them; send them back as they came.
- **A wrong key raises `APICallError` with status 401** (`invalid_api_key`). An unknown model raises 404 (`model_not_found`). `maxRetries: 0` keeps a retry out of the run.
- **The SDK has no model-list call.** `GET /v1/models` with `fetch` works (S7).

## Known gaps

Scripted and live (`runs/live/2026-10-13-c97ac66`, plugboard 0.25.1): none. All scenarios pass on all three ways in, including `openai(id)` on `/v1/responses`.

The 2026-10-11 record under `runs/live/2026-10-11-3fcedc7/REPORT.md` predates this example and shows the old `openai-default` failure. Per the contract it is kept unchanged.

## Historical record

`runs/live/2026-10-11-3fcedc7/REPORT.md` is the 2026-10-11 run at commit `3fcedc7`, copied from `compat/results/vercel-ai-sdk.md` without change. The `openai-default` failures it describes are superseded: `/v1/responses` is served now, and the live run `runs/live/2026-10-13-c97ac66` passes the same scenarios.
