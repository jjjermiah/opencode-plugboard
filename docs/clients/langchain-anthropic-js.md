# LangChain JS (ChatAnthropic)

<ExampleResult example="langchain-anthropic-js" />

Tested: `@langchain/anthropic` 1.5.12 with `@langchain/core` 1.2.17 on Bun 1.4.2. The example runs S1 to S7 and the two error paths through `ChatAnthropic`. The scripted run passes. The live run on plugboard main v0.41.0 (`v0.41.0-13-g7e1fdcb`) passes ([record](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/langchain-anthropic-js/runs/live/2026-10-16-v0.41.0-13-g7e1fdcb)). The `fast` alias falls back to `anthropic/claude-haiku-4-5` when its Go provider is rate-limited, so `fast` rows can be Haiku answers. For the OpenAI-shaped client, see [LangChain JS](langchain-js.md).

`anthropicApiUrl` is plugboard's base URL without the `/v1`. The client adds `/v1/messages` itself:

<<< @/../examples/langchain-anthropic-js/llm.ts#snippet

## Tool call

<<< @/../examples/langchain-anthropic-js/tools.ts#snippet

## Streaming

<<< @/../examples/langchain-anthropic-js/stream.ts#snippet

## Structured output

`withStructuredOutput` answers with a forced tool, not `output_config.format`, so plugboard accepts it.

<<< @/../examples/langchain-anthropic-js/structured.ts#snippet

## Gotchas

- The stop reason of a streamed answer arrives on the last chunk, in `additional_kwargs.stop_reason`, not in `response_metadata`. The example reads it there. The Python `ChatAnthropic` puts it in `response_metadata` instead.
- Messages errors carry `error.type` and no `error.code`. The example checks the status and does not check the code, because the wire has none.
- `GET /v1/models` accepts `x-api-key` since 0.47.0 ([#399](https://github.com/jjjermiah/opencode-plugboard/issues/399)). `ChatAnthropic` has no model list call; the example's `models.ts` lists with a raw `fetch` and a Bearer key, not through the client, so S7 is not a client check.
