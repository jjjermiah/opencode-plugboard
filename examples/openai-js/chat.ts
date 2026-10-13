// S1, plain chat, non-stream. The smallest call: one user message, one answer.
import OpenAI from "openai"

export async function run(client: OpenAI, model: string) {
  // #region snippet
  const response = await client.chat.completions.create({ model, messages: [{ role: "user", content: "Reply with exactly: pong" }] })
  // #endregion snippet
  const choice = response.choices[0]
  return { text: choice?.message.content ?? "", finish_reason: choice?.finish_reason ?? null, usage: response.usage ?? null }
}

if (import.meta.main) {
  const client = new OpenAI({ baseURL: process.env.PLUGBOARD_BASE_URL, apiKey: process.env.PLUGBOARD_KEY, maxRetries: 0 })
  console.log(JSON.stringify(await run(client, "fast")))
}
