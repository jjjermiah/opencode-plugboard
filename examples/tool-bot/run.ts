// Runner for tool-bot. Started by examples/_harness/run.ts, which captures the traffic and writes the run. This file
// writes nothing: it runs the bot once per model with the S2 prompt and prints one JSON line per scenario.
//
//   bun run.ts          # through the harness, against the capture proxy
//
// The bot reads PLUGBOARD_URL (not PLUGBOARD_BASE_URL), so this file maps the variable. The bot prints only its final
// answer, so the S2 observations come from the round trip the capture proxy recorded (GET /__exchanges, #320): the
// first successful chat completion that asks for a tool, and the last successful one. A retried or failed request
// (status other than 200) is not read, and the count of calls is not assumed.
import { emitClient, runAll } from "../_harness/ts/harness.ts"

const PROMPT = "What is the weather in Paris? Use the tool."
const BOT = new URL("./index.ts", import.meta.url).pathname

const version = JSON.parse(await Bun.file(new URL("./node_modules/openai/package.json", import.meta.url)).text()).version as string
emitClient("openai", version)

interface Exchange {
  readonly seq: number
  readonly path: string
  readonly status: number
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

/** The S2 observations, read from the successful chat completions the bot made: the tool-call turn, then the last turn. */
async function roundTrip(): Promise<Record<string, unknown>> {
  const url = process.env.PLUGBOARD_CAPTURE_URL
  if (!url) throw new Error("PLUGBOARD_CAPTURE_URL is not set: run this through examples/_harness/run.ts")
  const exchanges = (await (await fetch(`${url}/__exchanges`)).json()) as Exchange[]
  const answers = exchanges
    .filter((exchange) => exchange.status === 200 && exchange.path.startsWith("/v1/chat/completions"))
    .sort((a, b) => a.seq - b.seq)
    .map((exchange) => JSON.parse(exchange.resBody) as ChatResponse)
  const asked = answers.find((answer) => (answer.choices[0]?.message.tool_calls?.length ?? 0) > 0)
  const last = answers.at(-1)
  if (!asked || !last) throw new Error("the bot had no successful tool-call answer and no final answer in S2")
  const choice = asked.choices[0]!
  const call = choice.message.tool_calls![0]!
  const args = JSON.parse(call.function.arguments) as { city?: string }
  return {
    finish_reason: choice.finish_reason,
    tool_name: call.function.name,
    tool_city: args.city ?? "",
    tool_call_id: call.id,
    final_text: last.choices[0]!.message.content ?? "",
    final_finish_reason: last.choices[0]!.finish_reason,
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
