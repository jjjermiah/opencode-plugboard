// E2, unknown model (404 model_not_found). The SDK throws APICallError; the observations are its status and the error code.
import { APICallError, generateText } from "ai"
import { apis, type Client } from "./providers.ts"

const PROMPT = "Reply with exactly: pong"

export async function run(client: Client) {
  // #region snippet
  try {
    await generateText({ model: client("nope"), prompt: PROMPT, maxRetries: 0 })
  } catch (error) {
    if (!APICallError.isInstance(error)) throw error
    const body = JSON.parse(error.responseBody ?? "{}") as { error?: { code?: string } }
    return { status: error.statusCode ?? null, code: body.error?.code ?? null, type: body.error?.type ?? null }
  }
  // #endregion snippet
  throw new Error("model nope was accepted")
}

if (import.meta.main) {
  console.log(JSON.stringify(await run(apis.compat)))
}
