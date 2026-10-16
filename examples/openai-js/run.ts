// Runner for the OpenAI JS SDK example. Started by examples/_harness/run.ts, which captures the traffic and writes
// the run. This file writes nothing: it prints one JSON line per scenario and model.
//
//   bun run.ts          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
import OpenAI from "openai"
import { emitClient, runAll, type Observations } from "../_harness/ts/harness.ts"
import * as chat from "./chat.ts"
import * as models from "./models.ts"
import * as errors from "./errors.ts"
import * as image from "./image.ts"
import * as stream from "./stream.ts"
import * as streamTools from "./stream_tools.ts"
import * as structured from "./structured.ts"
import * as tools from "./tools.ts"

const client = new OpenAI({ baseURL: process.env.PLUGBOARD_BASE_URL, apiKey: process.env.PLUGBOARD_KEY, maxRetries: 0 })
const version = JSON.parse(await Bun.file(new URL("./node_modules/openai/package.json", import.meta.url)).text()).version as string
emitClient("openai", version)

// Chat Completions (`chat`) and the Responses API (`responses`) run side by side on the scenarios that have both.
const APIS = ["chat", "responses"]
// previous_response_id is refused by plugboard by design (docs/responses.md). Recorded as a gap until the client moves to full input.
const PREVIOUS_ID = "responses-previous-id"
const byApi = (chatRun: (model: string) => Promise<Observations>, responsesRun: (model: string) => Promise<Observations>) => (model: string, variant?: string) =>
  variant === "chat" ? chatRun(model) : responsesRun(model)

await runAll(
  {
    S1: byApi((model) => chat.run(client, model), (model) => chat.runResponses(client, model)),
    S2: (model, variant) => {
      if (variant === PREVIOUS_ID) return tools.runResponsesPreviousId(client, model)
      return variant === "chat" ? tools.run(client, model) : tools.runResponses(client, model)
    },
    S3: byApi((model) => stream.run(client, model), (model) => stream.runResponses(client, model)),
    S4: (model) => streamTools.run(client, model),
    S5: byApi((model) => image.run(client, model), (model) => image.runResponses(client, model)),
    S6: byApi((model) => structured.run(client, model), (model) => structured.runResponses(client, model)),
    S7: () => models.run(client),
    E1: (model) => errors.runWrongKey(client, model),
    E2: (model) => errors.runUnknownModel(client, model),
  },
  {
    variants: { S1: APIS, S2: [...APIS, PREVIOUS_ID], S3: APIS, S5: APIS, S6: APIS },
    gaps: {
      [`S2|${PREVIOUS_ID}`]: {
        note: "previous_response_id is refused: plugboard is stateless, send the full input (docs/responses.md)",
        issue: "#104",
      },
    },
  },
)
