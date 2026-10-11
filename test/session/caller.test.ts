/**
 * The session-backed `ModelCaller` (src/session/caller.ts) against a fake host port and a real
 * session store: one request = one kept session. Abort is checked before every side effect (#40),
 * the backend gate comes before `session.create` (#35), and the response and the host execution
 * end separately (#33): the guard is retired, not dropped, when the response ends first.
 */
import { describe, expect, test } from "bun:test"
import type { CallContext, PlugEvent, PlugRequest } from "../../src/contract.js"
import { createSessionCaller, type SessionCallerDeps } from "../../src/session/caller.js"
import { ensureAppDir } from "../../src/session/history.js"
import { REQUEST_PERMISSIONS } from "../../src/session/seeds.js"
import { createSessionStore } from "../../src/session/state.js"
import { gate, plugRequest, until } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { bus, FakeSessionPort, type BusEnvelope } from "../support/session.js"

const logs = captureLogs()

/** A caller over a fake port; `host(events)` makes the prompt answer with these bus events. */
function setup(deps: Partial<SessionCallerDeps> = {}) {
  const port = new FakeSessionPort()
  const sessions = createSessionStore()
  const caller = createSessionCaller({ port, sessions, maxTools: 2, ...deps })
  const controller = new AbortController()
  const records: string[] = []
  const context: CallContext = { app: "app", signal: controller.signal, onRecord: (id) => void records.push(id) }
  const answer = (events: (sessionID: string) => BusEnvelope[]) => {
    port.script.prompt = async (input) => {
      queueMicrotask(() => events(input.sessionID).forEach((event) => sessions.dispatch(event)))
    }
  }
  return { port, sessions, caller, controller, context, records, answer }
}

async function drain(stream: AsyncIterable<PlugEvent>): Promise<PlugEvent[]> {
  const out: PlugEvent[] = []
  for await (const event of stream) out.push(event)
  return out
}

describe("one request, one kept session", () => {
  test("creates the session in the app directory with the request permissions, registers it, reports it, then prompts", async () => {
    const run = setup()
    let registeredAtPrompt = false
    run.port.script.prompt = async (input) => {
      registeredAtPrompt = run.sessions.lookup(input.sessionID) !== undefined
      queueMicrotask(() => [bus(input.sessionID).textDelta("Hi"), bus(input.sessionID).stepEnded("stop"), bus(input.sessionID).executionSucceeded()].forEach((event) => run.sessions.dispatch(event)))
    }
    const request: PlugRequest = plugRequest({ model: "fast", ref: { providerID: "test", id: "echo", variant: "low" }, system: ["be brief"] })
    const events = await drain(run.caller.stream(request, run.context))

    expect(events).toEqual([{ type: "text-delta", text: "Hi" }, { type: "finish", reason: "stop", usage: undefined }])
    const [created] = run.port.created
    expect(created).toMatchObject({
      id: "ses_1",
      directory: (await ensureAppDir("app")) as string,
      model: { providerID: "test", id: "echo", variant: "low" },
      title: "hello",
      permissions: REQUEST_PERMISSIONS,
      metadata: { plugboard: { app: "app", model: "fast", requestID: expect.any(String) } },
    })
    expect(registeredAtPrompt).toBe(true)
    expect(run.records).toEqual(["ses_1"])
    expect(run.port.prompted).toEqual([{ sessionID: "ses_1", text: "## system\nbe brief\n\n## user\nhello", files: [] }])
    // The turn settled and the execution ended: nothing to interrupt, and the guard is gone.
    expect(run.port.interrupted).toEqual([])
    expect(run.sessions.lookup("ses_1")).toBeUndefined()
    expect(logs.of("request.finished")[0]!.fields).toMatchObject({ app: "app", model: "fast", outcome: "finish:stop" })
  })

  test("data URL images become prompt files named by position", async () => {
    const run = setup()
    run.answer((id) => [bus(id).stepEnded(), bus(id).executionSucceeded()])
    const request = plugRequest({ messages: [{ role: "user", content: [{ type: "media", url: "data:image/png;base64,AA" }, { type: "text", text: "what?" }, { type: "media", url: "data:image/jpeg;base64,BB" }] }] })
    await drain(run.caller.stream(request, run.context))
    expect(run.port.prompted[0]!.files).toEqual([
      { uri: "data:image/png;base64,AA", name: "image-1" },
      { uri: "data:image/jpeg;base64,BB", name: "image-2" },
    ])
  })
})

