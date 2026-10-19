// S1, plain chat, non-stream. The smallest call: one prompt, one answer.
import { generateText } from "ai"
import { type Client, wireFinish } from "./providers.ts"

export async function run(client: Client, model: string) {
  // #region snippet
  const result = await generateText({ model: client(model), prompt: "Reply with exactly: pong", maxOutputTokens: 1024 })
  // #endregion snippet
  return { text: result.text, finish_reason: wireFinish(result.finishReason), usage: result.usage ?? null }
}

if (import.meta.main) {
  const { client } = await import("./providers.ts")
  console.log(JSON.stringify(await run(client, "fast")))
}
