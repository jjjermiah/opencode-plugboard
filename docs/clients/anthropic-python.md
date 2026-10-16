# Anthropic Python SDK

<ExampleResult example="anthropic-python" />

Tested: `anthropic` 1.15.0 on Python 3.13. The example runs S1 to S7 and the two error paths on plugboard's Messages route (`POST /v1/messages`). The scripted run has every required row passing except S7, a gap ([#399](https://github.com/jjjermiah/opencode-plugboard/issues/399)). The live run on plugboard main v0.41.0 (`v0.41.0-13-g7e1fdcb`) is `partial`: the only gap is S7 ([record](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/anthropic-python/runs/live/2026-10-16-v0.41.0-13-g7e1fdcb)). The `fast` alias falls back to `anthropic/claude-haiku-4-5` when its Go provider is rate-limited, so `fast` rows can be Haiku answers.

Point the SDK at plugboard's base URL without the `/v1`. The SDK adds `/v1/messages` itself:

<<< @/../examples/anthropic-python/provider.py#snippet

## Chat

<<< @/../examples/anthropic-python/chat.py#snippet

## Tool call

The Messages API returns a `tool_use` block. Your code runs the tool and sends a `tool_result` back.

<<< @/../examples/anthropic-python/tools.py#snippet

## Streaming

<<< @/../examples/anthropic-python/stream.py#snippet

## Structured output

Plugboard refuses `output_config.format` (see [Messages](../messages.md)). Use a forced tool: a tool whose `input_schema` is the schema, with `tool_choice` set to that tool. The `input` of the call is the answer.

<<< @/../examples/anthropic-python/structured.py#snippet

## Gotchas

- `client.models.list()` sends `x-api-key`, and `GET /v1/models` answers 401 to it. Tracked in [#399](https://github.com/jjjermiah/opencode-plugboard/issues/399). With `Authorization: Bearer` the list works.
- Messages errors carry `error.type` and no `error.code`. The example checks the status and does not check the code, because the wire has none.
- The Messages API reports `end_turn` and `tool_use`. The example maps them to the `stop` and `tool_calls` the other examples use.
