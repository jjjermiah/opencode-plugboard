// S1, plain chat, non-stream: one invoke, one answer. Copy this shape for any text generation.
import { chatModel, finishReason } from "./llm.ts"

export async function run(model: string) {
  // #region snippet
  const message = await chatModel(model).invoke("Reply with exactly: pong")
  // #endregion snippet
  const text = typeof message.content === "string" ? message.content : message.content.map((part) => ("text" in part ? part.text : "")).join("")
  return {
    text,
    finish_reason: finishReason(message.response_metadata.stop_reason),
    usage: message.usage_metadata ?? null,
  }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run("fast")))
}
