/**
 * The location keep-alive (#310, #350, src/keepalive.ts) against the spy context: the loop starts after setup
 * returns, creates a keep-alive session on each interval and removes the one the previous tick stored (the create
 * is the touch; a rename is not), removes a session an older plugboard stored, goes on when that session is already
 * gone, stops with its generation, never runs with `keepAlive: false`, keeps one generation as the owner, and leaves
 * the session out of the history index and usage.
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
 * A fake host for the keep-alive calls: plugin storage, session create and remove. A session in `deleted` answers a
 * remove with the host's `Session.NotFoundError`, as a session that is already gone does.
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
      "session.remove": (input: { sessionID: string }) => (deleted.has(input.sessionID) ? Effect.fail({ _tag: "Session.NotFoundError" }) : Effect.void),
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
const KEEP_ALIVE_METHODS = new Set("storage.get storage.set session.create session.remove session.prompt session.update".split(" "))

const callsOf = (spy: SpyContext, path: string): SpyCall[] => spy.calls.filter((call) => call.path === path)
const creates = (spy: SpyContext) => callsOf(spy, "session.create")
const removes = (spy: SpyContext) => callsOf(spy, "session.remove")
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

  test("each interval creates a session in this Location and removes the one the previous tick stored; no rename", async () => {
    const host = fakeHost()
    const { spy } = load(await options(), "/projects/a", host.respond)
    await until(async () => removes(spy).length >= 2, 2_000, "two removes")
    expect(creates(spy).every((call) => (call.args[0] as { title: string }).title === KEEP_ALIVE_TITLE)).toBe(true)
    expect(removes(spy).map((call) => (call.args[0] as { sessionID: string }).sessionID).slice(0, 2)).toEqual(["ses_keep_1", "ses_keep_2"])
    expect(callsOf(spy, "session.update")).toEqual([])
  })

  test("the first tick creates one session with no location argument (so it is this Location), denies it every permission, and stores its id", async () => {
    const host = fakeHost()
    const { spy } = load(await options(), "/projects/a", host.respond)
    await until(async () => callsOf(spy, "storage.set").length > 0, 2_000, "the stored session id")
    expect(creates(spy)[0]!.args[0]).toMatchObject({
      title: KEEP_ALIVE_TITLE,
      metadata: { plugboard: "keep-alive" },
      permissions: [{ action: "*", resource: "*", effect: "deny" }],
    })
    expect(creates(spy)[0]!.args[0]).not.toHaveProperty("location")
    expect(callsOf(spy, "storage.set")[0]!.args).toEqual([KEEP_ALIVE_KEY, "ses_keep_1"])
  })

  test("a session stored by an earlier plugboard is replaced: the new one is created first, then the old one removed", async () => {
    const host = fakeHost({ stored: { [KEEP_ALIVE_KEY]: "ses_old" } })
    const { spy } = load(await options(), "/projects/a", host.respond)
    await until(async () => removes(spy).length >= 1, 2_000, "the removal of the stored session")
    expect((removes(spy)[0]!.args[0] as { sessionID: string }).sessionID).toBe("ses_old")
    const order = spy.calls.map((call) => call.path)
    expect(order.indexOf("session.create")).toBeLessThan(order.indexOf("session.remove"))
  })

  test("a stored session that is already gone is not an error: the loop goes on and stores the new id", async () => {
    const host = fakeHost({ stored: { [KEEP_ALIVE_KEY]: "ses_gone" }, deleted: ["ses_gone"] })
    const { spy } = load(await options(), "/projects/a", host.respond)
    await until(async () => creates(spy).length >= 2, 2_000, "a second tick after the missing session")
    expect(host.storage.get(KEEP_ALIVE_KEY)).toMatch(/^ses_keep_\d+$/)
  })

  test("the loop stops when its generation is disposed", async () => {
    const host = fakeHost()
    const loaded = load(await options(), "/projects/a", host.respond)
    await until(async () => creates(loaded.spy).length >= 1, 2_000, "a create")
    loaded.unload()
    const stopped = creates(loaded.spy).length
    await pause(25)
    expect(creates(loaded.spy).length).toBe(stopped)
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
    await until(async () => creates(first.spy).length >= 2, 2_000, "the first generation's creates")
    await pause(10)
    expect(keepAliveCalls(second.spy)).toEqual([])
    first.unload()
    await until(async () => creates(second.spy).length >= 1, 2_000, "the second generation takes the lease")
  })

  test("the keep-alive session is not a request session: no history index, no usage, no session store entry", async () => {
    const host = fakeHost()
    const { spy } = load(await options(), "/projects/a", host.respond)
    await until(async () => removes(spy).length >= 1, 2_000, "a remove")
    expect(new Set(callsOf(spy, "storage.set").map((call) => call.args[0]))).toEqual(new Set([KEEP_ALIVE_KEY]))
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
