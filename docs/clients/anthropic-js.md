# Anthropic TypeScript SDK

<ExampleResult example="anthropic-js" />

Tested: `@anthropic-ai/sdk` 0.135.0 on Bun 1.4.2. The example runs S1 to S7 and the two error paths on plugboard's Messages route (`POST /v1/messages`). The scripted run has every required row passing except S7, a gap ([#399](https://github.com/jjjermiah/opencode-plugboard/issues/399)). The live run at plugboard `b41c376` (v0.37.0) passes on `anthropic/claude-haiku-4-5` and `openai/gpt-5.6-luna#low`. Its `fast` rows failed on upstream quota, so that record's verdict is `fail` ([record](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/anthropic-js/runs/live/2026-10-16-b41c376)).

Point the SDK at plugboard's base URL without the `/v1`. The SDK adds `/v1/messages` itself:

<<< @/../examples/anthropic-js/providers.ts#snippet

## Chat

<<< @/../examples/anthropic-js/chat.ts#snippet

## Tool call

The Messages API returns a `tool_use` block. Your code runs the tool and sends a `tool_result` back.

<<< @/../examples/anthropic-js/tools.ts#snippet

## Streaming

<<< @/../examples/anthropic-js/stream.ts#snippet

## Structured output

Plugboard refuses `output_config.format` (see [Messages](../messages.md)). Use a forced tool: a tool whose `input_schema` is the schema, with `tool_choice` set to that tool. The `input` of the call is the answer.

<<< @/../examples/anthropic-js/structured.ts#snippet

## Gotchas

- `client.models.list()` sends `x-api-key`, and `GET /v1/models` answers 401 to it. Tracked in [#399](https://github.com/jjjermiah/opencode-plugboard/issues/399). With `Authorization: Bearer` the list works.
- Messages errors carry `error.type` (`authentication_error`, `not_found_error`) and no `error.code`. The example checks the status and does not check the code, because the wire has none.
- The Messages API reports `end_turn` and `tool_use`. The example maps them to the `stop` and `tool_calls` the other examples use.
