// S2, tool call and tool-result turn through the OpenAI Agents SDK. The SDK runs the tool and sends the second turn itself.
import { Agent, run, tool, type ModelResponse } from "@openai/agents"
import type OpenAI from "openai"
import { z } from "zod"
import { finishReason, modelFor, usageOf } from "./chat.ts"

const PROMPT = "What is the weather in Paris? Use the tool."

function toolObservations(first: ModelResponse, last: ModelResponse, cities: string[], finalText: string) {
  const call = first.output.find((item) => item.type === "function_call")
  const args = call?.type === "function_call" ? (JSON.parse(call.arguments) as { city?: string }) : {}
  return {
    finish_reason: finishReason(first),
    tool_name: call?.type === "function_call" ? call.name : "",
    tool_city: args.city ?? cities[0] ?? "",
    tool_call_id: call?.type === "function_call" ? call.callId : "",
    final_text: finalText,
    final_finish_reason: finishReason(last),
    usage: usageOf(last),
  }
}

/** S4: the same tool, run with `stream: true`. The SDK streams the answer and the tool turn; the call is read from the first response. */
export async function runStreamTools(client: OpenAI, model: string) {
  const cities: string[] = []
  // #region snippet-stream
  const getWeather = tool({
    name: "get_weather",
    description: "Current weather for a city",
    parameters: z.object({ city: z.string().describe("City name") }),
    execute: async ({ city }) => {
      cities.push(city)
      return { temp_c: 18, sky: "cloudy" }
    },
  })
  const agent = new Agent({ name: "weather", model: modelFor(client, model), instructions: "Use the tool to answer.", tools: [getWeather] })
  const stream = await run(agent, PROMPT, { stream: true })
  for await (const _event of stream) {
    // each event is a raw model event or a run item; the final result is read after the loop
  }
  // #endregion snippet-stream
  await stream.completed
  return toolObservations(stream.rawResponses[0]!, stream.rawResponses.at(-1)!, cities, String(stream.finalOutput ?? ""))
}

export async function runTools(client: OpenAI, model: string) {
  const cities: string[] = []
  // #region snippet
  const getWeather = tool({
    name: "get_weather",
    description: "Current weather for a city",
    parameters: z.object({ city: z.string().describe("City name") }),
    execute: async ({ city }) => {
      cities.push(city)
      return { temp_c: 18, sky: "cloudy" }
    },
  })
  const agent = new Agent({ name: "weather", model: modelFor(client, model), instructions: "Use the tool to answer.", tools: [getWeather] })
  const result = await run(agent, PROMPT)
  // #endregion snippet
  const first = result.rawResponses[0]!
  const last = result.rawResponses.at(-1)!
  const call = first.output.find((item) => item.type === "function_call")
  const args = call?.type === "function_call" ? (JSON.parse(call.arguments) as { city?: string }) : {}
  return {
    finish_reason: finishReason(first),
    tool_name: call?.type === "function_call" ? call.name : "",
    tool_city: args.city ?? cities[0] ?? "",
    tool_call_id: call?.type === "function_call" ? call.callId : "",
    final_text: String(result.finalOutput ?? ""),
    final_finish_reason: finishReason(last),
    usage: usageOf(last),
  }
}
