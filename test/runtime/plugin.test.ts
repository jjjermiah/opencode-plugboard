/**
 * The plugin entry (index.ts) against a spy context: the AGENTS.md freeze-safety rules as
 * executable assertions. OpenCode runs plugin effects inline under its activation lock, so setup
 * must register and return, and the finalizer must be synchronous and call nothing on `ctx`.
 *
 * `Effect.runSync` is part of the assertion: it throws if setup or the finalizer ever suspends.
 */
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { Effect, Exit, Scope, Stream } from "effect"
import plugin from "../../index.js"
import { ensureBackend, sessionStore } from "../../src/runtime.js"
import { ensureAppDir } from "../../src/session/history.js"
import type { ContextHookEvent, HostToolDescriptor } from "../../src/session/host.js"
import { plugRequest, until } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { spyContext, type SpyContext } from "../support/plugin-context.js"
import { freePort, isolateRuntime } from "../support/runtime.js"

const logs = captureLogs()
isolateRuntime()

/** The calls an accepted generation makes during setup, and nothing else. */
const SETUP_CALLS = ["session.hook", "agent.transform", "tool.transform"]

interface Loaded {
  readonly spy: SpyContext
  readonly scope: Scope.Closeable
  /** Runs the finalizer, synchronously. */
  unload(): void
}

/** Loads the plugin for one Location the way the host does, and fails if setup suspends. */
function load(options: unknown, directory = "/projects/real"): Loaded {
  const spy = spyContext({
    options,
    directory,
    respond: {
      "event.subscribe": () => Stream.never,
      "model.list": () => Effect.succeed({ data: [{ providerID: "test", id: "echo" }] }),
    },
  })
  const scope = Effect.runSync(Scope.make())
  Effect.runSync(Scope.provide(scope)(plugin.effect(spy.ctx)))
  spy.mark("after-setup")
  return {
    spy,
    scope,
    unload() {
      spy.mark("finalizer")
      Effect.runSync(Scope.close(scope, Exit.void))
      spy.mark("after-finalizer")
    },
  }
}

const options = async (extra: Record<string, unknown> = {}) => ({ listen: { port: await freePort() }, models: ["test/*"], maxTools: 2, ...extra })

describe("plugin setup only registers and returns", () => {
  test("setup is synchronous and calls only the three registrations on ctx", async () => {
    const { spy } = load(await options())
    expect(spy.during("setup")).toEqual(SETUP_CALLS)
  })

  test("setup makes no readiness, session, storage, model or event call", async () => {
    const { spy } = load(await options())
    const forbidden = spy.during("setup").filter((path) => /^(agent\.(list|reload)|tool\.reload|session\.(create|prompt|interrupt|remove|get)|storage\.|model\.|event\.)/.test(path))
    expect(forbidden).toEqual([])
  })

  test("setup touches no filesystem: the data root does not exist afterwards", async () => {
    load(await options())
    expect(existsSync(join(process.env.XDG_DATA_HOME!, "opencode-plugboard"))).toBe(false)
  })

  test("invalid options leave the Location inert and say why", async () => {
    const { spy } = load({ models: "not-an-array" })
    expect(spy.during("setup")).toEqual([])
    expect(logs.of("options.invalid")[0]!.fields.error).toContain("`models` must be an array")
  })

  test("a rejected generation (options differ from the live ones) registers nothing", async () => {
    const live = await options()
    load(live)
    const { spy } = load({ ...live, maxTools: 3 }, "/projects/other")
    expect(spy.during("setup")).toEqual([])
  })

  test("the event pump starts lazily from the first request, never from setup", async () => {
    const live = await options()
    const { spy } = load(live)
    expect(spy.calls.map((call) => call.path)).not.toContain("event.subscribe")
    await until(async () => (await fetch(`http://127.0.0.1:${live.listen.port}/healthz`).catch(() => undefined))?.status === 200, 1_000, "the listener")
    expect(spy.during("after-setup")).toContain("event.subscribe")
  })
})

