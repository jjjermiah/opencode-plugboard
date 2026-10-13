// #region snippet
import { at, call, type Owui } from "./owui.ts"

/** S1: one non-streamed chat completion through Open WebUI's API. No chat_id, so Open WebUI makes no title or tag calls. */
export async function run(owui: Owui, model: string) {
  const { json } = await call(owui, "POST", "/api/chat/completions", {
    model,
    stream: false,
    max_tokens: 1024,
    messages: [{ role: "user", content: "Reply with exactly: pong" }],
  })
  return {
    text: at(json, "choices", 0, "message", "content"),
    finish_reason: at(json, "choices", 0, "finish_reason"),
    usage: at(json, "usage") ?? null,
  }
}
// #endregion snippet

if (import.meta.main) {
  const owui: Owui = { base: process.env.OWUI_BASE!, token: process.env.OWUI_TOKEN!, upstream: process.env.OWUI_UPSTREAM ?? "" }
  console.log(JSON.stringify(await run(owui, process.env.MODEL ?? "fast")))
}
