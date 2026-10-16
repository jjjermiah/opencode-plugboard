/**
 * The one client every scenario builds: ChatAnthropic pointed at plugboard. Scenario files take `chatModel` from here.
 * anthropicApiUrl is plugboard's base URL without the `/v1`: the SDK under ChatAnthropic adds `/v1/messages` itself.
 */
import { ChatAnthropic } from "@langchain/anthropic"

const plugboardURL = process.env.PLUGBOARD_BASE_URL!.replace(/\/v1$/, "")
export const plugboardKey = process.env.PLUGBOARD_KEY!

// #region snippet
export function chatModel(model: string, overrides: Record<string, unknown> = {}) {
  return new ChatAnthropic({
    model,
    anthropicApiUrl: plugboardURL,
    anthropicApiKey: plugboardKey,
    maxTokens: 1024,
    maxRetries: 0,
    ...overrides,
  })
}
// #endregion snippet

/** Messages stop reasons, as the shared checks name them (the other examples' vocabulary). */
export const finishReason = (reason: unknown): string | null => {
  if (typeof reason !== "string") return null
  return ({ end_turn: "stop", stop_sequence: "stop", tool_use: "tool_calls", max_tokens: "length" } as Record<string, string>)[reason] ?? reason
}
