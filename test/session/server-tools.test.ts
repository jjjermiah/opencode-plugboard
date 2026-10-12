/**
 * #82 `apps.<name>.serverTools`: a trusted app's request sessions may run a named list of OpenCode
 * tools themselves. Covers the session permissions (pinned lists, the untrusted one stays deny-all),
 * the request-time checks (a listed tool the location does not offer, a caller tool named like a server
 * tool), the context hook (the host's own descriptors are kept and dropped for `tool_choice` none), the
 * collector's step classification (server-only steps continue, mixed steps return to the caller), the
 * step cap, and the `server_tool.call` log lines, which never carry arguments.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { AppPolicy, PlugboardOptions } from "../../src/config.js"
import type { CallContext, ModelCaller, PlugEvent, PlugRequest } from "../../src/contract.js"
import { cachedCaller, createCacheStore } from "../../src/cache.js"
import { createSessionCaller, type SessionCallerDeps } from "../../src/session/caller.js"
import { installSessionHooks } from "../../src/session/context.js"
import { createSessionPort, type ContextHookEvent, type HostToolDescriptor } from "../../src/session/host.js"
import { RequestCollector } from "../../src/session/events.js"
import { reportServerTools } from "../../src/policy.js"
import type { ServerResponse } from "node:http"
import { REQUEST_PERMISSIONS, requestPermissions } from "../../src/session/seeds.js"
import { createSessionStore } from "../../src/session/state.js"
import { collect, plugRequest } from "../support/fixtures.js"
import { spyContext } from "../support/plugin-context.js"
import { captureLogs } from "../support/logs.js"
import { bus, FakeSessionPort, type BusEnvelope } from "../support/session.js"

const logs = captureLogs()

type Rule = { action: string; resource: string; effect: "allow" | "deny" }

/** The deny-all list every request session gets without `serverTools`. */
const UNTRUSTED: Rule[] = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "plugboard_seed_*", resource: "*", effect: "allow" },
]

describe("session permissions", () => {
  test("#82 an app without serverTools gets exactly the deny-all list, and nothing else", () => {
    expect(REQUEST_PERMISSIONS).toEqual(UNTRUSTED)
    expect(requestPermissions([])).toEqual(UNTRUSTED)
  })

  test("#82 a trusted app gets deny-all, the seeds, then one exact allow per listed id, in that order", () => {
    const allow = (action: string): Rule => ({ action, resource: "*", effect: "allow" })
    expect(requestPermissions(["websearch", "read"])).toEqual([...UNTRUSTED, allow("websearch"), allow("read")])
  })
})

/** A caller over a fake port with one app; `policy` sets its policy, `null` configures no app at all. */
function setup(policy: Partial<AppPolicy> | null = { serverTools: ["websearch"] }, deps: Partial<SessionCallerDeps> = {}) {
  const port = new FakeSessionPort()
  const sessions = createSessionStore()
  const apps: PlugboardOptions["apps"] = policy ? { app: { systemMode: "prepend", tools: true, ...policy } } : {}
  const caller = createSessionCaller({ port, sessions, maxTools: 4, apps, ...deps })
  const controller = new AbortController()
  const context: CallContext = { app: "app", signal: controller.signal }
  const answer = (events: (sessionID: string) => BusEnvelope[]) => {
    port.script.prompt = async (input) => {
      queueMicrotask(() => events(input.sessionID).forEach((event) => sessions.dispatch(event)))
    }
  }
  return { port, sessions, caller, context, answer }
}

async function drain(stream: AsyncIterable<PlugEvent>): Promise<PlugEvent[]> {
  const out: PlugEvent[] = []
  for await (const event of stream) out.push(event)
  return out
}

const tool = (name: string) => ({ name, description: `${name} tool`, parameters: { type: "object", properties: {} } })

