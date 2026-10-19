# OpenAI Agents SDK

`openai-agents` for Python. It uses the Responses API by default; Chat Completions works too.

## Connect

Build a model object, so the SDK sends the id as given (its string lookup would read `anthropic/...` as a provider prefix). Turn tracing off, or the SDK posts traces to OpenAI:

<<< @/../examples/openai-agents/chat.py#snippet-model

## Chat

<<< @/../examples/openai-agents/chat.py#snippet

## Tool calls

The SDK runs the tool and makes the follow-up request itself.

<<< @/../examples/openai-agents/tools.py#snippet

## Structured output

<<< @/../examples/openai-agents/structured.py#snippet

## Streaming

`Runner.run_streamed(agent, prompt)` yields `raw_response_event` items; text arrives as `response.output_text.delta`.

<<< @/../examples/openai-agents/stream.py#snippet

## Limits

- The SDK doesn't expose the wire `finish_reason`. Check the output items for a function call instead.
