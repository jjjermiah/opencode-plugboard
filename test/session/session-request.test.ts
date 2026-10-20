/**
 * #201 `sessionRequest`, the request as the session sends it for a count: the same pure refusals as `stream`, the
 * app's tool policy (`tools: false`), the tools the session offers (`seedToolsFor`), and the server tools with the
 * operator's grant. The route tests (test/http/messages.test.ts, gemini.test.ts) cover the same through HTTP.
 */
import { describe, expect, test } from "bun:test"
import { appPolicy, type AppPolicy } from "../../src/config.js"
import type { PlugError, PlugTool } from "../../src/contract.js"
import { isPlugError } from "../../src/contract.js"
import { sessionRequest, type SessionPromptDeps } from "../../src/session/caller.js"
import { plugRequest, testOptions } from "../support/fixtures.js"
import { FakeSessionPort } from "../support/session.js"

const signal = new AbortController().signal
const policy = (app: Record<string, unknown>): AppPolicy | undefined => appPolicy(testOptions({ keys: { app: "secret" }, apps: { app } }), "app")
const tool = (name: string): PlugTool => ({ name, description: `${name} tool`, parameters: { type: "object" } })
const hosted = (port: FakeSessionPort): SessionPromptDeps => ({ port, persona: () => undefined })
const websearch = (port: FakeSessionPort = new FakeSessionPort()): FakeSessionPort => {
  port.toolIDs.push("websearch")
  port.toolSchemas.set("websearch", { description: "Search the web", input: { type: "object" } })
  return port
}
const refusal = (result: unknown): PlugError => {
  expect(isPlugError(result)).toBe(true)
  return result as PlugError
}

describe("#201 the app's tool policy: tools: false", () => {
  test("the caller's tools and the steering sentence are dropped with them", async () => {
    const request = plugRequest({ system: ["Caller."], tools: [tool("a")], toolChoice: "required" })
    const counted = await sessionRequest(undefined, "app", request, policy({ tools: false }), signal)
    expect(counted).toMatchObject({ system: ["Caller."], tools: [] })
  })

  test("a structured answer's tool stays, forced, with its steering sentence", async () => {
    const request = plugRequest({ system: ["Caller."], tools: [tool("respond"), tool("a")], structuredTool: "respond", toolChoice: { type: "tool", name: "respond" } })
    const counted = await sessionRequest(undefined, "app", request, policy({ tools: false }), signal)
    expect(counted).toMatchObject({ system: ["Caller.", "You must respond by calling the `respond` tool."], tools: [tool("respond")] })
  })
})

describe("#201 the refusals the request makes, before any host read", () => {
  test("a model outside the app's models is the 404 model_not_found the request gets", async () => {
    const result = await sessionRequest(undefined, "app", plugRequest(), policy({ allowedModels: ["other/model"] }), signal)
    expect(refusal(result)).toMatchObject({ status: 404, code: "model_not_found" })
  })

  test("more caller tools than the app's maxTools is the 400 too_many_tools the request gets", async () => {
    const result = await sessionRequest(undefined, "app", plugRequest({ tools: [tool("a"), tool("b")] }), policy({ maxTools: 1 }), signal)
    expect(refusal(result)).toMatchObject({ status: 400, code: "too_many_tools" })
  })

  test("a caller tool named like a server tool is the 400 opencode_tool_collision the request gets", async () => {
    const result = await sessionRequest(hosted(websearch()), "app", plugRequest({ tools: [tool("websearch")] }), policy({ opencodeTools: ["websearch"] }), signal)
    expect(refusal(result)).toMatchObject({ status: 400, code: "opencode_tool_collision" })
  })

  test("a server tool the operator's agent does not grant is the 400 opencode_tool_denied_by_operator the request gets", async () => {
    const port = websearch()
    port.operatorRules = []
    const result = await sessionRequest(hosted(port), "app", plugRequest(), policy({ opencodeTools: ["websearch"] }), signal)
    expect(refusal(result)).toMatchObject({ status: 400, code: "opencode_tool_denied_by_operator" })
  })
})

describe("#201 the tools the session offers", () => {
  test("a granted server tool is counted with its schema", async () => {
    const counted = await sessionRequest(hosted(websearch()), "app", plugRequest(), policy({ opencodeTools: ["websearch"] }), signal)
    expect(counted).toMatchObject({ tools: [{ name: "websearch", description: "Search the web", parameters: { type: "object" } }] })
  })

  test("tool_choice none offers no caller tool and no server tool", async () => {
    const request = plugRequest({ tools: [tool("a")], toolChoice: "none" })
    const counted = await sessionRequest(hosted(websearch()), "app", request, policy({ opencodeTools: ["websearch"] }), signal)
    expect(counted).toMatchObject({ tools: [] })
  })

  test("tools: false keeps tool_choice none: no server tool is offered (#421, SHOULD 3)", async () => {
    const request = plugRequest({ tools: [tool("a")], toolChoice: "none" })
    const counted = await sessionRequest(hosted(websearch()), "app", request, policy({ opencodeTools: ["websearch"], tools: false }), signal)
    expect(counted).toMatchObject({ tools: [] })
  })

  test("a named tool choice offers only that caller tool, with its steering sentence", async () => {
    const request = plugRequest({ tools: [tool("a"), tool("b")], toolChoice: { type: "tool", name: "b" } })
    const counted = await sessionRequest(undefined, "app", request, undefined, signal)
    expect(counted).toMatchObject({ tools: [tool("b")], system: ["You must respond by calling the `b` tool."] })
  })

  test("without a session the count covers the request and the policy alone: no server tools, no persona", async () => {
    const request = plugRequest({ system: ["Caller."], tools: [tool("a")] })
    const counted = await sessionRequest(undefined, "app", request, policy({ opencodeTools: ["websearch"], system: "Policy.", systemMode: "prepend" }), signal)
    expect(counted).toMatchObject({ system: ["Policy.", "Caller."], tools: [tool("a")] })
  })
})
