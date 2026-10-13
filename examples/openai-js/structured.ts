// S6, structured output: the typed helper with a zod schema, then the raw json_schema form.
import OpenAI from "openai"
import { zodResponseFormat } from "openai/helpers/zod"
import { z } from "zod"

export async function run(client: OpenAI, model: string) {
  // #region parse
  const Meal = z.object({ calories: z.number(), protein_g: z.number() })
  const messages: OpenAI.ChatCompletionMessageParam[] = [{ role: "user", content: "Estimate: 2 boiled eggs and a slice of toast." }]
  const parsed = await client.chat.completions.parse({ model, messages, response_format: zodResponseFormat(Meal, "meal_estimate"), max_tokens: 1024 })
  const meal = parsed.choices[0]?.message.parsed // a typed Meal, or undefined when the content did not parse
  // #endregion parse
  if (!meal) throw new Error(`parse did not give a Meal: ${JSON.stringify(parsed.choices[0]?.message.content)}`)
  // #region raw
  // Any json_schema object works here. This one is examples/_shared/meal_estimate.json_schema.json.
  const schema = {
    name: "meal_estimate",
    strict: true,
    schema: {
      type: "object",
      properties: { calories: { type: "number" }, protein_g: { type: "number" } },
      required: ["calories", "protein_g"],
      additionalProperties: false,
    },
  }
  const raw = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: "Estimate: 2 boiled eggs and a slice of toast." }],
    response_format: { type: "json_schema", json_schema: schema },
    max_tokens: 1024,
  })
  // #endregion raw
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
