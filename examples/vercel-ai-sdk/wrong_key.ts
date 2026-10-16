// E1, wrong key (401 invalid_api_key). The SDK throws APICallError; the observations are its status and the error code.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { APICallError, generateText } from "ai"
import { plugboardURL } from "./providers.ts"

const PROMPT = "Reply with exactly: pong"
/** A fixed fake key: it may appear in a run; the app key may not. */
const WRONG_KEY = "sk-wrong-key-example"

export async function run(model: string) {
  // #region snippet
  const wrong = createOpenAICompatible({ name: "plugboard", baseURL: plugboardURL, apiKey: WRONG_KEY })
  try {
    await generateText({ model: wrong.chatModel(model), prompt: PROMPT, maxRetries: 0 })
  } catch (error) {
    if (!APICallError.isInstance(error)) throw error
    const body = JSON.parse(error.responseBody ?? "{}") as { error?: { code?: string } }
    return { status: error.statusCode ?? null, code: body.error?.code ?? null, type: body.error?.type ?? null }
  }
  // #endregion snippet
  throw new Error("a wrong key was accepted")
}

if (import.meta.main) {
  console.log(JSON.stringify(await run("fast")))
}
