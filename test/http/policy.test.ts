/**
 * #78 #51 per-app policy on the wire: `x-plugboard-policy` on every front-end, the model lists
 * scoped to the calling key, and the real session caller behind the real route (404 outside the
 * scope, tools stripped). The enforcement itself is in test/session/policy.test.ts.
 */
import { afterEach, describe, expect, test } from "bun:test"
import type { ModelCaller } from "../../src/contract.js"
import { createSessionCaller } from "../../src/session/caller.js"
import { createSessionStore } from "../../src/session/state.js"
import { ev } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { sseData, startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { bus, FakeSessionPort } from "../support/session.js"

captureLogs()
let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const OPTIONS = {
  models: ["test/*", "other/*"],
  maxN: 2,
  aliases: { fast: "test/echo#low" },
  keys: { open: "k-open" },
  apps: { bot: { key: "k-bot", models: ["fast"], tools: false, system: "Be brief." } },
}
const BOT = { authorization: "Bearer k-bot" }
const OPEN = { authorization: "Bearer k-open" }
const TOOLS_STRIPPED = [{ policy: ["tools-stripped" as const] }]

async function route(script: ConstructorParameters<typeof FakeModelCaller>[0]) {
  const caller = new FakeModelCaller(script)
  server = await startRoute({ caller, options: OPTIONS })
  return caller
}

const post = (path: string, body: Record<string, unknown>, headers: Record<string, string> = OPEN): SendInit => ({ method: "POST", path, headers, body })
const FRONT_ENDS: Array<[string, SendInit]> = [
  ["chat completions", post("/v1/chat/completions", { model: "test/echo", messages: [{ role: "user", content: "hi" }] })],
  ["chat completions, n = 2", post("/v1/chat/completions", { model: "test/echo", n: 2, messages: [{ role: "user", content: "hi" }] })],
  ["legacy completions", post("/v1/completions", { model: "test/echo", prompt: "hi" })],
  ["responses", post("/v1/responses", { model: "test/echo", input: "hi" })],
  ["anthropic messages", post("/v1/messages", { model: "test/echo", max_tokens: 8, messages: [{ role: "user", content: "hi" }] })],
  ["gemini generateContent", post("/v1beta/models/test%2Fecho:generateContent", { contents: [{ role: "user", parts: [{ text: "hi" }] }] })],
]

describe("x-plugboard-policy on every front-end", () => {
  test.each(FRONT_ENDS)("%s: the header says tools were stripped", async (_name, init) => {
    // Two calls for n = 2; the first writer wins, so the value is not repeated.
    await route(() => [...TOOLS_STRIPPED, ev.text("ok"), ev.finish()])
    const reply = await server!.send(init)
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-policy"]).toBe("tools-stripped")
  })

  test.each(FRONT_ENDS)("%s: no header when the policy changed nothing", async (_name, init) => {
    await route(() => [ev.text("ok"), ev.finish()])
    expect((await server!.send(init)).headers["x-plugboard-policy"]).toBeUndefined()
  })

  test("a streamed answer carries it too (chat and gemini)", async () => {
    await route(() => [...TOOLS_STRIPPED, ev.text("ok"), ev.finish()])
    const chat = await server!.open(post("/v1/chat/completions", { model: "test/echo", stream: true, messages: [{ role: "user", content: "hi" }] }))
    expect(chat.headers["x-plugboard-policy"]).toBe("tools-stripped")
    expect(sseData(await chat.ended).length).toBeGreaterThan(0)
    const gemini = await server!.open(post("/v1beta/models/test%2Fecho:streamGenerateContent?alt=sse", { contents: [{ role: "user", parts: [{ text: "hi" }] }] }))
    expect(gemini.headers["x-plugboard-policy"]).toBe("tools-stripped")
    await gemini.ended
  })
})

describe("model lists show only what the calling app may use", () => {
  const ids = (list: Array<{ id: string }>) => list.map((m) => m.id)

  test("/v1/models: a scoped key sees its models, an unscoped key sees them all", async () => {
    await route([])
    expect(ids((await server!.send({ path: "/v1/models", headers: BOT })).json().data)).toEqual(["fast"])
    expect(ids((await server!.send({ path: "/v1/models", headers: OPEN })).json().data)).toEqual(expect.arrayContaining(["test/echo", "test/echo#low", "test/vision", "other/model", "fast"]))
  })

  test("/v1/models/{id}: a model outside the scope is the 404 model_not_found, inside it is served", async () => {
    await route([])
    const hidden = await server!.send({ path: "/v1/models/test%2Fecho", headers: BOT })
    expect(hidden.status).toBe(404)
    expect(hidden.json().error).toMatchObject({ code: "model_not_found", param: "model" })
    expect((await server!.send({ path: "/v1/models/fast", headers: BOT })).json()).toMatchObject({ id: "fast" })
    expect((await server!.send({ path: "/v1/models/test%2Fecho", headers: OPEN })).status).toBe(200)
  })

  test("GET /v1beta/models and /v1beta/models/{model} follow the same scope", async () => {
    await route([])
    const list = await server!.send({ path: "/v1beta/models", headers: BOT })
    expect(list.json().models.map((m: { name: string }) => m.name)).toEqual(["models/fast"])
    expect((await server!.send({ path: "/v1beta/models/fast", headers: BOT })).status).toBe(200)
    const hidden = await server!.send({ path: "/v1beta/models/test%2Fecho", headers: BOT })
    expect(hidden.status).toBe(404)
    expect(hidden.json().error).toMatchObject({ code: 404 })
    expect((await server!.send({ path: "/v1beta/models/test%2Fecho", headers: OPEN })).status).toBe(200)
  })

  test("the setup page and /plugboard/status count only the caller's models", async () => {
    await route([])
    expect((await server!.send({ path: "/v1", headers: BOT })).json().models).toMatchObject({ available: 1 })
    expect((await server!.send({ path: "/v1", headers: OPEN })).json().models.available).toBeGreaterThan(1)
    expect((await server!.send({ path: "/plugboard/status", headers: BOT })).json().models).toMatchObject({ available: 1 })
  })
})

describe("the real session caller behind the route", () => {
  async function real() {
    const port = new FakeSessionPort()
    const sessions = createSessionStore()
    const seen: Array<{ tools: number; system: readonly string[] }> = []
    port.script.prompt = async (input) => {
      const { request } = sessions.lookup(input.sessionID)!
      seen.push({ tools: request.tools.length, system: request.system })
      queueMicrotask(() => [bus(input.sessionID).textDelta("ok"), bus(input.sessionID).stepEnded("stop"), bus(input.sessionID).executionSucceeded()].forEach((event) => sessions.dispatch(event)))
    }
    const caller = createSessionCaller({ port, sessions, maxTools: 4, apps: { bot: { models: ["fast"], tools: false, systemMode: "prepend", system: "Be brief." } } })
    server = await startRoute({ caller, options: OPTIONS })
    return { port, seen }
  }

  const withTools = { tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }] }

  test("a model outside the scope is a 404 on every front-end, and no session is created", async () => {
    const { port } = await real()
    const bodies: Array<[string, SendInit, (reply: any) => unknown]> = [
      ["chat", post("/v1/chat/completions", { model: "test/vision", messages: [{ role: "user", content: "hi" }] }, BOT), (r) => r.error.code],
      ["responses", post("/v1/responses", { model: "test/vision", input: "hi" }, BOT), (r) => r.error.code],
      ["completions", post("/v1/completions", { model: "test/vision", prompt: "hi" }, BOT), (r) => r.error.code],
      ["messages", post("/v1/messages", { model: "test/vision", max_tokens: 8, messages: [{ role: "user", content: "hi" }] }, BOT), (r) => r.error.type],
      ["gemini", post("/v1beta/models/test%2Fvision:generateContent", { contents: [{ role: "user", parts: [{ text: "hi" }] }] }, BOT), (r) => r.error.code],
    ]
    const expected: Record<string, unknown> = { chat: "model_not_found", responses: "model_not_found", completions: "model_not_found", messages: "not_found_error", gemini: 404 }
    for (const [name, init, pick] of bodies) {
      const reply = await server!.send(init)
      expect({ name, status: reply.status, error: pick(reply.json()) }).toEqual({ name, status: 404, error: expected[name] })
    }
    expect(port.created).toEqual([])
  })

  test("an in-scope request with tools succeeds without them, and says so", async () => {
    const { port, seen } = await real()
    const reply = await server!.send(post("/v1/chat/completions", { model: "fast", messages: [{ role: "system", content: "caller" }, { role: "user", content: "hi" }], ...withTools }, BOT))
    expect(reply.status).toBe(200)
    expect(reply.json().choices[0].message.content).toBe("ok")
    expect(reply.headers["x-plugboard-policy"]).toBe("tools-stripped")
    expect(port.created).toHaveLength(1)
    expect(seen).toEqual([{ tools: 0, system: ["caller"] }])
  })

  test("an unscoped caller of the same route is untouched", async () => {
    const { seen } = await real()
    const reply = await server!.send(post("/v1/chat/completions", { model: "test/vision", messages: [{ role: "user", content: "hi" }], ...withTools }))
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-policy"]).toBeUndefined()
    expect(seen).toEqual([{ tools: 1, system: [] }])
  })
})

