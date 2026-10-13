// Runner for the OpenAI JS SDK example. Started by examples/_harness/run.ts, which captures the traffic and writes
// the run. This file writes nothing: it prints one JSON line per scenario and model.
//
//   bun run.ts          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
import OpenAI from "openai"
import { emitClient, runAll } from "../_harness/ts/harness.ts"
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

await runAll({
  S1: (model) => chat.run(client, model),
  S2: (model) => tools.run(client, model),
  S3: (model) => stream.run(client, model),
  S4: (model) => streamTools.run(client, model),
  S5: (model) => image.run(client, model),
  S6: (model) => structured.run(client, model),
  S7: () => models.run(client),
  E1: (model) => errors.runWrongKey(client, model),
  E2: (model) => errors.runUnknownModel(client, model),
})
