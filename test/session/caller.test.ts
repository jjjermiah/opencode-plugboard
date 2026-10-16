/**
 * The session-backed `ModelCaller` (src/session/caller.ts) against a fake host port and a real
 * session store: one request = one kept session. Abort is checked before every side effect (#40),
 * the backend gate comes before `session.create` (#35), and the response and the host execution
 * end separately (#33): the guard is retired, not dropped, when the response ends first.
 */
import { afterEach, describe, expect, test } from "bun:test"
import type { CallContext, PlugEvent, PlugRequest } from "../../src/contract.js"
import { setLogLevel } from "../../src/log.js"
import { createSessionCaller, type SessionCallerDeps } from "../../src/session/caller.js"
import { withStopSequences } from "../../src/stop.js"
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

describe("#77 the session link gets the session and its app directory", () => {
  test("#77 onRecord names the session and the app directory it lives in, for the link template", async () => {
    const run = setup()
    run.answer((id) => [bus(id).textDelta("Hi"), bus(id).stepEnded("stop"), bus(id).executionSucceeded()])
    const seen: Array<[string, string | undefined]> = []
    const context: CallContext = { app: "app", signal: new AbortController().signal, onRecord: (id, directory) => void seen.push([id, directory]) }
    await drain(run.caller.stream(plugRequest(), context))
    expect(seen).toEqual([["ses_1", (await ensureAppDir("app")) as string]])
  })
})

/** #262 the per-step debug lines: ids, counts and enums only, never prompt text, and none of them is built at `info`. */
describe("#262 the per-step debug lines", () => {
  afterEach(() => setLogLevel("info"))
  const STEP_EVENTS = ["request.received", "session.created", "model.first_event", "model.finished"]
  const stepLines = () => logs.lines.filter((line) => STEP_EVENTS.includes(line.event))

  test("at info, none of the step lines is written", async () => {
    const run = setup()
    run.answer((id) => [bus(id).textDelta("Hi"), bus(id).stepEnded("stop"), bus(id).executionSucceeded()])
    await drain(run.caller.stream(plugRequest({ model: "fast" }), run.context))
    expect(stepLines()).toEqual([])
  })

  test("at debug, the request, its session, the first model event and the finish are each one line", async () => {
    setLogLevel("debug")
    const run = setup()
    run.answer((id) => [bus(id).usage({ input: 12, output: 5 }), bus(id).textDelta("Hi"), bus(id).textDelta("!"), bus(id).stepEnded("stop"), bus(id).executionSucceeded()])
    await drain(run.caller.stream(plugRequest({ model: "fast" }), run.context))
    expect(logs.of("request.received")).toHaveLength(1)
    expect(logs.of("request.received")[0]!.fields).toMatchObject({ app: "app", model: "fast" })
    expect(logs.of("session.created")[0]!.fields).toMatchObject({ app: "app", sessionID: "ses_1" })
    expect(logs.of("model.first_event")).toHaveLength(1)
    expect(logs.of("model.first_event")[0]!.fields).toMatchObject({ type: "text-delta" })
    expect(logs.of("model.finished")[0]!.fields).toMatchObject({ finish: "stop", inputTokens: "12", outputTokens: "5" })
    expect(logs.of("model.finished")[0]!.fields.durationMs).toMatch(/^\d+$/)
    const raw = stepLines().map((line) => line.raw).join("\n")
    expect(raw).not.toContain("hello")
    expect(raw).not.toContain("Hi")
    expect(raw).not.toContain("!")
  })

  test("at debug, model.finished fires when the prompt cannot start: the outcome is the error, there is no finish reason", async () => {
    setLogLevel("debug")
    const run = setup()
    run.port.script.prompt = () => Promise.reject(new Error("host refused"))
    await drain(run.caller.stream(plugRequest({ model: "fast" }), run.context))
    expect(logs.of("model.finished")).toHaveLength(1)
    expect(logs.of("model.finished")[0]!.fields.outcome).toMatch(/^error:502:prompt_failed$/)
    expect(logs.of("model.finished")[0]!.fields.finish).toBeUndefined()
    expect(logs.of("model.finished")[0]!.fields.durationMs).toMatch(/^\d+$/)
  })

  test("at debug, model.finished fires on a cancelled request with outcome cancelled and no finish reason", async () => {
    setLogLevel("debug")
    const run = setup()
    run.port.script.prompt = () => new Promise<void>(() => {})
    const pending = drain(run.caller.stream(plugRequest({ model: "fast" }), run.context))
    await until(() => run.port.created.length === 1)
    run.controller.abort()
    await pending
    expect(logs.of("model.finished")).toHaveLength(1)
    expect(logs.of("model.finished")[0]!.fields.outcome).toBe("cancelled")
    expect(logs.of("model.finished")[0]!.fields.finish).toBeUndefined()
  })
})

