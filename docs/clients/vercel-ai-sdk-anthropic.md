# Vercel AI SDK (Anthropic provider)

<ExampleResult example="vercel-ai-sdk-anthropic" />

Tested: `@ai-sdk/anthropic` 4.0.81 with `ai` 7.0.137 on Bun 1.4.2. The example runs S1 to S7 and the two error paths through the provider's Messages route. The live run at plugboard `8ef91b5` is `partial`: every required row passes except S6 on `anthropic/claude-haiku-4-5`, and the two error rows are gaps. The run and its transcripts are in [`examples/vercel-ai-sdk-anthropic/runs/live`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/vercel-ai-sdk-anthropic/runs/live/2026-10-16-8ef91b5). For the OpenAI-shaped providers in the same SDK, see [Vercel AI SDK](vercel-ai-sdk.md).

The provider's base URL ends in `/v1`. Its default is `https://api.anthropic.com/v1`, and it appends `/messages`:

<<< @/../examples/vercel-ai-sdk-anthropic/providers.ts#snippet

## Chat

<<< @/../examples/vercel-ai-sdk-anthropic/chat.ts#snippet

## Tool call

The SDK runs `execute` and sends the second request. Plugboard only returns the call.

<<< @/../examples/vercel-ai-sdk-anthropic/tools.ts#snippet

## Structured output

<<< @/../examples/vercel-ai-sdk-anthropic/structured.ts#snippet

## Gotchas

- Structured output on `anthropic/claude-haiku-4-5` fails: the SDK sends `output_config.format`, and plugboard refuses it (see [Messages](../messages.md)). The row is a gap. Use a forced tool instead, as the [Anthropic SDK pages](anthropic-js.md) do.
- The SDK has no model list call. `GET /v1/models` with a Bearer key and `fetch` works. `x-api-key` does not (see [#399](https://github.com/jjjermiah/opencode-plugboard/issues/399)).
- Messages errors carry `error.type` and no `error.code`, so the shared `code` check in E1 and E2 is a gap.
