// S2, tool call and tool-result turn. bindTools sends the schema; your code runs the tool and sends a ToolMessage back.
import { HumanMessage, ToolMessage } from "@langchain/core/messages"
import { z } from "zod"
import weatherResult from "../_shared/get_weather.result.json" with { type: "json" }
import { chatModel, finishReason } from "./llm.ts"

const PROMPT = "What is the weather in Paris? Use the tool."
const getWeather = {
  name: "get_weather",
  description: "Current weather for a city",
  schema: z.object({ city: z.string().describe("City name") }),
}

export async function run(model: string) {
  // #region snippet
  const llm = chatModel(model).bindTools([getWeather])
  const first = await llm.invoke([new HumanMessage(PROMPT)])
  const call = first.tool_calls?.[0]
  if (!call) throw new Error("turn 1 had no tool call")
  const second = await llm.invoke([new HumanMessage(PROMPT), first, new ToolMessage({ tool_call_id: call.id!, content: JSON.stringify(weatherResult) })])
  // #endregion snippet
  return {
    finish_reason: finishReason(first.response_metadata.stop_reason),
    tool_name: call.name,
    tool_city: String((call.args as { city?: unknown }).city ?? ""),
    tool_call_id: call.id ?? "",
    final_text: typeof second.content === "string" ? second.content : second.content.map((part) => ("text" in part ? part.text : "")).join(""),
    final_finish_reason: finishReason(second.response_metadata.stop_reason),
  }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run("fast")))
}
