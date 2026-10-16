// E1 wrong key (401) and E2 unknown model (404). The SDK throws APICallError; the observations are its status and Google's error status.
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { APICallError, generateText } from "ai"
import { client, plugboardURL } from "./providers.ts"

const PROMPT = "Reply with exactly: pong"
/** A fixed fake key: it may appear in a run; the app key may not. */
const WRONG_KEY = "sk-wrong-key-example"

/** Google's error body is `{"error": {"code", "message", "status"}}`, which the SDK keeps in responseBody. */
function googleStatus(error: APICallError): string | null {
  const body = JSON.parse(error.responseBody ?? "{}") as { error?: { status?: string } }
  return body.error?.status ?? null
}

export async function runWrongKey(model: string) {
  // #region snippet-wrong-key
  const wrong = createGoogleGenerativeAI({ baseURL: plugboardURL, apiKey: WRONG_KEY })
  try {
    await generateText({ model: wrong(model), prompt: PROMPT, maxRetries: 0 })
  } catch (error) {
    if (!APICallError.isInstance(error)) throw error
    return { status: error.statusCode ?? null, code: googleStatus(error) }
  }
  // #endregion snippet-wrong-key
  throw new Error("a wrong key was accepted")
}

export async function runUnknownModel(model: string) {
  // #region snippet-unknown-model
  try {
    await generateText({ model: client(model), prompt: PROMPT, maxRetries: 0 })
  } catch (error) {
    if (!APICallError.isInstance(error)) throw error
    return { status: error.statusCode ?? null, code: googleStatus(error) }
  }
  // #endregion snippet-unknown-model
  throw new Error(`model ${model} was accepted`)
}

if (import.meta.main) {
  console.log(JSON.stringify(await runWrongKey("fast")))
  console.log(JSON.stringify(await runUnknownModel("nope")))
}
