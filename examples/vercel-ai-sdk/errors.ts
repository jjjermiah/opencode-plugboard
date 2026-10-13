// E1 wrong key (401 invalid_api_key) and E2 unknown model (404 model_not_found). The SDK throws APICallError; the
// observations are its status and the error code from the body.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { APICallError, generateText } from "ai"
import { apis, plugboardURL, type Client } from "./providers.ts"

const PROMPT = "Reply with exactly: pong"
/** A fixed fake key: it may appear in a run; the app key may not. */
const WRONG_KEY = "sk-wrong-key-example"

function errorOf(error: unknown): { status: number | null; code: string | null } {
  if (!APICallError.isInstance(error)) throw error
  const body = JSON.parse(error.responseBody ?? "{}") as { error?: { code?: string } }
  return { status: error.statusCode ?? null, code: body.error?.code ?? null }
}

export async function runWrongKey(model: string) {
  // #region snippet
  const wrong = createOpenAICompatible({ name: "plugboard", baseURL: plugboardURL, apiKey: WRONG_KEY })
  try {
    await generateText({ model: wrong.chatModel(model), prompt: PROMPT, maxRetries: 0 })
  } catch (error) {
    return errorOf(error)
  }
  // #endregion snippet
  throw new Error("a wrong key was accepted")
}

export async function runUnknownModel(client: Client) {
  // #region snippet
  try {
    await generateText({ model: client("nope"), prompt: PROMPT, maxRetries: 0 })
  } catch (error) {
    return errorOf(error)
  }
  // #endregion snippet
  throw new Error("model nope was accepted")
}

if (import.meta.main) {
  console.log(JSON.stringify(await runWrongKey("fast")))
  console.log(JSON.stringify(await runUnknownModel(apis.compat)))
}
