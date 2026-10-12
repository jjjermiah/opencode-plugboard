/**
 * #79 skill aliases and #6 agents where they take effect: the session caller (a skill's content, an
 * agent's system prompt and OpenCode agent, the 404s, the deny-all permissions that still apply) and the
 * context hook (the order of the system parts). Parsing and listing are in test/unit/personas.test.ts.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { parseOptions, type PlugboardOptions } from "../../src/config.js"
import type { CallContext, PlugEvent, PlugRequest, PlugTool } from "../../src/contract.js"
import { cachedCaller, createCacheStore } from "../../src/cache.js"
import { personaOf, type Persona } from "../../src/models.js"
import { createSessionCaller } from "../../src/session/caller.js"
import { installSessionHooks } from "../../src/session/context.js"
import { createSessionPort, type ContextHookEvent } from "../../src/session/host.js"
import { REQUEST_PERMISSIONS } from "../../src/session/seeds.js"
import { createSessionStore, type RequestState } from "../../src/session/state.js"
import { collect, ev, plugRequest } from "../support/fixtures.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { captureLogs } from "../support/logs.js"
import { spyContext } from "../support/plugin-context.js"
import { bus, FakeSessionPort } from "../support/session.js"

captureLogs()

const options = parseOptions({
  models: ["test/*"],
  aliases: { "invoice-parser": "skill:invoice-parser@test/echo#low" },
  agents: [
    { name: "review", model: "test/echo#high" },
    { name: "plain", model: "test/echo" },
  ],
})

const echoLow = { providerID: "test", id: "echo", variant: "low" }
const echoHigh = { providerID: "test", id: "echo", variant: "high" }
const lookup: PlugTool = { name: "lookup", description: "look things up", parameters: { type: "object" } }

async function drain(stream: AsyncIterable<PlugEvent>): Promise<PlugEvent[]> {
  const out: PlugEvent[] = []
  for await (const event of stream) out.push(event)
  return out
}

/**
 * A caller over a fake port whose prompt finishes at once. `states` holds the store entry each prompt
 * found, so a test can read what the session was registered with.
 */
function setup(persona: (model: string) => Persona | undefined = (model) => personaOf(options, model)) {
  const port = new FakeSessionPort()
  const sessions = createSessionStore()
  const states: RequestState[] = []
  port.script.prompt = async (input) => {
    states.push(sessions.lookup(input.sessionID)!)
    queueMicrotask(() => [bus(input.sessionID).textDelta("ok"), bus(input.sessionID).stepEnded("stop"), bus(input.sessionID).executionSucceeded()].forEach((event) => sessions.dispatch(event)))
  }
  const caller = createSessionCaller({ port, sessions, maxTools: 4, persona })
  const call = (request: PlugRequest, context: Partial<CallContext> = {}) =>
    drain(caller.stream(request, { app: "app", signal: new AbortController().signal, ...context }))
  return { port, states, call }
}

describe("#79 a skill alias in the session caller", () => {
  test("the session carries the skill's content as its prelude, and the caller's system and tools stay as sent", async () => {
    const run = setup()
    run.port.skills.set("invoice-parser", "Parse invoices into JSON.")
    const events = await run.call(plugRequest({ model: "invoice-parser", ref: echoLow, system: ["be brief"], tools: [lookup] }))

    expect(events.at(-1)).toEqual({ type: "finish", reason: "stop", usage: undefined })
    expect(run.port.created[0]).toMatchObject({ model: { providerID: "test", id: "echo", variant: "low" }, permissions: REQUEST_PERMISSIONS })
    expect(run.port.created[0]!.agent).toBeUndefined()
    expect(run.states[0]!.prelude).toEqual(["Parse invoices into JSON."])
    expect(run.states[0]!.request.system).toEqual(["be brief"])
    expect(run.states[0]!.request.tools).toEqual([lookup])
  })

  test("a skill id that the app directory does not have is a 404 model_not_found naming it, and nothing is created", async () => {
    const run = setup()
    const events = await run.call(plugRequest({ model: "invoice-parser", ref: echoLow }))

    expect(events).toEqual([
      { type: "error", error: { status: 404, kind: "not_found", message: "Skill invoice-parser is not available", code: "model_not_found", param: "model" } },
    ])
    expect(run.port.created).toEqual([])
  })

  test("a plain model request has no prelude", async () => {
    const run = setup(() => undefined)
    await run.call(plugRequest({ model: "test/echo", ref: echoLow }))
    expect(run.states[0]!.prelude).toEqual([])
  })
})

