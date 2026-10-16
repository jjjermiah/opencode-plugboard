# Google GenAI JS SDK

<ExampleResult example="gemini-js" />

Tested: `@google/genai` 2.30.0, live run [`2026-10-16-987338b`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/gemini-js/runs/live/2026-10-16-987338b) at plugboard 0.37.0 (`987338b`): pass. The code below is the example's snippets. The run's summary and transcripts are in the example directory.

## Setup

The SDK adds `/v1beta` itself, so the base URL is the plugboard origin, without `/v1`:

```ts
import { GoogleGenAI } from "@google/genai"

const ai = new GoogleGenAI({ apiKey: process.env.PLUGBOARD_KEY, httpOptions: { baseUrl: "http://127.0.0.1:4010" } })
```

The snippets use `ai` (above) and `model`, `"fast"` in the examples. `fast` is an alias from the plugboard `aliases` option.

## Chat

<<< @/../examples/gemini-js/chat.ts#snippet

## Tool call

The model asks for `get_weather`, the app answers with a `functionResponse`, and the model finishes. Gemini calls carry no id, so the name pairs the result with its call.

<<< @/../examples/gemini-js/tools.ts#snippet

## Streaming

<<< @/../examples/gemini-js/stream.ts#snippet

Streamed tool calls arrive whole, in one chunk with their full `args`:

<<< @/../examples/gemini-js/stream_tools.ts#snippet

## Image

<<< @/../examples/gemini-js/image.ts#snippet

## Structured output

Pass a JSON schema as `responseJsonSchema` with `responseMimeType: "application/json"`. Gemini enforces the schema on the model's output.

<<< @/../examples/gemini-js/structured.ts#snippet

## Model ids

A bare `#` starts a URL fragment in the SDK, so `openai/gpt-5.6-luna#low` must be sent as `openai/gpt-5.6-luna%23low`. A `/` goes as it is: `anthropic/claude-haiku-4-5` works. The example's `run.ts` does this for every scenario. Aliases avoid both problems; see [Gemini API](../gemini.md#model-names).

## Errors

A wrong key and an unknown model both throw `ApiError` with the HTTP status. Google's error body names the status (`UNAUTHENTICATED`, `NOT_FOUND`), not the OpenAI codes, so the example checks the status.

<<< @/../examples/gemini-js/errors.ts#snippet-wrong-key

<<< @/../examples/gemini-js/errors.ts#snippet-unknown-model

## Gotchas

- `ai.models.list()` and `ai.models.get()` are served. Names carry a `models/` prefix, which the example drops.
- Gemini reports `STOP` on a function call too. A turn that holds a call is a `tool_calls` turn for the example's checks.
- `countTokens` is served (an estimate). This example does not call it.
