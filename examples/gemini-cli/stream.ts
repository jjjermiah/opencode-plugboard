// S3, streaming text: the CLI's stream-json output. Text arrives as assistant deltas; the result event carries the stats.
import { gemini } from "./cli.ts"

interface Event {
  type: string
  role?: string
  content?: string
  delta?: boolean
  status?: string
  stats?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
}

export async function run(home: string, model: string) {
  // #region snippet
  // gemini -p "<prompt>" -m <model> --output-format stream-json. One JSON event per line.
  const stdout = await gemini(home, model, "Reply with exactly: pong", "stream-json")
  // #endregion snippet
  const events = stdout.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line) as Event)
  const text = events
    .filter((event) => event.type === "message" && event.role === "assistant" && event.delta)
    .map((event) => event.content ?? "")
    .join("")
  const result = events.find((event) => event.type === "result")
  if (!text) throw new Error("the stream sent no text")
  return {
    text,
    usage: result?.stats ?? null,
    done: result?.status === "success",
  }
}

if (import.meta.main) {
  const { cliHome } = await import("./cli.ts")
  console.log(JSON.stringify(await run(cliHome(), "fast")))
}
