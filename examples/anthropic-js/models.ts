// S7, list models. The Anthropic SDK lists GET /v1/models; the first page holds plugboard's whole catalog.
import { client } from "./providers.ts"

export async function run() {
  // #region snippet
  const page = await client.models.list({ limit: 100 })
  // #endregion snippet
  const ids = page.data.map((model) => model.id)
  return {
    model_ids: ids,
    has_fast: ids.includes("fast"),
    has_claude: ids.some((id) => id.startsWith("anthropic/claude")),
    has_gpt_low: ids.some((id) => id.endsWith("#low")),
  }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run()))
}
