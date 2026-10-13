/**
 * The location keep-alive (#310, src/keepalive.ts) against the spy context: the loop starts after setup
 * returns, touches the keep-alive session on each interval, creates it once, renames a stored one,
 * recreates a deleted one, stops with its generation, never runs with `keepAlive: false`, keeps one
 * generation as the owner, and leaves the session out of the history index and usage.
 *
 * The interval is shortened with `PLUGBOARD_KEEPALIVE_INTERVAL_MS` (read at setup): the real one is 30 minutes.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect, Exit, Scope, Stream } from "effect"
import plugin from "../../index.js"
import { parseOptions } from "../../src/config.js"
import { KEEP_ALIVE_INTERVAL_MS, KEEP_ALIVE_KEY, KEEP_ALIVE_TITLE, keepAliveIntervalMs } from "../../src/keepalive.js"
import { sessionStore } from "../../src/runtime.js"
import { until } from "../support/fixtures.js"
import { spyContext, type SpyCall, type SpyContext } from "../support/plugin-context.js"
import { freePort, isolateRuntime } from "../support/runtime.js"

isolateRuntime()

const savedInterval = process.env.PLUGBOARD_KEEPALIVE_INTERVAL_MS
beforeEach(() => {
  process.env.PLUGBOARD_KEEPALIVE_INTERVAL_MS = "5"
})
afterEach(() => {
  if (savedInterval === undefined) delete process.env.PLUGBOARD_KEEPALIVE_INTERVAL_MS
  else process.env.PLUGBOARD_KEEPALIVE_INTERVAL_MS = savedInterval
})

const options = async (extra: Record<string, unknown> = {}) => ({ listen: { port: await freePort() }, models: ["test/*"], maxTools: 2, ...extra })

/**
 * A fake host for the keep-alive calls: plugin storage, session create and update. A session in `deleted` answers an
 * update with the host's `Session.NotFoundError`, as a deleted session does.
 */
function fakeHost(input: { stored?: Record<string, string>; deleted?: string[] } = {}) {
  const storage = new Map(Object.entries(input.stored ?? {}))
  const deleted = new Set(input.deleted ?? [])
  let created = 0
  return {
    storage,
    respond: {
      "event.subscribe": () => Stream.never,
      "model.list": () => Effect.succeed({ data: [] }),
      "storage.get": (key: string) => Effect.succeed(storage.get(key)),
      "storage.set": (key: string, value: string) => Effect.sync(() => void storage.set(key, value)),
      "session.create": () => Effect.sync(() => ({ id: `ses_keep_${++created}` })),
      "session.update": (input: { sessionID: string }) => (deleted.has(input.sessionID) ? Effect.fail({ _tag: "Session.NotFoundError" }) : Effect.void),
    },
  }
}

interface Loaded {
  readonly spy: SpyContext
  unload(): void
}

/** Runs the plugin's setup for one Location the way the host does: a suspending setup throws here. */
function load(opts: unknown, directory: string, respond: Record<string, (...args: never[]) => unknown>): Loaded {
  const spy = spyContext({ options: opts, directory, respond })
  const scope = Effect.runSync(Scope.make())
  Effect.runSync(Scope.provide(scope)(plugin.effect(spy.ctx)))
  spy.mark("after-setup")
  return {
    spy,
    unload() {
      Effect.runSync(Scope.close(scope, Exit.void))
    },
  }
}

/** The host methods the keep-alive uses (setup registers the context hook, which is not one of them). */
const KEEP_ALIVE_METHODS = new Set("storage.get storage.set session.create session.update session.remove session.prompt".split(" "))

