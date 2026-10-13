// #region snippet
import { at, call, type Owui } from "./owui.ts"

/**
 * E1: the connection test with a wrong key. Open WebUI's Verify button asks the upstream for its model list, so the
 * 401 reaches plugboard as GET /v1/models. The body comes back to the caller unchanged.
 */
export async function run(owui: Owui) {
  const { status, json } = await call(owui, "POST", "/openai/verify", { url: owui.upstream, key: "wrongkey" })
  return { status, code: at(json, "error", "code") ?? null }
}
// #endregion snippet

if (import.meta.main) {
  const owui: Owui = { base: process.env.OWUI_BASE!, token: process.env.OWUI_TOKEN!, upstream: process.env.OWUI_UPSTREAM ?? "" }
  console.log(JSON.stringify(await run(owui)))
}
