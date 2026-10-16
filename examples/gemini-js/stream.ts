// S3, streaming text. Gemini sends usageMetadata on the last chunk, so the stream always carries usage.
import { GoogleGenAI } from "@google/genai"

export async function run(ai: GoogleGenAI, model: string) {
  // #region snippet
  const stream = await ai.models.generateContentStream({ model, contents: "Reply with exactly: pong", config: { maxOutputTokens: 1024 } })
  let text = ""
  let finish: string | null = null
  let usage: unknown = null
  for await (const chunk of stream) {
    text += chunk.text ?? "" // each chunk carries the next text delta
    finish = chunk.candidates?.[0]?.finishReason?.toLowerCase() ?? finish
    usage = chunk.usageMetadata ?? usage
  }
  // #endregion snippet
  if (!text) throw new Error("the stream sent no text")
  return { text, finish_reason: finish, usage, done: true }
}

if (import.meta.main) {
  const baseUrl = (process.env.PLUGBOARD_BASE_URL ?? "").replace(/\/v1\/?$/, "")
  const ai = new GoogleGenAI({ apiKey: process.env.PLUGBOARD_KEY, httpOptions: { baseUrl } })
  console.log(JSON.stringify(await run(ai, "fast")))
}
