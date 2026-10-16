# Vercel AI SDK (Anthropic provider)

<ExampleResult example="vercel-ai-sdk-anthropic" />

Tested: `@ai-sdk/anthropic` 4.0.81 with `ai` 7.0.137 on Bun 1.4.2. The example runs S1 to S7 and the two error paths through the provider's Messages route. The scripted run passes. The live run on plugboard main v0.41.0 (`v0.41.0-13-g7e1fdcb`) passes ([record](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/vercel-ai-sdk-anthropic/runs/live/2026-10-16-v0.41.0-13-g7e1fdcb)). The `fast` alias falls back to `anthropic/claude-haiku-4-5` when its Go provider is rate-limited, so `fast` rows can be Haiku answers. The earlier `8ef91b5` record is kept, labelled. For the OpenAI-shaped providers in the same SDK, see [Vercel AI SDK](vercel-ai-sdk.md).

The provider's base URL ends in `/v1`. Its default is `https://api.anthropic.com/v1`, and it appends `/messages`:

<<< @/../examples/vercel-ai-sdk-anthropic/providers.ts#snippet

## Chat

<<< @/../examples/vercel-ai-sdk-anthropic/chat.ts#snippet

## Tool call

The SDK runs `execute` and sends the second request. Plugboard only returns the call.

<<< @/../examples/vercel-ai-sdk-anthropic/tools.ts#snippet

## Structured output

The provider answers `Output.object` through a tool named `json`, with `tool_choice` set to `any`. The default `structuredOutputMode` is `"auto"`, which picks `output_config.format` for `claude-haiku-4-5`. Plugboard refuses that field (see [Messages](../messages.md)), so the snippet sets `structuredOutputMode: "jsonTool"` in `providerOptions`. On the wire the request carries `tool_choice: {"type": "any", "disable_parallel_tool_use": true}` and a tool named `json`.

<<< @/../examples/vercel-ai-sdk-anthropic/structured.ts#snippet

## Gotchas

- Keep `structuredOutputMode: "jsonTool"` for every model. With the default `"auto"`, `claude-haiku-4-5` gets a 400 (`output_config.format: structured outputs are not supported`).
- The SDK has no model list call. The example lists models with `fetch` and a Bearer key. `x-api-key` does not work on `GET /v1/models` ([#399](https://github.com/jjjermiah/opencode-plugboard/issues/399)).
- Messages errors carry `error.type` and no `error.code`. The example checks the status (401, 404) and does not check the code, because the Messages wire has none.
