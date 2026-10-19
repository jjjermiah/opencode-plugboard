// E1 wrong key (401 invalid_api_key). LangChain throws; the observations are the status and code the error carries.
import { ChatOpenAI } from "@langchain/openai"

export async function run(client: { baseURL: string; apiKey: string }, model: string) {
  // #region snippet
  const FAKE_KEY = "sk-wrong-key-example" // a fixed fake: it may appear in the run, the app key may not
  const llm = new ChatOpenAI({ model, apiKey: FAKE_KEY, configuration: { baseURL: client.baseURL }, maxRetries: 0 })
  try {
    await llm.invoke("Reply with exactly: pong")
  } catch (error) {
    const { status, code, type } = error as { status?: number; code?: string; type?: string }
    return { status: status ?? null, code: code ?? null, type: type ?? null }
  }
  // #endregion snippet
  throw new Error("a wrong key was accepted")
}

if (import.meta.main) {
  console.log(JSON.stringify(await run({ baseURL: process.env.PLUGBOARD_BASE_URL!, apiKey: process.env.PLUGBOARD_KEY! }, "fast")))
}
