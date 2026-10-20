/**
 * Security review round 3 (since 0.37.0), the request surfaces added since: Codex's tool mapping on Responses (`namespace`, `custom`,
 * hosted tools, `additional_tools`, the flattened and hashed names), the two new response headers, and the error text of every API.
 *
 * Guarantees: a caller's tool name can never be the reserved `respond` tool or one of the app's server tools, whichever way it is
 * spelled; two spellings of one flattened name are a refusal, never a silent replacement; a header takes only fixed or checked
 * text; and a provider's or the host's error text never reaches a caller.
 */
import { afterEach, describe, expect, test } from "bun:test"
import type { IncomingMessage } from "node:http"
import type { PlugboardOptions } from "../../src/config.js"
import { clientRequestId } from "../../src/http.js"
import { createSessionCaller } from "../../src/session/caller.js"
import { createSessionStore } from "../../src/session/state.js"
import { ev } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller, type Script } from "../support/model-caller.js"
import { isolateRuntime } from "../support/runtime.js"
import { bus, FakeSessionPort } from "../support/session.js"

const logs = captureLogs()
isolateRuntime()

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

async function route(script: Script, options: Record<string, unknown> = {}) {
  const caller = new FakeModelCaller(script)
  server = await startRoute({ caller, options })
  return caller
}
const responses = (body: Record<string, unknown> = {}): SendInit => ({ method: "POST", path: "/v1/responses", body: { model: "test/echo", input: "hi", ...body } })
const fn = (name: string) => ({ type: "function", name, parameters: { type: "object", properties: {} } })
const space = (name: string, ...tools: unknown[]) => ({ type: "namespace", name, tools })
const SCHEMA = { type: "json_schema", name: "answer", schema: { type: "object", properties: { x: { type: "string" } } } }

// ---------------------------------------------------------------- the reserved `respond` tool

describe("security regression test: no spelling of a caller's tool is the reserved `respond` tool", () => {
  test.each([
    ["a function", [fn("respond")]],
    ["a custom tool", [{ type: "custom", name: "respond" }]],
    ["a namespace tool in the default namespace", [space("functions", fn("respond"))]],
    ["a namespace tool in the default namespace, custom", [space("functions", { type: "custom", name: "respond" })]],
  ])("%s named respond next to text.format json_schema is refused before any model call", async (_name, tools) => {
    const caller = await route([ev.text("{}"), ev.finish()])
    const direct = await server!.send(responses({ tools, text: { format: SCHEMA } }))
    expect(direct.status).toBe(400)
    expect(direct.json().error).toMatchObject({ code: "reserved_tool_name" })
    // The same tools declared in an additional_tools item (Codex's form for a model it knows) are refused the same way.
    const added = await server!.send(
      responses({
        input: [
          { type: "additional_tools", tools },
          { role: "user", content: "hi" },
        ],
        text: { format: SCHEMA },
      }),
    )
    expect(added.status).toBe(400)
    expect(added.json().error).toMatchObject({ code: "reserved_tool_name" })
    expect(caller.calls).toEqual([])
  })

  test("a tool called respond in another namespace is a different tool: its call comes back as that tool's, and is never the structured answer", async () => {
    const caller = await route([ev.call("call_1", "x__respond", { v: 1 }), ev.finish("tool-calls")])
    const reply = await server!.send(responses({ tools: [space("x", fn("respond"))], text: { format: SCHEMA } }))
    expect(reply.status).toBe(200)
    expect(caller.call.request.tools.map((tool) => tool.name).sort()).toEqual(["respond", "x__respond"])
    expect(reply.json().output).toEqual([{ id: expect.stringMatching(/^fc_/), type: "function_call", status: "completed", call_id: "call_1", name: "respond", namespace: "x", arguments: '{"v":1}' }])
  })

  test("a long name never shortens to `respond`, and a hashed name is 64 characters at most", async () => {
    const caller = await route([ev.text("{}"), ev.finish()])
    const reply = await server!.send(responses({ tools: [space("n".repeat(80), fn("respond"))], text: { format: SCHEMA } }))
    expect(reply.status).toBe(200)
    const names = caller.call.request.tools.map((tool) => tool.name)
    expect(names).toContain("respond")
    for (const name of names) expect(name.length).toBeLessThanOrEqual(64)
    expect(names.filter((name) => name !== "respond")).toHaveLength(1)
  })
})

