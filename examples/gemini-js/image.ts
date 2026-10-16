// S5, image as inline data in a multi-part user turn.
import { GoogleGenAI } from "@google/genai"
import { readFileSync } from "node:fs"

export async function run(ai: GoogleGenAI, model: string) {
  // #region snippet
  // A 32px red PNG (examples/_shared/red32.dataurl.txt). Gemini takes the base64 bytes and the mime type, not a data URL.
  const dataUrl = readFileSync(new URL("../_shared/red32.dataurl.txt", import.meta.url), "utf8").trim()
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1)
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { text: "What color is this image? One word." },
          { inlineData: { mimeType: "image/png", data: base64 } },
        ],
      },
    ],
    config: { maxOutputTokens: 1024 },
  })
  // #endregion snippet
  return { text: response.text ?? "" }
}

if (import.meta.main) {
  const baseUrl = (process.env.PLUGBOARD_BASE_URL ?? "").replace(/\/v1\/?$/, "")
  const ai = new GoogleGenAI({ apiKey: process.env.PLUGBOARD_KEY, httpOptions: { baseUrl } })
  console.log(JSON.stringify(await run(ai, "fast")))
}
