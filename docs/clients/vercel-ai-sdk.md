# Vercel AI SDK

Tested: `ai` 7.0.137, `@ai-sdk/openai-compatible` 3.0.67, `@ai-sdk/openai` 4.0.91. Live on 2026-10-13 at plugboard 0.26.0 (`c97ac66`): all 45 rows pass on all three ways in (`examples/vercel-ai-sdk/runs/live/2026-10-13-c97ac66/summary.md`). The 2026-10-11 record at `3fcedc7` predates the Responses route.

Use `createOpenAICompatible`. It passed every scenario with `supportsStructuredOutputs: true`. Without that flag structured output failed (see Gotchas).

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"

const plugboard = createOpenAICompatible({
  name: "plugboard",
  baseURL: "http://localhost:4010/v1",
  apiKey: process.env.PLUGBOARD_KEY,
  includeUsage: true,                // usage while streaming
  supportsStructuredOutputs: true,   // see below
})
const model = plugboard.chatModel("fast")
```

`fast` is an alias from the plugboard `aliases` option. Use any allowed `provider/model[#variant]` instead.

## Chat

```ts
import { generateText } from "ai"

const { text } = await generateText({ model, prompt: "Reply with exactly: pong" })
```

## Tool call

```ts
import { generateText, tool, isStepCount } from "ai"
import { z } from "zod"

const { text } = await generateText({
  model,
  tools: { get_weather: tool({
    description: "Current weather for a city",
    inputSchema: z.object({ city: z.string() }),
    execute: async ({ city }) => ({ city, temp_c: 18, sky: "cloudy" }),
  }) },
  stopWhen: isStepCount(4),
  prompt: "What is the weather in Paris? Use the tool.",
})
```

The SDK runs `execute` and sends the second request. Plugboard only returns the call.

## Structured output

```ts
import { generateText, Output } from "ai"

const { output } = await generateText({ model, output: Output.object({ schema: z.object({ calories: z.number(), protein_g: z.number() }) }), prompt: "Estimate: 2 boiled eggs and a slice of toast." })
```

`generateObject` is deprecated in `ai` v7 and sends the same request.

## Gotchas

- Set `supportsStructuredOutputs: true`. Without it the SDK sends `response_format: json_object` with no schema anywhere, the model guesses the keys, and `Output.object` throws `NoObjectGeneratedError`.
- `@ai-sdk/openai`: the default `openai(id)` calls `/v1/responses`, which plugboard serves (see [Responses API](../responses.md)). The 2026-10-11 record failed every scenario on it with a 404 (`No route for POST /v1/responses`), because the route did not exist yet. The 2026-10-13 live run passes all 45 rows on it, the same as on `openai.chat(id)` and `createOpenAICompatible`. Multi-turn chats work with the default `store: true`: plugboard keeps the output items of recent answers and resolves the `item_reference`s the SDK sends back (#147). `providerOptions: { openai: { store: false } }` also works and sends the earlier turns in full. `openai.chat(id)` still works if you prefer Chat Completions.
- The SDK has no model list call. `GET /v1/models` with `fetch` works.
