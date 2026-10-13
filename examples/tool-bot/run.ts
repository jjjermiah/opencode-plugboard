// Runner for tool-bot. Started by examples/_harness/run.ts, which captures the traffic and writes the run. This file
// writes nothing: it runs the bot once per model with the S2 prompt and prints one JSON line per scenario.
//
//   bun run.ts          # through the harness, against the capture proxy
//
// The bot reads PLUGBOARD_URL (not PLUGBOARD_BASE_URL), so this file maps the variable. The bot prints only its final
// answer, so the S2 observations come from the round trip the capture proxy recorded (GET /__exchanges, #320): the
// first chat completion is the tool call, the second is the answer after the tool result.
import { emitClient, runAll } from "../_harness/ts/harness.ts"

const PROMPT = "What is the weather in Paris? Use the tool."
const BOT = new URL("./index.ts", import.meta.url).pathname

const version = JSON.parse(await Bun.file(new URL("./node_modules/openai/package.json", import.meta.url)).text()).version as string
emitClient("openai", version)

interface Exchange {
  readonly seq: number
  readonly path: string
  readonly resBody: string
}
interface ChatResponse {
  readonly choices: ReadonlyArray<{
    readonly finish_reason: string | null
    readonly message: {
      readonly content: string | null
      readonly tool_calls?: ReadonlyArray<{ readonly id: string; readonly function: { readonly name: string; readonly arguments: string } }>
    }
  }>
}

/** The two chat completions the bot made in S2, read from the capture: the tool call, then the answer after the tool result. */
async function roundTrip(): Promise<Record<string, unknown>> {
  const url = process.env.PLUGBOARD_CAPTURE_URL
  if (!url) throw new Error("PLUGBOARD_CAPTURE_URL is not set: run this through examples/_harness/run.ts")
  const exchanges = (await (await fetch(`${url}/__exchanges`)).json()) as Exchange[]
  const turns = exchanges.filter((exchange) => exchange.path.startsWith("/v1/chat/completions")).sort((a, b) => a.seq - b.seq)
  if (turns.length !== 2) throw new Error(`the bot made ${turns.length} chat completion calls for S2, expected 2`)
  const [first, second] = turns.map((turn) => JSON.parse(turn.resBody) as ChatResponse)
  const choice = first!.choices[0]!
  const call = choice.message.tool_calls?.[0]
  const args = call ? (JSON.parse(call.function.arguments) as { city?: string }) : {}
  return {
    finish_reason: choice.finish_reason,
    tool_name: call?.function.name ?? "",
    tool_city: args.city ?? "",
    tool_call_id: call?.id ?? "",
    final_text: second!.choices[0]!.message.content ?? "",
    final_finish_reason: second!.choices[0]!.finish_reason,
  }
}

async function bot(model: string) {
  const proc = Bun.spawn(["bun", BOT, PROMPT], {
    env: { ...process.env, PLUGBOARD_URL: process.env.PLUGBOARD_BASE_URL, PLUGBOARD_KEY: process.env.PLUGBOARD_KEY, PLUGBOARD_MODEL: model },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`index.ts exited ${code}: ${err.trim() || "no output"}`)
  return roundTrip()
}

await runAll({ S2: (model) => bot(model) })
