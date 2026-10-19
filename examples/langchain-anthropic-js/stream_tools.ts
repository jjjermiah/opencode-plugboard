// S4, streaming tool call. The chunks are merged into one message; its tool_calls hold the assembled call.
import { HumanMessage } from "@langchain/core/messages"
import { concat } from "@langchain/core/utils/stream"
import { z } from "zod"
import { chatModel, finishReason } from "./llm.ts"

const PROMPT = "What is the weather in Paris? Use the tool."
const getWeather = { name: "get_weather", description: "Current weather for a city", schema: z.object({ city: z.string() }) }

export async function run(model: string) {
  // #region snippet
  const stream = await chatModel(model).bindTools([getWeather]).stream([new HumanMessage(PROMPT)])
  let merged: Awaited<ReturnType<typeof stream.next>>["value"] | undefined
  let stopReason: unknown
  for await (const chunk of stream) {
    merged = merged === undefined ? chunk : concat(merged, chunk)
    // The stop reason arrives on the message_delta chunk, in additional_kwargs (not response_metadata).
    if (typeof chunk.additional_kwargs.stop_reason === "string") stopReason = chunk.additional_kwargs.stop_reason
  }
  // #endregion snippet
  const call = merged?.tool_calls?.[0]
  return {
    finish_reason: finishReason(stopReason),
    tool_name: call?.name ?? "",
    tool_city: String((call?.args as { city?: unknown } | undefined)?.city ?? ""),
    tool_call_id: call?.id ?? "",
  }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run("fast")))
}
