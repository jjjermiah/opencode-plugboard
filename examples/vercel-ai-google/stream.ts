// S3, streaming text. The SDK reads the stream as parts; Gemini sends usage with the last chunk, so the finish part carries it.
import { streamText } from "ai"
import { type Client, wireFinish } from "./providers.ts"

const PROMPT = "Reply with exactly: pong"

export async function run(client: Client, model: string) {
  let text = ""
  let finish: string | null = null
  let usage: unknown = null
  // #region snippet
  const result = streamText({ model: client(model), prompt: PROMPT, maxOutputTokens: 1024 })
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") text += part.text
    if (part.type === "finish") {
      finish = part.finishReason
      usage = part.totalUsage
    }
  }
  // #endregion snippet
  return { text, finish_reason: wireFinish(finish), usage: usage ?? null, done: finish !== null }
}

if (import.meta.main) {
  const { client } = await import("./providers.ts")
  console.log(JSON.stringify(await run(client, "fast")))
}
