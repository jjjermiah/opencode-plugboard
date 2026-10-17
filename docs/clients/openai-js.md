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

## Responses API

The same scenarios on `client.responses` (`/v1/responses`), as the `responses` variant of the example. Each turn can send the whole conversation in `input`, or continue a stored answer with `previous_response_id` (since 0.50.0).

Text. The snippet uses `client` and `model`.

<<< @/../examples/openai-js/chat.ts#snippet-responses

Tool call. The snippet uses `client`, `model`, `PROMPT`, `TOOL_RESULT` and `responsesTool` (`get_weather` in the Responses shape, the name at the top level). `store: false` sends the whole history back in `input`.

<<< @/../examples/openai-js/tools.ts#snippet-responses

Streaming. The snippet uses `client` and `model`. The text comes from the `response.output_text.delta` events, and the final response must agree with them.

<<< @/../examples/openai-js/stream.ts#snippet-responses

Image. The snippet uses `client` and `model`; it reads `examples/_shared/red32.dataurl.txt`.

<<< @/../examples/openai-js/image.ts#snippet-responses

Structured output with `responses.parse` and `zodTextFormat`, then the raw `text.format` `json_schema` form. The snippets use `client`, `model` and `Meal` (a zod schema, as in `structured.ts`).

<<< @/../examples/openai-js/structured.ts#snippet-responses

<<< @/../examples/openai-js/structured.ts#snippet-responses-raw

Gotchas (Responses):

- The Responses API has no `finish_reason`. The example maps it from the response: `tool_calls` if a function call is in the output, else `stop` when the status is `completed`.
- `previous_response_id` works since 0.50.0: plugboard keeps each answer made with `store` on, per app. Before 0.50.0 it was refused with a 400 `unsupported_parameter`, and the recorded live run still shows that. See [Responses API](../responses.md#stored-responses-since-0-50-0).
