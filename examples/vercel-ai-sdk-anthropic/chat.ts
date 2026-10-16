// S1, plain chat, non-stream: the smallest call. Copy this shape for any text generation.
import { generateText } from "ai"
import { client, wireFinish, type Client } from "./providers.ts"

export async function run(model: string, make: Client = client) {
  // #region snippet
  const { text, finishReason, usage } = await generateText({ model: make(model), prompt: "Reply with exactly: pong", maxOutputTokens: 1024 })
  // #endregion snippet
  return { text, finish_reason: wireFinish(finishReason), usage: usage ?? null }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run("fast")))
}
