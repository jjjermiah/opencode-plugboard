/**
 * `x-plugboard-affinity` on the wire (#80): an app whose `promptCache` is `anchor` gets the header on every front-end,
 * with its request sessions parented by the anchor; an app without the option gets neither the header nor a parent.
 * The policy itself is in test/session/affinity.test.ts.
 */
import { afterEach, describe, expect, test } from "bun:test"
import type { AppPolicy } from "../../src/config.js"
import { createAffinity } from "../../src/session/affinity.js"
import { createSessionCaller } from "../../src/session/caller.js"
import { createSessionStore } from "../../src/session/state.js"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { bus, FakeSessionPort } from "../support/session.js"
import { FakeStorage } from "../support/usage.js"

captureLogs()
let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const OPTIONS = {
  models: ["test/*"],
  keys: { bot: "k-bot", plain: "k-plain" },
  apps: { bot: { promptCache: { affinity: "anchor", scope: "app" } } },
}
const BOT = { authorization: "Bearer k-bot" }
const PLAIN = { authorization: "Bearer k-plain" }
const APPS = {
  bot: { systemMode: "prepend", tools: true, promptCache: { affinity: "anchor", scope: "app" } },
} as Record<string, AppPolicy>

async function real() {
  const port = new FakeSessionPort()
  const sessions = createSessionStore()
  port.script.prompt = async (input) => {
    queueMicrotask(() => [bus(input.sessionID).textDelta("ok"), bus(input.sessionID).stepEnded("stop"), bus(input.sessionID).executionSucceeded()].forEach((event) => sessions.dispatch(event)))
  }
  const caller = createSessionCaller({ port, sessions, maxTools: 4, apps: APPS, affinity: createAffinity({ storage: new FakeStorage() }) })
  server = await startRoute({ caller, options: OPTIONS })
  return { port }
}

const message = [{ role: "user", content: "hi" }]
const requests: Array<[string, SendInit]> = [
  ["chat", { method: "POST", path: "/v1/chat/completions", headers: {}, body: { model: "test/echo", messages: message } }],
  ["responses", { method: "POST", path: "/v1/responses", headers: {}, body: { model: "test/echo", input: "hi" } }],
  ["messages", { method: "POST", path: "/v1/messages", headers: {}, body: { model: "test/echo", max_tokens: 8, messages: message } }],
  ["gemini", { method: "POST", path: "/v1beta/models/test%2Fecho:generateContent", headers: {}, body: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } }],
]

describe("x-plugboard-affinity: anchor apps", () => {
  for (const [name, init] of requests) {
    test(`${name}: the header is anchor and the request session is a child of the anchor`, async () => {
      const { port } = await real()
      const reply = await server!.send({ ...init, headers: BOT })
      expect(reply.status).toBe(200)
      expect(reply.headers["x-plugboard-affinity"]).toBe("anchor")
      const [anchor, child] = port.created
      expect(anchor!.title).toBe("plugboard anchor: bot")
      expect(child!.parentID).toBe(anchor!.id)
    })
  }
})

describe("x-plugboard-affinity: apps without the option", () => {
  test("no header and no anchor: the request session is top-level, as before", async () => {
    const { port } = await real()
    const reply = await server!.send({ method: "POST", path: "/v1/chat/completions", headers: PLAIN, body: { model: "test/echo", messages: message } })
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-affinity"]).toBeUndefined()
    expect(port.created).toHaveLength(1)
    expect(port.created[0]!.parentID).toBeUndefined()
  })
})
