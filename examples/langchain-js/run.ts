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
    // plugboard returns status "completed". The finish_reason checks of the "auto" variant are left out (unobserved, #104),
    // a client limitation, not a bug. The auto variant also takes the Chat route for fast and claude, where finish_reason is
    // not left out in the same way, so those rows lose that one check: see the README.
    variants: { S1: ["chat", "auto"], S2: ["chat", "auto"] },
    unobserved: {
      "S1|auto": { "finish_reason is stop": "LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)" },
      "S2|auto": {
        "turn 1 finish_reason is tool_calls": "LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)",
        "turn 2 finish_reason is stop": "LangChain exposes no finish_reason on the Responses route (plugboard returns status completed)",
      },
    },
  },
)
