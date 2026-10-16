// S2, tool call and tool-result turn. The Messages API returns the tool_use block; your code runs the tool and sends
// the tool_result back. Plugboard only returns the call.
import type Anthropic from "@anthropic-ai/sdk"
import weatherResult from "../_shared/get_weather.result.json" with { type: "json" }
import { client, finishReason } from "./providers.ts"

const PROMPT = "What is the weather in Paris? Use the tool."

const tools: Anthropic.Tool[] = [
  {
    name: "get_weather",
    description: "Current weather for a city",
    input_schema: {
      type: "object",
      properties: { city: { type: "string", description: "City name" } },
      required: ["city"],
    },
  },
]

export async function run(model: string) {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: PROMPT }]
  // #region snippet
  const first = await client.messages.create({ model, max_tokens: 1024, tools, messages })
  const call = first.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
  if (!call) throw new Error("turn 1 had no tool_use block")
  const second = await client.messages.create({
    model,
    max_tokens: 1024,
    tools,
    messages: [
      ...messages,
      { role: "assistant", content: first.content },
      { role: "user", content: [{ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(weatherResult) }] },
    ],
  })
  // #endregion snippet
  const final_text = second.content.map((block) => (block.type === "text" ? block.text : "")).join("")
  return {
    finish_reason: finishReason(first.stop_reason),
    tool_name: call.name,
    tool_city: (call.input as { city?: string }).city ?? "",
    tool_call_id: call.id,
    final_text,
    final_finish_reason: finishReason(second.stop_reason),
  }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run("fast")))
}
