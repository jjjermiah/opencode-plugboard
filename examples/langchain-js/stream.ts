// S3, streaming text, with and without usage. LangChain folds the chunks into one message; usage arrives on the last
// chunk only when streamUsage is set.
import type { AIMessageChunk } from "@langchain/core/messages"
import { ChatOpenAI } from "@langchain/openai"

const PROMPT = "Reply with exactly: pong"

export async function run(client: { baseURL: string; apiKey: string }, model: string) {
  // #region snippet
  const llm = new ChatOpenAI({
    model,
    apiKey: client.apiKey,
    configuration: { baseURL: client.baseURL },
    maxTokens: 1024,
    maxRetries: 0,
    streamUsage: true,
  })
  let message: AIMessageChunk | undefined
  for await (const chunk of await llm.stream(PROMPT)) message = message ? message.concat(chunk) : chunk
  // #endregion snippet
  // Without usage the stream must still finish with the same text.
  const plain = new ChatOpenAI({ model, apiKey: client.apiKey, configuration: { baseURL: client.baseURL }, maxTokens: 1024, maxRetries: 0, streamUsage: false })
  let plainText = ""
  for await (const chunk of await plain.stream(PROMPT)) plainText += typeof chunk.content === "string" ? chunk.content : ""
  if (!plainText.toLowerCase().includes("pong")) throw new Error(`stream without usage gave ${JSON.stringify(plainText)}`)
  return {
    text: typeof message?.content === "string" ? message.content : JSON.stringify(message?.content),
    finish_reason: (message?.response_metadata.finish_reason as string | undefined) ?? null,
    usage: message?.usage_metadata ?? null,
    done: true,
  }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run({ baseURL: process.env.PLUGBOARD_BASE_URL!, apiKey: process.env.PLUGBOARD_KEY! }, "fast")))
}