// ---------------------------------------------------------------- two spellings of one flattened name

describe("security regression test: a flattened name is declared once", () => {
  test.each([
    ["namespace a with b__c, and namespace a__b with c", { tools: [space("a", fn("b__c")), space("a__b", fn("c"))] }],
    ["a function and the same name in the default namespace", { tools: [fn("x"), space("functions", fn("x"))] }],
    ["a function and a custom tool of one name", { tools: [fn("x"), { type: "custom", name: "x" }] }],
    ["a prefixed function and the namespace it spells", { tools: [fn("mcp__w__g"), space("mcp__w", fn("g"))] }],
    ["namespaces a__ and a with one tool name", { tools: [space("a__", fn("b")), space("a", fn("b"))] }],
    [
      "a tool in tools and the same in additional_tools",
      {
        tools: [fn("x")],
        input: [
          { type: "additional_tools", tools: [fn("x")] },
          { role: "user", content: "hi" },
        ],
      },
    ],
    [
      "a tool twice in one additional_tools item",
      {
        input: [
          { type: "additional_tools", tools: [fn("x"), fn("x")] },
          { role: "user", content: "hi" },
        ],
      },
    ],
  ])("%s is a 400 duplicate, and no declaration replaces another", async (_name, body) => {
    const caller = await route([ev.text("ok"), ev.finish()])
    const reply = await server!.send(responses(body))
    expect(reply.status).toBe(400)
    expect(reply.json().error.message).toContain("Duplicate tool name")
    expect(caller.calls).toEqual([])
  })

  test("two long names that share their first 55 characters stay apart, and the same name is the same in a call and in the history", async () => {
    const prefix = `mcp__${"s".repeat(60)}`
    const caller = await route([ev.text("ok"), ev.finish()])
    const tools = [space(prefix, fn("alpha_tool_with_a_long_name")), space(prefix, fn("beta_tool_with_a_long_name"))]
    const reply = await server!.send(responses({ tools }))
    expect(reply.status).toBe(200)
    const names = caller.call.request.tools.map((tool) => tool.name)
    expect(new Set(names).size).toBe(2)
    for (const name of names) expect(name.length).toBeLessThanOrEqual(64)
    // The history names the tool as the client declared it; it resolves to the flat name the model was offered, and only that one.
    const next = await server!.send(
      responses({
        tools,
        input: [
          { role: "user", content: "go" },
          { type: "function_call", call_id: "c1", name: "alpha_tool_with_a_long_name", namespace: prefix, arguments: "{}" },
          { type: "function_call_output", call_id: "c1", output: "done" },
        ],
      }),
    )
    expect(next.status).toBe(200)
    expect(caller.calls[1]!.request.messages[1]).toMatchObject({ content: [{ type: "tool-call", name: names[0] }] })
  })

  test("a result answers only a call an earlier item made", async () => {
    const caller = await route([ev.text("ok"), ev.finish()])
    const reply = await server!.send(
      responses({
        input: [
          { role: "user", content: "go" },
          { type: "function_call_output", call_id: "never-made", output: "x" },
        ],
      }),
    )
    expect(reply.status).toBe(400)
    expect(caller.calls).toEqual([])
  })
})

// ---------------------------------------------------------------- a caller's tool and the app's server tools

