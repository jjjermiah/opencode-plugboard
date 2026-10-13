// S4, streaming tool call. The name and id come in one delta, the arguments in one or more; accumulate them.
import OpenAI from "openai"
import { readFileSync } from "node:fs"

const TOOL = JSON.parse(readFileSync(new URL("../_shared/get_weather.tool.json", import.meta.url), "utf8")) as OpenAI.ChatCompletionTool
const PROMPT = "What is the weather in Paris? Use the tool."

export async function run(client: OpenAI, model: string) {
  const messages: OpenAI.ChatCompletionMessageParam[] = [{ role: "user", content: PROMPT }]
  // #region snippet
  const stream = await client.chat.completions.create({ model, messages, tools: [TOOL], stream: true, stream_options: { include_usage: true }, max_tokens: 1024 })
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
