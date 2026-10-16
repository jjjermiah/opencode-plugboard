// Runner for the Google GenAI JS SDK example. Started by examples/_harness/run.ts, which captures the traffic and writes
// the run. This file writes nothing: it prints one JSON line per scenario and model.
//
//   bun run.ts          # against PLUGBOARD_BASE_URL and PLUGBOARD_KEY, through the harness
import { GoogleGenAI } from "@google/genai"
import { emitClient, runAll } from "../_harness/ts/harness.ts"
import * as chat from "./chat.ts"
import * as errors from "./errors.ts"
import * as image from "./image.ts"
import * as models from "./models.ts"
import * as stream from "./stream.ts"
import * as streamTools from "./stream_tools.ts"
import * as structured from "./structured.ts"
import * as tools from "./tools.ts"

// The SDK adds /v1beta itself, so the base URL is the plugboard origin, not the /v1 the other examples take.
const baseUrl = (process.env.PLUGBOARD_BASE_URL ?? "").replace(/\/v1\/?$/, "")
const ai = new GoogleGenAI({ apiKey: process.env.PLUGBOARD_KEY, httpOptions: { baseUrl } })
const version = JSON.parse(await Bun.file(new URL("./node_modules/@google/genai/package.json", import.meta.url)).text()).version as string
emitClient("@google/genai", version)

// The SDK builds the URL, and a bare # starts a fragment, so the variant goes as %23 (docs/gemini.md, Model names). A / is sent as it is.
const wire = (model: string) => model.replaceAll("#", "%23")

const NO_CALL_ID = "Gemini function calls carry no id (Google's API); the call is paired with its result by name, so there is nothing to check"

await runAll(
  {
    S1: (model) => chat.run(ai, wire(model)),
    S2: (model) => tools.run(ai, wire(model)),
    S3: (model) => stream.run(ai, wire(model)),
    S4: (model) => streamTools.run(ai, wire(model)),
    S5: (model) => image.run(ai, wire(model)),
    S6: (model) => structured.run(ai, wire(model)),
    S7: () => models.run(ai),
    E1: (model) => errors.runWrongKey(baseUrl, wire(model)),
    E2: (model) => errors.runUnknownModel(baseUrl, wire(model)),
  },
  {
    unobserved: {
      S2: { "call id present": NO_CALL_ID },
      S4: { "call id present": NO_CALL_ID },
      E1: { "code is invalid_api_key": "Google's error body names the status UNAUTHENTICATED, not invalid_api_key; the status 401 is checked" },
      E2: { "code is model_not_found": "Google's error body names the status NOT_FOUND, not model_not_found; the status 404 is checked" },
    },
  },
)
