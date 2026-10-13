// S4, streaming tool call. The name and id come in one delta, the arguments in one or more; accumulate them.
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
  const stream = await client.chat.completions.create({
    model,
    messages,
    tools: [tool],
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 1024,
  })
  let id = ""
  let name = ""
  let args = ""
  let finish: string | null = null
  for await (const chunk of stream) {
    for (const choice of chunk.choices) {
      for (const delta of choice.delta.tool_calls ?? []) {
        id = delta.id || id
        name += delta.function?.name ?? ""
        args += delta.function?.arguments ?? ""
      }
      finish = choice.finish_reason ?? finish
    }
  }
  // #endregion snippet
  return { finish_reason: finish, tool_name: name, tool_city: (JSON.parse(args) as { city?: string }).city ?? "", tool_call_id: id }
}

if (import.meta.main) {
  const client = new OpenAI({ baseURL: process.env.PLUGBOARD_BASE_URL, apiKey: process.env.PLUGBOARD_KEY, maxRetries: 0 })
  console.log(JSON.stringify(await run(client, "fast")))
}
