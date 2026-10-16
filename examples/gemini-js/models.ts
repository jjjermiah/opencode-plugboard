// S7, list models, and get one. Gemini names carry a `models/` prefix; the runner drops it so ids match the other examples.
import { GoogleGenAI } from "@google/genai"

export async function run(ai: GoogleGenAI) {
  // #region snippet
  const ids: string[] = []
  for await (const model of await ai.models.list()) ids.push((model.name ?? "").replace(/^models\//, ""))
  const one = await ai.models.get({ model: "fast" }) // GET /v1beta/models/fast
  // #endregion snippet
  return {
    model_ids: ids,
    has_fast: ids.includes("fast"),
    has_claude: ids.some((id) => id.startsWith("anthropic/claude")),
    has_gpt_low: ids.some((id) => id.endsWith("#low")),
    retrieved_name: (one.name ?? "").replace(/^models\//, ""),
  }
}

if (import.meta.main) {
  const baseUrl = (process.env.PLUGBOARD_BASE_URL ?? "").replace(/\/v1\/?$/, "")
  const ai = new GoogleGenAI({ apiKey: process.env.PLUGBOARD_KEY, httpOptions: { baseUrl } })
  console.log(JSON.stringify(await run(ai)))
}