describe("#6 an agent in the session caller", () => {
  test("the session runs as the agent on its model, with the agent's system prompt in place of the caller's, and the deny-all permissions", async () => {
    const run = setup()
    run.port.agents.set("review", { system: "You review code." })
    const events = await run.call(plugRequest({ model: "agent/review", ref: echoHigh, system: ["caller system"], tools: [lookup] }))

    expect(events.at(-1)).toEqual({ type: "finish", reason: "stop", usage: undefined })
    expect(run.port.created[0]).toMatchObject({ agent: "review", model: { providerID: "test", id: "echo", variant: "high" }, permissions: REQUEST_PERMISSIONS })
    expect(run.states[0]!.request.system).toEqual(["You review code."])
    // Caller tools are still returned unexecuted: they reach the model as seeds, and no OpenCode tool is allowed.
    expect(run.states[0]!.request.tools).toEqual([lookup])
    expect(run.states[0]!.prelude).toEqual([])
  })

  test("an agent with no system prompt runs with none, not with the caller's", async () => {
    const run = setup()
    run.port.agents.set("plain", {})
    await run.call(plugRequest({ model: "agent/plain", ref: echoLow, system: ["caller system"] }))
    expect(run.states[0]!.request.system).toEqual([])
  })

  test("an agent the app directory does not have is a 404 model_not_found naming it, and nothing is created", async () => {
    const run = setup(() => ({ kind: "agent", agent: "gone" }))
    const events = await run.call(plugRequest({ model: "agent/gone", ref: echoLow }))

    expect(events).toEqual([{ type: "error", error: { status: 404, kind: "not_found", message: "Agent gone is not available", code: "model_not_found", param: "model" } }])
    expect(run.port.created).toEqual([])
  })

  test("a plain model request never names an agent", async () => {
    const run = setup(() => undefined)
    await run.call(plugRequest({ model: "test/echo", ref: echoLow }))
    expect(run.port.created[0]!.agent).toBeUndefined()
  })
})

describe("#79 #6 the system prompt order in the context hook", () => {
  const hookOptions: PlugboardOptions["apps"] = parseOptions({
    models: ["test/*"],
    keys: { app: "k1" },
    apps: { app: { key: "k1", system: "Operator rule.", systemMode: "prepend" } },
  }).apps
  const replaceOptions: PlugboardOptions["apps"] = parseOptions({
    models: ["test/*"],
    keys: { app: "k1" },
    apps: { app: { key: "k1", system: "Operator rule.", systemMode: "replace" } },
  }).apps

  /** Installs the hooks on a spy context; `prelude` is what the session was registered with. */
  function hook(request: PlugRequest, prelude: ReadonlyArray<string>, apps: PlugboardOptions["apps"] = {}) {
    const sessions = createSessionStore()
    sessions.register({ sessionID: "ses_1", app: "app", requestID: "r", request, collector: { push: () => undefined }, prelude })
    const spy = spyContext({ directory: "/data/app" })
    Effect.runSync(Effect.scoped(installSessionHooks(spy.ctx, { maxTools: 4, sessions, active: () => true, apps })))
    return (event: ContextHookEvent): ContextHookEvent => {
      Effect.runSync(spy.registered<(event: unknown) => Effect.Effect<void>>("session.hook")(event))
      return event
    }
  }
  const event = (): ContextHookEvent => ({ sessionID: "ses_1", system: ["host default"], messages: [{ content: [{ type: "text", text: "hi" }] }], options: {}, tools: {} })
  const text = (value: string) => ({ type: "text", text: value })

  test("the skill's content comes first, then the caller's system prompt", () => {
    const run = hook(plugRequest({ system: ["be brief"] }), ["Parse invoices into JSON."])
    expect(run(event()).system).toEqual([text("Parse invoices into JSON."), text("be brief")])
  })

  test("the skill's content stays first ahead of the app's prepended system prompt", () => {
    const run = hook(plugRequest({ system: ["be brief"] }), ["Parse invoices into JSON."], hookOptions)
    expect(run(event()).system).toEqual([text("Parse invoices into JSON."), text("Operator rule."), text("be brief")])
  })

  test("an app's replace drops the caller's prompt but not the skill's content", () => {
    const run = hook(plugRequest({ system: ["be brief"] }), ["Parse invoices into JSON."], replaceOptions)
    expect(run(event()).system).toEqual([text("Parse invoices into JSON."), text("Operator rule.")])
  })

  test("the tool-choice instruction stays last", () => {
    const run = hook(plugRequest({ system: ["be brief"], tools: [lookup], toolChoice: "required" }), ["Parse invoices into JSON."])
    expect(run(event()).system.at(-1)).toEqual(text("You must respond by calling one of the provided tools."))
  })
})

