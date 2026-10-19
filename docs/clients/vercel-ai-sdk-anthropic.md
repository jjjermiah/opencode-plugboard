# Vercel AI SDK (Anthropic provider)

`@ai-sdk/anthropic` with the `ai` package, on plugboard's [Messages API](../messages.md).

## Connect

The provider's base URL ends in `/v1`; it appends `/messages`:

<<< @/../examples/vercel-ai-sdk-anthropic/providers.ts#snippet

## Chat

<<< @/../examples/vercel-ai-sdk-anthropic/chat.ts#snippet

## Tool calls

The SDK runs `execute` and sends the follow-up request. Plugboard only returns the call.

<<< @/../examples/vercel-ai-sdk-anthropic/tools.ts#snippet

## Structured output

`Output.object` works with the default `structuredOutputMode` (which sends `output_config.format` for Claude models) and with `"jsonTool"` (a forced tool named `json`). The example uses `"jsonTool"`:

<<< @/../examples/vercel-ai-sdk-anthropic/structured.ts#snippet

## Limits

- The SDK has no model-list call. `GET /v1/models` accepts the same key as `x-api-key` or `Authorization: Bearer`.
- Errors carry `error.type` and no `error.code`.
- The schema in structured output is not enforced by the provider. Validate the answer.
