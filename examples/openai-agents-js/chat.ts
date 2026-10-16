// S1, plain chat through the OpenAI Agents SDK on the Responses API. The snippet is the agent and one run. `run.ts` points
// the SDK at plugboard once (one client, tracing off: it would call OpenAI otherwise).
//
// finish_reason is derived from the last model response: `tool_calls` if it holds a function call, else `stop`. The SDK
// does not expose the wire finish_reason, so this is a mapping, not a read.
import { Agent, OpenAIResponsesModel, run, setDefaultOpenAIClient, setTracingDisabled, type ModelResponse } from "@openai/agents"
import OpenAI from "openai"

// #region snippet-model
/** The SDK model for one id. A model object sends the id as given: the SDK's own string lookup reads `anthropic/...` as a provider prefix. */
export function modelFor(client: OpenAI, model: string): OpenAIResponsesModel {
  return new OpenAIResponsesModel(client, model)
}
// #endregion snippet-model

export function finishReason(response: ModelResponse): string {
  return response.output.some((item) => item.type === "function_call") ? "tool_calls" : "stop"
}

export function usageOf(response: ModelResponse): Record<string, number> | null {
  const usage = response.usage
  return usage ? { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, total_tokens: usage.totalTokens } : null
}

export async function runChat(client: OpenAI, model: string) {
  // #region snippet
  const agent = new Agent({ name: "pong", model: modelFor(client, model), instructions: "Answer tersely." })
  const result = await run(agent, "Reply with exactly: pong")
  // #endregion snippet
  const last = result.rawResponses.at(-1)!
  return { text: String(result.finalOutput ?? ""), finish_reason: finishReason(last), usage: usageOf(last) }
}

if (import.meta.main) {
  const client = new OpenAI({ baseURL: process.env.PLUGBOARD_BASE_URL, apiKey: process.env.PLUGBOARD_KEY, maxRetries: 0 })
  setDefaultOpenAIClient(client)
  setTracingDisabled(true)
  console.log(JSON.stringify(await runChat(client, "fast")))
}
