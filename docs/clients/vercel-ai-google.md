# Vercel AI SDK (Google provider)

`@ai-sdk/google` with the `ai` package, on plugboard's [Gemini API](../gemini.md).

## Connect

The provider adds `/models/{id}:generateContent`, so `baseURL` ends in `/v1beta`:

<<< @/../examples/vercel-ai-google/providers.ts#snippet

## Chat

<<< @/../examples/vercel-ai-google/chat.ts#snippet

## Tool calls

The SDK runs the tool and sends the follow-up request. Plugboard only returns the call.

<<< @/../examples/vercel-ai-google/tools.ts#snippet

## Streaming

<<< @/../examples/vercel-ai-google/stream.ts#snippet

## Images

Use a `file` part with `mediaType: "image/png"` (the older `image` part also works, with a deprecation warning):

<<< @/../examples/vercel-ai-google/image.ts#snippet

## Structured output

<<< @/../examples/vercel-ai-google/structured.ts#snippet

## Model names

The provider adds the `models/` prefix only to ids without a `/`. Send `provider/model` ids percent-encoded (`anthropic%2Fclaude-haiku-4-5`, `openai%2Fgpt-5.6-luna%23low`), or use an alias. See [Gemini model names](../gemini.md#model-names).

## Limits

- The provider has no model-list call.
- The schema in structured output is not enforced by the provider. Validate the answer.