describe("finalizers are synchronous and call nothing on ctx", () => {
  test("unloading an accepted generation calls nothing on ctx", async () => {
    const loaded = load(await options())
    loaded.unload()
    expect(loaded.spy.during("finalizer")).toEqual([])
  })

  test("unloading a rejected generation calls nothing on ctx", async () => {
    const live = await options()
    load(live)
    const rejected = load({ ...live, maxTools: 3 })
    rejected.unload()
    expect(rejected.spy.calls).toEqual([])
  })

  test("unloading the last generation keeps the listener through the grace period", async () => {
    const live = await options()
    const loaded = load(live)
    await until(async () => (await fetch(`http://127.0.0.1:${live.listen.port}/healthz`).catch(() => undefined))?.status === 200, 1_000, "the listener")
    loaded.unload()
    const reply = await fetch(`http://127.0.0.1:${live.listen.port}/healthz`)
    expect(reply.status).toBe(503)
  })
})

describe("outside a confirmed app directory nothing is added or rewritten", () => {
  /** A fake agent editor and tool editor that record what a transform does. */
  function runTransforms(spy: SpyContext) {
    const denied: unknown[] = []
    const added: string[] = []
    spy.registered<(editor: unknown) => void>("agent.transform")({
      list: () => [{ id: "build" }],
      update: (_id: string, change: (item: { permissions: unknown[] }) => void) => {
        const item = { permissions: [] as unknown[] }
        change(item)
        denied.push(...item.permissions)
      },
    })
    spy.registered<(editor: unknown) => void>("tool.transform")({ add: (tool: { name: string }) => added.push(tool.name) })
    return { denied, added }
  }

  function hookEvent(sessionID: string): ContextHookEvent {
    const seed: HostToolDescriptor = { description: "placeholder", input: {} }
    return { sessionID, system: ["original"], messages: [{ content: [{ type: "text", text: "transcript" }] }], tools: { plugboard_seed_0: seed, read: { description: "real tool", input: {} } } }
  }

  const runHook = (spy: SpyContext, event: ContextHookEvent) => Effect.runSync(spy.registered<(event: unknown) => Effect.Effect<void>>("session.hook")(event))

  test("in a real project the transforms add no seed and deny nothing, and the hook leaves sessions alone", async () => {
    const { spy } = load(await options())
    sessionStore().register({ sessionID: "ses_1", app: "app", requestID: "r", request: plugRequest({ system: ["caller system"] }), collector: { push() {} } })
    expect(runTransforms(spy)).toEqual({ denied: [], added: [] })
    const event = hookEvent("ses_1")
    runHook(spy, event)
    expect(event.system).toEqual(["original"])
    expect(Object.keys(event.tools!)).toEqual(["plugboard_seed_0", "read"])
  })

  test("once a request confirms the app directory, the seeds, the deny and the rewrite switch on", async () => {
    const live = await options()
    const directory = (await ensureAppDir("app")) as string
    const { spy } = load(live, directory)
    expect(await ensureBackend("app", new AbortController().signal, async () => {})).toBeUndefined()
    // Confirmation rebuilt the transforms from request handling, never from setup.
    expect(spy.during("after-setup")).toEqual(expect.arrayContaining(["agent.reload", "tool.reload"]))

    expect(runTransforms(spy)).toEqual({ denied: [{ action: "plugboard_seed_*", resource: "*", effect: "deny" }], added: ["plugboard_seed_0", "plugboard_seed_1"] })
    sessionStore().register({
      sessionID: "ses_2",
      app: "app",
      requestID: "r",
      request: plugRequest({ system: ["caller system"], tools: [{ name: "lookup", description: "Look up", parameters: { type: "object" } }] }),
      collector: { push() {} },
    })
    const event = hookEvent("ses_2")
    const seed = event.tools!.plugboard_seed_0
    runHook(spy, event)
    expect(event.system).toEqual([{ type: "text", text: "caller system" }])
    expect(event.messages as unknown).toEqual([{ role: "user", content: [{ type: "text", text: "hello" }] }])
    // Seed tools are re-keyed in place: the same descriptor object, now under the caller's name.
    expect(Object.keys(event.tools!)).toEqual(["lookup"])
    expect(event.tools!.lookup).toBe(seed!)
    expect(seed).toEqual({ description: "Look up", input: { type: "object" } })
  })

  test("sessions that are not plugboard requests are untouched even in an app directory", async () => {
    const directory = (await ensureAppDir("app")) as string
    const { spy } = load(await options(), directory)
    await ensureBackend("app", new AbortController().signal, async () => {})
    const event = hookEvent("ses_someone_else")
    runHook(spy, event)
    expect(event.system).toEqual(["original"])
  })
})
