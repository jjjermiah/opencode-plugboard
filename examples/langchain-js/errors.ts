// E1 wrong key (401 invalid_api_key) and E2 unknown model (404 model_not_found). LangChain throws; the observations are
// the status and code the error carries.
import { ChatOpenAI } from "@langchain/openai"

const FAKE_KEY = "sk-wrong-key-example" // a fixed fake: it may appear in the run, the app key may not
const PROMPT = "Reply with exactly: pong"

export async function runWrongKey(client: { baseURL: string; apiKey: string }, model: string) {
  // #region snippet
  const llm = new ChatOpenAI({ model, apiKey: FAKE_KEY, configuration: { baseURL: client.baseURL }, maxRetries: 0 })
  try {
    await llm.invoke(PROMPT)
  } catch (error) {
    const { status, code } = error as { status?: number; code?: string }
    return { status: status ?? null, code: code ?? null }
  }
  // #endregion snippet
  throw new Error("a wrong key was accepted")
}

export async function runUnknownModel(client: { baseURL: string; apiKey: string }, model: string) {
  // #region snippet
  const llm = new ChatOpenAI({ model, apiKey: client.apiKey, configuration: { baseURL: client.baseURL }, maxRetries: 0 })
  try {
    await llm.invoke(PROMPT)
  } catch (error) {
    const { status, code } = error as { status?: number; code?: string }
    return { status: status ?? null, code: code ?? null }
  }
  // #endregion snippet
  throw new Error(`model ${model} was accepted`)
}

if (import.meta.main) {
  const client = { baseURL: process.env.PLUGBOARD_BASE_URL!, apiKey: process.env.PLUGBOARD_KEY! }
  console.log(JSON.stringify(await runWrongKey(client, "fast")))
  console.log(JSON.stringify(await runUnknownModel(client, "nope")))
}
