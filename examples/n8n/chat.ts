// #region snippet
import { at, fromEnv, lastExecution, turns, webhook, type N8n } from "./n8n.ts"

/**
 * S1: one non-streamed answer from a Basic LLM Chain. The variant picks the API: `chat` (Chat Completions, the node's
 * Use Responses API switched off) or `responses` (the node's default, on).
 */
export async function run(n8n: N8n, model: string, variant = "chat") {
  const workflow = variant === "responses" ? "pb-s1-responses-default" : "pb-s1-chain"
  const answer = await webhook(n8n, workflow, { model, prompt: "Reply with exactly: pong" })
  const last = turns(await lastExecution(n8n, workflow)).at(-1)
  return {
    text: at(answer.json, "text"),
    finish_reason: last?.finish_reason ?? null,
    usage: last?.usage ?? null,
  }
}
// #endregion snippet

if (import.meta.main) {
  const n8n = fromEnv()
  console.log(JSON.stringify(await run(n8n, process.env.MODEL ?? "fast", process.env.VARIANT ?? "chat")))
}
