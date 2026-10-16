# Vercel AI SDK

<ExampleResult example="vercel-ai-sdk" />

Tested: `ai` 7.0.137, `@ai-sdk/openai-compatible` 3.0.67, `@ai-sdk/openai` 4.0.91. Live run [`2026-10-13-c97ac66`](https://github.com/jjjermiah/opencode-plugboard/tree/main/examples/vercel-ai-sdk/runs/live/2026-10-13-c97ac66) at plugboard 0.26.0 (`c97ac66`): pass, all 45 rows pass on all three ways in. The code below is the example's snippet, and the run's summary and transcripts are in the example directory.

Use `createOpenAICompatible`. It passed every scenario with `supportsStructuredOutputs: true`. Without that flag structured output failed (see Gotchas).

<<< @/../examples/vercel-ai-sdk/providers.ts#snippet

The scenario files take `client`, a function from a model id to a model. In [`providers.ts`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/vercel-ai-sdk/providers.ts), `apis.compat` is `(id) => compat.chatModel(id)`. The snippets below use `client(model)`, with `model` set to `"fast"`.

`fast` is an alias from the plugboard `aliases` option. Use any allowed `provider/model[#variant]` instead.

## Chat

<<< @/../examples/vercel-ai-sdk/chat.ts#snippet

## Tool call

<<< @/../examples/vercel-ai-sdk/tools.ts#snippet

The SDK runs `execute` and sends the second request. Plugboard only returns the call. The snippet uses `client`, `model`, and `PROMPT` (`"What is the weather in Paris? Use the tool."`) and `wireFinish` from the file's top; `weatherResult` is `examples/_shared/get_weather.result.json`.

## Structured output

<<< @/../examples/vercel-ai-sdk/structured.ts#snippet

The snippet uses `Meal`, a zod `strictObject` with `calories` and `protein_g`, and `PROMPT` from the file's top. `generateObject` is deprecated in `ai` v7 and sends the same request.

## Gotchas

- Set `supportsStructuredOutputs: true`. Without it the SDK sends `response_format: json_object` with no schema anywhere, the model guesses the keys, and `Output.object` throws `NoObjectGeneratedError`.
- `@ai-sdk/openai`: the default `openai(id)` calls `/v1/responses`, which plugboard serves (see [Responses API](../responses.md)). The 2026-10-11 record failed every scenario on it with a 404 (`No route for POST /v1/responses`), because the route did not exist yet. The 2026-10-13 live run passes all 45 rows on it, the same as on `openai.chat(id)` and `createOpenAICompatible`. Multi-turn chats work with the default `store: true`: plugboard keeps the output items of recent answers and resolves the `item_reference`s the SDK sends back (#147). `providerOptions: { openai: { store: false } }` also works and sends the earlier turns in full. `openai.chat(id)` still works if you prefer Chat Completions.
- The SDK has no model list call. `GET /v1/models` with `fetch` works.

## Store off

`openai(id)` sends `store: true` by default, so a multi-turn chat replays earlier answers as `item_reference` items. Plugboard resolves those only while it holds the answer (one hour, the last 1000 per app). With `providerOptions: { openai: { store: false } }` the SDK sends the earlier turns in full instead. The example's `responses-store-false` row of the tool-call scenario passes on the same wire shape; it does not replay an `item_reference`.

The snippet uses `client` and `model`, and `tool`, `generateText` and `isStepCount` from `ai`, with `z` from `zod`.

<<< @/../examples/vercel-ai-sdk/tools.ts#snippet-store-false