describe("request-time checks (#82)", () => {
  test("a trusted app's session is created with exactly its listed ids allowed", async () => {
    const run = setup({ serverTools: ["websearch"] })
    run.port.toolIDs.push("websearch")
    run.answer((id) => [bus(id).textDelta("Hi"), bus(id).stepEnded("stop"), bus(id).executionSucceeded()])
    await drain(run.caller.stream(plugRequest(), run.context))
    expect(run.port.created[0]?.permissions).toEqual(requestPermissions(["websearch"]))
  })

  test("an untrusted app's session gets deny-all, and no tool list is read", async () => {
    const run = setup(null)
    run.answer((id) => [bus(id).textDelta("Hi"), bus(id).stepEnded("stop"), bus(id).executionSucceeded()])
    await drain(run.caller.stream(plugRequest(), run.context))
    expect(run.port.created[0]?.permissions).toEqual(UNTRUSTED)
  })

  test("a listed tool the location does not offer is a 400 server_tool_unavailable, before any session exists", async () => {
    const run = setup({ serverTools: ["websearch", "missing_tool"] })
    run.port.toolIDs.push("websearch")
    const events = await drain(run.caller.stream(plugRequest(), run.context))
    expect(events).toEqual([
      {
        type: "error",
        error: {
          status: 400,
          kind: "invalid_request",
          code: "server_tool_unavailable",
          message:
            "OpenCode tool(s) not available in this location: missing_tool (option `apps.<name>.serverTools`). CodeMode tools, including MCP tools by default, cannot be listed; set codemode: false on the tool",
        },
      },
    ])
    expect(run.port.created).toEqual([])
  })

  test("a caller tool named like a server tool is a 400 server_tool_collision, before any session exists", async () => {
    const run = setup({ serverTools: ["websearch"] })
    run.port.toolIDs.push("websearch")
    const events = await drain(run.caller.stream(plugRequest({ tools: [tool("websearch")] }), run.context))
    expect(events).toEqual([{ type: "error", error: expect.objectContaining({ status: 400, code: "server_tool_collision" }) }])
    expect(run.port.created).toEqual([])
  })
})

/** Installs the hooks for an app with `serverTools` and returns a runner for the context hook. */
function hook(request: PlugRequest, serverTools: ReadonlyArray<string>) {
  const sessions = createSessionStore()
  sessions.register({ sessionID: "ses_1", app: "app", requestID: "r", request, collector: { push: () => {} } })
  const spy = spyContext({ directory: "/data/app" })
  const apps: PlugboardOptions["apps"] = { app: { systemMode: "prepend", tools: true, serverTools } }
  Effect.runSync(Effect.scoped(installSessionHooks(spy.ctx, { maxTools: 4, sessions, active: () => true, apps })))
  return (event: ContextHookEvent) => {
    Effect.runSync(spy.registered<(event: unknown) => Effect.Effect<void>>("session.hook")(event))
    return event
  }
}

const seeds = (): Record<string, HostToolDescriptor> =>
  Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`plugboard_seed_${index}`, { description: "placeholder", input: {} }]))

describe("the context hook keeps the server tools (#82)", () => {
  test("the host's own descriptor for a listed tool is kept by identity, next to the re-keyed seeds", () => {
    const search: HostToolDescriptor = { description: "Search the web", input: { type: "object" } }
    const run = hook(plugRequest({ tools: [tool("lookup")] }), ["websearch"])
    const event: ContextHookEvent = { sessionID: "ses_1", system: [], tools: { ...seeds(), websearch: search } }
    run(event)
    expect(Object.keys(event.tools ?? {}).sort()).toEqual(["lookup", "websearch"])
    expect(event.tools?.websearch).toBe(search)
  })

  test("a listed tool is not offered when the caller set tool_choice none", () => {
    const run = hook(plugRequest({ tools: [tool("lookup")], toolChoice: "none" }), ["websearch"])
    const event: ContextHookEvent = { sessionID: "ses_1", system: [], tools: { ...seeds(), websearch: { description: "s", input: {} } } }
    run(event)
    expect(event.tools?.websearch).toBeUndefined()
  })
})

