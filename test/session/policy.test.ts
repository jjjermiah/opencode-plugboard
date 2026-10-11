/**
 * #78 #51 per-app policy where it is enforced: the session caller (model scope, tools off, a lower
 * tool cap, the `onPolicy` note) and the context hook (the app's system prompt). Parsing is in
 * test/unit/apps.test.ts, the wire in test/http/policy.test.ts.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { parseOptions } from "../../src/config.js"
import type { CallContext, PlugEvent, PlugRequest, PolicyNote } from "../../src/contract.js"
import { createSessionCaller } from "../../src/session/caller.js"
import { installSessionHooks } from "../../src/session/context.js"
import type { ContextHookEvent } from "../../src/session/host.js"
import { createSessionStore } from "../../src/session/state.js"
import { plugRequest } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { spyContext } from "../support/plugin-context.js"
import { bus, FakeSessionPort } from "../support/session.js"

captureLogs()

const options = parseOptions({
  models: ["test/*"],
  aliases: { fast: "test/echo#low", smart: "test/vision" },
  maxTools: 4,
  keys: { bot: "k1", ide: "k2", web: "k3" },
  apps: {
    bot: { models: ["fast"], system: "Answer in two sentences.", tools: false },
    ide: { models: ["test/echo"], maxTools: 2, system: "Repo notes.", systemMode: "append" },
    web: { system: "Only JSON.", systemMode: "replace" },
  },
})
const tool = (name: string) => ({ name, description: "", parameters: {} })
const echo = { providerID: "test", id: "echo" }
const request = (model: string, ref: PlugRequest["ref"] = echo, extra: Partial<PlugRequest> = {}) => plugRequest({ model, ref, ...extra })

async function drain(stream: AsyncIterable<PlugEvent>): Promise<PlugEvent[]> {
  const out: PlugEvent[] = []
  for await (const event of stream) out.push(event)
  return out
}

/** A caller with the policy options over a fake port whose prompt answers at once; `seen` holds what the store registered. */
function setup() {
  const port = new FakeSessionPort()
  const sessions = createSessionStore()
  const seen: PlugRequest[] = []
  port.script.prompt = async (input) => {
    seen.push(sessions.lookup(input.sessionID)!.request)
    queueMicrotask(() => [bus(input.sessionID).textDelta("ok"), bus(input.sessionID).stepEnded("stop"), bus(input.sessionID).executionSucceeded()].forEach((event) => sessions.dispatch(event)))
  }
  const caller = createSessionCaller({ port, sessions, maxTools: 4, apps: options.apps })
  const notes: PolicyNote[][] = []
  const call = (app: string, req: PlugRequest) => {
    const context: CallContext = { app, signal: new AbortController().signal, onPolicy: (n) => void notes.push([...n]) }
    return drain(caller.stream(req, context))
  }
  return { port, seen, notes, call }
}

describe("model scope", () => {
  test("a model outside the app's scope is the 404 model_not_found of an unknown model, and nothing is created", async () => {
    const run = setup()
    const events = await run.call("bot", request("test/vision", { providerID: "test", id: "vision" }))
    expect(events).toEqual([{ type: "error", error: { status: 404, kind: "not_found", code: "model_not_found", param: "model", message: "Model test/vision is not available" } }])
    expect(run.port.created).toEqual([])
  })

  test("an alias entry admits the alias name only, not the model it points at", async () => {
    const run = setup()
    const direct = await run.call("bot", request("test/echo#low", { ...echo, variant: "low" }))
    expect(direct[0]).toMatchObject({ type: "error", error: { status: 404 } })
    expect(run.port.created).toEqual([])
    const named = await run.call("bot", request("fast", { ...echo, variant: "low" }))
    expect(named.at(-1)).toMatchObject({ type: "finish", reason: "stop" })
    expect(run.port.created).toHaveLength(1)
  })

  test("a pattern entry admits the model, and an alias pointing at it, whichever name reaches it", async () => {
    const run = setup()
    expect((await run.call("ide", request("test/echo"))).at(-1)).toMatchObject({ type: "finish" })
    expect((await run.call("ide", request("fast", { ...echo, variant: "low" }))).at(-1)).toMatchObject({ type: "finish" })
    const out = await run.call("ide", request("smart", { providerID: "test", id: "vision" }))
    expect(out[0]).toMatchObject({ type: "error", error: { status: 404, code: "model_not_found" } })
  })

  test("an app without models, an app without a policy and the default app are not narrowed", async () => {
    const run = setup()
    for (const app of ["web", "other", "default"]) expect((await run.call(app, request("test/vision", { providerID: "test", id: "vision" }))).at(-1)).toMatchObject({ type: "finish" })
  })
})

