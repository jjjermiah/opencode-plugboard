// The curl example's runner. Each API's shell file runs one scenario and prints its observations; the shared helpers
// mark, check and print. Started by examples/_harness/run.ts, which writes the run. This file writes nothing.
import { join } from "node:path"
import { emit, runAll, type Observations } from "../_harness/ts/harness.ts"

const HERE = import.meta.dir
/** The shell file for each API a scenario runs on (the variant). */
const API_FILE: Record<string, string> = {
  chat: "chat.sh",
  responses: "responses.sh",
  messages: "messages.sh",
  gemini: "gemini.sh",
  completions: "completions.sh",
}

async function output(command: string[]): Promise<string> {
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "ignore" })
  const text = await new Response(proc.stdout).text()
  await proc.exited
  return text.trim()
}

/** Runs one scenario in one shell file; the file prints one JSON object of observations. */
async function shell(file: string, scenario: string, model: string): Promise<Observations> {
  const proc = Bun.spawn(["bash", join(HERE, file), scenario, model], { env: process.env, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`${file} ${scenario} on ${model} exited ${code}: ${err.trim() || "no output"}`)
  return JSON.parse(out.trim()) as Observations
}

const curlVersion = (await output(["curl", "--version"])).split("\n")[0]!.split(" ")[1] ?? "unknown"
const bashVersion = await output(["bash", "-c", 'echo "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}"'])
emit({ kind: "client", name: "curl", version: curlVersion, runtime: { name: "bash", version: bashVersion } })

await runAll(
  {
    S1: (model, variant) => shell(API_FILE[variant ?? "chat"]!, "S1", model),
    S2: (model, variant) => shell(API_FILE[variant ?? "chat"]!, "S2", model),
    S3: (model, variant) => shell(API_FILE[variant ?? "chat"]!, "S3", model),
    S4: (model) => shell("chat.sh", "S4", model),
    S5: (model) => shell("chat.sh", "S5", model),
    S6: (model) => shell("chat.sh", "S6", model),
    S7: () => shell("models.sh", "S7", "-"),
    E1: (model) => shell("chat.sh", "E1", model),
    E2: (model) => shell("chat.sh", "E2", model),
  },
  {
    variants: {
      S1: ["chat", "responses", "messages", "gemini", "completions"],
      S2: ["chat", "messages", "gemini"],
      S3: ["chat", "messages", "gemini"],
    },
  },
)
