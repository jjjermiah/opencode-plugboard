/**
 * #263 `apps.<name>.maxOutputTokens`: a per-app ceiling on one answer's output tokens, on every route. It lowers the caller's
 * limit or sets one when none was sent, and never raises it. On Messages it lowers `max_tokens` before parsing, so the
 * thinking-budget rule refuses a cap that cannot hold the budget with the existing 400. Real loopback HTTP.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { ev } from "../support/fixtures.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const KEYS = { widget: "k-widget", bot: "k-bot" }
const options = { keys: KEYS, apps: { widget: { maxOutputTokens: 400 } }, aliases: { fast: "test/echo" } }

const bearer = (key: string) => ({ authorization: `Bearer ${key}` })
const chat = (key: string, body: Record<string, unknown> = {}): SendInit => ({
  method: "POST",
  path: "/v1/chat/completions",
  headers: bearer(key),
  body: { model: "test/echo", messages: [{ role: "user", content: "hi" }], ...body },
})
const responses = (key: string, body: Record<string, unknown> = {}): SendInit => ({
  method: "POST",
  path: "/v1/responses",
  headers: bearer(key),
  body: { model: "test/echo", input: "hi", ...body },
})
const completions = (key: string, body: Record<string, unknown> = {}): SendInit => ({
  method: "POST",
  path: "/v1/completions",
  headers: bearer(key),
  body: { model: "test/echo", prompt: "hi", ...body },
})
const messages = (key: string, body: Record<string, unknown> = {}): SendInit => ({
  method: "POST",
  path: "/v1/messages",
  headers: bearer(key),
  body: { model: "test/echo", max_tokens: 1000, messages: [{ role: "user", content: "hi" }], ...body },
})
const gemini = (key: string, generationConfig: Record<string, unknown> = {}): SendInit => ({
  method: "POST",
  path: "/v1beta/models/test%2Fecho:generateContent",
  headers: bearer(key),
  body: { contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig },
})

async function route() {
  const caller = new FakeModelCaller(() => [ev.text("answer"), ev.finish()])
  server = await startRoute({ caller, options })
  return caller
}

describe("#263 apps.<name>.maxOutputTokens on Chat Completions", () => {
  test("a caller with no limit gets the app's cap", async () => {
    const caller = await route()
    expect((await server!.send(chat(KEYS.widget))).status).toBe(200)
    expect(caller.call.request.generation.maxTokens).toBe(400)
  })

  test("a caller with a higher limit is lowered to the cap; the cap is never raised", async () => {
    const caller = await route()
    expect((await server!.send(chat(KEYS.widget, { max_tokens: 5000 }))).status).toBe(200)
    expect(caller.call.request.generation.maxTokens).toBe(400)
  })

  test("a caller with a lower limit keeps its own", async () => {
    const caller = await route()
    await server!.send(chat(KEYS.widget, { max_completion_tokens: 100 }))
    expect(caller.call.request.generation.maxTokens).toBe(100)
  })

  test("another app without the option keeps the caller's limit", async () => {
    const caller = await route()
    await server!.send(chat(KEYS.bot, { max_tokens: 5000 }))
    expect(caller.call.request.generation.maxTokens).toBe(5000)
  })
})

describe("#263 apps.<name>.maxOutputTokens on the other routes", () => {
  test("Responses: max_output_tokens is lowered to the cap, and a missing one is set", async () => {
    const caller = await route()
    await server!.send(responses(KEYS.widget, { max_output_tokens: 9000 }))
    expect(caller.call.request.generation.maxTokens).toBe(400)
    await server!.send(responses(KEYS.widget))
    expect(caller.calls[1]!.request.generation.maxTokens).toBe(400)
  })

  test("legacy completions: max_tokens is capped for each prompt", async () => {
    const caller = await route()
    expect((await server!.send(completions(KEYS.widget, { max_tokens: 9000 }))).status).toBe(200)
    expect(caller.call.request.generation.maxTokens).toBe(400)
  })

  test("Gemini: maxOutputTokens is capped, and a missing one is set", async () => {
    const caller = await route()
    await server!.send(gemini(KEYS.widget, { maxOutputTokens: 9000 }))
    expect(caller.call.request.generation.maxTokens).toBe(400)
    await server!.send(gemini(KEYS.widget))
    expect(caller.calls[1]!.request.generation.maxTokens).toBe(400)
  })

  test("Messages: max_tokens above the cap is lowered before the request is sent", async () => {
    const caller = await route()
    expect((await server!.send(messages(KEYS.widget, { max_tokens: 1000 }))).status).toBe(200)
    expect(caller.call.request.generation.maxTokens).toBe(400)
  })

  test("Messages: a thinking budget the cap cannot hold is the existing 400 and no model call", async () => {
    const caller = await route()
    const reply = await server!.send(messages(KEYS.widget, { max_tokens: 2000, thinking: { type: "enabled", budget_tokens: 1024 } }))
    expect(reply.status).toBe(400)
    expect(reply.json().error.message).toBe("thinking.budget_tokens: must be less than max_tokens")
    expect(caller.calls).toEqual([])
  })

  test("Messages: a thinking budget under the cap is kept, with the cap as max_tokens", async () => {
    // A cap of 4096 leaves room for the 1024 minimum budget; the 400 cap above would not.
    const caller = new FakeModelCaller(() => [ev.text("answer"), ev.finish()])
    server = await startRoute({ caller, options: { keys: KEYS, apps: { widget: { maxOutputTokens: 4096 } } } })
    expect((await server.send(messages(KEYS.widget, { max_tokens: 8000, thinking: { type: "enabled", budget_tokens: 1024 } }))).status).toBe(200)
    expect(caller.call.request.generation.maxTokens).toBe(4096)
  })
})

describe("#263 apps.<name>.maxOutputTokens at load", () => {
  test("the cap is an integer from 1 to 2147483647 and names its option", async () => {
    const { parseOptions } = await import("../../src/config.js")
    expect(() => parseOptions({ keys: KEYS, apps: { widget: { maxOutputTokens: 0 } } })).toThrow(/apps\.widget\.maxOutputTokens` must be an integer between 1 and 2147483647/)
    expect(() => parseOptions({ keys: KEYS, apps: { widget: { maxOutputTokens: 2147483648 } } })).toThrow(/maxOutputTokens/)
  })
})
