// E1 wrong key (401 invalid_api_key) and E2 unknown model (404 model_not_found), through the Agents SDK. The SDK throws;
// the observations are the error.
import { Agent, run } from "@openai/agents"
import OpenAI from "openai"
import { modelFor } from "./chat.ts"

const PROMPT = "Reply with exactly: pong"

export async function runWrongKey(client: OpenAI, model: string) {
  // #region snippet-wrong-key
  // A fixed fake key: it may appear in the run, the app key may not.
  const wrong = new OpenAI({ baseURL: client.baseURL, apiKey: "sk-wrong-key-example", maxRetries: 0 })
  try {
    await run(new Agent({ name: "pong", model: modelFor(wrong, model) }), PROMPT)
  } catch (error) {
    if (error instanceof OpenAI.AuthenticationError) return { status: error.status ?? null, code: error.code ?? null }
    throw error
  }
  // #endregion snippet-wrong-key
  throw new Error("a wrong key was accepted")
}

export async function runUnknownModel(client: OpenAI, model: string) {
  // #region snippet-unknown-model
  try {
    await run(new Agent({ name: "pong", model: modelFor(client, model) }), PROMPT)
  } catch (error) {
    if (error instanceof OpenAI.NotFoundError) return { status: error.status ?? null, code: error.code ?? null }
    throw error
  }
  // #endregion snippet-unknown-model
  throw new Error(`model ${model} was accepted`)
}
