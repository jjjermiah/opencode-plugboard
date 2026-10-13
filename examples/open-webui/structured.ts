// #region snippet
import schema from "../_shared/meal_estimate.json_schema.json" with { type: "json" }
import { at, call, type Owui } from "./owui.ts"

/** S6: structured output through Open WebUI's API. Open WebUI has no UI for it, so the request passes response_format on. */
export async function run(owui: Owui, model: string) {
  const { json } = await call(owui, "POST", "/api/chat/completions", {
    model,
    stream: false,
    max_tokens: 1024,
    messages: [{ role: "user", content: "Estimate: 2 boiled eggs and a slice of toast." }],
    response_format: { type: "json_schema", json_schema: schema },
  })
  const text = at(json, "choices", 0, "message", "content")
  const meal = typeof text === "string" ? (JSON.parse(text) as Record<string, unknown>) : {}
  const extra = Object.keys(meal).filter((key) => key !== "calories" && key !== "protein_g")
  return { calories: meal.calories, protein_g: meal.protein_g, extra_keys: extra }
}
// #endregion snippet

if (import.meta.main) {
  const owui: Owui = { base: process.env.OWUI_BASE!, token: process.env.OWUI_TOKEN!, upstream: process.env.OWUI_UPSTREAM ?? "" }
  console.log(JSON.stringify(await run(owui, process.env.MODEL ?? "fast")))
}
