// S3, streaming text, with and without usage. The SDK reads the stream as parts; usage arrives only when asked for.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { streamText } from "ai"
import { plugboardKey, plugboardURL, type Client } from "./providers.ts"

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

  // Without includeUsage the compat provider sends no stream_options, and the stream carries no usage.
  const bare = createOpenAICompatible({ name: "plugboard", baseURL: plugboardURL, apiKey: plugboardKey })
  let bareText = ""
  for await (const part of streamText({ model: bare.chatModel(model), prompt: PROMPT, maxOutputTokens: 1024 }).fullStream) {
    if (part.type === "text-delta") bareText += part.text
  }
  if (!/pong/i.test(bareText)) throw new Error(`stream without usage gave ${JSON.stringify(bareText)}`)

  return { text, finish_reason: finish, usage: usage ?? null, done: finish !== null }
}

if (import.meta.main) {
  const { apis } = await import("./providers.ts")
  console.log(JSON.stringify(await run(apis.compat, "fast")))
}