/** A collector in a real store, for an app whose `serverTools` are `websearch`. */
function collectorRun(maxServerToolSteps = 8, maxServerToolCalls = 16) {
  let stops = 0
  const collector = new RequestCollector({
    stopTurn: () => void stops++,
    requestID: "req_1",
    app: "app",
    serverTools: new Set(["websearch"]),
    maxServerToolSteps,
    maxServerToolCalls,
  })
  const store = createSessionStore()
  store.register({ sessionID: "ses_1", app: "app", requestID: "req_1", request: plugRequest(), collector })
  const host = bus("ses_1")
  return {
    collector,
    stops: () => stops,
    send: (...events: BusEnvelope[]) => events.forEach((event) => store.dispatch(event)),
    host,
    drain: () => collect(collector.events()),
  }
}

describe("step classification (#82)", () => {
  test("a server-only step continues the turn: no tool call is emitted and nothing stops", async () => {
    const run = collectorRun()
    run.send(run.host.toolCalled("s1", "websearch", { query: "weather" }), run.host.toolSucceeded("s1"), run.host.stepEnded("tool-calls"))
    expect(run.stops()).toBe(0)
    expect(run.collector.terminal).toBe(false)
    run.send(run.host.textDelta("Sunny"), run.host.stepEnded("stop"), run.host.executionSucceeded())
    expect(await run.drain()).toEqual([
      { type: "text-delta", text: "Sunny" },
      { type: "finish", reason: "stop", usage: undefined },
    ])
    expect(run.stops()).toBe(0)
  })

  test("a step with a caller call returns that call to the caller, and the server call stays out of it", async () => {
    const run = collectorRun()
    run.send(run.host.toolCalled("s1", "websearch", {}), run.host.toolCalled("c1", "lookup", { a: 1 }), run.host.stepEnded("tool-calls"))
    expect(run.stops()).toBe(1)
    expect(await run.drain()).toEqual([
      { type: "tool-call", id: "c1", name: "lookup", input: { a: 1 } },
      { type: "finish", reason: "tool-calls", usage: undefined },
    ])
  })

  test("the step cap fails the request with server_tool_steps_exceeded and stops the turn", async () => {
    const run = collectorRun(2)
    for (const id of ["s1", "s2", "s3"]) run.send(run.host.toolCalled(id, "websearch", {}), run.host.toolSucceeded(id), run.host.stepEnded("tool-calls"))
    expect(await run.drain()).toEqual([
      {
        type: "error",
        error: { status: 502, kind: "server", code: "server_tool_steps_exceeded", message: "The model used more OpenCode tool steps than this app allows" },
      },
    ])
    expect(run.stops()).toBe(1)
  })

  test("#198 the call cap counts calls across steps: the call past it fails 502 server_tool_calls_exceeded and stops the turn", async () => {
    const run = collectorRun(8, 3)
    run.send(run.host.toolCalled("s1", "websearch", {}), run.host.toolCalled("s2", "websearch", {}), run.host.stepEnded("tool-calls"))
    run.send(run.host.toolCalled("s3", "websearch", {}), run.host.stepEnded("tool-calls"))
    run.send(run.host.toolCalled("s4", "websearch", {}), run.host.stepEnded("tool-calls"))
    expect(await run.drain()).toEqual([
      {
        type: "error",
        error: { status: 502, kind: "server", code: "server_tool_calls_exceeded", message: "The model used more OpenCode tool calls than this app allows" },
      },
    ])
    expect(run.stops()).toBe(1)
  })

  test("#198 a mixed step whose server calls pass the cap fails the request; the caller's call is not returned", async () => {
    const run = collectorRun(8, 1)
    run.send(run.host.toolCalled("s1", "websearch", {}), run.host.toolCalled("s2", "websearch", {}), run.host.toolCalled("c1", "lookup", {}), run.host.stepEnded("tool-calls"))
    const events = await run.drain()
    expect(events.map((event) => event.type)).toEqual(["error"])
    expect(events.some((event) => event.type === "tool-call")).toBe(false)
    expect(run.stops()).toBe(1)
  })

  test("#198 the calls up to the cap are allowed, whatever the steps", async () => {
    const run = collectorRun(8, 2)
    run.send(run.host.toolCalled("s1", "websearch", {}), run.host.stepEnded("tool-calls"))
    run.send(run.host.toolCalled("s2", "websearch", {}), run.host.stepEnded("tool-calls"))
    run.send(run.host.textDelta("Done"), run.host.stepEnded("stop"), run.host.executionSucceeded())
    expect(await run.drain()).toEqual([
      { type: "text-delta", text: "Done" },
      { type: "finish", reason: "stop", usage: undefined },
    ])
  })

  test("the steps up to the cap are allowed", async () => {
    const run = collectorRun(2)
    for (const id of ["s1", "s2"]) run.send(run.host.toolCalled(id, "websearch", {}), run.host.toolSucceeded(id), run.host.stepEnded("tool-calls"))
    run.send(run.host.textDelta("Done"), run.host.stepEnded("stop"), run.host.executionSucceeded())
    expect(await run.drain()).toEqual([
      { type: "text-delta", text: "Done" },
      { type: "finish", reason: "stop", usage: undefined },
    ])
  })
})

