// S3, streaming text. Each chunk carries a piece of the text; the last chunk carries the stop reason and the usage.
import { chatModel, finishReason } from "./llm.ts"

const PROMPT = "Reply with exactly: pong"

export async function run(model: string) {
  let text = ""
  let finish: string | null = null
  let usage: unknown = null
  // #region snippet
  for await (const chunk of await chatModel(model).stream(PROMPT)) {
    text += typeof chunk.content === "string" ? chunk.content : chunk.content.map((part) => ("text" in part ? part.text : "")).join("")
    // The stop reason arrives on the message_delta chunk, in additional_kwargs (not response_metadata).
    if (typeof chunk.additional_kwargs.stop_reason === "string") finish = finishReason(chunk.additional_kwargs.stop_reason)
    if (chunk.usage_metadata) usage = chunk.usage_metadata
  }
  // #endregion snippet
  return { text, finish_reason: finish, usage, done: finish !== null }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run("fast")))
}
