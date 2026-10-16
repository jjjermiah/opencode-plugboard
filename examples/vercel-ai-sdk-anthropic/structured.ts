// S6, structured output: Output.object with a zod schema. The Anthropic provider has no response_format switch: the
// result is checked against the schema the SDK sends.
import { generateText, Output } from "ai"
import { z } from "zod"
import { client, type Client } from "./providers.ts"

const Meal = z.strictObject({ calories: z.number(), protein_g: z.number() })
const PROMPT = "Estimate: 2 boiled eggs and a slice of toast."

export async function run(model: string, make: Client = client) {
  // #region snippet
  const { output } = await generateText({ model: make(model), output: Output.object({ schema: Meal }), prompt: PROMPT, maxOutputTokens: 1024 })
  // #endregion snippet
  const keys: string[] = Object.keys(output)
  return {
    calories: output.calories,
    protein_g: output.protein_g,
    extra_keys: keys.filter((key) => key !== "calories" && key !== "protein_g"),
  }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run("fast")))
}
