// S1, plain chat, non-stream: the smallest call. Copy this shape for any text generation.
import { generateText } from "ai"
import type { Client } from "./providers.ts"

export async function run(client: Client, model: string) {
  // #region snippet
  const { text, finishReason, usage } = await generateText({ model: client(model), prompt: "Reply with exactly: pong", maxOutputTokens: 1024 })
  // #endregion snippet
  return { text, finish_reason: finishReason, usage: usage ?? null }
}

if (import.meta.main) {
  const { apis } = await import("./providers.ts")
  console.log(JSON.stringify(await run(apis.compat, "fast")))
}
