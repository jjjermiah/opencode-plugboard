# Vercel AI SDK (Google provider)

<ExampleResult example="vercel-ai-google" />

Tested: `@ai-sdk/google` 4.0.98 with `ai` 7.0.137 and `zod` 4.6.6, live run [`2026-10-16-987338b`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/vercel-ai-google/runs/live/2026-10-16-987338b) at plugboard 0.37.0 (`987338b`): pass. The code below is the example's snippets. The OpenAI-shaped route through `@ai-sdk/openai-compatible` is on [Vercel AI SDK](vercel-ai-sdk.md).

## Setup

The provider adds `/models/{id}:generateContent` itself, so `baseURL` ends in `/v1beta`:

<<< @/../examples/vercel-ai-google/providers.ts#snippet

The snippets use `client(model)`, which returns a model; `"fast"` is an alias.

## Chat

<<< @/../examples/vercel-ai-google/chat.ts#snippet

## Tool call

The SDK runs the tool and sends the second request itself. Plugboard only returns the call.

<<< @/../examples/vercel-ai-google/tools.ts#snippet

## Streaming

<<< @/../examples/vercel-ai-google/stream.ts#snippet

<<< @/../examples/vercel-ai-google/stream_tools.ts#snippet

## Image

The `image` content part works, and the SDK logs a deprecation warning for it. A `file` part with `mediaType: "image/*"` is the replacement the warning names.

<<< @/../examples/vercel-ai-google/image.ts#snippet

## Structured output

<<< @/../examples/vercel-ai-google/structured.ts#snippet

## Model ids

The provider adds the `models/` prefix only when the id has no `/`. An id like `anthropic/claude-haiku-4-5` would then go out without it, and plugboard answers 404 "No Gemini route". `providers.ts` sends the id percent-encoded (`anthropic%2Fclaude-haiku-4-5`, `openai%2Fgpt-5.6-luna%23low`). See [Gemini API](../gemini.md#model-names).

## Errors

<<< @/../examples/vercel-ai-google/errors.ts#snippet-wrong-key

<<< @/../examples/vercel-ai-google/errors.ts#snippet-unknown-model

## Gotchas

- `@ai-sdk/google` has no model-list call, so S7 does not apply.
