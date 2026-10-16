// S4, streaming tool call. finalMessage() assembles the streamed tool_use block, so the call is whole when it returns.
import type Anthropic from "@anthropic-ai/sdk"
import { client, finishReason } from "./providers.ts"

const PROMPT = "What is the weather in Paris? Use the tool."

const tools: Anthropic.Tool[] = [
  {
    name: "get_weather",
    description: "Current weather for a city",
    input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  },
]

export async function run(model: string) {
  // #region snippet
  const message = await client.messages
    .stream({ model, max_tokens: 1024, tools, messages: [{ role: "user", content: PROMPT }] })
    .finalMessage()
  // #endregion snippet
  const call = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
  return {
    finish_reason: finishReason(message.stop_reason),
    tool_name: call?.name ?? "",
    tool_city: (call?.input as { city?: string } | undefined)?.city ?? "",
    tool_call_id: call?.id ?? "",
  }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run("fast")))
}
