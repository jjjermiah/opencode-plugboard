// Runner for the OpenAI Agents SDK (JS) example. Started by examples/_harness/run.ts, which captures the traffic and writes
// the run. This file writes nothing: it prints one JSON line per scenario and model.
//
//   bun run.ts          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
import OpenAI from "openai"
import { setDefaultOpenAIClient, setOpenAIAPI, setTracingDisabled } from "@openai/agents"
import { emitClient, runAll } from "../_harness/ts/harness.ts"
import * as chat from "./chat.ts"
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

const NOT_WRITTEN = "not written for this example yet"
await runAll(
  {
    S1: (model) => chat.runChat(client, model),
    S2: (model) => tools.runTools(client, model),
    S3: (model) => stream.runStream(client, model),
    S6: (model) => structured.runStructured(client, model),
  },
  {
    na: {
      S4: NOT_WRITTEN,
      S5: NOT_WRITTEN,
      S7: "the Agents SDK has no model-list call",
      E1: NOT_WRITTEN,
      E2: NOT_WRITTEN,
    },
  },
)
