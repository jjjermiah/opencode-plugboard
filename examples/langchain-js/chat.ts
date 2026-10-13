// S1, plain chat, non-stream: the smallest LangChain call. Copy this shape for any chat request.
// Two variants: "chat" uses ChatOpenAICompletions, which always calls /v1/chat/completions. "auto" uses ChatOpenAI, which
// picks the route itself and sends gpt-5.6* ids to /v1/responses.
import { ChatOpenAI, ChatOpenAICompletions } from "@langchain/openai"

export async function run(client: { baseURL: string; apiKey: string }, model: string, variant = "auto") {
  // #region snippet
  const options = { model, apiKey: client.apiKey, configuration: { baseURL: client.baseURL }, maxTokens: 1024, maxRetries: 0 }
  const llm = variant === "chat" ? new ChatOpenAICompletions(options) : new ChatOpenAI(options)
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
