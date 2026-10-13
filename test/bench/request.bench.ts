#!/usr/bin/env bun
/**
 * Request-path benchmarks (#118): each front-end over real loopback HTTP with a scripted model,
 * plus the pure decode and model resolution on their own. Not part of `bun test`.
 *
 *   bun run bench                      # the mitata table
 *   bun run bench -- --json run.json   # also write { name, p50Ns } for .github/scripts/bench-gate.ts (base vs head)
 *
 * The model is a replay of fixed events. FakeModelCaller is not used here: it keeps every call
 * record, which would grow across mitata's iterations and measure the heap, not the request path.
 */
import { bench, do_not_optimize, run } from "mitata"
import { Agent, request as httpRequest } from "node:http"
import { writeFileSync } from "node:fs"
import type { CatalogModel, ModelCaller, PlugEvent } from "../../src/contract.js"
import { resolveModel } from "../../src/models.js"
import { parseCompletionsRequest } from "../../src/completions/request.js"
import { parseChatRequest } from "../../src/openai/request.js"
import { CATALOG, ev, events, model, testOptions } from "../support/fixtures.js"
import { startRoute, type RouteServer } from "../support/loopback.js"

// The logger writes one line per request to the console; a benchmark measures the route, not stdout.
const jsonAt = process.argv.indexOf("--json")
const jsonFile = jsonAt === -1 ? undefined : process.argv[jsonAt + 1]
if (jsonAt !== -1 && !jsonFile) throw new Error("usage: request.bench.ts [--json <file>]")
const write = (line: string) => process.stdout.write(`${line}\n`)
console.log = () => {}
console.error = () => {}

/** Replays the same events on every call, without keeping a record of the call. */
const replay = (...list: PlugEvent[]): ModelCaller => ({ stream: () => events(...list) })
const answer = replay(ev.text("hi there"), ev.finish("stop", { inputTokens: 3, outputTokens: 2 }))
const deltas: PlugEvent[] = Array.from({ length: 2_000 }, (_, i) => ev.text(`token${i} `))
const longStream = replay(...deltas, ev.finish())
const slowStart = replay(ev.text("hi there"), ev.finish())

const servers: RouteServer[] = []
const serve = async (setup: Parameters<typeof startRoute>[0]) => {
  const server = await startRoute(setup)
  servers.push(server)
  return server
}

const plain = await serve({ caller: answer })
const streaming = await serve({ caller: slowStart })
const long = await serve({ caller: longStream })
const fanout = await serve({ caller: answer, options: { maxN: 3 } })
const responses = await serve({ caller: answer })
const messages = await serve({ caller: answer })
const gemini = await serve({ caller: answer, options: { aliases: { fast: "test/echo" } } })

/**
 * One kept-alive connection per server, so a benchmark measures the request path and not the TCP
 * setup. The support client opens a connection per request, and on loopback that setup moved the
 * medians between 0.2 ms and 150 ms from one run to the next.
 */
const agent = new Agent({ keepAlive: true, maxSockets: 1 })
function post(server: RouteServer, path: string, body: unknown, options: { agent?: Agent | false } = {}) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const payload = JSON.stringify(body)
    const client = httpRequest(
      { host: "127.0.0.1", port: server.port, method: "POST", path, agent: options.agent ?? agent, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } },
      (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk: Buffer) => chunks.push(chunk))
        response.on("end", () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }))
        response.on("error", reject)
      },
    )
    client.on("error", reject)
    client.end(payload)
  })
}
/** Resolves at the first body bytes of a streamed reply, then hangs up: time to first byte, on a new connection. */
function firstByte(server: RouteServer, path: string, body: unknown) {
  return new Promise<void>((resolve, reject) => {
    const payload = JSON.stringify(body)
    const client = httpRequest({ host: "127.0.0.1", port: server.port, method: "POST", path, agent: false, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } }, (response) => {
      response.once("data", () => {
        client.destroy()
        resolve()
      })
      response.on("error", () => resolve())
    })
    client.on("error", (error) => (client.destroyed ? resolve() : reject(error)))
    client.end(payload)
  })
}

// An allowlist of 1,000 explicit models: the resolution path of a large `models` option.
const bigCatalog: CatalogModel[] = Array.from({ length: 1_000 }, (_, i) => model(`prov${i}`, `model${i}`))
const bigOptions = testOptions({ models: bigCatalog.map((m) => `${m.providerID}/${m.id}`) })
const chatBody = { model: "test/echo", messages: [{ role: "user", content: "hello" }], temperature: 0.2, stream: false }
const chat = { model: "test/echo", messages: [{ role: "user", content: "hello" }] }

bench("chat completion, json", async () => {
  do_not_optimize((await post(plain, "/v1/chat/completions", chat)).status)
})

bench("chat completion, n=3 fan-out", async () => {
  do_not_optimize((await post(fanout, "/v1/chat/completions", { ...chat, n: 3 })).status)
})

bench("chat stream, time to first byte", async () => {
  await firstByte(streaming, "/v1/chat/completions", { ...chat, stream: true })
})

bench("chat stream, total", async () => {
  do_not_optimize((await post(streaming, "/v1/chat/completions", { ...chat, stream: true })).text)
})

bench("chat stream, 2,000 deltas", async () => {
  do_not_optimize((await post(long, "/v1/chat/completions", { ...chat, stream: true })).text)
})

bench("responses, json", async () => {
  do_not_optimize((await post(responses, "/v1/responses", { model: "test/echo", input: "hello" })).status)
})

bench("messages, json", async () => {
  do_not_optimize((await post(messages, "/v1/messages", { model: "test/echo", max_tokens: 64, messages: [{ role: "user", content: "hello" }] })).status)
})

bench("gemini generateContent, json", async () => {
  do_not_optimize((await post(gemini, "/v1beta/models/fast:generateContent", { contents: [{ role: "user", parts: [{ text: "hello" }] }] })).status)
})

bench("decode and validate a chat body", () => {
  do_not_optimize(parseChatRequest(chatBody, testOptions()))
})

const completionsBody = { model: "test/echo", prompt: "hello", temperature: 0.2, stream: false }

bench("decode and validate a legacy completions body", () => {
  do_not_optimize(parseCompletionsRequest(completionsBody, testOptions()))
})

bench("resolve a model in a 1,000-model allowlist", () => {
  do_not_optimize(resolveModel(bigOptions, "prov900/model900", bigCatalog))
})

bench("resolve a model in the test catalog", () => {
  do_not_optimize(resolveModel(testOptions(), "test/echo", CATALOG))
})

const { benchmarks } = await run({ print: write })
// The gate compares medians: means on a shared runner move with every GC pause (p99 is in milliseconds).
if (jsonFile) writeFileSync(jsonFile, `${JSON.stringify(benchmarks.map((trial) => ({ name: trial.runs[0]!.name, p50Ns: trial.runs[0]!.stats!.p50 })), null, 2)}\n`)
agent.destroy()
await Promise.all(servers.map((server) => server.close()))
