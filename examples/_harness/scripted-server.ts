#!/usr/bin/env bun
/**
 * Plugboard over loopback with the scripted model: the real OpenAI-compatible route (Chat Completions, Responses,
 * Anthropic Messages, Gemini, models) with `scripted-model.ts` in place of a provider. Used by `run.ts --target scripted`.
 *
 *   bun examples/_harness/scripted-server.ts [--port 0]
 *
 * It prints `PLUGBOARD_BASE_URL=http://127.0.0.1:<port>/v1` and `PLUGBOARD_KEY=<key>`, then stays up until SIGTERM,
 * SIGINT or the end of stdin. `--port 0` (the default) takes an ephemeral port.
 *
 * It builds the route itself instead of calling `startRoute` from test/support: `startRoute` always listens on an
 * ephemeral port, and this server must bind the port it was given. The route, options and fake caller are the same ones
 * the tests use.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { parseOptions } from "../../src/config.js"
import type { CatalogModel } from "../../src/contract.js"
import { createMetrics } from "../../src/metrics.js"
import { createOpenAiRoute } from "../../src/openai/route.js"
import { model } from "../../test/support/fixtures.js"
import { TEST_STATUS } from "../../test/support/loopback.js"
import { scriptedModel } from "./scripted-model.ts"

/** The app the examples call with. Its key is fixed: the scripted server is local and answers fake prompts. */
export const SCRIPTED_APP = "compat"
export const SCRIPTED_KEY = "sk-plug-scripted-examples"
export const SCRIPTED_MODELS = ["anthropic/claude-haiku-4-5", "openai/gpt-5.6-luna#low"]

export const CATALOG: ReadonlyArray<CatalogModel> = [
  model("anthropic", "claude-haiku-4-5", { capabilities: { tools: true, image: true } }),
  model("openai", "gpt-5.6-luna", { variants: ["low"], capabilities: { tools: true, image: true } }),
]

export interface ScriptedServer {
  /** The base URL the clients call, ending in `/v1`. */
  readonly url: string
  readonly key: string
  close(): Promise<void>
}

export async function startScriptedServer(port = 0): Promise<ScriptedServer> {
  let handle: ((request: IncomingMessage, response: ServerResponse) => Promise<void>) | undefined
  const server = createServer((request, response) => void handle!(request, response))
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve))
  const actual = (server.address() as AddressInfo).port
  const options = parseOptions({
    listen: { host: "127.0.0.1", port: actual },
    keys: { [SCRIPTED_APP]: SCRIPTED_KEY },
    models: SCRIPTED_MODELS,
    aliases: { fast: "anthropic/claude-haiku-4-5" },
  })
  handle = createOpenAiRoute({
    options,
    caller: scriptedModel,
    loadCatalog: async () => CATALOG,
    metrics: createMetrics(),
    status: () => TEST_STATUS,
  })
  return {
    url: `http://127.0.0.1:${actual}/v1`,
    key: SCRIPTED_KEY,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

if (import.meta.main) {
  const flag = process.argv.indexOf("--port")
  const port = flag === -1 ? 0 : Number(process.argv[flag + 1])
  if (!Number.isInteger(port) || port < 0) throw new Error("--port needs an integer, 0 for an ephemeral port")
  const route = await startScriptedServer(port)
  console.log(`PLUGBOARD_BASE_URL=${route.url}`)
  console.log(`PLUGBOARD_KEY=${route.key}`)
  const stop = () => void route.close().then(() => process.exit(0))
  process.on("SIGTERM", stop)
  process.on("SIGINT", stop)
  process.stdin.on("end", stop)
  process.stdin.resume()
}
