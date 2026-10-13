// S4, streaming tool call. Without an execute function the SDK hands back the assembled call and runs nothing.
import { streamText, tool } from "ai"
import { z } from "zod"
import { wireFinish, type Client } from "./providers.ts"

const PROMPT = "What is the weather in Paris? Use the tool."

export async function run(client: Client, model: string) {
  let call: { toolName: string; toolCallId: string; input: unknown } | undefined
  let finish: string | null = null
  // #region snippet
  const get_weather = tool({ description: "Current weather for a city", inputSchema: z.object({ city: z.string() }) })
  const result = streamText({ model: client(model), tools: { get_weather }, prompt: PROMPT, maxOutputTokens: 1024 })
  for await (const part of result.fullStream) {
    if (part.type === "tool-call") call = part
    if (part.type === "finish") finish = part.finishReason
  }
  // #endregion snippet
  return {
    finish_reason: wireFinish(finish),
    tool_name: call?.toolName ?? "",
    tool_city: (call?.input as { city?: string } | undefined)?.city ?? "",
    tool_call_id: call?.toolCallId ?? "",
  }
}

if (import.meta.main) {
  const { apis } = await import("./providers.ts")
  console.log(JSON.stringify(await run(apis.compat, "fast")))
}
