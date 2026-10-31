/**
 * The size fields of the request log line over loopback HTTP: a request with a system prompt, messages and tools logs the right counts
 * and byte sizes on every model route, and `body_bytes` is the body as it arrived.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { ev } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

const logs = captureLogs()

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

async function start(): Promise<RouteServer> {
  server = await startRoute({ caller: new FakeModelCaller([ev.text("hi"), ev.finish()]), options: {} })
  return server
}

const TOOL = { name: "lookup", description: "Find a thing", parameters: { type: "object", properties: { q: { type: "string" } } } }
/** The decoded tool as the model caller gets it: name, description and schema. */
const TOOL_JSON = '{"name":"lookup","description":"Find a thing","parameters":{"type":"object","properties":{"q":{"type":"string"}}}}'

describe("request log sizes", () => {
  test("a chat request with tools logs its counts, the tool bytes and the body bytes", async () => {
    const srv = await start()
    const body = JSON.stringify({
      model: "test/echo",
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
      ],
      tools: [
        { type: "function", function: TOOL },
        { type: "function", function: { ...TOOL, name: "other" } },
      ],
    })
    const reply = await srv.send({ method: "POST", path: "/v1/chat/completions", body })
    expect(reply.status).toBe(200)
    const fields = logs.of("request")[0]!.fields
    expect(fields).toMatchObject({ body_bytes: String(Buffer.byteLength(body)), system_count: "1", message_count: "1", tool_count: "2" })
    expect(Number(fields.system_bytes)).toBe(Buffer.byteLength('["be brief"]'))
    expect(Number(fields.tool_bytes)).toBe(Buffer.byteLength(`[${TOOL_JSON},${TOOL_JSON.replace('"lookup"', '"other"')}]`))
    expect(Number(fields.message_bytes)).toBeGreaterThan(0)
  })

  test("a request with no tools logs zero tools and zero tool bytes", async () => {
    const srv = await start()
    await srv.send({ method: "POST", path: "/v1/chat/completions", body: { model: "test/echo", messages: [{ role: "user", content: "hi" }] } })
    expect(logs.of("request")[0]!.fields).toMatchObject({ tool_count: "0", tool_bytes: "0", system_count: "0", system_bytes: "0", message_count: "1" })
  })

  test.each([
    ["Responses", "/v1/responses", { model: "test/echo", input: "hi", instructions: "be brief", tools: [{ type: "function", ...TOOL }] }],
    [
      "Messages",
      "/v1/messages",
      {
        model: "test/echo",
        max_tokens: 8,
        system: "be brief",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ name: TOOL.name, description: TOOL.description, input_schema: TOOL.parameters }],
      },
    ],
    [
      "Gemini",
      "/v1beta/models/test%2Fecho:generateContent",
      {
        systemInstruction: { parts: [{ text: "be brief" }] },
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [{ functionDeclarations: [{ name: TOOL.name, description: TOOL.description, parameters: TOOL.parameters }] }],
      },
    ],
  ])("%s logs the sizes too", async (_name, path, body) => {
    const srv = await start()
    await srv.send({ method: "POST", path, body })
    const fields = logs.of("request")[0]!.fields
    expect(fields).toMatchObject({ body_bytes: String(Buffer.byteLength(JSON.stringify(body))), system_count: "1", tool_count: "1", tool_bytes: String(Buffer.byteLength(`[${TOOL_JSON}]`)) })
  })

  test("a completions body with several prompts logs the sum of them, not the first", async () => {
    server = await startRoute({ caller: new FakeModelCaller([ev.text("hi"), ev.finish()]), options: { maxChoices: 3 } })
    const srv = server
    await srv.send({ method: "POST", path: "/v1/completions", body: { model: "test/echo", prompt: ["a", "b", "c"] } })
    expect(logs.of("request")[0]!.fields).toMatchObject({ message_count: "3" })
  })

  test("a refused request has no sizes, and a route that reads no body has none", async () => {
    const srv = await start()
    await srv.send({ method: "POST", path: "/v1/chat/completions", body: { messages: [] } })
    await srv.send({ method: "GET", path: "/v1/models" })
    for (const line of logs.of("request")) expect(line.fields).not.toHaveProperty("tool_bytes")
  })
})