describe("failures before anything is created", () => {
  test("an invalid app name is a 400 invalid_app", async () => {
    const run = setup()
    expect(await drain(run.caller.stream(plugRequest(), { ...run.context, app: "Bad App" }))).toEqual([{ type: "error", error: { status: 400, kind: "invalid_request", message: "Invalid app name: Bad App", code: "invalid_app" } }])
    expect(run.port.created).toEqual([])
  })

  test("more tools than the seed pool is a 400 backend_preparation_failed on tools", async () => {
    const run = setup()
    const tool = (name: string) => ({ name, description: "", parameters: {} })
    const [event] = await drain(run.caller.stream(plugRequest({ tools: [tool("a"), tool("b"), tool("c")] }), run.context))
    expect(event).toMatchObject({ type: "error", error: { status: 400, code: "backend_preparation_failed", param: "tools" } })
    expect(run.port.created).toEqual([])
  })

  test("a named tool_choice needs only one seed", async () => {
    const run = setup()
    run.answer((id) => [bus(id).stepEnded(), bus(id).executionSucceeded()])
    const tool = (name: string) => ({ name, description: "", parameters: {} })
    await drain(run.caller.stream(plugRequest({ tools: [tool("a"), tool("b"), tool("c")], toolChoice: { type: "tool", name: "b" } }), run.context))
    expect(run.port.created).toHaveLength(1)
  })

  test("a remote image while remoteImages is off is a 400 remote_images_disabled", async () => {
    const run = setup()
    const [event] = await drain(run.caller.stream(plugRequest({ messages: [{ role: "user", content: [{ type: "media", url: "https://example.com/a.png" }] }] }), run.context))
    expect(event).toMatchObject({ type: "error", error: { status: 400, code: "remote_images_disabled" } })
  })

  test("#35 the backend gate's error ends the request before session.create", async () => {
    const run = setup({ ensureBackend: async () => ({ status: 503, kind: "server", code: "backend_unavailable", message: "no" }) })
    expect(await drain(run.caller.stream(plugRequest(), run.context))).toEqual([{ type: "error", error: { status: 503, kind: "server", code: "backend_unavailable", message: "no" } }])
    expect(run.port.created).toEqual([])
  })

  test("#40 a request aborted while the backend gate runs never creates a session", async () => {
    const run = setup({ ensureBackend: async () => void run.controller.abort() })
    expect(await drain(run.caller.stream(plugRequest(), run.context))).toEqual([])
    expect(run.port.created).toEqual([])
  })

  test("#40 a request aborted while session.create hangs ends at once and registers nothing", async () => {
    const creating = gate<{ id: string }>()
    const asked = gate()
    const run = setup()
    run.port.script.create = () => (asked.open(), creating.promise)
    const events = drain(run.caller.stream(plugRequest(), run.context))
    await asked.promise
    run.controller.abort()
    expect(await events).toEqual([])
    creating.open({ id: "ses_late" })
    expect(run.sessions.size()).toBe(0)
    expect(run.port.prompted).toEqual([])
  })

  test("session.create failing is a generic 502 backend_failed; the cause goes to the log", async () => {
    const run = setup()
    run.port.script.create = () => Promise.reject(new Error("db locked at /secret/path"))
    expect(await drain(run.caller.stream(plugRequest(), run.context))).toEqual([{ type: "error", error: { status: 502, kind: "server", message: "plugboard session backend failed", code: "backend_failed" } }])
    expect(logs.of("request.backend_failed")[0]!.fields.error).toBe("db locked at /secret/path")
  })
})

describe("#33 the response and the host execution end separately", () => {
  test("a tool-call turn interrupts once at the step end, and the guard is retired until the execution ends", async () => {
    const run = setup()
    run.answer((id) => [bus(id).toolCalled("c1", "lookup", { q: 1 }), bus(id).stepEnded("tool-calls")])
    const events = await drain(run.caller.stream(plugRequest(), run.context))
    expect(events).toEqual([{ type: "tool-call", id: "c1", name: "lookup", input: { q: 1 } }, { type: "finish", reason: "tool-calls", usage: undefined }])
    expect(run.port.interrupted).toEqual(["ses_1"])
    expect(run.sessions.lookup("ses_1")).toBeDefined()
    run.sessions.dispatch(bus("ses_1").executionInterrupted())
    expect(run.sessions.lookup("ses_1")).toBeUndefined()
  })

  test("a consumer that stops reading early interrupts the running turn and retires the guard", async () => {
    const run = setup()
    run.answer((id) => [bus(id).textDelta("first")])
    for await (const event of run.caller.stream(plugRequest(), run.context)) if (event.type === "text-delta") break
    expect(run.port.interrupted).toEqual(["ses_1"])
    expect(run.sessions.lookup("ses_1")).toBeDefined()
  })

  test("a client abort mid-stream ends the stream without a terminal event and interrupts", async () => {
    const run = setup()
    run.answer((id) => [bus(id).textDelta("first")])
    const seen: PlugEvent[] = []
    for await (const event of run.caller.stream(plugRequest(), run.context)) {
      seen.push(event)
      run.controller.abort()
    }
    expect(seen).toEqual([{ type: "text-delta", text: "first" }])
    expect(run.port.interrupted).toEqual(["ses_1"])
    await until(() => logs.of("request.finished").length === 1)
    expect(logs.of("request.finished")[0]!.fields.outcome).toBe("cancelled")
  })

  test("a failed step stops the turn; the error reaches the caller in its safe form", async () => {
    const run = setup()
    run.answer((id) => [bus(id).stepFailed({ type: "provider.rate-limit", message: "org-1 slow down" })])
    const events = await drain(run.caller.stream(plugRequest(), run.context))
    expect(events).toEqual([{ type: "error", error: { status: 429, kind: "rate_limit", code: "rate_limited", message: "The model provider is rate limiting requests; retry later" } }])
    expect(run.port.interrupted).toEqual(["ses_1"])
  })

  test("a prompt that cannot start fails the request with prompt_failed", async () => {
    const run = setup()
    run.port.script.prompt = () => Promise.reject(new Error("host refused"))
    const events = await drain(run.caller.stream(plugRequest(), run.context))
    expect(events).toEqual([{ type: "error", error: { status: 502, kind: "server", code: "prompt_failed", message: "Could not start the model session" } }])
    expect(logs.of("session.prompt_failed")[0]!.fields.error).toBe("host refused")
  })

  test("an interrupt that fails is logged, never thrown", async () => {
    const run = setup()
    run.port.script.interrupt = () => Promise.reject(new Error("gone"))
    run.answer((id) => [bus(id).toolCalled("c1", "f"), bus(id).stepEnded("tool-calls")])
    await drain(run.caller.stream(plugRequest(), run.context))
    await until(() => logs.of("session.interrupt_failed").length === 1)
  })
})
