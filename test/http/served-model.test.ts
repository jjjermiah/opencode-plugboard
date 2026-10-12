/**
 * `x-plugboard-model` over loopback HTTP (#279): every answer names the model that answered, whether the
 * request named an alias or the canonical id, on every front-end and in both json and stream. The caller
 * is the real `withFallbacks` wrapper around a fake model caller, as in `index.ts`.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { parseOptions } from "../../src/config.js"
import { withFallbacks } from "../../src/fallback.js"
import { CATALOG, ev } from "../support/fixtures.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

const ALIASES = { aliases: { fast: "test/echo" } }

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

async function start(): Promise<RouteServer> {
  const options = parseOptions({ models: ["test/*"], ...ALIASES })
  const caller = withFallbacks(
    new FakeModelCaller(() => [ev.text("hi"), ev.finish()]),
    { options, loadCatalog: async () => CATALOG },
  )
  server = await startRoute({ caller, options: ALIASES })
  return server
}

const message = [{ role: "user", content: "hi" }]
const routes: ReadonlyArray<readonly [string, (model: string, stream: boolean) => SendInit]> = [
  ["chat", (model, stream) => ({ method: "POST", path: "/v1/chat/completions", body: { model, stream, messages: message } })],
  ["responses", (model, stream) => ({ method: "POST", path: "/v1/responses", body: { model, stream, input: "hi" } })],
  ["messages", (model, stream) => ({ method: "POST", path: "/v1/messages", body: { model, stream, max_tokens: 8, messages: message } })],
  ["completions", (model, stream) => ({ method: "POST", path: "/v1/completions", body: { model, stream, prompt: "hi" } })],
  [
    "gemini",
    (model, stream) => ({
      method: "POST",
      path: `/v1beta/models/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`,
      body: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
    }),
  ],
]

const cases = routes.flatMap(([name, make]) =>
  [false, true].flatMap((stream) => ["fast", "test/echo"].map((model) => [`${name} ${stream ? "stream" : "json"} ${model}`, make, stream, model] as const)),
)

describe("#279 x-plugboard-model names the model that answered", () => {
  test.each(cases)("#279 %s", async (_name, make, stream, model) => {
    const srv = await start()
    const reply = await srv.send(make(model, stream))
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-model"]).toBe("test/echo")
    expect(reply.headers).not.toHaveProperty("x-plugboard-fallbacks")
  })

  test("#279 an alias keeps its name in the chat body: only a list alias echoes its target there", async () => {
    const srv = await start()
    const reply = await srv.send(routes[0]![1]("fast", false))
    expect(reply.json()).toMatchObject({ model: "fast" })
  })
})
