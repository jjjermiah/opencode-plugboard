// #region snippet
import type { Owui } from "./owui.ts"
import { observe, toolTurn } from "./tools.ts"

/**
 * S4: the streamed tool call. The turn is the same as S2 on the streamed path: the transcript holds the upstream stream
 * (its tool_calls deltas), and the checks read the record Open WebUI stores after it assembles that call.
 */
export async function run(owui: Owui, model: string) {
  const { message } = await toolTurn(owui, model, true)
  return observe(message)
}
// #endregion snippet

if (import.meta.main) {
  const owui: Owui = { base: process.env.OWUI_BASE!, token: process.env.OWUI_TOKEN!, upstream: process.env.OWUI_UPSTREAM ?? "" }
  console.log(JSON.stringify(await run(owui, process.env.MODEL ?? "fast")))
}
