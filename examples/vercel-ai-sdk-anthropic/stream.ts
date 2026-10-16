// S3, streaming text. The SDK reads the stream as parts; the finish part carries the usage.
import { streamText } from "ai"
import { client, wireFinish, type Client } from "./providers.ts"

const PROMPT = "Reply with exactly: pong"

export async function run(model: string, make: Client = client) {
  let text = ""
  let finish: string | null = null
  let usage: unknown = null
  // #region snippet
  const result = streamText({ model: make(model), prompt: PROMPT, maxOutputTokens: 1024 })
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
  console.log(JSON.stringify(await run("fast")))
}
