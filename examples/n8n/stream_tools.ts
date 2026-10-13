// #region snippet
import { fromEnv, lastExecution, toolCall, turns, webhook, type N8n } from "./n8n.ts"

/**
 * S4: a streamed tool call. The same AI Agent as S2, streaming on: the model's streamed tool_calls are what n8n
 * assembles, and the execution records the call it made.
 */
export async function run(n8n: N8n, model: string) {
  await webhook(n8n, "pb-s3s4-stream-agent", { model, prompt: "What is the weather in Paris? Use the tool." })
  const execution = await lastExecution(n8n, "pb-s3s4-stream-agent")
  const call = toolCall(execution)
  return {
    finish_reason: turns(execution)[0]?.finish_reason ?? null,
    tool_name: call?.name ?? null,
    tool_city: call?.city ?? null,
    tool_call_id: call?.id ?? null,
  }
}
// #endregion snippet

if (import.meta.main) {
  const n8n = fromEnv()
  console.log(JSON.stringify(await run(n8n, process.env.MODEL ?? "fast")))
}
