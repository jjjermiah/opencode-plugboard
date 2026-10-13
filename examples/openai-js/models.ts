// S7, list models, and retrieve one. Each entry carries an extra `plugboard` object; the SDK keeps it as an extra field.
import OpenAI from "openai"

export async function run(client: OpenAI) {
  // #region snippet
  const ids: string[] = []
  for await (const model of client.models.list()) ids.push(model.id)
  const retrieved = await client.models.retrieve("fast") // GET /v1/models/fast
  // #endregion snippet
  return {
    model_ids: ids,
    has_fast: ids.includes("fast"),
    has_claude: ids.some((id) => id.startsWith("anthropic/claude")),
    has_gpt_low: ids.some((id) => id.endsWith("#low")),
    retrieved_id: retrieved.id,
  }
}

if (import.meta.main) {
  const client = new OpenAI({ baseURL: process.env.PLUGBOARD_BASE_URL, apiKey: process.env.PLUGBOARD_KEY, maxRetries: 0 })
  console.log(JSON.stringify(await run(client)))
}
