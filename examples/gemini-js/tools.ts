// S2, tool call and tool-result turn. The model asks for get_weather, the app answers, the model finishes.
import { GoogleGenAI, type Content } from "@google/genai"

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
  const contents: Content[] = [{ role: "user", parts: [{ text: "What is the weather in Paris? Use the tool." }] }]
  const first = await ai.models.generateContent({ model, contents, config: { tools, maxOutputTokens: 1024 } })
  const call = first.functionCalls?.[0]
  // Send the model's turn back as it came, then the result as a functionResponse. Gemini calls carry no id: the name pairs them.
  const turn: Content[] = [...contents, ...(first.candidates?.[0]?.content ? [first.candidates[0].content] : [])]
  if (call) turn.push({ role: "user", parts: [{ functionResponse: { name: call.name, response: { temp_c: 18, sky: "cloudy" } } }] })
  const second = await ai.models.generateContent({ model, contents: turn, config: { tools, maxOutputTokens: 1024 } })
  // #endregion snippet
  return {
    // Gemini reports STOP on a function call too; a turn that holds a call is read as tool_calls.
    finish_reason: call ? "tool_calls" : (first.candidates?.[0]?.finishReason?.toLowerCase() ?? null),
    tool_name: call?.name ?? null,
    tool_city: (call?.args as { city?: string } | undefined)?.city ?? "",
    tool_call_id: call?.id ?? null,
    final_text: second.text ?? "",
    final_finish_reason: second.candidates?.[0]?.finishReason?.toLowerCase() ?? null,
  }
}

if (import.meta.main) {
  const baseUrl = (process.env.PLUGBOARD_BASE_URL ?? "").replace(/\/v1\/?$/, "")
  const ai = new GoogleGenAI({ apiKey: process.env.PLUGBOARD_KEY, httpOptions: { baseUrl } })
  console.log(JSON.stringify(await run(ai, "fast")))
}
