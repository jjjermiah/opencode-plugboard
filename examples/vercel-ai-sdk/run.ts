// The Vercel AI SDK runner. Started by examples/_harness/run.ts, which captures the traffic and writes the run. It
// prints one JSON line per scenario and model and writes nothing.
//
//   bun run.ts    # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
import { emitClient, runAll } from "../_harness/ts/harness.ts"
import * as chat from "./chat.ts"
import * as errors from "./errors.ts"
import * as image from "./image.ts"
import * as models from "./models.ts"
import { apis, type Client } from "./providers.ts"
import * as stream from "./stream.ts"
import * as streamTools from "./stream_tools.ts"
import * as structured from "./structured.ts"
import * as tools from "./tools.ts"

const API = ["compat", "openai-chat", "responses"] as const
const clientFor = (variant?: string): Client => apis[(variant ?? "compat") as keyof typeof apis]

const version = JSON.parse(await Bun.file(new URL("./node_modules/ai/package.json", import.meta.url)).text()).version as string
emitClient("vercel-ai-sdk", version)

await runAll(
  {
    S1: (model, variant) => chat.run(clientFor(variant), model),
    S2: (model, variant) => tools.run(clientFor(variant), model),
    S3: (model, variant) => stream.run(clientFor(variant), model),
    S4: (model, variant) => streamTools.run(clientFor(variant), model),
    S5: (model, variant) => image.run(clientFor(variant), model),
    S6: (model, variant) => structured.run(clientFor(variant), model),
    S7: () => models.run(),
    E1: (model) => errors.runWrongKey(model),
    E2: () => errors.runUnknownModel(clientFor()),
  },
  {
    variants: { S1: API, S2: API, S3: API, S4: API, S5: API, S6: API },
  },
)
