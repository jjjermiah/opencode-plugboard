// S1, plain chat, non-stream: the smallest LangChain call. Copy this shape for any chat request.
import { ChatOpenAI } from "@langchain/openai"

export async function run(client: { baseURL: string; apiKey: string }, model: string) {
  // #region snippet
  const llm = new ChatOpenAI({
    model,
    apiKey: client.apiKey,
    configuration: { baseURL: client.baseURL },
    maxTokens: 1024,
    maxRetries: 0,
  })
  const reply = await llm.invoke("Reply with exactly: pong")
  // #endregion snippet
  return {
    text: typeof reply.content === "string" ? reply.content : JSON.stringify(reply.content),
    finish_reason: (reply.response_metadata.finish_reason as string | undefined) ?? null,
    usage: reply.usage_metadata ?? null,
  }
}

if (import.meta.main) {
  console.log(JSON.stringify(await run({ baseURL: process.env.PLUGBOARD_BASE_URL!, apiKey: process.env.PLUGBOARD_KEY! }, "fast")))
}