describe("x-plugboard-server-tools on the wire (#82)", () => {
  /** A caller whose every call ran two server tools, as a trusted app's session reports them. */
  const ranTwo: ModelCaller = {
    async *stream(_request, context) {
      context.onServerTools?.(2)
      yield { type: "text-delta", text: "ok" }
      yield { type: "finish", reason: "stop" }
    },
  }
  const chat = (extra: Record<string, unknown> = {}) => post("/v1/chat/completions", { model: "test/echo", messages: [{ role: "user", content: "hi" }], ...extra })

  test("a non-streaming answer carries the count of its server tool calls", async () => {
    server = await startRoute({ caller: ranTwo, options: OPTIONS })
    const reply = await server.send(chat())
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-server-tools"]).toBe("2")
  })

  test("the choices of n add their counts", async () => {
    server = await startRoute({ caller: ranTwo, options: OPTIONS })
    expect((await server.send(chat({ n: 2 }))).headers["x-plugboard-server-tools"]).toBe("4")
  })

  test("a stream gets no header", async () => {
    server = await startRoute({ caller: ranTwo, options: OPTIONS })
    const open = await server.open(chat({ stream: true }))
    expect(open.headers["x-plugboard-server-tools"]).toBeUndefined()
    expect(sseData(await open.ended).length).toBeGreaterThan(0)
  })
})
