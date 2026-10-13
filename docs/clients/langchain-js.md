# LangChain JS

Tested: `@langchain/openai` 1.6.2, `@langchain/core` 1.2.17, live on 2026-10-13 at plugboard 0.26.0 (`c97ac66`), in [`examples/langchain-js`](https://github.com/jjjermiah/opencode-plugboard/blob/main/examples/langchain-js/runs/live/2026-10-13-c97ac66-2/REPORT.md). Every scenario passed on `fast` and `anthropic/claude-haiku-4-5`. On `openai/gpt-5.6-luna#low`, S1 and S2 pass through `ChatOpenAICompletions` but not through `ChatOpenAI` (the Responses route, below). `jsonMode` on `fast` returned a correct object in this run; the 2026-10-11 run returned `{}`.

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

- Model ids containing `gpt-5.6` (also `gpt-5.2-pro`, `gpt-5.4-pro`, `gpt-5.5-pro`, `codex`) force the Responses API when you use `ChatOpenAI`, and `useResponsesApi: false` does not override it. Plugboard serves that API (see [Responses API](../responses.md)). On 2026-10-13, `openai/gpt-5.6-luna#low` passed image input and `withStructuredOutput` (`jsonSchema`, `functionCalling`) through `ChatOpenAI`; streaming was run on `fast` only. For `invoke` and a tool round trip, `finish_reason` is missing on that route: plugboard returns `status: "completed"`, and LangChain does not expose a `finish_reason` for it. Check `response_metadata.status` there instead. To keep the same id on Chat Completions, use `ChatOpenAICompletions`: `new ChatOpenAICompletions({ model: "openai/gpt-5.6-luna#low", apiKey, configuration: { baseURL } })`.
- There is no list-models call. Use the `openai` SDK directly.