const callsOf = (spy: SpyContext, path: string): SpyCall[] => spy.calls.filter((call) => call.path === path)
const updates = (spy: SpyContext) => callsOf(spy, "session.update")
/** The storage and session calls the keep-alive makes (not the setup registrations or the event pump). */
const keepAliveCalls = (spy: SpyContext) => spy.calls.filter((call) => KEEP_ALIVE_METHODS.has(call.path))
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("#310 the keep-alive runs after setup, on the interval", () => {
  test("setup returns before the first keep-alive call, and the loop starts after it", async () => {
    const host = fakeHost()
    const { spy } = load(await options(), "/projects/a", host.respond)
    expect(spy.during("setup").filter((path) => KEEP_ALIVE_METHODS.has(path))).toEqual([])
    await until(async () => keepAliveCalls(spy).length > 0, 2_000, "the first keep-alive tick")
    expect(keepAliveCalls(spy)[0]!.phase).toBe("after-setup")
  })

  test("the loop touches the keep-alive session on each interval (a rename keeps its time.updated moving)", async () => {
    const host = fakeHost()
    const { spy } = load(await options(), "/projects/a", host.respond)
    await until(async () => updates(spy).length >= 2, 2_000, "two renames")
    expect(updates(spy).every((call) => (call.args[0] as { sessionID: string; title: string }).title === KEEP_ALIVE_TITLE)).toBe(true)
    expect(new Set(updates(spy).map((call) => (call.args[0] as { sessionID: string }).sessionID))).toEqual(new Set(["ses_keep_1"]))
  })

  test("the first tick creates one session, denies it every permission, and stores its id under keepalive/session", async () => {
    const host = fakeHost()
    const { spy } = load(await options(), "/projects/a", host.respond)
    await until(async () => callsOf(spy, "storage.set").length > 0, 2_000, "the stored session id")
    expect(callsOf(spy, "session.create")[0]!.args[0]).toMatchObject({
      title: KEEP_ALIVE_TITLE,
      metadata: { plugboard: "keep-alive" },
      permissions: [{ action: "*", resource: "*", effect: "deny" }],
    })
    expect(callsOf(spy, "storage.set")[0]!.args).toEqual([KEEP_ALIVE_KEY, "ses_keep_1"])
    expect(host.storage.get(KEEP_ALIVE_KEY)).toBe("ses_keep_1")
  })

  test("a stored session is renamed on each tick and never created again", async () => {
    const host = fakeHost({ stored: { [KEEP_ALIVE_KEY]: "ses_old" } })
    const { spy } = load(await options(), "/projects/a", host.respond)
    await until(async () => updates(spy).length >= 1, 2_000, "a rename of the stored session")
    expect((updates(spy)[0]!.args[0] as { sessionID: string }).sessionID).toBe("ses_old")
    expect(callsOf(spy, "session.create")).toEqual([])
  })

  test("a deleted keep-alive session is recreated and its new id stored", async () => {
    const host = fakeHost({ stored: { [KEEP_ALIVE_KEY]: "ses_gone" }, deleted: ["ses_gone"] })
    const { spy } = load(await options(), "/projects/a", host.respond)
    await until(async () => callsOf(spy, "storage.set").length > 0, 2_000, "the recreated session id")
    expect(callsOf(spy, "session.create")).toHaveLength(1)
    expect(host.storage.get(KEEP_ALIVE_KEY)).toBe("ses_keep_1")
    // The next tick renames the new session.
    await until(async () => updates(spy).some((call) => (call.args[0] as { sessionID: string }).sessionID === "ses_keep_1"), 2_000, "a rename of the new session")
  })

  test("the loop stops when its generation is disposed", async () => {
    const host = fakeHost()
    const loaded = load(await options(), "/projects/a", host.respond)
    await until(async () => updates(loaded.spy).length >= 1, 2_000, "a rename")
    loaded.unload()
    const stopped = updates(loaded.spy).length
    await pause(25)
    expect(updates(loaded.spy).length).toBe(stopped)
  })

  test("with `keepAlive: false` no keep-alive call is ever made", async () => {
    const host = fakeHost()
    const { spy } = load(await options({ keepAlive: false }), "/projects/a", host.respond)
    await pause(25)
    expect(keepAliveCalls(spy)).toEqual([])
  })

  test("one loop per process: the generation holding the lease ticks, and the next one takes over when it leaves", async () => {
    const host = fakeHost()
    const shared = await options()
    const first = load(shared, "/projects/a", host.respond)
    const second = load(shared, "/projects/b", host.respond)
    await until(async () => updates(first.spy).length >= 2, 2_000, "the first generation's renames")
    await pause(10)
    expect(keepAliveCalls(second.spy)).toEqual([])
    first.unload()
    await until(async () => updates(second.spy).length >= 1, 2_000, "the second generation takes the lease")
  })

  test("the keep-alive session is not a request session: no history index, no usage, no session store entry", async () => {
    const host = fakeHost()
    const { spy } = load(await options(), "/projects/a", host.respond)
    await until(async () => updates(spy).length >= 1, 2_000, "a rename")
    expect(callsOf(spy, "storage.set").map((call) => call.args[0])).toEqual([KEEP_ALIVE_KEY])
    expect(callsOf(spy, "session.remove")).toEqual([])
    expect(callsOf(spy, "session.prompt")).toEqual([])
    expect(sessionStore().size()).toBe(0)
  })
})

describe("#310 the option and its interval", () => {
  test("`keepAlive` must be a boolean, and absent means on", () => {
    expect(() => parseOptions({ keepAlive: "yes" })).toThrow("plugboard option `keepAlive` must be a boolean")
    expect(parseOptions({}).keepAlive).toBeUndefined()
    expect(parseOptions({ keepAlive: false }).keepAlive).toBe(false)
  })

  test("the interval is 30 minutes, and the test variable shortens it only when it is a positive integer", () => {
    expect(KEEP_ALIVE_INTERVAL_MS).toBe(30 * 60_000)
    process.env.PLUGBOARD_KEEPALIVE_INTERVAL_MS = "250"
    expect(keepAliveIntervalMs()).toBe(250)
    process.env.PLUGBOARD_KEEPALIVE_INTERVAL_MS = "soon"
    expect(keepAliveIntervalMs()).toBe(KEEP_ALIVE_INTERVAL_MS)
  })
})