describe("security regression test: a caller's tool never names one of the app's server tools", () => {
  const OPTIONS = { keys: { r3srv: "key-r3srv" }, apps: { r3srv: { opencodeTools: ["read"] } } }
  const APPS: PlugboardOptions["apps"] = { r3srv: { systemMode: "prepend", tools: true, opencodeTools: ["read"], maxToolSteps: 2, maxToolCalls: 3 } }
  const KEY = { authorization: "Bearer key-r3srv" }

  async function sessionRoute() {
    const port = new FakeSessionPort()
    port.toolIDs.push("read")
    port.operatorRules = [{ action: "*", resource: "*", effect: "allow" }]
    const sessions = createSessionStore()
    port.script.prompt = async (input) => {
      queueMicrotask(() => {
        const host = bus(input.sessionID)
        for (const event of [host.textDelta("ok"), host.stepEnded("stop"), host.executionSucceeded()]) sessions.dispatch(event)
      })
    }
    server = await startRoute({ caller: createSessionCaller({ port, sessions, maxTools: 4, apps: APPS }), options: OPTIONS })
    return port
  }

  test.each([
    ["a function", { tools: [fn("read")] }],
    ["a custom tool", { tools: [{ type: "custom", name: "read" }] }],
    ["a namespace tool in the default namespace", { tools: [space("functions", fn("read"))] }],
    [
      "a tool of an additional_tools item",
      {
        input: [
          { type: "additional_tools", tools: [fn("read")] },
          { role: "user", content: "hi" },
        ],
      },
    ],
    [
      "a namespace tool of an additional_tools item",
      {
        input: [
          { type: "additional_tools", tools: [space("functions", fn("read"))] },
          { role: "user", content: "hi" },
        ],
      },
    ],
  ])("on Responses, %s named read is refused and no session is made", async (_name, body) => {
    const port = await sessionRoute()
    const reply = await server!.send({ ...responses(body), headers: KEY })
    expect(reply.status).toBe(400)
    expect(reply.json().error).toMatchObject({ code: "server_tool_collision" })
    expect(port.created).toEqual([])
  })

  test("on Chat, Messages and Gemini too, and a tool in a namespace of its own is a different name that is allowed", async () => {
    const port = await sessionRoute()
    const chat = await server!.send({
      method: "POST",
      path: "/v1/chat/completions",
      headers: KEY,
      body: { model: "test/echo", messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }] },
    })
    const messages = await server!.send({
      method: "POST",
      path: "/v1/messages",
      headers: KEY,
      body: { model: "test/echo", max_tokens: 16, messages: [{ role: "user", content: "hi" }], tools: [{ name: "read", input_schema: { type: "object" } }] },
    })
    const gemini = await server!.send({
      method: "POST",
      path: "/v1beta/models/test%2Fecho:generateContent",
      headers: KEY,
      body: { contents: [{ parts: [{ text: "hi" }] }], tools: [{ functionDeclarations: [{ name: "read" }] }] },
    })
    expect([chat.status, messages.status, gemini.status]).toEqual([400, 400, 400])
    expect(port.created).toEqual([])
    const allowed = await server!.send({ ...responses({ tools: [space("mcp", fn("read"))] }), headers: KEY })
    expect(allowed.status).toBe(200)
    expect(port.created).toHaveLength(1)
  })
})

// ---------------------------------------------------------------- app names that are Object properties

