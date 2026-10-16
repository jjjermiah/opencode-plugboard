// E1 wrong key (401) and E2 unknown model (404). The SDK throws ApiError; the observations are its status and Google's error status.
import { ApiError, GoogleGenAI } from "@google/genai"

/** Google's error body: `{"error": {"code", "message", "status"}}`. The SDK keeps the body as the error message. */
/** Google's status as the neutral error type the other wires send (the per-wire map of #427). */
const GOOGLE_TYPE: Record<string, string> = { UNAUTHENTICATED: "authentication_error", NOT_FOUND: "not_found_error" }

function googleStatus(error: ApiError): string | null {
  try {
    return (JSON.parse(error.message) as { error?: { status?: string } }).error?.status ?? null
  } catch {
    return null
  }
}

export async function runWrongKey(baseUrl: string, model: string) {
  // #region snippet-wrong-key
  // A fixed fake key: it may appear in the run, the app key may not.
  const wrong = new GoogleGenAI({ apiKey: "sk-wrong-key-example", httpOptions: { baseUrl } })
  try {
    await wrong.models.generateContent({ model, contents: "Reply with exactly: pong" })
  } catch (error) {
    if (error instanceof ApiError) return { status: error.status, code: googleStatus(error), type: GOOGLE_TYPE[googleStatus(error) ?? ""] ?? null }
    throw error
  }
  // #endregion snippet-wrong-key
  throw new Error("a wrong key was accepted")
}

export async function runUnknownModel(baseUrl: string, model: string) {
  // #region snippet-unknown-model
  const ai = new GoogleGenAI({ apiKey: process.env.PLUGBOARD_KEY, httpOptions: { baseUrl } })
  try {
    await ai.models.generateContent({ model, contents: "Reply with exactly: pong" })
  } catch (error) {
    if (error instanceof ApiError) return { status: error.status, code: googleStatus(error), type: GOOGLE_TYPE[googleStatus(error) ?? ""] ?? null }
    throw error
  }
  // #endregion snippet-unknown-model
  throw new Error(`model ${model} was accepted`)
}

if (import.meta.main) {
  const baseUrl = (process.env.PLUGBOARD_BASE_URL ?? "").replace(/\/v1\/?$/, "")
  console.log(JSON.stringify(await runWrongKey(baseUrl, "fast")))
  console.log(JSON.stringify(await runUnknownModel(baseUrl, "nope")))
}
