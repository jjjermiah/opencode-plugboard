// #region snippet
import { at, fromEnv, webhook, type N8n } from "./n8n.ts"

/**
 * S6: structured output. The Structured Output Parser asks the model for the meal JSON in the prompt and parses its
 * answer, so the webhook returns the parsed object. n8n does not send response_format for this node.
 */
export async function run(n8n: N8n, model: string) {
  const answer = await webhook(n8n, "pb-s6-structured", { model, prompt: "Estimate: 2 boiled eggs and a slice of toast." })
  const meal = (at(answer.json, "output") ?? {}) as Record<string, unknown>
  const extra = Object.keys(meal).filter((key) => key !== "calories" && key !== "protein_g")
  return { calories: meal.calories, protein_g: meal.protein_g, extra_keys: extra }
}
// #endregion snippet

if (import.meta.main) {
  const n8n = fromEnv()
  console.log(JSON.stringify(await run(n8n, process.env.MODEL ?? "fast")))
}
