# OpenAI Agents SDK (JS)

`@openai/agents`. It uses the Responses API.

## Connect

Build a model object, so the SDK sends the id as given (its string lookup would read `anthropic/...` as a provider prefix). Turn tracing off with `setTracingDisabled(true)`, or the SDK posts traces to OpenAI:

<<< @/../examples/openai-agents-js/chat.ts#snippet-model

## Chat

<<< @/../examples/openai-agents-js/chat.ts#snippet

## Tool calls

The SDK runs the tool and makes the follow-up request itself.

<<< @/../examples/openai-agents-js/tools.ts#snippet

## Streaming

`run(agent, input, { stream: true })` yields `raw_model_stream_event` items; text arrives as `output_text_delta`.

<<< @/../examples/openai-agents-js/stream.ts#snippet

## Images

<<< @/../examples/openai-agents-js/image.ts#snippet

## Structured output

`outputType` takes a zod schema:

<<< @/../examples/openai-agents-js/structured.ts#snippet

## Limits

- A wrong key throws `AuthenticationError` (401) and an unknown model `NotFoundError` (404).
- The SDK doesn't expose the wire `finish_reason`, and has no model-list call.
