// S4, streaming tool call. Gemini sends each function call whole in one chunk; the SDK reports it as one tool-call part.
import { streamText, tool } from "ai"
import { z } from "zod"
import { type Client, wireFinish } from "./providers.ts"

const PROMPT = "What is the weather in Paris? Use the tool."

export async function run(client: Client, model: string) {
  let name = ""
  let input: { city?: string } = {}
  let id = ""
  let finish: string | null = null
  // #region snippet
  const get_weather = tool({ description: "Current weather for a city", inputSchema: z.object({ city: z.string() }) })
  const result = streamText({ model: client(model), tools: { get_weather }, prompt: PROMPT, maxOutputTokens: 1024 })
  for await (const part of result.fullStream) {
    if (part.type === "tool-call") {
      name = part.toolName
      input = part.input as { city?: string }
      id = part.toolCallId
    }
    if (part.type === "finish") finish = part.finishReason
  }
  // #endregion snippet
  return { finish_reason: wireFinish(finish), tool_name: name, tool_city: input.city ?? "", tool_call_id: id }
}

if (import.meta.main) {
  const { client } = await import("./providers.ts")
  console.log(JSON.stringify(await run(client, "fast")))
}
