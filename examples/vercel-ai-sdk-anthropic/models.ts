// S7, list models. The AI SDK has no model-list call, so this is a plain GET /v1/models with fetch. It sends the key as a
// Bearer token: GET /v1/models read x-api-key only from #399 on, so this sends Bearer.
import { plugboardKey, plugboardURL } from "./providers.ts"

export async function run() {
  // #region snippet
  const response = await fetch(`${plugboardURL}/v1/models`, { headers: { authorization: `Bearer ${plugboardKey}` } })
  const body = (await response.json()) as { data: Array<{ id: string }> }
  // #endregion snippet
  const ids = body.data.map((model) => model.id)
  return {
    status: response.status,
    model_ids: ids,
    has_fast: ids.includes("fast"),
    has_claude: ids.some((id) => id.startsWith("anthropic/claude")),
    has_gpt_low: ids.some((id) => id.endsWith("#low")),
  }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run()))
}
