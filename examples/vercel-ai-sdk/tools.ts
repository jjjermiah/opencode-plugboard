// S2, tool call and tool-result turn. The SDK runs the tool and sends the second request itself; plugboard only returns the call.
import { generateText, isStepCount, tool } from "ai"
import { z } from "zod"
import weatherResult from "../_shared/get_weather.result.json" with { type: "json" }
import { wireFinish, type Client } from "./providers.ts"

const PROMPT = "What is the weather in Paris? Use the tool."

/** The observations of one run: the first step's call and the final answer. */
function observe(
  result: { steps: ReadonlyArray<{ finishReason: string; toolCalls: ReadonlyArray<{ toolName: string; input: unknown; toolCallId: string }> }>; text: string; finishReason: string },
  cities: string[],
) {
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

export async function run(client: Client, model: string) {
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
  const result = await generateText({ model: client(model), tools: { get_weather }, stopWhen: isStepCount(4), prompt: PROMPT, maxOutputTokens: 1024 })
  // #endregion snippet
  return observe(result, cities)
}

/**
 * The store variant: the same round trip with `store: false` on the call. The SDK then sends the history in full
 * instead of `item_reference` items. Plugboard keeps no state, so either way the answer is the same.
 */
export async function runStoreOff(client: Client, model: string) {
  const cities: string[] = []
  // #region snippet-store-false
  const get_weather = tool({
    description: "Current weather for a city",
    inputSchema: z.object({ city: z.string().describe("City name") }),
    execute: async ({ city }) => {
      cities.push(city)
      return weatherResult
    },
  })
  const result = await generateText({
    model: client(model),
    tools: { get_weather },
    stopWhen: isStepCount(4),
    prompt: PROMPT,
    maxOutputTokens: 1024,
    providerOptions: { openai: { store: false } },
  })
  // #endregion snippet-store-false
  return observe(result, cities)
}
