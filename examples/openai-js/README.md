# OpenAI JS SDK

The OpenAI JS SDK against plugboard: plain chat, a tool round trip, streaming (raw and through the SDK's helper), streaming tool calls, an image, structured output, the model list, and the two error paths. Each scenario is one file you can copy, and the copyable part sits between `// #region snippet` markers. Part of the runnable-examples epic [#174](https://github.com/jjjermiah/opencode-plugboard/issues/174).

## What it shows

| File | Scenario | What the snippet does |
| --- | --- | --- |
| `chat.ts` | S1 | one non-streamed chat call |
| `tools.ts` | S2 | `get_weather` call, the assistant turn sent back, the tool result under the same id |
| `stream.ts` | S3 | raw stream with `include_usage`, and the stream helper that must agree with it |
| `stream_tools.ts` | S4 | streamed tool call, arguments accumulated across deltas |
| `image.ts` | S5 | a red PNG as a data URL in a multi-part message |
| `structured.ts` | S6 | `chat.completions.parse` with a zod schema through `zodResponseFormat`, and the raw `json_schema` form |
| `models.ts` | S7 | `models.list()` and `models.retrieve("fast")` |
| `errors.ts` | E1, E2 | a wrong key (401) and an unknown model (404) |

Each file has an `import.meta.main` block, so it runs on its own. `run.ts` is the runner the harness starts; it prints results and writes nothing.

## Setup

```sh
cd examples/openai-js
bun install --frozen-lockfile
```

The versions are exact pins (`openai@7.32.0`, `zod@4.6.6`, `typescript@7.0.2`, `@types/bun@1.4.2`), locked in `bun.lock`. The example type checks with `bunx tsc --noEmit`.

## Run one file

```sh
export PLUGBOARD_BASE_URL=http://127.0.0.1:4010/v1   # ends in /v1
export PLUGBOARD_KEY=<your app key>
bun chat.ts
```

## Run the whole example

Through the harness, which captures the traffic and writes the run under `runs/`:

```sh
bun examples/_harness/run.ts openai-js --target scripted   # local, no provider
bun examples/_harness/run.ts openai-js --target live       # the isolated server only
```

## Gotchas

- **Streaming usage needs `stream_options: { include_usage: true }`.** Without it the last chunk has no usage. A streamed tool call can arrive as one delta with the whole arguments string; `stream_tools.ts` still accumulates, because a client has to handle both.
- **The `.stream()` helper assembles the single-delta tool call correctly.** The 2026-10-11 record checked this with `finalChatCompletion()`; S3 checks the text part of it on every run.
- **`client.chat.completions.runTools` also works** (2026-10-11 record: the tool ran in the client and the second request carried the result). It is not a scenario here.
- **Structured output is a forced tool.** Plugboard asks the model to answer through a `respond` tool, and the provider does not enforce the schema. The checks read the numbers, not the form. `zodResponseFormat` sends `strict: true` and `additionalProperties: false`; every model tested accepts it.
- **Tool call ids differ by model.** The 2026-10-11 record saw a bare UUID on `fast`, `toolu_...` on Claude and `call_...` on the ChatGPT id. Don't parse them; send them back as they came.
- **`models.retrieve` was a 404 in the 2026-10-11 record.** It is implemented now and passes on the scripted target (S7). The live run is the first live check of it with this SDK; see `runs/live/`.
- **Each model entry carries a `plugboard` object.** The SDK keeps it as an extra field on the model, not an error.
- **A wrong key throws `AuthenticationError`** (401 `invalid_api_key`); an unknown model throws `NotFoundError` (404 `model_not_found`). The runner sets `maxRetries: 0`, so a retry never shows up as a second request. The 2026-10-11 record also saw the 404 on `stream: true` (the SDK raised before any chunk); `errors.ts` covers the non-stream form only.

## Known gaps

None on the scripted target. Both targets pass every scenario in the run that matters for this client.

The tool-bot runner (`examples/tool-bot/run.ts`, the same SDK) has S2 as a gap: the bot prints only its final answer, so the tool-call checks cannot be read from its output. See [#320](https://github.com/jjjermiah/opencode-plugboard/issues/320).

## Historical record

`runs/live/2026-10-11-3fcedc7/REPORT.md` is the 2026-10-11 run at commit `3fcedc7`, copied from `compat/results/openai-js.md` without change. It predates the `models.retrieve` fix and the usage fix in [#10](https://github.com/jjjermiah/opencode-plugboard/issues/10).
