# LangChain Python (ChatAnthropic)

`ChatAnthropic` from `langchain-anthropic`, on plugboard's [Messages API](../messages.md). For the OpenAI-shaped client, see [LangChain Python](langchain-python.md).

## Connect

`base_url` is the plugboard origin, without `/v1`:

<<< @/../examples/langchain-anthropic-python/llm.py#snippet

## Tool calls

<<< @/../examples/langchain-anthropic-python/tools.py#snippet

## Streaming

<<< @/../examples/langchain-anthropic-python/stream.py#snippet

The stop reason of a streamed answer is on the last chunk, in `response_metadata["stop_reason"]`.

## Structured output

<<< @/../examples/langchain-anthropic-python/structured.py#snippet

## Limits

- `ChatAnthropic` has no model-list call. `GET /v1/models` with your key works.
- Errors carry `error.type` and no `error.code`.
