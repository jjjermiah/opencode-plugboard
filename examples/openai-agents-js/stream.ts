// S3, streaming text through the OpenAI Agents SDK on the Responses API. The snippet streams the run's events.
import { Agent, run } from "@openai/agents"
import type OpenAI from "openai"
import { finishReason, modelFor, usageOf } from "./chat.ts"

export async function runStream(client: OpenAI, model: string) {
  // #region snippet
  const agent = new Agent({ name: "pong", model: modelFor(client, model), instructions: "Answer tersely." })
  const stream = await run(agent, "Reply with exactly: pong", { stream: true })
  let text = ""
  for await (const event of stream) {
    if (event.type === "raw_model_stream_event" && event.data.type === "output_text_delta") text += event.data.delta
  }
  // #endregion snippet
  await stream.completed
  const last = stream.rawResponses.at(-1)!
  return { text, finish_reason: finishReason(last), usage: usageOf(last), done: true }
}
