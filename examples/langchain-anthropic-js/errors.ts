// The error observations for E1 and E2. ChatAnthropic throws the Anthropic SDK's APIError, which carries the HTTP status and
// the parsed body. Messages errors carry Anthropic's error.type; there is no error.code (see the gap in run.ts).
import { ChatAnthropic } from "@langchain/anthropic"

export async function errorObservations(attempt: () => Promise<unknown>): Promise<{ status: number | null; code: string | null }> {
  try {
    await attempt()
  } catch (error) {
    const failure = error as { status?: number; error?: { error?: { code?: string; type?: string } } }
    if (typeof failure.status !== "number") throw error
    return { status: failure.status, code: failure.error?.error?.code ?? failure.error?.error?.type ?? null }
  }
  throw new Error("the call was accepted")
}

/** The wrong key, as a ChatAnthropic built with a fixed fake key. */
export const wrongKeyModel = (model: string) =>
  new ChatAnthropic({ model, anthropicApiUrl: process.env.PLUGBOARD_BASE_URL!.replace(/\/v1$/, ""), anthropicApiKey: "sk-wrong-key-example", maxTokens: 1024, maxRetries: 0 })
