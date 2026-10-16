// Runner for the OpenAI Agents SDK (JS) example. Started by examples/_harness/run.ts, which captures the traffic and writes
// the run. This file writes nothing: it prints one JSON line per scenario and model.
//
//   bun run.ts          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
import OpenAI from "openai"
import { setDefaultOpenAIClient, setOpenAIAPI, setTracingDisabled } from "@openai/agents"
import { emitClient, runAll } from "../_harness/ts/harness.ts"
import * as chat from "./chat.ts"
import * as errors from "./errors.ts"
import * as image from "./image.ts"
import * as stream from "./stream.ts"
import * as structured from "./structured.ts"
import * as tools from "./tools.ts"

const client = new OpenAI({ baseURL: process.env.PLUGBOARD_BASE_URL, apiKey: process.env.PLUGBOARD_KEY, maxRetries: 0 })
// The SDK's default client, API and tracing. Set once for the run: the scenarios build their models from `client`.
setDefaultOpenAIClient(client)
setOpenAIAPI("responses")
setTracingDisabled(true)

const version = JSON.parse(await Bun.file(new URL("./node_modules/@openai/agents/package.json", import.meta.url)).text()).version as string
emitClient("openai-agents-js", version)

await runAll(
  {
    S1: (model) => chat.runChat(client, model),
    S2: (model) => tools.runTools(client, model),
    S3: (model) => stream.runStream(client, model),
    S4: (model) => tools.runStreamTools(client, model),
    S5: (model) => image.runImage(client, model),
    S6: (model) => structured.runStructured(client, model),
    E1: (model) => errors.runWrongKey(client, model),
    E2: (model) => errors.runUnknownModel(client, model),
  },
  {
    na: {
      S7: "the Agents SDK has no model-list call",
    },
  },
)
