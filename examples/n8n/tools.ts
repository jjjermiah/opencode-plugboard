// #region snippet
import { at, fromEnv, lastExecution, toolCall, turns, webhook, type N8n } from "./n8n.ts"

const PROMPT = "What is the weather in Paris? Use the tool."

/**
 * S2: a tool call, then the tool result turn. An AI Agent with a Code tool (get_weather) runs the loop. The webhook
 * answers with the final text; the model's turns and the tool call come from the execution's run data.
 */
export async function run(n8n: N8n, model: string) {
  const answer = await webhook(n8n, "pb-s2-agent", { model, prompt: PROMPT })
  const execution = await lastExecution(n8n, "pb-s2-agent")
  const all = turns(execution)
  const call = toolCall(execution)
  return {
    finish_reason: all[0]?.finish_reason ?? null,
    tool_name: call?.name ?? null,
    tool_city: call?.city ?? null,
    tool_call_id: call?.id ?? null,
    final_text: at(answer.json, "output") ?? null,
    final_finish_reason: all.at(-1)?.finish_reason ?? null,
  }
}
// #endregion snippet

if (import.meta.main) {
  const n8n = fromEnv()
  console.log(JSON.stringify(await run(n8n, process.env.MODEL ?? "fast")))
}
