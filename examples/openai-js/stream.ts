// S3, streaming text, with and without usage. Raw chunks, then the SDK's stream helper, which must agree.
import OpenAI from "openai"
import { responsesFinishReason } from "./chat.ts"

export async function run(client: OpenAI, model: string) {
  // #region snippet
  const messages: OpenAI.ChatCompletionMessageParam[] = [{ role: "user", content: "Reply with exactly: pong" }]
  // Without usage (the default): text arrives in deltas, and the stream ends at [DONE].
  const plain = await client.chat.completions.create({ model, messages, stream: true, max_tokens: 1024 })
  let plainText = ""
  for await (const chunk of plain) {
    for (const choice of chunk.choices) plainText += choice.delta.content ?? ""
  }
  // With usage: the last chunk has no choices and carries the usage object.
  const stream = await client.chat.completions.create({ model, messages, stream: true, stream_options: { include_usage: true }, max_tokens: 1024 })
  let text = ""
  let finish: string | null = null
  let usage: OpenAI.CompletionUsage | null = null
  for await (const chunk of stream) {
    if (chunk.usage) usage = chunk.usage
    for (const choice of chunk.choices) {
      text += choice.delta.content ?? ""
      finish = choice.finish_reason ?? finish
    }
  }
  // The helper accumulates the same chunks into a snapshot; it must give the same text.
  const helper = client.chat.completions.stream({ model, messages, stream_options: { include_usage: true }, max_tokens: 1024 })
  const helperText = (await helper.finalChatCompletion()).choices[0]?.message.content ?? ""
  // #endregion snippet
  if (!plainText) throw new Error("the stream without usage sent no text")
  if (helperText !== text) throw new Error(`stream helper text ${JSON.stringify(helperText)} differs from the raw stream ${JSON.stringify(text)}`)
  return { text, finish_reason: finish, usage, done: true }
}

export async function runResponses(client: OpenAI, model: string) {
  // #region snippet-responses
  const stream = client.responses.stream({ model, input: "Reply with exactly: pong", max_output_tokens: 1024 })
  let text = ""
  for await (const event of stream) {
    if (event.type === "response.output_text.delta") text += event.delta
  }
  const final = await stream.finalResponse()
  // #endregion snippet-responses
  // The final response carries the same text the deltas did.
  if (final.output_text !== text) throw new Error(`final response text ${JSON.stringify(final.output_text)} differs from the deltas ${JSON.stringify(text)}`)
  return { text, finish_reason: responsesFinishReason(final), usage: final.usage ?? null, done: true }
}

if (import.meta.main) {
  const client = new OpenAI({ baseURL: process.env.PLUGBOARD_BASE_URL, apiKey: process.env.PLUGBOARD_KEY, maxRetries: 0 })
  console.log(JSON.stringify(await run(client, "fast")))
}