describe("x-plugboard-server-tools (#82)", () => {
  /** A stand-in response: only the header writes and the two flags the reporter reads. */
  function fakeResponse(headersSent = false) {
    const headers = new Map<string, string>()
    const response = { headersSent, destroyed: false, setHeader: (name: string, value: string) => void headers.set(name, value) }
    return { response: response as unknown as ServerResponse, headers }
  }

  test("the caller reports the server calls of a call once, when the call ends", async () => {
    const run = setup({ serverTools: ["websearch"] })
    run.port.toolIDs.push("websearch")
    const reported: number[] = []
    run.answer((id) => [
      bus(id).toolCalled("s1", "websearch", {}),
      bus(id).toolSucceeded("s1"),
      bus(id).stepEnded("tool-calls"),
      bus(id).textDelta("Sunny"),
      bus(id).stepEnded("stop"),
      bus(id).executionSucceeded(),
    ])
    await drain(run.caller.stream(plugRequest(), { ...run.context, onServerTools: (count) => void reported.push(count) }))
    expect(reported).toEqual([1])
  })

  test("a non-streaming answer gets the summed count while its headers are open, and nothing else", () => {
    const { response, headers } = fakeResponse()
    const report = reportServerTools(response, false)!
    report(2)
    report(1)
    report(0)
    expect(headers.get("x-plugboard-server-tools")).toBe("3")
  })

  test("a stream gets no callback, and sent headers are never changed", () => {
    expect(reportServerTools(fakeResponse().response, true)).toBeUndefined()
    const late = fakeResponse(true)
    reportServerTools(late.response, false)!(4)
    expect(late.headers.size).toBe(0)
  })
})

describe("server calls after the request ended (#196)", () => {
  test("a server call after the client left is logged as server_tool.after_request, and its step stops the turn", async () => {
    const run = collectorRun()
    run.collector.cancel()
    run.send(run.host.toolCalled("s1", "websearch", { query: "secret query" }), run.host.stepEnded("tool-calls"))
    expect(run.stops()).toBe(1)
    const lines = logs.of("server_tool.after_request")
    expect(lines).toHaveLength(1)
    expect(lines[0]!.fields).toMatchObject({ requestID: "req_1", app: "app", tool: "websearch", lateCalls: "1" })
    expect(lines[0]!.raw).not.toContain("secret query")
  })

  test("each late step that ran a server call stops the turn again, and a repeated call id is logged once", async () => {
    const run = collectorRun()
    run.collector.cancel()
    run.send(run.host.toolCalled("s1", "websearch", {}), run.host.toolCalled("s1", "websearch", {}), run.host.stepEnded("tool-calls"))
    run.send(run.host.toolCalled("s2", "websearch", {}), run.host.stepEnded("tool-calls"))
    expect(run.stops()).toBe(2)
    expect(logs.of("server_tool.after_request")).toHaveLength(2)
  })

  test("a caller call after the request ended is ignored: no log, no stop", async () => {
    const run = collectorRun()
    run.collector.cancel()
    run.send(run.host.toolCalled("c1", "lookup", {}), run.host.stepEnded("tool-calls"))
    expect(run.stops()).toBe(0)
    expect(logs.of("server_tool.after_request")).toHaveLength(0)
  })

  test("the answer returned and the host still runs a server tool: the session is interrupted again (fake session)", async () => {
    const run = setup({ serverTools: ["websearch"] })
    run.port.toolIDs.push("websearch")
    run.answer((id) => [bus(id).textDelta("Hi"), bus(id).stepEnded("stop")])
    await drain(run.caller.stream(plugRequest(), run.context))
    expect(run.port.interrupted).toEqual([])
    run.sessions.dispatch(bus("ses_1").toolCalled("late1", "websearch", {}))
    run.sessions.dispatch(bus("ses_1").stepEnded("tool-calls"))
    expect(run.port.interrupted).toEqual(["ses_1"])
    expect(logs.of("server_tool.after_request")[0]!.fields).toMatchObject({ tool: "websearch", lateCalls: "1" })
  })
})