describe("security regression test: an app named like an Object property is an ordinary app", () => {
  test("`constructor` gets none of the endpoint list, body cap or retention another app is configured with, and nothing of the object it is looked up in", async () => {
    const caller = await route([ev.text("ok"), ev.finish()], {
      keys: { constructor: "k-ctor", other: "k-other" },
      apps: { other: { endpoints: ["chat"], sessions: { maxAgeDays: 2 } } },
      limits: { apps: { other: { maxBodyBytes: 1024 } } },
    })
    const as = (key: string) => ({ authorization: `Bearer ${key}` })
    const files = (key: string) => server!.send({ path: "/v1/files", headers: as(key) })
    expect((await files("k-ctor")).status).toBe(200)
    expect((await files("k-other")).status).toBe(403)
    const big = { model: "test/echo", messages: [{ role: "user", content: "x".repeat(4000) }] }
    expect((await server!.send({ method: "POST", path: "/v1/chat/completions", headers: as("k-ctor"), body: big })).status).toBe(200)
    expect((await server!.send({ method: "POST", path: "/v1/chat/completions", headers: as("k-other"), body: big })).status).toBe(413)
    expect(caller.calls).toHaveLength(1)
    // Its own app: a file it holds is its own, and expires on the default retention.
    const boundary = "R3"
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nuser_data\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n\r\nhello\r\n--${boundary}--\r\n`,
    )
    const made = await server!.send({ method: "POST", path: "/v1/files", headers: { ...as("k-ctor"), "content-type": `multipart/form-data; boundary=${boundary}` }, body })
    expect(made.status).toBe(200)
    expect(made.json().expires_at - made.json().created_at).toBe(30 * 86_400)
    expect((await server!.send({ path: `/v1/files/${made.json().id}`, headers: as("k-other") })).status).toBe(403)
  })
})

// ---------------------------------------------------------------- headers

describe("security regression test: response headers take fixed or checked text", () => {
  test("x-plugboard-dropped-tools names only the fixed hosted types, whatever type the caller wrote", async () => {
    const caller = await route([ev.text("ok"), ev.finish()])
    const hostile = ["web_search\r\nx-injected: 1", "web_search, x-evil", "WEB_SEARCH", "web search", "web_search\u0000", "x".repeat(5000), "../web_search"]
    for (const type of hostile) {
      const reply = await server!.send(responses({ tools: [fn("a"), { type }] }))
      expect(reply.status).toBe(400)
      expect(reply.headers["x-plugboard-dropped-tools"]).toBeUndefined()
      expect(reply.headers["x-injected"]).toBeUndefined()
    }
    expect(caller.calls).toEqual([])
    const hosted = ["web_search", "web_search_preview", "web_search_preview_2025_03_11", "file_search", "code_interpreter", "image_generation", "mcp"].map((type) => ({ type }))
    const reply = await server!.send(responses({ tools: [fn("a"), ...hosted] }))
    expect(reply.status).toBe(200)
    expect(String(reply.headers["x-plugboard-dropped-tools"])).toBe("web_search,web_search_preview,web_search_preview_2025_03_11,file_search,code_interpreter,image_generation,mcp")
    expect(String(reply.headers["x-plugboard-dropped-tools"])).toMatch(/^[a-z0-9_,]+$/)
  })

  test("x-request-id is echoed only as one value of 1 to 128 safe characters: a line break, a percent-encoded one and a repeated header are not", () => {
    const sent = (value: unknown) => clientRequestId({ headers: { "x-request-id": value } } as unknown as IncomingMessage)
    expect(sent("abc-123")).toBe("abc-123")
    for (const value of [
      "abc\n",
      "abc\r\nx-injected: 1",
      "\nabc",
      "abc\u0000",
      "abc%0d%0ax",
      "abc def",
      "abc,def",
      "a\tb",
      "\u0661\u0662\u0663",
      "a\u2028b",
      "",
      "a".repeat(129),
      ["a", "b"],
      undefined,
      12,
    ])
      expect(sent(value)).toBeUndefined()
  })

  test("a caller's x-request-id and x-plugboard-request-id never reach a log line or a header in another shape", async () => {
    await route([ev.text("ok"), ev.finish()])
    const reply = await server!.send({
      method: "POST",
      path: "/v1/chat/completions",
      headers: { "x-request-id": "gw:1/a_b.c+d=e-f" },
      body: { model: "test/echo", messages: [{ role: "user", content: "hi" }] },
    })
    expect(reply.headers["x-request-id"]).toBe("gw:1/a_b.c+d=e-f")
    for (const line of logs.lines) expect(line.raw).not.toMatch(/[\r\u0000-\u0008\u000b\u000c\u000e-\u001f]/)
  })
})

// ---------------------------------------------------------------- error text

describe("security regression test: a provider's or the host's error text never reaches a caller", () => {
  const CANARIES = ["https://internal.example.test/v1/secret", "sk-canary-0123456789", "org-canary-456", "/home/canary/.local/share/opencode/auth.json", "acct-canary-789"]
  const LEAK = CANARIES.join(" ")

  const hostErrors = [
    ["a provider failure with a server status", { type: "provider.internal", status: 500, message: LEAK, response: { body: LEAK } }],
    ["a provider rejection", { type: "provider.invalid-request", status: 400, message: LEAK, response: { body: LEAK } }],
    ["a provider sign-in failure", { type: "provider.auth", status: 401, message: LEAK, response: { body: LEAK } }],
    ["a rate limit", { type: "provider.rate-limit", status: 429, message: LEAK, response: { body: LEAK } }],
    ["a context overflow", { type: "provider.invalid-request", status: 400, message: `context length exceeded ${LEAK}`, response: { body: LEAK } }],
    ["an unclassified host error", { type: "something.new", message: LEAK, response: { body: LEAK } }],
    ["a provider error with no status", { type: "provider.other", message: `${LEAK} overloaded`, response: { body: LEAK } }],
  ] as const

  /** One request to each API, streamed or not, answered by a host whose session fails with `error`. */
  async function every(failure: (host: ReturnType<typeof bus>) => ReturnType<typeof bus>["stepFailed"][]) {
    const port = new FakeSessionPort()
    const sessions = createSessionStore()
    port.script.prompt = async (input) => {
      queueMicrotask(() => {
        for (const event of failure(bus(input.sessionID)) as unknown as Parameters<typeof sessions.dispatch>[0][]) sessions.dispatch(event)
      })
    }
    server = await startRoute({ caller: createSessionCaller({ port, sessions, maxTools: 4 }), options: {} })
    const text: Array<[string, string]> = []
    for (const stream of [false, true]) {
      const sends: Array<[string, SendInit]> = [
        ["chat", { method: "POST", path: "/v1/chat/completions", body: { model: "test/echo", stream, messages: [{ role: "user", content: "hi" }] } }],
        ["completions", { method: "POST", path: "/v1/completions", body: { model: "test/echo", stream, prompt: "hi" } }],
        ["responses", { method: "POST", path: "/v1/responses", body: { model: "test/echo", stream, input: "hi" } }],
        ["messages", { method: "POST", path: "/v1/messages", body: { model: "test/echo", stream, max_tokens: 16, messages: [{ role: "user", content: "hi" }] } }],
        ["gemini", { method: "POST", path: `/v1beta/models/test%2Fecho:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`, body: { contents: [{ parts: [{ text: "hi" }] }] } }],
      ]
      for (const [api, init] of sends) {
        const reply = await server.send(init)
        text.push([`${api}${stream ? " (stream)" : ""}`, `${reply.text}\n${JSON.stringify(reply.headers)}`])
      }
    }
    return text
  }

  test.each(hostErrors)("%s answers a fixed message on every API, streamed or not", async (_name, error) => {
    const answers = await every((host) => [host.stepFailed(error), host.executionFailed(error)] as never)
    expect(answers).toHaveLength(10)
    for (const [api, text] of answers) {
      for (const canary of CANARIES) expect(text, `${api} leaked ${canary}`).not.toContain(canary)
    }
    // The operator's log is where the text goes, and a request id leads to it.
    expect(logs.lines.some((line) => line.raw.includes("canary"))).toBe(true)
  })

  test("a host that fails to create or start the session answers a fixed message too", async () => {
    for (const where of ["create", "prompt"] as const) {
      const port = new FakeSessionPort()
      port.script[where] = async () => {
        throw new Error(`${LEAK} ENOENT`)
      }
      server = await startRoute({ caller: createSessionCaller({ port, sessions: createSessionStore(), maxTools: 4 }), options: {} })
      const replies = [
        await server.send({ method: "POST", path: "/v1/chat/completions", body: { model: "test/echo", messages: [{ role: "user", content: "hi" }] } }),
        await server.send({ method: "POST", path: "/v1/responses", body: { model: "test/echo", input: "hi", stream: true } }),
        await server.send({ method: "POST", path: "/v1/messages", body: { model: "test/echo", max_tokens: 16, messages: [{ role: "user", content: "hi" }] } }),
        await server.send({ method: "POST", path: "/v1beta/models/test%2Fecho:generateContent", body: { contents: [{ parts: [{ text: "hi" }] }] } }),
      ]
      for (const reply of replies) {
        expect(reply.status).toBeGreaterThanOrEqual(500)
        for (const canary of CANARIES) expect(reply.text, `${where} leaked ${canary}`).not.toContain(canary)
      }
      await server.close()
      server = undefined
    }
  })
})
