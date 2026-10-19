# Mastra

Mastra agents, through the model router's custom endpoint.

## Connect

<<< @/../examples/mastra/agent.ts#snippet

- `id` needs a provider prefix: `plugboard/fast` routes to your `url` and sends `fast`. A bare `fast` fails with `Failed to resolve model configuration`, and `openai/fast` goes to OpenAI.
- `url` is the `/v1` base; don't add `/chat/completions`.
- Set `api: "responses"` on the model object to use the Responses API instead of Chat Completions.

## What works

`agent.generate`, `agent.stream`, and tools made with `createTool`.

## Limits

- Mastra requests no stream usage, so streamed answers carry no token counts.
