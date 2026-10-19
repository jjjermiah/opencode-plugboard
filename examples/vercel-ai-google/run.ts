// Runner for the Vercel AI SDK Google provider example. Started by examples/_harness/run.ts, which captures the traffic and
// writes the run. This file writes nothing: it prints one JSON line per scenario and model.
//
//   bun run.ts          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
import { emitClient, runAll } from "../_harness/ts/harness.ts"
import * as chat from "./chat.ts"
import { client } from "./providers.ts"
import * as errors from "./errors.ts"
import * as image from "./image.ts"
import * as stream from "./stream.ts"
import * as streamTools from "./stream_tools.ts"
import * as structured from "./structured.ts"
import * as tools from "./tools.ts"

const version = JSON.parse(await Bun.file(new URL("./node_modules/@ai-sdk/google/package.json", import.meta.url)).text()).version as string
emitClient("@ai-sdk/google", version)

await runAll(
  {
    S1: (model) => chat.run(client, model),
    S2: (model) => tools.run(client, model),
    S3: (model) => stream.run(client, model),
    S4: (model) => streamTools.run(client, model),
    S5: (model) => image.run(client, model),
    S6: (model) => structured.run(client, model),
    E1: (model) => errors.runWrongKey(model),
    E2: (model) => errors.runUnknownModel(model),
  },
  {
    na: { S7: "The AI SDK has no model-list call, and @ai-sdk/google does not GET /v1beta/models" },
    unobserved: {
      E1: { "code is invalid_api_key": "Google's error body names the status UNAUTHENTICATED, not invalid_api_key; the status 401 is checked" },
      E2: { "code is model_not_found": "Google's error body names the status NOT_FOUND, not model_not_found; the status 404 is checked" },
    },
  },
)
