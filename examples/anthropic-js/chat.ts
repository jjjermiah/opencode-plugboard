// S1, plain chat, non-stream: the smallest call. Copy this shape for any text generation.
import { client, finishReason } from "./providers.ts"

export async function run(model: string) {
  // #region snippet
  const message = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [{ role: "user", content: "Reply with exactly: pong" }],
  })
  // #endregion snippet
  const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("")
  return { text, finish_reason: finishReason(message.stop_reason), usage: message.usage ?? null }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run("fast")))
}
