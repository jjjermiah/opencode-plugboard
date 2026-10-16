// S4, streaming tool call. Gemini sends each function call whole in one chunk, with its full args.
import { GoogleGenAI } from "@google/genai"

export async function run(ai: GoogleGenAI, model: string) {
  // #region snippet
  const tools = [
    {
      functionDeclarations: [
        {
          name: "get_weather",
          description: "Current weather for a city",
          parametersJsonSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        },
      ],
    },
  ]
  const stream = await ai.models.generateContentStream({
    model,
    contents: "What is the weather in Paris? Use the tool.",
    config: { tools, maxOutputTokens: 1024 },
  })
  let call: { name?: string; args?: Record<string, unknown>; id?: string } | undefined
  let finish: string | null = null
  for await (const chunk of stream) {
    call = chunk.functionCalls?.[0] ?? call
    finish = chunk.candidates?.[0]?.finishReason?.toLowerCase() ?? finish
  }
  // #endregion snippet
  return {
    finish_reason: call ? "tool_calls" : finish,
    tool_name: call?.name ?? null,
    tool_city: (call?.args?.city as string | undefined) ?? "",
    tool_call_id: call?.id ?? null,
  }
}

if (import.meta.main) {
  const baseUrl = (process.env.PLUGBOARD_BASE_URL ?? "").replace(/\/v1\/?$/, "")
  const ai = new GoogleGenAI({ apiKey: process.env.PLUGBOARD_KEY, httpOptions: { baseUrl } })
  console.log(JSON.stringify(await run(ai, "fast")))
}
