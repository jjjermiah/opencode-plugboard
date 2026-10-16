/**
 * The Anthropic SDK client for plugboard's Messages route. Each scenario file imports `client` from here. The SDK adds
 * `/v1/messages` to its base URL itself, so the base URL is plugboard's `/v1` URL without the `/v1`.
 */
import Anthropic from "@anthropic-ai/sdk"

// #region snippet
const plugboardURL = process.env.PLUGBOARD_BASE_URL!.replace(/\/v1$/, "")

export const client = new Anthropic({ baseURL: plugboardURL, apiKey: process.env.PLUGBOARD_KEY!, maxRetries: 0 })
// #endregion snippet

export const plugboardKey = process.env.PLUGBOARD_KEY!

/** The Messages API says `end_turn` and `tool_use`; the shared checks say `stop` and `tool_calls` (as the other examples). */
export const finishReason = (reason: string | null | undefined): string | null => {
  if (reason === undefined || reason === null) return null
  return ({ end_turn: "stop", stop_sequence: "stop", tool_use: "tool_calls", max_tokens: "length" } as Record<string, string>)[reason] ?? reason
}
