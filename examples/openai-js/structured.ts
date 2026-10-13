// S6, structured output: the typed helper with a zod schema, then the raw json_schema form.
import OpenAI from "openai"
import { zodResponseFormat } from "openai/helpers/zod"
import { readFileSync } from "node:fs"
import { z } from "zod"

const SCHEMA = JSON.parse(readFileSync(new URL("../_shared/meal_estimate.json_schema.json", import.meta.url), "utf8"))
const PROMPT = "Estimate: 2 boiled eggs and a slice of toast."

const Meal = z.object({ calories: z.number(), protein_g: z.number() })

export async function run(client: OpenAI, model: string) {
  const messages: OpenAI.ChatCompletionMessageParam[] = [{ role: "user", content: PROMPT }]
  // #region snippet
  const parsed = await client.chat.completions.parse({ model, messages, response_format: zodResponseFormat(Meal, "meal_estimate") })
  const meal = parsed.choices[0]?.message.parsed // a typed Meal, or undefined when the content did not parse
  // #endregion snippet
  if (!meal) throw new Error(`parse did not give a Meal: ${JSON.stringify(parsed.choices[0]?.message.content)}`)
  // #region snippet
  const raw = await client.chat.completions.create({ model, messages, response_format: { type: "json_schema", json_schema: SCHEMA } })
  // #endregion snippet
  const data = JSON.parse(raw.choices[0]?.message.content ?? "") as Record<string, unknown>
  return {
    calories: data.calories ?? null,
    protein_g: data.protein_g ?? null,
    extra_keys: Object.keys(data).filter((key) => key !== "calories" && key !== "protein_g").sort(),
  }
}

if (import.meta.main) {
  const client = new OpenAI({ baseURL: process.env.PLUGBOARD_BASE_URL, apiKey: process.env.PLUGBOARD_KEY, maxRetries: 0 })
  console.log(JSON.stringify(await run(client, "fast")))
}
