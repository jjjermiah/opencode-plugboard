# LangChain Python (ChatAnthropic)

<ExampleResult example="langchain-anthropic-python" />

Tested: `langchain-anthropic` 1.7.6 on Python 3.13. The example runs S1 to S7 and the two error paths through `ChatAnthropic`. The live run at plugboard `8ef91b5` is `partial`: every required row passes and the two error rows are gaps. The run and its transcripts are in [`examples/langchain-anthropic-python/runs/live`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/langchain-anthropic-python/runs/live/2026-10-16-8ef91b5). For the OpenAI-shaped client, see [LangChain Python](langchain-python.md).

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
- Messages errors carry `error.type` and no `error.code`, so the shared `code` check in E1 and E2 is a gap.
- `GET /v1/models` ignores `x-api-key` ([#399](https://github.com/jjjermiah/opencode-plugboard/issues/399)). `ChatAnthropic` has no model list call; the example's `models.py` lists with a Bearer key.
