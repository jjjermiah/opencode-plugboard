# LangChain Python (ChatAnthropic)

<ExampleResult example="langchain-anthropic-python" />

Tested: `langchain-anthropic` 1.7.6 on Python 3.13. The example runs S1 to S7 and the two error paths through `ChatAnthropic`. The scripted run passes. The live run on plugboard main v0.41.0 (`v0.41.0-13-g7e1fdcb`) passes ([record](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/langchain-anthropic-python/runs/live/2026-10-16-v0.41.0-13-g7e1fdcb)). The `fast` alias falls back to `anthropic/claude-haiku-4-5` when its Go provider is rate-limited, so `fast` rows can be Haiku answers. For the OpenAI-shaped client, see [LangChain Python](langchain-python.md).

`base_url` is plugboard's base URL without the `/v1`. The client adds `/v1/messages` itself:

<<< @/../examples/langchain-anthropic-python/llm.py#snippet

## Tool call

<<< @/../examples/langchain-anthropic-python/tools.py#snippet

## Streaming

<<< @/../examples/langchain-anthropic-python/stream.py#snippet

## Structured output

`with_structured_output(..., method="function_calling")` answers with a forced tool, not `output_config.format`, so plugboard accepts it.

<<< @/../examples/langchain-anthropic-python/structured.py#snippet

## Gotchas

- The stop reason of a streamed answer is on the last chunk, in `response_metadata.stop_reason`. The JS `ChatAnthropic` puts it in `additional_kwargs` instead.
- Messages errors carry `error.type` and no `error.code`. The example checks the status and does not check the code, because the wire has none.
- `GET /v1/models` accepts `x-api-key` since 0.47.0 ([#399](https://github.com/jjjermiah/opencode-plugboard/issues/399)). `ChatAnthropic` has no model list call; the example's `models.py` lists with a raw `httpx` call and a Bearer key, not through the client, so S7 is not a client check.
