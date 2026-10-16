// S1, plain chat, non-stream. The smallest call: one string of contents, one answer.
import { GoogleGenAI } from "@google/genai"

export async function run(ai: GoogleGenAI, model: string) {
  // #region snippet
  const response = await ai.models.generateContent({ model, contents: "Reply with exactly: pong", config: { maxOutputTokens: 1024 } })
  // #endregion snippet
  return {
    text: response.text ?? "",
    finish_reason: response.candidates?.[0]?.finishReason?.toLowerCase() ?? null,
    usage: response.usageMetadata ?? null,
  }
}

if (import.meta.main) {
  const baseUrl = (process.env.PLUGBOARD_BASE_URL ?? "").replace(/\/v1\/?$/, "")
  const ai = new GoogleGenAI({ apiKey: process.env.PLUGBOARD_KEY, httpOptions: { baseUrl } })
  console.log(JSON.stringify(await run(ai, "fast")))
}
