// S2, tool call and tool-result turn. The SDK runs the tool and sends the second request itself; plugboard only returns the call.
import { generateText, isStepCount, tool } from "ai"
import { z } from "zod"
import weatherResult from "../_shared/get_weather.result.json" with { type: "json" }
import { client, wireFinish, type Client } from "./providers.ts"

const PROMPT = "What is the weather in Paris? Use the tool."

export async function run(model: string, make: Client = client) {
  const cities: string[] = []
  // #region snippet
  const get_weather = tool({
    description: "Current weather for a city",
    inputSchema: z.object({ city: z.string().describe("City name") }),
    execute: async ({ city }) => {
      cities.push(city)
      return weatherResult
    },
  })
  const result = await generateText({ model: make(model), tools: { get_weather }, stopWhen: isStepCount(4), prompt: PROMPT, maxOutputTokens: 1024 })
  // #endregion snippet
  const call = result.steps[0]?.toolCalls[0]
  return {
    finish_reason: wireFinish(result.steps[0]?.finishReason),
    tool_name: call?.toolName ?? "",
    tool_city: (call?.input as { city?: string } | undefined)?.city ?? cities[0] ?? "",
    tool_call_id: call?.toolCallId ?? "",
    final_text: result.text,
    final_finish_reason: wireFinish(result.finishReason),
  }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run("fast")))
}
