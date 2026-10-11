# Vercel AI SDK

Tested: `ai` 7.0.137, `@ai-sdk/openai-compatible` 3.0.67, `@ai-sdk/openai` 4.0.91, 2026-10-11.

Use `createOpenAICompatible`. It passed every scenario.

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
- `@ai-sdk/openai` must use `openai.chat(id)`. The default `openai(id)` calls `/v1/responses`, which plugboard does not serve yet (`404 No route for POST /v1/responses`).
- The SDK has no model list call. `GET /v1/models` with `fetch` works.
