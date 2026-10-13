// S3, streaming text, with and without usage. Raw chunks, then the SDK's stream helper, which must agree.
import OpenAI from "openai"

export async function run(client: OpenAI, model: string) {
  const messages: OpenAI.ChatCompletionMessageParam[] = [{ role: "user", content: "Reply with exactly: pong" }]
  // #region snippet
  const stream = await client.chat.completions.create({ model, messages, stream: true, stream_options: { include_usage: true }, max_tokens: 1024 })
  let text = ""
  let finish: string | null = null
  let usage: OpenAI.CompletionUsage | null = null
  for await (const chunk of stream) {
    // the SDK stops here when the server sends [DONE]
    if (chunk.usage) usage = chunk.usage
    for (const choice of chunk.choices) {
      text += choice.delta.content ?? ""
      finish = choice.finish_reason ?? finish
    }
  }
  // #endregion snippet
  // The helper accumulates the same chunks into a snapshot; it must give the same text.
  const helper = client.chat.completions.stream({ model, messages, stream_options: { include_usage: true }, max_tokens: 1024 })
  const helperText = (await helper.finalChatCompletion()).choices[0]?.message.content ?? ""
  if (helperText !== text) throw new Error(`stream helper text ${JSON.stringify(helperText)} differs from the raw stream ${JSON.stringify(text)}`)
  return { text, finish_reason: finish, usage, done: true }
}

if (import.meta.main) {
  const client = new OpenAI({ baseURL: process.env.PLUGBOARD_BASE_URL, apiKey: process.env.PLUGBOARD_KEY, maxRetries: 0 })
  console.log(JSON.stringify(await run(client, "fast")))
}
