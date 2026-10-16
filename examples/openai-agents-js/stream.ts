// S3, streaming text through the OpenAI Agents SDK on the Responses API. The snippet streams the run's events.
import { Agent, run } from "@openai/agents"
import type OpenAI from "openai"
import { finishReason, modelFor, usageOf } from "./chat.ts"

export async function runStream(client: OpenAI, model: string) {
  // #region snippet
  const agent = new Agent({ name: "pong", model: modelFor(client, model), instructions: "Answer tersely." })
  const stream = await run(agent, "Reply with exactly: pong", { stream: true })
  let text = ""
  let status: unknown
  for await (const event of stream) {
    if (event.type === "raw_model_stream_event" && event.data.type === "output_text_delta") text += event.data.delta
    // The streamed response's status comes on its last event, not on the rawResponses entry.
    if (event.type === "raw_model_stream_event" && event.data.type === "response_done") status = event.data.response.providerData?.status
  }
  // #endregion snippet
  await stream.completed
  const last = stream.rawResponses.at(-1)!
  return { text, finish_reason: finishReason(last, status), usage: usageOf(last), done: true }
}
