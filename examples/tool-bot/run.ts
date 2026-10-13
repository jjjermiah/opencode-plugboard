// Runner for tool-bot. Started by examples/_harness/run.ts, which captures the traffic and writes the run. This file
// writes nothing: it runs the bot once per model with the S2 prompt and prints one JSON line per scenario.
//
//   bun run.ts          # through the harness, against the capture proxy
//
// The bot reads PLUGBOARD_URL (not PLUGBOARD_BASE_URL), so this file maps the variable. The bot prints only its final
// answer, so the S2 checks that read the tool call cannot be observed here: S2 is a gap (#320), and the transcript
// still holds the round trip.
import { emitClient, runAll } from "../_harness/ts/harness.ts"

const PROMPT = "What is the weather in Paris? Use the tool."
const BOT = new URL("./index.ts", import.meta.url).pathname

const version = JSON.parse(await Bun.file(new URL("./node_modules/openai/package.json", import.meta.url)).text()).version as string
emitClient("openai", version)

async function bot(model: string) {
  const proc = Bun.spawn(["bun", BOT, PROMPT], {
    env: { ...process.env, PLUGBOARD_URL: process.env.PLUGBOARD_BASE_URL, PLUGBOARD_KEY: process.env.PLUGBOARD_KEY, PLUGBOARD_MODEL: model },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`index.ts exited ${code}: ${err.trim() || "no output"}`)
  return { final_text: out.trim() }
}

await runAll(
  { S2: (model) => bot(model) },
  { gaps: { S2: { note: "the bot prints only its final answer, so the tool-call checks cannot be read from its output", issue: "#320" } } },
)
