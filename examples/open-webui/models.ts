// #region snippet
import { at, call, type Owui } from "./owui.ts"

/** S7: the model list as Open WebUI shows it. Open WebUI fetches the upstream /v1/models and merges it. */
export async function run(owui: Owui) {
  const { json } = await call(owui, "GET", "/api/models")
  const ids = (((at(json, "data") as Array<{ id: string }> | undefined) ?? []).map((model) => model.id))
  return {
    model_ids: ids.length,
    has_fast: ids.includes("fast"),
    has_claude: ids.includes("anthropic/claude-haiku-4-5"),
    has_gpt_low: ids.includes("openai/gpt-5.6-luna#low"),
  }
}
// #endregion snippet

if (import.meta.main) {
  const owui: Owui = { base: process.env.OWUI_BASE!, token: process.env.OWUI_TOKEN!, upstream: process.env.OWUI_UPSTREAM ?? "" }
  console.log(JSON.stringify(await run(owui)))
}
