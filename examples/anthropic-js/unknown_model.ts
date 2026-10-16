// E2, unknown model (404 model_not_found). The SDK throws APIError; the observations are its status and the error code.
import Anthropic from "@anthropic-ai/sdk"
import { client } from "./providers.ts"

const PROMPT = "Reply with exactly: pong"

export async function run() {
  // #region snippet
  try {
    await client.messages.create({ model: "nope", max_tokens: 1024, messages: [{ role: "user", content: PROMPT }] })
  } catch (error) {
    if (!(error instanceof Anthropic.APIError)) throw error
    // Messages errors carry Anthropic's error.type; there is no error.code (see the gap in run.ts).
    const body = error.error as { error?: { code?: string; type?: string } } | undefined
    return { status: error.status ?? null, code: body?.error?.code ?? body?.error?.type ?? null }
  }
  // #endregion snippet
  throw new Error("an unknown model was accepted")
}

if (import.meta.main) {
  console.log(JSON.stringify(await run()))
}
