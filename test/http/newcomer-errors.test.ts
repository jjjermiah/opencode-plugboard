/**
 * The first requests a newcomer gets wrong, over loopback HTTP: each refusal says what to do next, in the API's own error shape.
 * (The codes and statuses are pinned elsewhere; these tests pin the wording that points at the fix.)
 */
import { afterEach, describe, expect, test } from "bun:test"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

captureLogs()
let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const KEY = { authorization: "Bearer k-main" }
const OPTIONS = { models: "all", keys: { main: "k-main" } }

describe("a newcomer's first mistakes", () => {
  test("a wrong key says to use a plugboard key, not a provider key, on every API", async () => {
    server = await startRoute({ caller: new FakeModelCaller([]), options: OPTIONS })
    const chat = await server.send({ method: "POST", path: "/v1/chat/completions", headers: { authorization: "Bearer sk-provider" }, body: { model: "test/echo", messages: [] } })
    expect(chat.status).toBe(401)
    expect(chat.json().error.message).toBe("Missing or invalid API key. Use a key from the plugboard `keys` option, not a provider key.")
    const messages = await server.send({ method: "POST", path: "/v1/messages", headers: { "x-api-key": "sk-provider" }, body: { model: "test/echo", max_tokens: 1, messages: [] } })
    expect(messages.json().error.message).toContain("not a provider key")
    const gemini = await server.send({ method: "POST", path: "/v1beta/models/test%2Fecho:generateContent", headers: { "x-goog-api-key": "sk-provider" }, body: { contents: [] } })
    expect(gemini.json().error.message).toContain("not a provider key")
  })

  test("an unknown model says where the list is, on Chat, Messages and Gemini", async () => {
    server = await startRoute({ caller: new FakeModelCaller([]), options: OPTIONS })
    const body = { model: "gpt-4", messages: [{ role: "user", content: "hi" }] }
    const chat = await server.send({ method: "POST", path: "/v1/chat/completions", headers: KEY, body })
    expect(chat.status).toBe(404)
    expect(chat.json().error).toMatchObject({ code: "model_not_found", message: "Model gpt-4 is not available. GET /v1/models lists the models you can call." })
    const messages = await server.send({ method: "POST", path: "/v1/messages", headers: { "x-api-key": "k-main" }, body: { ...body, max_tokens: 1 } })
    expect(messages.json().error.message).toBe("Model gpt-4 is not available. GET /v1/models lists the models you can call.")
    const one = await server.send({ path: "/v1beta/models/gpt-4", headers: { "x-goog-api-key": "k-main" } })
    expect(one.status).toBe(404)
    expect(one.json().error.message).toBe("Model gpt-4 is not available. GET /v1beta/models lists the models you can call.")
    const listed = await server.send({ path: "/v1/models/gpt-4", headers: KEY })
    expect(listed.json().error.message).toBe("Model gpt-4 is not available. GET /v1/models lists the models you can call.")
  })

  test("an unknown model on a Gemini generate route points at /v1beta/models, not /v1/models", async () => {
    server = await startRoute({ caller: new FakeModelCaller([]), options: OPTIONS })
    const headers = { "x-goog-api-key": "k-main" }
    const expected = "Model gpt-4 is not available. GET /v1beta/models lists the models you can call."
    const generate = await server.send({ method: "POST", path: "/v1beta/models/gpt-4:generateContent", headers, body: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } })
    expect(generate.status).toBe(404)
    expect(generate.json().error).toMatchObject({ code: 404, status: "NOT_FOUND", message: expected })
    expect(generate.json().error.details[0].fieldViolations[0].description).toBe(expected)
    const stream = await server.send({ method: "POST", path: "/v1beta/models/gpt-4:streamGenerateContent", headers, body: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } })
    expect(stream.json().error.message).toBe(expected)
    const count = await server.send({ method: "POST", path: "/v1beta/models/gpt-4:countTokens", headers, body: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } })
    expect(count.json().error.message).toBe(expected)
  })

  test("no allowed models says what to write", async () => {
    server = await startRoute({ caller: new FakeModelCaller([]), options: { models: [], keys: { main: "k-main" } } })
    const reply = await server.send({ method: "POST", path: "/v1/chat/completions", headers: KEY, body: { model: "test/echo", messages: [{ role: "user", content: "hi" }] } })
    expect(reply.status).toBe(403)
    expect(reply.json().error.message).toBe('No models are allowed: set the plugboard `models` option, for example `"models": "all"`')
  })

  test("a GET on a POST route says which method the path takes; an unknown path adds nothing", async () => {
    server = await startRoute({ caller: new FakeModelCaller([]), options: OPTIONS })
    const wrong = await server.send({ path: "/v1/chat/completions", headers: KEY })
    expect(wrong.status).toBe(404)
    expect(wrong.json().error).toMatchObject({ code: "not_found", message: "No route for GET /v1/chat/completions. This path takes POST." })
    const unknown = await server.send({ path: "/v1/nothing", headers: KEY })
    expect(unknown.json().error.message).toBe("No route for GET /v1/nothing")
  })

  test("the setup page without a key tells a browser user how to see the models", async () => {
    server = await startRoute({ caller: new FakeModelCaller([]), options: OPTIONS })
    const page = (await server.send({ path: "/" })).text
    expect(page).toContain("A browser cannot send that header")
    expect(page).toMatch(/<code>curl -s http:\/\/127\.0\.0\.1:\d+\/v1 -H &quot;Authorization: Bearer \$PLUGBOARD_KEY&quot;<\/code>/)
    expect(page).not.toContain("`")
  })
})
