// S1, plain chat, non-stream. The smallest call: one user message, one answer.
import OpenAI from "openai"

export async function run(client: OpenAI, model: string) {
  // #region snippet
  const response = await client.chat.completions.create({ model, messages: [{ role: "user", content: "Reply with exactly: pong" }], max_tokens: 1024 })
  // #endregion snippet
  const choice = response.choices[0]
  return { text: choice?.message.content ?? "", finish_reason: choice?.finish_reason ?? null, usage: response.usage ?? null }
}

/** The Responses API has no finish_reason. A function call means `tool_calls`, a completed answer `stop`. */
export function responsesFinishReason(response: OpenAI.Responses.Response): string {
  if (response.output.some((item) => item.type === "function_call")) return "tool_calls"
  return response.status === "completed" ? "stop" : (response.status ?? "")
}

export async function runResponses(client: OpenAI, model: string) {
  // #region snippet-responses
  const response = await client.responses.create({ model, input: "Reply with exactly: pong", max_output_tokens: 1024 })
  // #endregion snippet-responses
  return { text: response.output_text, finish_reason: responsesFinishReason(response), usage: response.usage ?? null }
}

if (import.meta.main) {
  const client = new OpenAI({ baseURL: process.env.PLUGBOARD_BASE_URL, apiKey: process.env.PLUGBOARD_KEY, maxRetries: 0 })
  console.log(JSON.stringify(await run(client, "fast")))
}
