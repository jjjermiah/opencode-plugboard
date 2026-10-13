// S7, list models. LangChain has no model-list call of its own, so this uses the openai SDK that @langchain/openai
// wraps, with the same base URL and key.
import OpenAI from "openai"

const FAST = "fast"

export async function run(client: { baseURL: string; apiKey: string }, _model: string) {
  // #region snippet
  const openai = new OpenAI({ baseURL: client.baseURL, apiKey: client.apiKey, maxRetries: 0 })
  const ids: string[] = []
  for await (const model of openai.models.list()) ids.push(model.id)
  // #endregion snippet
  return {
    model_ids: ids,
    has_fast: ids.includes(FAST),
    has_claude: ids.some((id) => id.startsWith("anthropic/claude")),
    has_gpt_low: ids.some((id) => id.endsWith("#low")),
  }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run({ baseURL: process.env.PLUGBOARD_BASE_URL!, apiKey: process.env.PLUGBOARD_KEY! }, "-")))
}