describe("#57 the end user labels the session title", () => {
  test("#57 a kept end user is the title prefix `[user] ` before the first words of the prompt", async () => {
    const run = setup()
    run.answer((id) => [bus(id).textDelta("Hi"), bus(id).stepEnded("stop"), bus(id).executionSucceeded()])
    await drain(run.caller.stream(plugRequest({ user: "alice" }), run.context))
    expect(run.port.created[0]!.title).toBe("[alice] hello")
  })

  test("#57 without an end user the title is the first words, as before", async () => {
    const run = setup()
    run.answer((id) => [bus(id).textDelta("Hi"), bus(id).stepEnded("stop"), bus(id).executionSucceeded()])
    await drain(run.caller.stream(plugRequest(), run.context))
    expect(run.port.created[0]!.title).toBe("hello")
  })
})

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

  test("#172 a turn that stops with no text, reasoning or tool call logs answer.empty with its session id", async () => {
    const run = setup()
    run.answer((id) => [bus(id).stepEnded("stop"), bus(id).executionSucceeded()])
    await drain(run.caller.stream(plugRequest(), run.context))
    expect(logs.of("answer.empty")[0]!.fields).toMatchObject({ app: "app", sessionID: "ses_1", tools: "0" })
  })

  test("#172 a turn that answered in text does not log answer.empty", async () => {
    const run = setup()
    run.answer((id) => [bus(id).textDelta("Hi"), bus(id).stepEnded("stop"), bus(id).executionSucceeded()])
    await drain(run.caller.stream(plugRequest(), run.context))
    expect(logs.of("answer.empty")).toEqual([])
  })

  // The other tests compare against REQUEST_PERMISSIONS itself, so a flipped entry would pass them. Pin the list.
  test("I8 request sessions deny every tool, then allow only the seed tools", () => {
    expect(REQUEST_PERMISSIONS).toEqual([
      { action: "*", resource: "*", effect: "deny" },
      { action: "plugboard_seed_*", resource: "*", effect: "allow" },
    ])
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
    // #155: the session that lands after the abort is deleted, so no unindexed session is left behind.
    await until(() => run.port.removed.length > 0, 1_000, "the late session to be deleted")
    expect(run.port.removed).toEqual(["ses_late"])
    expect(run.sessions.size()).toBe(0)
    expect(run.port.prompted).toEqual([])
  })

  test("#155 a late session whose delete fails is logged, not thrown", async () => {
    const creating = gate<{ id: string }>()
    const asked = gate()
    const run = setup()
    run.port.script.create = () => (asked.open(), creating.promise)
    run.port.script.remove = () => Promise.reject(new Error("database locked"))
    const events = drain(run.caller.stream(plugRequest(), run.context))
    await asked.promise
    run.controller.abort()
    expect(await events).toEqual([])
    creating.open({ id: "ses_late" })
    await until(() => logs.of("session.late_remove_failed").length > 0, 1_000, "the failed delete to be logged")
    expect(logs.of("session.late_remove_failed")[0]!.fields.error).toBe("database locked")
  })

  test("#155 a create that fails after the abort leaves no session to delete", async () => {
    const asked = gate()
    let fail: (error: Error) => void = () => {}
    const run = setup()
    run.port.script.create = () => (asked.open(), new Promise((_resolve, reject) => (fail = reject)))
    const events = drain(run.caller.stream(plugRequest(), run.context))
    await asked.promise
    run.controller.abort()
    expect(await events).toEqual([])
    fail(new Error("create failed"))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(run.port.removed).toEqual([])
    expect(logs.of("session.late_remove_failed")).toEqual([])
  })

  test("session.create failing is a generic 502 backend_failed; the cause goes to the log", async () => {
    const run = setup()
    run.port.script.create = () => Promise.reject(new Error("db locked at /secret/path"))
    expect(await drain(run.caller.stream(plugRequest(), run.context))).toEqual([{ type: "error", error: { status: 502, kind: "server", message: "plugboard session backend failed", code: "backend_failed" } }])
    expect(logs.of("request.backend_failed")[0]!.fields.error).toBe("db locked at /secret/path")
  })
})

