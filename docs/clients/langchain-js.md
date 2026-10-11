# LangChain JS

Tested: `@langchain/openai` 1.6.2, `@langchain/core` 1.2.17, 2026-10-11, at an earlier commit. Everything passed except model ids that force the Responses API (below) and `jsonMode` on `fast`, which returned `{}`.

```ts
import { ChatOpenAI } from "@langchain/openai"

const llm = new ChatOpenAI({
  model: "fast",
  apiKey: process.env.PLUGBOARD_KEY,
  configuration: { baseURL: "http://localhost:4010/v1" },
  useResponsesApi: false,
  streamUsage: true,   // usage while streaming
})
```

`fast` is an alias from the plugboard `aliases` option. See the gotcha before you use a `gpt-5.6` id.

## Chat

```ts
console.log((await llm.invoke("Reply with exactly: pong")).content)
```

## Tool call

```ts
import { ToolMessage } from "@langchain/core/messages"
import { tool } from "@langchain/core/tools"
import { z } from "zod"

const getWeather = tool(async () => '{"temp_c":18,"sky":"cloudy"}', {
  name: "get_weather", description: "Current weather for a city", schema: z.object({ city: z.string() }),
})
const bound = llm.bindTools([getWeather])
const history: any[] = ["What is the weather in Paris? Use the tool."]
const ai = await bound.invoke(history)            // ai.tool_calls[0].name === "get_weather"
history.push(ai, new ToolMessage({ content: await getWeather.invoke(ai.tool_calls![0]!.args), tool_call_id: ai.tool_calls![0]!.id! }))
console.log((await bound.invoke(history)).content)
```

## Structured output

`llm.withStructuredOutput(Meal, { method: "jsonSchema" })` and `method: "functionCalling"` work. `jsonMode` sends `json_object` with no schema, and a weak model can return `{}`.

## Gotchas

- Model ids containing `gpt-5.6` (also `gpt-5.2-pro`, `gpt-5.4-pro`, `gpt-5.5-pro`, `codex`) force the Responses API and ignore `useResponsesApi: false`. Plugboard serves that API (see [Responses API](../responses.md)): with `openai/gpt-5.6-luna#low`, `invoke`, streaming, a tool round trip, image input and `withStructuredOutput` (`jsonSchema`, `functionCalling`) passed on 2026-10-11. Responses results have no `finish_reason` in `response_metadata`; check `status` there instead.
- There is no list-models call. Use the `openai` SDK directly.
