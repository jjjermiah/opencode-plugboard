// S2, tool call and tool-result turn. The model asks for get_weather, the app answers, the model finishes.
import OpenAI from "openai"

export async function run(client: OpenAI, model: string) {
  // #region snippet
  const tool: OpenAI.ChatCompletionTool = {
    type: "function",
    function: {
      name: "get_weather",
      description: "Current weather for a city",
      parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    },
  }
  const messages: OpenAI.ChatCompletionMessageParam[] = [{ role: "user", content: "What is the weather in Paris? Use the tool." }]
  const first = await client.chat.completions.create({ model, messages, tools: [tool], max_tokens: 1024 })
  const message = first.choices[0]!.message
  const call = message.tool_calls![0]!
  // Send the assistant turn back as the SDK typed it, then the result under the same call id.
  messages.push(message, { role: "tool", tool_call_id: call.id, content: JSON.stringify({ temp_c: 18, sky: "cloudy" }) })
  const second = await client.chat.completions.create({ model, messages, tools: [tool], max_tokens: 1024 })
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
