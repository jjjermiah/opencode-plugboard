// The Anthropic TypeScript SDK runner. Started by examples/_harness/run.ts, which captures the traffic and writes the run. It
// prints one JSON line per scenario and model and writes nothing.
//
//   bun run.ts    # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
import { emitClient, runAll } from "../_harness/ts/harness.ts"
import * as chat from "./chat.ts"
import * as image from "./image.ts"
import * as models from "./models.ts"
import * as stream from "./stream.ts"
import * as streamTools from "./stream_tools.ts"
import * as structured from "./structured.ts"
import * as tools from "./tools.ts"
import * as unknownModel from "./unknown_model.ts"
import * as wrongKey from "./wrong_key.ts"

const version = JSON.parse(await Bun.file(new URL("./node_modules/@anthropic-ai/sdk/package.json", import.meta.url)).text()).version as string
emitClient("@anthropic-ai/sdk", version)

await runAll(
  {
    S1: (model) => chat.run(model),
    S2: (model) => tools.run(model),
    S3: (model) => stream.run(model),
    S4: (model) => streamTools.run(model),
    S5: (model) => image.run(model),
    S6: (model) => structured.run(model),
    S7: () => models.run(),
    E1: (model) => wrongKey.run(model),
    E2: () => unknownModel.run(),
  },
  {
    // The error code is not on the Messages wire (src/anthropic/response.ts:112), so the shared code checks are not observed.
    // The status checks stay enforced.
    unobserved: {
      E1: { "code is invalid_api_key": "Messages errors carry error.type and no error.code (src/anthropic/response.ts:112)" },
      E2: { "code is model_not_found": "Messages errors carry error.type and no error.code (src/anthropic/response.ts:112)" },
    },
    gaps: {
      // The SDK's models.list sends x-api-key, which GET /v1/models refuses (#399).
      S7: { note: "GET /v1/models ignores x-api-key, which the SDK sends", issue: "#399" },
    },
  },
)
