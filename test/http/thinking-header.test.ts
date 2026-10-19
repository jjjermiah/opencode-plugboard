/**
 * #410 `x-plugboard-thinking: unavailable` on every front-end that takes a reasoning effort, not only Messages:
 * Chat Completions (`reasoning_effort`), Responses (`reasoning.effort`) and Gemini (`thinkingConfig`). `none` asks
 * for no thinking, so it never sets the header.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { ev, model } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

captureLogs()
let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const NO_THINKING = [model("anthropic", "claude-haiku-4-5", { variants: ["fast"] })]
const THINKING = [model("anthropic", "claude-haiku-4-5", { variants: ["high", "max"] })]
const MODEL = "anthropic/claude-haiku-4-5"

/** One request per front-end that takes an effort: `effort` undefined sends none. */
const FRONT_ENDS: Array<[string, (effort?: string) => SendInit]> = [
  [
    "Chat Completions",
    (effort) => ({ method: "POST", path: "/v1/chat/completions", body: { model: MODEL, messages: [{ role: "user", content: "hi" }], ...(effort ? { reasoning_effort: effort } : {}) } }),
  ],
  ["Responses", (effort) => ({ method: "POST", path: "/v1/responses", body: { model: MODEL, input: "hi", ...(effort ? { reasoning: { effort } } : {}) } })],
  [
    "Gemini",
    (effort) => ({
      method: "POST",
      path: "/v1beta/models/anthropic%2Fclaude-haiku-4-5:generateContent",
      body: { contents: [{ role: "user", parts: [{ text: "hi" }] }], ...(effort ? { generationConfig: { thinkingConfig: { thinkingLevel: effort } } } : {}) },
    }),
  ],
]

async function serve(catalog: typeof NO_THINKING) {
  server = await startRoute({ caller: new FakeModelCaller([ev.finish()]), options: { models: ["anthropic/*"] }, catalog })
}

describe("#410 x-plugboard-thinking on every front-end with a reasoning effort", () => {
  test.each(FRONT_ENDS)("%s: a requested effort on a model with no thinking variant says unavailable", async (_name, request) => {
    await serve(NO_THINKING)
    const reply = await server!.send(request("low"))
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-thinking"]).toBe("unavailable")
  })

  test.each(FRONT_ENDS)("%s: a requested effort that the model can run never gets the header", async (_name, request) => {
    await serve(THINKING)
    const reply = await server!.send(request("low"))
    expect(reply.status).toBe(200)
    expect(reply.headers).not.toHaveProperty("x-plugboard-thinking")
  })

  test.each(FRONT_ENDS)("%s: no effort, or effort none, never gets the header", async (_name, request) => {
    await serve(NO_THINKING)
    expect((await server!.send(request())).headers).not.toHaveProperty("x-plugboard-thinking")
    expect((await server!.send(request("none"))).headers).not.toHaveProperty("x-plugboard-thinking")
  })
})
