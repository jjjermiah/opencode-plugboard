# LangChain JS

LangChain JS (`@langchain/openai`) against plugboard: plain chat, a tool round trip, streaming with and without usage, a streamed tool call, an image, structured output, the model list, and the two error paths. Each scenario is one file you can copy, and the copyable part sits between `// #region snippet` markers. Part of the runnable-examples epic [#174](https://github.com/jjjermiah/opencode-plugboard/issues/174).

## What it shows

| File | Scenario | What the snippet does |
| --- | --- | --- |
| `chat.ts` | S1 | one `invoke` on a `ChatOpenAI` |
| `tools.ts` | S2 | `bindTools` with `get_weather`, the assistant turn sent back, the tool result under the same id |
| `stream.ts` | S3 | `stream` with `streamUsage`, folded with `concat`; a second stream without usage must give the same text |
| `stream_tools.ts` | S4 | streamed tool call, chunks folded into `tool_calls` |
| `image.ts` | S5 | a red PNG as a data URL in a multi-part message |
| `structured.ts` | S6 | `withStructuredOutput` with a Zod schema: `jsonSchema` (text) and `functionCalling` (forced tool) |
| `models.ts` | S7 | `models.list()` through the `openai` SDK that `@langchain/openai` wraps |
| `errors.ts` | E1, E2 | a wrong key (401) and an unknown model (404) |

Each file has an `import.meta.main` block, so it runs on its own. `run.ts` is the runner the harness starts; it prints results and writes nothing.

## Setup

```sh
cd examples/langchain-js
bun install --frozen-lockfile
```

The versions are exact pins (`@langchain/openai` 1.6.2, `@langchain/core` 1.2.17, `openai` 7.32.0, `zod` 4.6.6), the same ones `compat/js` ran on, locked in `bun.lock`. CI runs Bun 1.4.2.

## Run one file

```sh
export PLUGBOARD_BASE_URL=http://127.0.0.1:4010/v1   # ends in /v1
export PLUGBOARD_KEY=<your app key>
bun chat.ts
```

## Run the whole example

Through the harness, which captures the traffic and writes the run under `runs/`:

```sh
bun examples/_harness/run.ts langchain-js --target scripted   # local, no provider
bun examples/_harness/run.ts langchain-js --target live       # the isolated server only
```

Type check the example on its own with `bunx tsc --noEmit`.

## Gotchas

- **`gpt-5.6*` ids go to `/v1/responses`.** `@langchain/openai` picks the Responses API for any id containing `gpt-5.6` (also `gpt-5.2-pro`, `gpt-5.4-pro`, `gpt-5.5-pro` and `codex`), and `useResponsesApi: false` does not override it. No setting avoids this. To use Chat Completions, pick an id without those substrings (the old record used `openai/gpt-5.5#low`).
- **Responses results have no `finish_reason`.** On `openai/gpt-5.6-luna#low`, `response_metadata` has no `finish_reason`; the reply carries `status: "completed"` instead. S1 and S2 are recorded as `gap` for that reason. The 2026-10-11 record saw a 404 on `/v1/responses`; that route is served now, so the gap is the missing field, not the route.
- **`maxTokens: 1024` is sent on every model.** Chat models get `max_tokens`; the Responses path gets `max_output_tokens`. `fast` reasons before it answers, so a small limit can return an empty reply.
- **`jsonMode` sends `json_object` with no schema.** On `fast` the 2026-10-11 record returned `{}`, so `parsed` was empty. S6 checks only the `jsonSchema` and `functionCalling` forms. The `jsonMode` request still runs and its outcome is in the S6 transcripts, but it is not checked.
- **Tool call ids are opaque.** Send them back as they came; the runs show placeholders, not the prefixes.
- **There is no list-models call in LangChain.** `models.ts` uses the `openai` SDK directly, with the same base URL and key.
- **Errors come back as the OpenAI error shape.** A wrong key carries `status` 401 and `code` `invalid_api_key`; an unknown model carries 404 and `model_not_found`. The runner sets `maxRetries: 0`, so a retry never shows up as a second request.
- **The 2026-10-11 record** (`compat/results/langchain.md`, JS half) is the dated run before these changes. It moves with the Python example under `examples/langchain-python/` and stays unchanged.

## Known gaps

| Scenario | Model | Gap | Issue |
| --- | --- | --- | --- |
| S1, S2 | `openai/gpt-5.6-luna#low` | No `finish_reason` on the Responses path (see gotchas) | [#104](https://github.com/jjjermiah/opencode-plugboard/issues/104) |