describe("#79 #6 the host adapter reads skills and agents from the app directory", () => {
  test("#79 a skill is read with ctx.skill.list in that directory, and the list is reused for the directory", async () => {
    const spy = spyContext({
      directory: "/data/app",
      respond: { "skill.list": () => Effect.succeed({ location: {}, data: [{ id: "invoice-parser", name: "invoice-parser", content: "Parse invoices." }] }) },
    })
    const port = createSessionPort(spy.ctx)
    expect(await port.skill("/data/app", "invoice-parser")).toBe("Parse invoices.")
    expect(await port.skill("/data/app", "missing")).toBeUndefined()
    expect(spy.calls.filter((call) => call.path === "skill.list")).toHaveLength(1)
    expect(spy.calls.find((call) => call.path === "skill.list")!.args[0]).toEqual({ location: { directory: "/data/app" } })
  })

  test("#6 an agent is read with ctx.agent.list, and is undefined when the directory has no such agent", async () => {
    const spy = spyContext({
      directory: "/data/app",
      respond: { "agent.list": () => Effect.succeed({ location: {}, data: [{ id: "review", system: "You review code." }] }) },
    })
    const port = createSessionPort(spy.ctx)
    expect(await port.agent("/data/app", "review")).toMatchObject({ system: "You review code." })
    expect(await port.agent("/data/app", "none")).toBeUndefined()
  })

  test("#6 create runs the session as the agent when one is named, and as the host default otherwise", async () => {
    const spy = spyContext({ directory: "/data/app", respond: { "session.create": () => Effect.succeed({ id: "ses_1" }) } })
    const port = createSessionPort(spy.ctx)
    const input = { directory: "/data/app", model: { providerID: "test", id: "echo" }, title: "t", metadata: {}, permissions: REQUEST_PERMISSIONS }
    await port.create({ ...input, agent: "review" })
    await port.create(input)
    const [named, plain] = spy.calls.filter((call) => call.path === "session.create").map((call) => call.args[0] as Record<string, unknown>)
    expect(named).toMatchObject({ agent: "review", permissions: REQUEST_PERMISSIONS })
    expect(plain).not.toHaveProperty("agent")
  })

  test("#155 remove deletes the host session by its id", async () => {
    const spy = spyContext({ directory: "/data/app", respond: { "session.remove": () => Effect.void } })
    await createSessionPort(spy.ctx).remove("ses_late")
    expect(spy.calls.find((call) => call.path === "session.remove")!.args[0]).toEqual({ sessionID: "ses_late" })
  })
})

describe("#79 #6 a persona answer is never cached", () => {
  test("a skill or agent call reaches the caller every time, while a plain model's second call is a hit", async () => {
    const fake = new FakeModelCaller(() => [ev.text("Hi"), ev.finish()])
    const store = createCacheStore({ ttlMs: 60_000, maxEntries: 10, maxBytes: 1_000_000 })
    const cached = cachedCaller(fake, { ttlSeconds: 60, maxEntries: 10, maxBytes: 1_000_000 }, store, undefined, (model) => model.startsWith("agent/") || model === "invoice-parser")
    const context = { app: "default", signal: new AbortController().signal }

    await collect(cached.stream(plugRequest({ model: "agent/review" }), context))
    await collect(cached.stream(plugRequest({ model: "agent/review" }), context))
    await collect(cached.stream(plugRequest({ model: "invoice-parser" }), context))
    expect(fake.calls.length).toBe(3)

    await collect(cached.stream(plugRequest({ model: "test/echo" }), context))
    await collect(cached.stream(plugRequest({ model: "test/echo" }), context))
    expect(fake.calls.length).toBe(4)
  })
})
