// S2, tool call and tool-result turn. The model asks for get_weather, the app answers, the model finishes.
// Two variants, as in chat.ts: "chat" (ChatOpenAICompletions) and "auto" (ChatOpenAI).
import { readFileSync } from "node:fs"
import { HumanMessage, ToolMessage } from "@langchain/core/messages"
import { tool } from "@langchain/core/tools"
import { ChatOpenAI, ChatOpenAICompletions } from "@langchain/openai"
import { z } from "zod"

export async function run(client: { baseURL: string; apiKey: string }, model: string, variant = "auto") {
  // #region snippet
  const PROMPT = "What is the weather in Paris? Use the tool."
  const TOOL_RESULT = readFileSync(new URL("../_shared/get_weather.result.json", import.meta.url), "utf8").trim()
  const getWeather = tool(async () => TOOL_RESULT, {
    name: "get_weather",
    description: "Current weather for a city",
    schema: z.object({ city: z.string() }),
  })
  const options = { model, apiKey: client.apiKey, configuration: { baseURL: client.baseURL }, maxTokens: 1024, maxRetries: 0 }
  const llm = (variant === "chat" ? new ChatOpenAICompletions(options) : new ChatOpenAI(options)).bindTools([getWeather])
  const first = await llm.invoke([new HumanMessage(PROMPT)])
  const call = first.tool_calls![0]!
  // Send the assistant turn back as LangChain built it, then the result under the same call id.
  const second = await llm.invoke([
    new HumanMessage(PROMPT),
    first,
    new ToolMessage({ content: TOOL_RESULT, tool_call_id: call.id! }),
  ])
  // #endregion snippet
  return {
    finish_reason: (first.response_metadata.finish_reason as string | undefined) ?? null,
    tool_name: call.name,
    tool_city: String(call.args.city ?? ""),
    tool_call_id: call.id ?? null,
    final_text: typeof second.content === "string" ? second.content : JSON.stringify(second.content),
    final_finish_reason: (second.response_metadata.finish_reason as string | undefined) ?? null,
  }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run({ baseURL: process.env.PLUGBOARD_BASE_URL!, apiKey: process.env.PLUGBOARD_KEY! }, "fast")))
}
