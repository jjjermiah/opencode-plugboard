// S7, list models. The Anthropic SDK lists GET /v1/models; `for await` walks every page (limit 100 per page).
import { client } from "./providers.ts"

export async function run() {
  // #region snippet
  const models = client.models.list({ limit: 100 })
  // #endregion snippet
  const ids: string[] = []
  for await (const model of models) ids.push(model.id) // every page
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
