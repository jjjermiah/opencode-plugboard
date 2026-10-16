// The Vercel AI SDK's Anthropic provider runner. Started by examples/_harness/run.ts, which captures the traffic and writes
// the run. It prints one JSON line per scenario and model and writes nothing.
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

const version = JSON.parse(await Bun.file(new URL("./node_modules/@ai-sdk/anthropic/package.json", import.meta.url)).text()).version as string
emitClient("@ai-sdk/anthropic", version)

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
    gaps: {
      E1: { note: "Messages errors use Anthropic's error.type, not an error.code", issue: "#102" },
      E2: { note: "Messages errors use Anthropic's error.type, not an error.code", issue: "#102" },
      // Plugboard refuses output_config.format by design (docs/messages.md). The SDK sends it for this model only.
      "S6|anthropic/claude-haiku-4-5": { note: "plugboard refuses output_config.format on /v1/messages (docs/messages.md)", issue: "#102" },
    },
  },
)
