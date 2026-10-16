// S3, streaming text. Iterate the stream for text deltas; the final message carries the usage. Messages always reports
// usage, so there is no include-usage switch to set.
import { client, finishReason } from "./providers.ts"

const PROMPT = "Reply with exactly: pong"

export async function run(model: string) {
  let text = ""
  // #region snippet
  const stream = client.messages.stream({ model, max_tokens: 1024, messages: [{ role: "user", content: PROMPT }] })
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") text += event.delta.text
  }
  const message = await stream.finalMessage()
  // #endregion snippet
  return { text, finish_reason: finishReason(message.stop_reason), usage: message.usage ?? null, done: true }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run("fast")))
}
