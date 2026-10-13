# OpenAI Agents SDK

<ExampleResult example="openai-agents" />

Tested: `openai-agents` 0.23.1 (with `openai` 3.29.0). Live record [2026-10-12 at `a67e176`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/openai-agents/runs/live/2026-10-12-a67e176/REPORT.md): all 8 scenarios passed on the isolated live dev server (`fast` = `opencode-go/glm-5.3-flash`), text, stream, tool round trip and structured output on both the Responses API and Chat Completions. The example's scripted run is checked in CI and runs the same four scenarios on both APIs.

The SDK is OpenAI's agent framework. It defaults to the Responses API, so it exercises `/v1/responses`. The example builds one model per API. A model object sends the id as given; the SDK's own string lookup would read `anthropic/...` or `openai/...` as a provider prefix.

<<< @/../examples/openai-agents/chat.py#snippet-model

## Text

The snippet uses `model_for` (above) and the model id, here `fast`, an alias from the plugboard `aliases` option.

<<< @/../examples/openai-agents/chat.py#snippet

Tracing is off in the example (`set_tracing_disabled(True)`); without it the SDK posts traces to OpenAI.

## Tool call

The SDK runs the tool and makes the follow-up request itself.

<<< @/../examples/openai-agents/tools.py#snippet

## Structured output

<<< @/../examples/openai-agents/structured.py#snippet

## Streaming

`Runner.run_streamed(agent, prompt)` returns a result whose `stream_events()` yields `raw_response_event` items. Text arrives as `response.output_text.delta` events on the Responses path, and as the equivalent deltas on the chat-completions path.

<<< @/../examples/openai-agents/stream.py#snippet

## Gotchas

- The Responses path resends the full history every turn; plugboard serves that statelessly, which is what the SDK expects here.
- The example's runs read `finish_reason` from the SDK's output items (`tool_calls` if a function call is in the last response, else `stop`), because the SDK does not expose the wire value.

Example: [`examples/openai-agents/`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/openai-agents).
