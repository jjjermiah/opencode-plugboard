// Runner for the TypeScript smoke example: S1 on every model it covers. Started by examples/_harness/run.ts; writes nothing.
import OpenAI from "openai"
import { emitClient, runAll } from "../ts/harness.ts"
import { run as chat } from "./chat.ts"

const client = new OpenAI({ baseURL: process.env.PLUGBOARD_BASE_URL, apiKey: process.env.PLUGBOARD_KEY, maxRetries: 0 })
const version = JSON.parse(await Bun.file(new URL("./node_modules/openai/package.json", import.meta.url)).text()).version as string
emitClient("openai", version)
await runAll({ S1: (model) => chat(client, model) })
