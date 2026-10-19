# LangChain JS (ChatAnthropic)

`ChatAnthropic` from `@langchain/anthropic`, on plugboard's [Messages API](../messages.md). For the OpenAI-shaped client, see [LangChain JS](langchain-js.md).

## Connect

`anthropicApiUrl` is the plugboard origin, without `/v1`:

<<< @/../examples/langchain-anthropic-js/llm.ts#snippet

## Tool calls

<<< @/../examples/langchain-anthropic-js/tools.ts#snippet

## Streaming

<<< @/../examples/langchain-anthropic-js/stream.ts#snippet

The stop reason of a streamed answer is on the last chunk, in `additional_kwargs.stop_reason`.

## Structured output

<<< @/../examples/langchain-anthropic-js/structured.ts#snippet

## Limits

- `ChatAnthropic` has no model-list call. `GET /v1/models` with your key works.
- Errors carry `error.type` and no `error.code`.
