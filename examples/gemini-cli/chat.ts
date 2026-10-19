// S1, plain chat, non-stream: the CLI's one-shot prompt with JSON output.
import { gemini } from "./cli.ts"

export async function run(home: string, model: string) {
  // #region snippet
  // gemini -p "<prompt>" -m <model> --output-format json, with GEMINI_API_KEY and GOOGLE_GEMINI_BASE_URL set (cli.ts).
  const stdout = await gemini(home, model, "Reply with exactly: pong", "json")
  // #endregion snippet
  const json = JSON.parse(stdout) as { response?: string; stats?: { models?: Record<string, { tokens?: unknown }> } }
  const stats = json.stats?.models ? Object.values(json.stats.models)[0] : undefined
  return { text: json.response ?? "", usage: stats?.tokens ?? null }
}

if (import.meta.main) {
  const { cliHome } = await import("./cli.ts")
  console.log(JSON.stringify(await run(cliHome(), "fast")))
}
