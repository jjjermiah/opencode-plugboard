// S6, structured output as a forced tool. The Messages API has no response_format here: a tool with a JSON schema and
// tool_choice pinned to it makes the model return its arguments as the schema-shaped input.
import type Anthropic from "@anthropic-ai/sdk"
import { client } from "./providers.ts"

const PROMPT = "Estimate: 2 boiled eggs and a slice of toast."
const KEYS = ["calories", "protein_g"]

export async function run(model: string) {
  // #region snippet
  const message = await client.messages.create({
    model,
    max_tokens: 1024,
    tools: [
      {
        name: "record_meal",
        description: "Record the estimated nutrition for a meal",
        input_schema: {
          type: "object",
          properties: { calories: { type: "number" }, protein_g: { type: "number" } },
          required: KEYS,
          additionalProperties: false,
        },
      },
    ],
    tool_choice: { type: "tool", name: "record_meal" },
    messages: [{ role: "user", content: PROMPT }],
  })
  // #endregion snippet
  const call = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
  const input = (call?.input ?? {}) as Record<string, unknown>
  return {
    calories: input.calories,
    protein_g: input.protein_g,
    extra_keys: Object.keys(input).filter((key) => !KEYS.includes(key)),
  }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run("fast")))
}
