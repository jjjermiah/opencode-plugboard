// E1, wrong key (401 authentication_error). The SDK throws APICallError; the observations are its status and the error type.
import { createAnthropic } from "@ai-sdk/anthropic"
import { APICallError, generateText } from "ai"
import { plugboardV1 } from "./providers.ts"

const PROMPT = "Reply with exactly: pong"
/** A fixed fake key: it may appear in a run; the app key may not. */
const WRONG_KEY = "sk-wrong-key-example"

export async function run(model: string) {
  // #region snippet
  const wrong = createAnthropic({ baseURL: plugboardV1, apiKey: WRONG_KEY })
  try {
    await generateText({ model: wrong(model), prompt: PROMPT, maxRetries: 0 })
  } catch (error) {
    if (!APICallError.isInstance(error)) throw error
    // Messages errors carry Anthropic's error.type; there is no error.code (see the gap in run.ts).
    const body = JSON.parse(error.responseBody ?? "{}") as { error?: { code?: string; type?: string } }
    return { status: error.statusCode ?? null, code: body.error?.code ?? body.error?.type ?? null }
  }
  // #endregion snippet
  throw new Error("a wrong key was accepted")
}

if (import.meta.main) {
  console.log(JSON.stringify(await run("fast")))
}
