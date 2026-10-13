// E2 unknown model (404 model_not_found). LangChain throws; the observations are the status and code the error carries.
import { ChatOpenAI } from "@langchain/openai"

export async function run(client: { baseURL: string; apiKey: string }, model: string) {
  // #region snippet
  const llm = new ChatOpenAI({ model, apiKey: client.apiKey, configuration: { baseURL: client.baseURL }, maxRetries: 0 })
  try {
    await llm.invoke("Reply with exactly: pong")
  } catch (error) {
    const { status, code } = error as { status?: number; code?: string }
    return { status: status ?? null, code: code ?? null }
  }
  // #endregion snippet
  throw new Error(`model ${model} was accepted`)
}

if (import.meta.main) {
  console.log(JSON.stringify(await run({ baseURL: process.env.PLUGBOARD_BASE_URL!, apiKey: process.env.PLUGBOARD_KEY! }, "nope")))
}