describe("server_tool.call log lines (#82)", () => {
  test("one line per server call with the tool, outcome and duration, and no arguments", async () => {
    const run = collectorRun()
    run.send(run.host.toolCalled("s1", "websearch", { query: "secret query" }), run.host.toolSucceeded("s1"), run.host.stepEnded("tool-calls"))
    run.send(run.host.textDelta("ok"), run.host.stepEnded("stop"), run.host.executionSucceeded())
    await run.drain()
    const lines = logs.of("server_tool.call")
    expect(lines).toHaveLength(1)
    expect(lines[0]!.fields).toMatchObject({ requestID: "req_1", app: "app", tool: "websearch", ok: "true" })
    expect(lines[0]!.raw).not.toContain("secret query")
  })

  test("a failed server call is logged as not ok", async () => {
    const run = collectorRun()
    run.send(run.host.toolCalled("s1", "websearch", {}), run.host.toolFailed("s1"), run.host.stepEnded("tool-calls"))
    run.send(run.host.textDelta("ok"), run.host.stepEnded("stop"), run.host.executionSucceeded())
    await run.drain()
    expect(logs.of("server_tool.call")[0]!.fields).toMatchObject({ tool: "websearch", ok: "false" })
  })
})

describe("the response cache skips a trusted app (#82)", () => {
  /** A model answer that counts the calls it receives; the cache is built with the app as bypassed or not. */
  function cached(bypass: (model: string, app: string) => boolean) {
    let calls = 0
    const inner: ModelCaller = {
      async *stream(): AsyncGenerator<PlugEvent> {
        calls++
        yield { type: "text-delta", text: "answer" }
        yield { type: "finish", reason: "stop", usage: undefined }
      },
    }
    const store = createCacheStore({ ttlMs: 60_000, maxEntries: 10, maxBytes: 1_000_000 })
    const caller = cachedCaller(inner, { ttlSeconds: 60, maxEntries: 10, maxBytes: 1_000_000 }, store, undefined, bypass)
    const context: CallContext = { app: "app", signal: new AbortController().signal }
    return {
      calls: () => calls,
      twice: async () => {
        await collect(caller.stream(plugRequest(), context))
        await collect(caller.stream(plugRequest(), context))
      },
    }
  }

  test("two identical requests from a trusted app both reach the model", async () => {
    const run = cached((_model, app) => app === "app")
    await run.twice()
    expect(run.calls()).toBe(2)
  })

  test("control: the same requests from an app that is not bypassed are answered from the cache", async () => {
    const run = cached(() => false)
    await run.twice()
    expect(run.calls()).toBe(1)
  })
})

describe("the host port lists the direct tools (#82)", () => {
  test("only tools that are direct (codemode false) and whose permission name is their id are listed", async () => {
    const spy = spyContext({
      directory: "/data/app",
      respond: {
        "tool.list": () =>
          Effect.succeed([
            { id: "websearch", options: { codemode: false } },
            { id: "grep", options: { codemode: true } },
            { id: "read", options: { codemode: false, permission: "file" } },
            { id: "lsp" },
          ]),
      },
    })
    await expect(createSessionPort(spy.ctx).directTools()).resolves.toEqual(["websearch"])
  })
})
