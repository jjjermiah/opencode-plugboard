// S6, structured output: LangChain's withStructuredOutput as text (json_schema) and as a forced tool (functionCalling).
// The json_object mode (method "jsonMode") is also tried and its outcome recorded in the transcript only: it is not
// checked (see README, gotchas).
import { ChatOpenAI } from "@langchain/openai"
import { z } from "zod"

export async function run(client: { baseURL: string; apiKey: string }, model: string) {
  // #region snippet
  const PROMPT = "Estimate: 2 boiled eggs and a slice of toast."
  const Meal = z.object({ calories: z.number(), protein_g: z.number() }).describe("Meal nutrition estimate.")
  const llm = new ChatOpenAI({
    model,
    apiKey: client.apiKey,
    configuration: { baseURL: client.baseURL },
    maxTokens: 1024,
    maxRetries: 0,
  })
  // includeRaw keeps the model's own text, before zod drops any keys it does not know.
  const { parsed: meal, raw } = await llm.withStructuredOutput(Meal, { method: "jsonSchema", name: "Meal", includeRaw: true }).invoke(PROMPT)
  // #endregion snippet
  // The forced-tool form must give the same shape.
  const tool = await llm.withStructuredOutput(Meal, { method: "functionCalling", name: "Meal" }).invoke(PROMPT)
  if (typeof tool.calories !== "number" || typeof tool.protein_g !== "number") throw new Error("functionCalling gave no numbers")
  try {
    await llm.withStructuredOutput(Meal, { method: "jsonMode" }).invoke(`${PROMPT} Respond as JSON with keys calories and protein_g (numbers).`)
  } catch {
    // Recorded in the transcript; not part of the checks.
  }
  const text = typeof raw.content === "string" ? raw.content : raw.content.map((part) => ("text" in part ? part.text : "")).join("")
  const written = JSON.parse(text) as Record<string, unknown>
  return {
    calories: meal.calories,
    protein_g: meal.protein_g,
    extra_keys: Object.keys(written).filter((key) => key !== "calories" && key !== "protein_g").sort(),
  }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run({ baseURL: process.env.PLUGBOARD_BASE_URL!, apiKey: process.env.PLUGBOARD_KEY! }, "fast")))
}
