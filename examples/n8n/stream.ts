// #region snippet
import { fromEnv, lastExecution, turns, webhook, type N8n } from "./n8n.ts"

/** The frames of a streamed webhook answer: one JSON object per line (`begin`, `item`, `end`). */
export function frames(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

/**
 * S3: a streamed answer from an AI Agent with streaming on (the webhook's responseMode is streaming). The text is the
 * item frames joined; `done` is the end frame. The finish reason and usage come from the execution.
 */
export async function run(n8n: N8n, model: string) {
  const answer = await webhook(n8n, "pb-s3s4-stream-agent", { model, prompt: "Reply with exactly: pong" })
  const items = frames(answer.text)
  const last = turns(await lastExecution(n8n, "pb-s3s4-stream-agent")).at(-1)
  return {
    text: items.filter((frame) => frame.type === "item").map((frame) => String(frame.content)).join(""),
    finish_reason: last?.finish_reason ?? null,
    usage: last?.usage ?? null,
    done: items.some((frame) => frame.type === "end"),
  }
}
// #endregion snippet

if (import.meta.main) {
  const n8n = fromEnv()
  console.log(JSON.stringify(await run(n8n, process.env.MODEL ?? "fast")))
}
