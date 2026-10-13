// Runner for the LangChain JS example. Started by examples/_harness/run.ts, which captures the traffic and writes the
// run. This file writes nothing: it prints one JSON line per scenario and model.
//
//   bun run.ts     # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
import { emitClient, runAll } from "../_harness/ts/harness.ts"
import { run as chat } from "./chat.ts"
import { run as image } from "./image.ts"
import { run as models } from "./models.ts"
import { run as stream } from "./stream.ts"
import { run as streamTools } from "./stream_tools.ts"
import { run as structured } from "./structured.ts"
import { run as tools } from "./tools.ts"
import { run as unknownModel } from "./unknown_model.ts"
import { run as wrongKey } from "./wrong_key.ts"

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
    S1: (model, variant) => chat(client, model, variant),
    S2: (model, variant) => tools(client, model, variant),
    S3: (model) => stream(client, model),
    S4: (model) => streamTools(client, model),
    S5: (model) => image(client, model),
    S6: (model) => structured(client, model),
    S7: (model) => models(client, model),
    E1: (model) => wrongKey(client, model),
    E2: (model) => unknownModel(client, model),
  },
  {
    // S1 and S2 run on two clients: "chat" (ChatOpenAICompletions, always /v1/chat/completions) and "auto" (ChatOpenAI,
    // which sends gpt-5.6* ids to /v1/responses). On the Responses route LangChain exposes no finish_reason, although
    // plugboard returns status "completed". The gap is the "auto" variant of luna; the "chat" variant passes.
    variants: { S1: ["chat", "auto"], S2: ["chat", "auto"] },
    gaps: {
      "S1|openai/gpt-5.6-luna#low": { note: "auto variant: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)", issue: "#104" },
      "S2|openai/gpt-5.6-luna#low": { note: "auto variant: LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)", issue: "#104" },
    },
  },
)
