# OpenAI JS SDK

<ExampleResult example="openai-js" />

Tested: `openai` 7.32.0 with `zod` 4.6.6, live run [`2026-10-13-50219b1`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/openai-js/runs/live/2026-10-13-50219b1) at plugboard 0.27.0 (`50219b1`): pass. The code below is the example's snippet, and the run's summary and transcripts are in the example directory.

```ts
import OpenAI from "openai"

const client = new OpenAI({ baseURL: "http://localhost:4010/v1", apiKey: process.env.PLUGBOARD_KEY })
```

`fast` below is an alias from the plugboard `aliases` option. Use any allowed `provider/model[#variant]` instead.

## Chat

The snippet uses `client` (above) and `model` (`"fast"`).

<<< @/../examples/openai-js/chat.ts#snippet

## Tool call

Plugboard returns the call. Your code runs it and sends the result back. The snippet uses `client` and `model` (above) and imports `OpenAI` from `openai`.

<<< @/../examples/openai-js/tools.ts#snippet

`client.chat.completions.runTools` also works. It runs your function in the client.

## Structured output

`zodResponseFormat(Meal, "meal")` with `.parse()` or `.stream()` works on every model tested and fills `message.parsed`. Plugboard instructs the model to answer through a `respond` tool. The provider does not enforce the schema. The raw `json_schema` form is in [`structured.ts`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/openai-js/structured.ts).

The snippet uses `client`, `model`, and `zodResponseFormat` from `openai/helpers/zod` with `z` from `zod`.

<<< @/../examples/openai-js/structured.ts#snippet-parse

## Gotchas

- Streaming usage needs `stream_options: { include_usage: true }`. The `.stream()` helper assembles the single-delta tool call correctly.
- `models.list()` and `client.models.retrieve(id)` (`GET /v1/models/{id}`) are both served. `retrieve` was added after the 2026-10-11 run; it passes live with this SDK (S7 in `examples/openai-js/runs/live/`).
- A wrong key throws `AuthenticationError` (401). An unknown model throws `NotFoundError` (404), also with `stream: true`.
