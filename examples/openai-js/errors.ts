// E1 wrong key (401 invalid_api_key) and E2 unknown model (404 model_not_found). The SDK throws; the observations are the error.
import OpenAI from "openai"

export async function runWrongKey(client: OpenAI, model: string) {
  // #region snippet-wrong-key
  // A fixed fake key: it may appear in the run, the app key may not.
  const wrong = new OpenAI({ baseURL: client.baseURL, apiKey: "sk-wrong-key-example", maxRetries: 0 })
  try {
    await wrong.chat.completions.create({ model, messages: [{ role: "user", content: "Reply with exactly: pong" }], max_tokens: 1024 })
  } catch (error) {
    if (error instanceof OpenAI.AuthenticationError) return { status: error.status ?? null, code: error.code ?? null, type: error.type ?? null }
    throw error
  }
  // #endregion snippet-wrong-key
  throw new Error("a wrong key was accepted")
}

export async function runUnknownModel(client: OpenAI, model: string) {
  // #region snippet-unknown-model
  try {
    await client.chat.completions.create({ model, messages: [{ role: "user", content: "Reply with exactly: pong" }], max_tokens: 1024 })
  } catch (error) {
    if (error instanceof OpenAI.NotFoundError) return { status: error.status ?? null, code: error.code ?? null, type: error.type ?? null }
    throw error
  }
  // #endregion snippet-unknown-model
  throw new Error(`model ${model} was accepted`)
}

if (import.meta.main) {
  const client = new OpenAI({ baseURL: process.env.PLUGBOARD_BASE_URL, apiKey: process.env.PLUGBOARD_KEY, maxRetries: 0 })
  console.log(JSON.stringify(await runWrongKey(client, "fast")))
  console.log(JSON.stringify(await runUnknownModel(client, "nope")))
}
