// S2, tool call and tool-result turn. The model asks for get_weather, the app answers, the model finishes.
import OpenAI from "openai"
import { readFileSync } from "node:fs"

const SHARED = new URL("../_shared/", import.meta.url)
const TOOL = JSON.parse(readFileSync(new URL("get_weather.tool.json", SHARED), "utf8")) as OpenAI.ChatCompletionTool
const TOOL_RESULT = readFileSync(new URL("get_weather.result.json", SHARED), "utf8").trim()
const PROMPT = "What is the weather in Paris? Use the tool."

export async function run(client: OpenAI, model: string) {
  const messages: OpenAI.ChatCompletionMessageParam[] = [{ role: "user", content: PROMPT }]
  // #region snippet
  const first = await client.chat.completions.create({ model, messages, tools: [TOOL], max_tokens: 1024 })
  const message = first.choices[0]!.message
  const call = message.tool_calls![0]!
  // Send the assistant turn back as the SDK typed it, then the result under the same call id.
  messages.push(message, { role: "tool", tool_call_id: call.id, content: TOOL_RESULT })
  const second = await client.chat.completions.create({ model, messages, tools: [TOOL], max_tokens: 1024 })
  // #endregion snippet
  const city = call.type === "function" ? (JSON.parse(call.function.arguments) as { city?: string }).city ?? "" : ""
  return {
    finish_reason: first.choices[0]?.finish_reason ?? null,
    tool_name: call.type === "function" ? call.function.name : null,
    tool_city: city,
    tool_call_id: call.id,
    final_text: second.choices[0]?.message.content ?? "",
    final_finish_reason: second.choices[0]?.finish_reason ?? null,
  }
}

if (import.meta.main) {
  const client = new OpenAI({ baseURL: process.env.PLUGBOARD_BASE_URL, apiKey: process.env.PLUGBOARD_KEY, maxRetries: 0 })
  console.log(JSON.stringify(await run(client, "fast")))
}
