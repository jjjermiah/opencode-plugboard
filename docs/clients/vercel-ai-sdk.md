# Vercel AI SDK

The `ai` package with an OpenAI-shaped provider. For the Anthropic and Google providers, see [Vercel AI SDK (Anthropic)](vercel-ai-sdk-anthropic.md) and [Vercel AI SDK (Google)](vercel-ai-google.md).

## Connect

Use `createOpenAICompatible` with `supportsStructuredOutputs: true`:

<<< @/../examples/vercel-ai-sdk/providers.ts#snippet

The snippets below call `client(model)`, a function from a model id to a model; `model` is an alias such as `"fast"` or any allowed `provider/model[#variant]`.

`@ai-sdk/openai` also works. Its default `openai(id)` uses the [Responses API](../responses.md); `openai.chat(id)` uses Chat Completions.

## Chat

<<< @/../examples/vercel-ai-sdk/chat.ts#snippet

## Tool calls

The SDK runs `execute` and sends the follow-up request. Plugboard only returns the call.

<<< @/../examples/vercel-ai-sdk/tools.ts#snippet

## Structured output

<<< @/../examples/vercel-ai-sdk/structured.ts#snippet

## Multi-turn on the Responses API

`openai(id)` sends `store: true`, so later turns refer to earlier answers by `item_reference`. Plugboard resolves those while it holds the answer (one hour, the last 1000 per app). For long-lived chats, pass `providerOptions: { openai: { store: false } }` so the SDK sends earlier turns in full:

<<< @/../examples/vercel-ai-sdk/tools.ts#snippet-store-false

## Limits

- Without `supportsStructuredOutputs: true`, `createOpenAICompatible` sends `response_format: json_object` with no schema, the model guesses the keys, and `Output.object` throws `NoObjectGeneratedError`.
- The SDK has no model-list call. Use `fetch` on `GET /v1/models`.
- The schema in structured output is not enforced by the provider. Validate the answer.
