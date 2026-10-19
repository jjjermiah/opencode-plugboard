// S6, structured output: a JSON schema in the request, the answer read back as JSON.
import { GoogleGenAI } from "@google/genai"

export async function run(ai: GoogleGenAI, model: string) {
  // #region snippet
  // Gemini enforces responseJsonSchema on the model's output, unlike plugboard's forced-tool route for other APIs.
  const schema = {
    type: "object",
    properties: { calories: { type: "number" }, protein_g: { type: "number" } },
    required: ["calories", "protein_g"],
    additionalProperties: false,
  }
  const response = await ai.models.generateContent({
    model,
    contents: "Estimate: 2 boiled eggs and a slice of toast.",
    config: { responseMimeType: "application/json", responseJsonSchema: schema, maxOutputTokens: 1024 },
  })
  // #endregion snippet
  const data = JSON.parse(response.text ?? "") as Record<string, unknown>
  return {
    calories: data.calories ?? null,
    protein_g: data.protein_g ?? null,
    extra_keys: Object.keys(data).filter((key) => key !== "calories" && key !== "protein_g").sort(),
  }
}

if (import.meta.main) {
  const baseUrl = (process.env.PLUGBOARD_BASE_URL ?? "").replace(/\/v1\/?$/, "")
  const ai = new GoogleGenAI({ apiKey: process.env.PLUGBOARD_KEY, httpOptions: { baseUrl } })
  console.log(JSON.stringify(await run(ai, "fast")))
}
