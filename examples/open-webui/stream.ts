// #region snippet
import { call, type Owui } from "./owui.ts"

/** The SSE frames of a streamed answer: the JSON chunks in order, and whether the stream ended with [DONE]. */
export function frames(text: string): { chunks: Array<Record<string, unknown>>; done: boolean } {
  const chunks: Array<Record<string, unknown>> = []
  let done = false
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue
    const payload = line.slice(5).trim()
    if (payload === "[DONE]") done = true
    else chunks.push(JSON.parse(payload) as Record<string, unknown>)
  }
  return { chunks, done }
}

/** S3: a streamed answer with `stream_options.include_usage`, then one without it. The checks read the first. */
export async function run(owui: Owui, model: string) {
  const body = { model, stream: true, max_tokens: 1024, messages: [{ role: "user", content: "Reply with exactly: pong" }] }
  const withUsage = await call(owui, "POST", "/api/chat/completions", { ...body, stream_options: { include_usage: true } })
  await call(owui, "POST", "/api/chat/completions", body)
  const { chunks, done } = frames(withUsage.text)
  const choices = chunks.flatMap((chunk) => (chunk.choices as Array<Record<string, any>> | undefined) ?? [])
  return {
    text: choices.map((choice) => choice.delta?.content ?? "").join(""),
    finish_reason: choices.map((choice) => choice.finish_reason).filter((reason) => reason).at(-1) ?? null,
    usage: chunks.map((chunk) => chunk.usage).filter((usage) => usage !== null && usage !== undefined).at(-1) ?? null,
    done,
  }
}
// #endregion snippet

if (import.meta.main) {
  const owui: Owui = { base: process.env.OWUI_BASE!, token: process.env.OWUI_TOKEN!, upstream: process.env.OWUI_UPSTREAM ?? "" }
  console.log(JSON.stringify(await run(owui, process.env.MODEL ?? "fast")))
}
