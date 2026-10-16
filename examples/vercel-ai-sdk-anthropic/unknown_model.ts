// E2, unknown model (404 not_found_error). The SDK throws APICallError; the observations are its status and the error type.
import { APICallError, generateText } from "ai"
import { client } from "./providers.ts"

const PROMPT = "Reply with exactly: pong"

export async function run() {
  // #region snippet
  try {
    await generateText({ model: client("nope"), prompt: PROMPT, maxRetries: 0 })
  } catch (error) {
    if (!APICallError.isInstance(error)) throw error
    // Messages errors carry Anthropic's error.type; there is no error.code (see unobserved in run.ts).
    const body = JSON.parse(error.responseBody ?? "{}") as { error?: { code?: string; type?: string } }
    return { status: error.statusCode ?? null, code: body.error?.code ?? body.error?.type ?? null }
  }
  // #endregion snippet
  throw new Error("an unknown model was accepted")
}

if (import.meta.main) {
  console.log(JSON.stringify(await run()))
}
