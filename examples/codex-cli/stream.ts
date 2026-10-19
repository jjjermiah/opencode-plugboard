// S3, streaming text with usage: `codex exec` streams the Responses API on every call, so this is the S1 call with the stream's
// own end checked. `done` is true when the turn completed, which Codex reports only after the stream's `response.completed`.
import { codex } from "./cli.ts"
import { answer } from "./chat.ts"

export async function run(model: string) {
  // #region snippet
  const events = await codex(model, "Reply with exactly: pong")
  // #endregion snippet
  const { text, usage, completed } = answer(events)
  return { text, usage, done: completed }
}
