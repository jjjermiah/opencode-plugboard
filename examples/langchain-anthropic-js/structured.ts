// S6, structured output through withStructuredOutput. ChatAnthropic answers it with a forced tool, not output_config.format.
import { z } from "zod"
import { chatModel } from "./llm.ts"

const Meal = z.object({ calories: z.number(), protein_g: z.number() })
const PROMPT = "Estimate: 2 boiled eggs and a slice of toast."
const KEYS = ["calories", "protein_g"]

export async function run(model: string) {
  // #region snippet
  const output = await chatModel(model).withStructuredOutput(Meal, { name: "record_meal" }).invoke(PROMPT)
  // #endregion snippet
  const keys = Object.keys(output)
  return {
    calories: output.calories,
    protein_g: output.protein_g,
    extra_keys: keys.filter((key) => !KEYS.includes(key)),
  }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run("fast")))
}
