# OpenAI Agents SDK (JS)

<ExampleResult example="openai-agents-js" />

Tested: `@openai/agents` 0.20.0 (with `openai` 7.32.0). Live record [`2026-10-16-95261a4`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/openai-agents-js/runs/live/2026-10-16-95261a4) at plugboard 0.41.0 (main `v0.41.0-4-g95261a4`): every row on `anthropic/claude-haiku-4-5` and `openai/gpt-5.6-luna#low` passes; the `fast` rows failed with an upstream 429. The example's scripted run is checked in CI. The SDK defaults to the Responses API, so every row here exercises `/v1/responses`. The Python SDK is on the [OpenAI Agents SDK page](openai-agents.md), which also runs Chat Completions.

The example builds one model from the client. A model object sends the id as given; the SDK's own string lookup would read `anthropic/...` or `openai/...` as a provider prefix. Tracing is off (`setTracingDisabled(true)`); without it the SDK posts traces to OpenAI.

<<< @/../examples/openai-agents-js/chat.ts#snippet-model

## Text

The snippet uses `modelFor` (above), `Agent` and `run`, and the model id, here `fast`, an alias from the plugboard `aliases` option.

<<< @/../examples/openai-agents-js/chat.ts#snippet

## Tool call

The SDK runs the tool and makes the follow-up request itself.

<<< @/../examples/openai-agents-js/tools.ts#snippet

## Streamed tool call

`run(agent, input, { stream: true })` streams the same tool round trip. The call is read from the first response.

<<< @/../examples/openai-agents-js/tools.ts#snippet-stream

## Streaming

`run(agent, input, { stream: true })` returns a result whose events include `raw_model_stream_event` items. Text arrives as `output_text_delta` events.

<<< @/../examples/openai-agents-js/stream.ts#snippet

## Image

The snippet uses `modelFor` (above) and `red`, a data URL read from `examples/_shared/red32.dataurl.txt`, as an `input_image` part.

<<< @/../examples/openai-agents-js/image.ts#snippet

## Structured output

`outputType` is a zod schema; the SDK sends it as a `json_schema` text format.

<<< @/../examples/openai-agents-js/structured.ts#snippet

## Errors

A wrong key throws `AuthenticationError` (401) and an unknown model throws `NotFoundError` (404). The SDK does not wrap them.

<<< @/../examples/openai-agents-js/errors.ts#snippet-wrong-key

<<< @/../examples/openai-agents-js/errors.ts#snippet-unknown-model

## Gotchas

- The SDK does not expose the wire `finish_reason`. The example maps it from the response: `tool_calls` if a function call is in the output, else the provider's response status (`completed` becomes `stop`). A streamed run reads the status from its last `response_done` event.
- The SDK has no model-list call, so the example has no S7 row (`n/a`).

Example: [`examples/openai-agents-js/`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/openai-agents-js).
