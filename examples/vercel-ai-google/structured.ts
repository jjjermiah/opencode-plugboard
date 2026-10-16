// S6, structured output: Output.object with a zod schema. The provider sends it as responseSchema.
import { generateText, Output } from "ai"
import { z } from "zod"
import type { Client } from "./providers.ts"

const Meal = z.strictObject({ calories: z.number(), protein_g: z.number() })

export async function run(client: Client, model: string) {
  // #region snippet
  const { output } = await generateText({ model: client(model), output: Output.object({ schema: Meal }), prompt: "Estimate: 2 boiled eggs and a slice of toast.", maxOutputTokens: 1024 })
  // #endregion snippet
  return {
    calories: output.calories,
    protein_g: output.protein_g,
    extra_keys: Object.keys(output).filter((key) => key !== "calories" && key !== "protein_g"),
  }
}

if (import.meta.main) {
  const { client } = await import("./providers.ts")
  console.log(JSON.stringify(await run(client, "fast")))
}
