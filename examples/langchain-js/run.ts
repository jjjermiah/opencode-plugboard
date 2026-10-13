// Runner for the LangChain JS example. Started by examples/_harness/run.ts, which captures the traffic and writes the
// run. This file writes nothing: it prints one JSON line per scenario and model.
//
//   bun run.ts     # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
import { emitClient, runAll } from "../_harness/ts/harness.ts"
import { run as chat } from "./chat.ts"
import { run as image } from "./image.ts"
import { runUnknownModel, runWrongKey } from "./errors.ts"
import { run as models } from "./models.ts"
import { run as stream } from "./stream.ts"
import { run as streamTools } from "./stream_tools.ts"
import { run as structured } from "./structured.ts"
import { run as tools } from "./tools.ts"

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set: run this through examples/_harness/run.ts`)
  return value
}

const client = { baseURL: env("PLUGBOARD_BASE_URL"), apiKey: env("PLUGBOARD_KEY") }
const version = JSON.parse(await Bun.file(new URL("./node_modules/@langchain/openai/package.json", import.meta.url)).text()).version as string
emitClient("@langchain/openai", version)

await runAll(
  {
    S1: (model) => chat(client, model),
    S2: (model) => tools(client, model),
    S3: (model) => stream(client, model),
    S4: (model) => streamTools(client, model),
    S5: (model) => image(client, model),
    S6: (model) => structured(client, model),
    S7: (model) => models(client, model),
    E1: (model) => runWrongKey(client, model),
    E2: (model) => runUnknownModel(client, model),
  },
  {
    // gpt-5.6* ids take the Responses API in @langchain/openai, and its results carry no finish_reason in
    // response_metadata (the reply has status "completed"). The Chat Completions models pass the same checks.
    gaps: {
      "S1|openai/gpt-5.6-luna#low": { note: "LangChain's Responses path sets no finish_reason; status is completed", issue: "#104" },
      "S2|openai/gpt-5.6-luna#low": { note: "LangChain's Responses path sets no finish_reason; status is completed", issue: "#104" },
    },
  },
)
