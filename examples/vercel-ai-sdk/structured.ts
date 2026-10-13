// S6, structured output: Output.object with a zod schema. The provider sends it as json_schema.
// Without supportsStructuredOutputs on createOpenAICompatible the SDK sends json_object with no schema, and the model
// guesses the keys (README, Gotchas).
import { generateText, Output } from "ai"
import { z } from "zod"
import type { Client } from "./providers.ts"

const Meal = z.strictObject({ calories: z.number(), protein_g: z.number() })
const PROMPT = "Estimate: 2 boiled eggs and a slice of toast."

export async function run(client: Client, model: string) {
  // #region snippet
  const { output } = await generateText({ model: client(model), output: Output.object({ schema: Meal }), prompt: PROMPT, maxOutputTokens: 1024 })
  // #endregion snippet
  const keys: string[] = Object.keys(output)
  return {
    calories: output.calories,
    protein_g: output.protein_g,
    extra_keys: keys.filter((key) => key !== "calories" && key !== "protein_g"),
  }
}

if (import.meta.main) {
  const { apis } = await import("./providers.ts")
  console.log(JSON.stringify(await run(apis.compat, "fast")))
}
