// S4, streaming tool call. The tool call arrives in chunks; LangChain assembles it into tool_calls on the message.
import { readFileSync } from "node:fs"
import type { AIMessageChunk } from "@langchain/core/messages"
import { tool } from "@langchain/core/tools"
import { ChatOpenAI } from "@langchain/openai"
import { z } from "zod"

export async function run(client: { baseURL: string; apiKey: string }, model: string) {
  // #region snippet
  const PROMPT = "What is the weather in Paris? Use the tool."
  // S4 only streams the call, so this tool body is never run; it is here because bindTools needs a tool.
  const TOOL_RESULT = readFileSync(new URL("../_shared/get_weather.result.json", import.meta.url), "utf8").trim()
  const getWeather = tool(async () => TOOL_RESULT, {
    name: "get_weather",
    description: "Current weather for a city",
    schema: z.object({ city: z.string() }),
  })
  const llm = new ChatOpenAI({
    model,
    apiKey: client.apiKey,
    configuration: { baseURL: client.baseURL },
    maxTokens: 1024,
    maxRetries: 0,
    streamUsage: true,
  }).bindTools([getWeather])
  let message: AIMessageChunk | undefined
  for await (const chunk of await llm.stream(PROMPT)) message = message ? message.concat(chunk) : chunk
  // #endregion snippet
  const call = message?.tool_calls?.[0]
  return {
    finish_reason: (message?.response_metadata.finish_reason as string | undefined) ?? null,
    tool_name: call?.name ?? null,
    tool_city: String(call?.args?.city ?? ""),
    tool_call_id: call?.id ?? null,
  }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run({ baseURL: process.env.PLUGBOARD_BASE_URL!, apiKey: process.env.PLUGBOARD_KEY! }, "fast")))
}