describe("tools", () => {
  test("tools: false drops the tools and the tool choice before the session is built, and tells the front-end once", async () => {
    const run = setup()
    const events = await run.call("bot", request("fast", { ...echo, variant: "low" }, { tools: [tool("a"), tool("b")], toolChoice: "required" }))
    expect(events.at(-1)).toMatchObject({ type: "finish", reason: "stop" })
    expect(run.seen[0]).toMatchObject({ tools: [] })
    expect(run.seen[0]).not.toHaveProperty("toolChoice")
    expect(run.notes).toEqual([["tools-stripped"]])
    // The stored transcript is built from the effective request too: no tools the model never saw.
    expect(run.port.prompted[0]!.text).not.toContain("tool")
  })

  test("nothing is reported when the caller sent no tools", async () => {
    const run = setup()
    await run.call("bot", request("fast", { ...echo, variant: "low" }, { toolChoice: "required" }))
    expect(run.notes).toEqual([])
  })

  test("an app without tools: false keeps the caller's tools and reports nothing", async () => {
    const run = setup()
    await run.call("web", request("test/echo", echo, { tools: [tool("a")] }))
    expect(run.seen[0]!.tools).toHaveLength(1)
    expect(run.notes).toEqual([])
  })

  test("an app's maxTools is a 400 too_many_tools on tools, before anything is created", async () => {
    const run = setup()
    const [event] = await run.call("ide", request("test/echo", echo, { tools: [tool("a"), tool("b"), tool("c")] }))
    expect(event).toEqual({
      type: "error",
      error: { status: 400, kind: "invalid_request", code: "too_many_tools", param: "tools", message: "Request has 3 tools; app ide allows 2 (option `apps.ide.maxTools`)" },
    })
    expect(run.port.created).toEqual([])
  })

  test("at the app's limit the request goes through; above it still hits the global cap for apps without a limit", async () => {
    const run = setup()
    expect((await run.call("ide", request("test/echo", echo, { tools: [tool("a"), tool("b")] }))).at(-1)).toMatchObject({ type: "finish" })
    const many = request("test/echo", echo, { tools: [tool("a"), tool("b"), tool("c"), tool("d"), tool("e")] })
    expect((await run.call("web", many))[0]).toMatchObject({ type: "error", error: { code: "backend_preparation_failed" } })
  })
})

describe("the app's system prompt in the context hook", () => {
  /** Runs the hook for a registered request of `app`; returns the system texts the model would get. */
  function system(app: string, req: PlugRequest, apps = options.apps) {
    const sessions = createSessionStore()
    sessions.register({ sessionID: "ses_1", app, requestID: "r", request: req, collector: { push() {} } })
    const spy = spyContext({ directory: "/data/app" })
    Effect.runSync(Effect.scoped(installSessionHooks(spy.ctx, { maxTools: 4, apps, sessions, active: () => true })))
    const event: ContextHookEvent = { sessionID: "ses_1", system: ["opencode system prompt"], messages: [], options: {}, tools: {} }
    Effect.runSync(spy.registered<(event: unknown) => Effect.Effect<void>>("session.hook")(event))
    return (event.system as Array<{ text: string }>).map((part) => part.text)
  }
  const caller = { system: ["caller says hi"] }

  test("prepends by default, so the operator's text comes first", () => {
    expect(system("bot", request("fast", echo, caller))).toEqual(["Answer in two sentences.", "caller says hi"])
  })

  test("append puts it after the caller's", () => {
    expect(system("ide", request("test/echo", echo, caller))).toEqual(["caller says hi", "Repo notes."])
  })

  test("replace drops the caller's system prompt", () => {
    expect(system("web", request("test/echo", echo, caller))).toEqual(["Only JSON."])
  })

  test("the tool-choice instruction stays after it, even when the system is replaced", () => {
    expect(system("web", request("test/echo", echo, { ...caller, tools: [tool("lookup")], toolChoice: "required" }))).toEqual(["Only JSON.", "You must respond by calling one of the provided tools."])
  })

  test("an app without a system, and an app without a policy, get the caller's system as sent", () => {
    expect(system("other", request("test/echo", echo, caller))).toEqual(["caller says hi"])
    expect(system("bot", request("fast", echo, caller), parseOptions({ keys: { bot: "k" }, apps: { bot: { tools: false } } }).apps)).toEqual(["caller says hi"])
  })

  test("a caller with no system prompt still gets the operator's", () => {
    expect(system("bot", request("fast", echo))).toEqual(["Answer in two sentences."])
  })
})
