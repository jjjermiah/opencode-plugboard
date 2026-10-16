// E1, wrong key (401 invalid_api_key). The SDK throws APIError; the observations are its status and the error code.
import Anthropic from "@anthropic-ai/sdk"

const PROMPT = "Reply with exactly: pong"
/** A fixed fake key: it may appear in a run; the app key may not. */
const WRONG_KEY = "sk-wrong-key-example"
const plugboardURL = process.env.PLUGBOARD_BASE_URL!.replace(/\/v1$/, "")

export async function run(model: string) {
  // #region snippet
  const wrong = new Anthropic({ baseURL: plugboardURL, apiKey: WRONG_KEY, maxRetries: 0 })
  try {
    await wrong.messages.create({ model, max_tokens: 1024, messages: [{ role: "user", content: PROMPT }] })
  } catch (error) {
    if (!(error instanceof Anthropic.APIError)) throw error
    // Messages errors carry Anthropic's error.type; there is no error.code (see the gap in run.ts).
    const body = error.error as { error?: { code?: string; type?: string } } | undefined
    return { status: error.status ?? null, code: body?.error?.code ?? body?.error?.type ?? null }
  }
  // #endregion snippet
  throw new Error("a wrong key was accepted")
}

if (import.meta.main) {
  console.log(JSON.stringify(await run("fast")))
}
