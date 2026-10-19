// S1, plain chat: the CLI's one-shot prompt. Codex always streams from /v1/responses, so S1 and S3 are the same call.
import { codex, type CodexEvent } from "./cli.ts"

/** The agent's last message and the turn's token usage, from the JSONL events. */
export function answer(events: CodexEvent[]) {
  const messages = events.filter((event) => event.type === "item.completed" && event.item?.type === "agent_message")
  const completed = events.find((event) => event.type === "turn.completed")
  return { text: messages.at(-1)?.item?.text ?? "", usage: completed?.usage ?? null, completed: completed !== undefined }
}

export async function run(model: string) {
  // #region snippet
  // codex exec --json -m <model> "<prompt>", with the plugboard provider in $CODEX_HOME/config.toml (cli.ts).
  const events = await codex(model, "Reply with exactly: pong")
  // #endregion snippet
  const { text, usage } = answer(events)
  return { text, usage }
}

if (import.meta.main) {
  const { cliHome } = await import("./cli.ts")
  cliHome()
  console.log(JSON.stringify(await run("fast")))
}