describe("#390 a stop sequence ends the answer: the run is interrupted and the stream still ends with its usage", () => {
  test("the stream stays open after the stop signal and ends with the step's finish and usage (the host ended the step, so no interrupt)", async () => {
    const run = setup()
    const stopping = new AbortController()
    run.answer((id) => [bus(id).textDelta("Hello END"), bus(id).usage({ input: 10, output: 500 }), bus(id).stepEnded("stop", { input: 10, output: 500 })])
    const context: CallContext = { ...run.context, stopAnswer: stopping.signal }
    const seen: PlugEvent[] = []
    for await (const event of run.caller.stream(plugRequest(), context)) {
      seen.push(event)
      if (event.type === "text-delta") stopping.abort()
    }
    expect(run.port.interrupted).toEqual([])
    expect(seen.at(-1)).toEqual({ type: "finish", reason: "stop", usage: { inputTokens: 10, outputTokens: 500 } })
  })
})

describe("#390 the host's interrupt of a stop-sequence run ends the answer with finish stop", () => {
  test("OpenCode 2.0.27 answers an interrupt with an aborted step failure (no tokens) and execution.interrupted: the answer ends with stop and the running usage", async () => {
    const run = setup({ settleMs: 30, stopDrainMs: 200 })
    run.port.script.interrupt = async (sessionID) => {
      run.sessions.dispatch(bus(sessionID).stepFailed({ type: "aborted", message: "Step interrupted" }))
      run.sessions.dispatch(bus(sessionID).executionInterrupted())
    }
    run.answer((id) => [bus(id).usage({ input: 10, output: 500 }), bus(id).textDelta("alpha END beta")])
    const events = await drain(withStopSequences(run.caller).stream(plugRequest({ generation: { stop: ["END"] } }), run.context))
    expect(events).toEqual([
      { type: "text-delta", text: "alpha " },
      { type: "finish", reason: "stop", usage: { inputTokens: 10, outputTokens: 500 }, stopSequence: "END" },
    ])
  })

  test("Anthropic order (2.0.27, live 2026-10-16): the host finishes the step itself inside the settle window, so the usage is the step's and nothing is interrupted", async () => {
    const run = setup({ settleMs: 200, stopDrainMs: 200 })
    // message_start carries the input tokens; the text runs past the sequence; message_delta carries the output and the step ends.
    run.answer((id) => {
      setTimeout(() => {
        run.sessions.dispatch(bus(id).stepEnded("stop", { input: 10, output: 500 }))
        run.sessions.dispatch(bus(id).executionSucceeded())
      }, 20)
      return [bus(id).usage({ input: 10 }), bus(id).textDelta("alpha END beta")]
    })
    const events = await drain(withStopSequences(run.caller).stream(plugRequest({ generation: { stop: ["END"] } }), run.context))
    expect(run.port.interrupted).toEqual([])
    expect(events).toEqual([
      { type: "text-delta", text: "alpha " },
      { type: "finish", reason: "stop", usage: { inputTokens: 10, outputTokens: 500 }, stopSequence: "END" },
    ])
  })

  test("Anthropic order, host still running after the settle window: it is interrupted, and the aborted step ends the answer with stop", async () => {
    const run = setup({ settleMs: 30, stopDrainMs: 200 })
    run.port.script.interrupt = async (sessionID) => {
      run.sessions.dispatch(bus(sessionID).stepFailed({ type: "aborted", message: "Step interrupted" }))
      run.sessions.dispatch(bus(sessionID).executionInterrupted())
    }
    run.answer((id) => [bus(id).usage({ input: 10 }), bus(id).textDelta("alpha END beta")])
    const events = await drain(withStopSequences(run.caller).stream(plugRequest({ generation: { stop: ["END"] } }), run.context))
    expect(run.port.interrupted).toEqual(["ses_1"])
    expect(events.at(-1)).toMatchObject({ type: "finish", reason: "stop", stopSequence: "END" })
  })

  test("a host failure inside the window, after the match, finishes as stop with a warning: the answer before the match is complete (#390 review)", async () => {
    const run = setup({ settleMs: 30, stopDrainMs: 200 })
    // The host reports asynchronously, as it does, and answers the interrupt once: a second failure would be a new interrupt, not the host.
    let answered = false
    run.port.script.interrupt = async (sessionID) => {
      if (answered) return
      answered = true
      await Promise.resolve()
      run.sessions.dispatch(bus(sessionID).stepFailed({ type: "provider.rate-limit", message: "org-1 slow down" }))
    }
    run.answer((id) => [bus(id).textDelta("alpha END beta")])
    const events = await drain(withStopSequences(run.caller).stream(plugRequest({ generation: { stop: ["END"] } }), run.context))
    expect(events).toEqual([{ type: "text-delta", text: "alpha " }, { type: "finish", reason: "stop", stopSequence: "END" }])
    expect(logs.of("request.stop_step_failed")).toHaveLength(1)
  })

  test("a tool call inside the window ends the run at once: nothing runs after the match, the host is interrupted now (#390 review)", async () => {
    const run = setup({ settleMs: 10_000, stopDrainMs: 10_000 })
    run.answer((id) => [bus(id).textDelta("alpha END beta"), bus(id).toolCalled("c1", "lookup", { q: 1 })])
    const started = Date.now()
    const events = await drain(withStopSequences(run.caller).stream(plugRequest({ generation: { stop: ["END"] } }), run.context))
    expect(Date.now() - started).toBeLessThan(2000)
    expect(run.port.interrupted).toEqual(["ses_1"])
    expect(events).toEqual([{ type: "text-delta", text: "alpha " }, { type: "finish", reason: "stop", usage: undefined, stopSequence: "END" }])
  })

  test("a host that never reports the end after the interrupt is closed by the drain, with the usage counted so far (#390)", async () => {
    const run = setup({ settleMs: 10, stopDrainMs: 20 })
    run.answer((id) => [bus(id).usage({ input: 7 }), bus(id).textDelta("alpha END beta")])
    const events = await drain(withStopSequences(run.caller).stream(plugRequest({ generation: { stop: ["END"] } }), run.context))
    expect(run.port.interrupted).toEqual(["ses_1"])
    expect(events.at(-1)).toEqual({ type: "finish", reason: "stop", usage: { inputTokens: 7, outputTokens: undefined }, stopSequence: "END" })
  })

  test("#390 a stop match close to the request deadline finishes as stop before the deadline, not after the settle window", async () => {
    // The deadline is 400 ms from the start; the window (2 s) and the drain (5 s) would both run past it. The window is clamped to the
    // time left, minus a margin, so the answer ends as stop before the route's 504 fires.
    const run = setup({ requestTimeoutMs: 400, settleMs: 2000, stopDrainMs: 5000 })
    run.answer((id) => [bus(id).usage({ input: 4 }), bus(id).textDelta("alpha END beta")])
    const started = Date.now()
    const events = await drain(withStopSequences(run.caller).stream(plugRequest({ generation: { stop: ["END"] } }), run.context))
    expect(Date.now() - started).toBeLessThan(400)
    expect(run.port.interrupted).toEqual(["ses_1"])
    expect(events.at(-1)).toMatchObject({ type: "finish", reason: "stop", stopSequence: "END", usage: { inputTokens: 4 } })
  })

  test("apps.<name>.settleMs 0 interrupts at once, so a step that never finishes is cut before the window", async () => {
    const run = setup({ stopDrainMs: 200, apps: { app: { settleMs: 0 } } as never })
    run.port.script.interrupt = async (sessionID) => {
      run.sessions.dispatch(bus(sessionID).stepFailed({ type: "aborted", message: "Step interrupted" }))
      run.sessions.dispatch(bus(sessionID).executionInterrupted())
    }
    run.answer((id) => [bus(id).textDelta("alpha END beta")])
    const started = Date.now()
    const events = await drain(withStopSequences(run.caller).stream(plugRequest({ generation: { stop: ["END"] } }), run.context))
    // Not the 2 s default: the answer ends as soon as the host reports the interrupt.
    expect(Date.now() - started).toBeLessThan(1000)
    expect(run.port.interrupted).toEqual(["ses_1"])
    expect(events.at(-1)).toMatchObject({ type: "finish", reason: "stop", stopSequence: "END" })
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
    const run = setup({ settleMs: 0 })
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
