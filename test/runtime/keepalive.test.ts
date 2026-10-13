/**
 * The location keep-alive (#310, #350, src/keepalive.ts) against the spy context: the loop starts after setup returns;
 * each tick creates a child under one long-lived parent (the create is the touch; a rename is not) and removes the
 * children the earlier ticks left. It reuses a parent from storage, creates a new one when the parent is gone, keeps a
 * failed create or remove for a later tick instead of leaking it, stops with its generation, never runs with
 * `keepAlive: false`, keeps one generation as the owner, and leaves the sessions out of the history index and usage.
 *
 * The interval is shortened with `PLUGBOARD_KEEPALIVE_INTERVAL_MS` (read at setup): the real one is 30 minutes.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect, Exit, Scope, Stream } from "effect"
import plugin from "../../index.js"
import { parseOptions } from "../../src/config.js"
import { KEEP_ALIVE_CHILDREN, KEEP_ALIVE_INTERVAL_MS, KEEP_ALIVE_KEY, KEEP_ALIVE_TITLE, keepAliveIntervalMs } from "../../src/keepalive.js"
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
 * A fake host for the keep-alive calls. `deleted` ids are gone: a remove of one answers the host's `Session.NotFoundError`,
 * and a child create under one answers the same (a missing parent). `failing.create` makes every create fail, and
 * `failing.remove` ids answer a remove with an error that is not NotFound.
 */
function fakeHost(input: { stored?: Record<string, string>; deleted?: string[]; orphanRoots?: boolean } = {}) {
  const storage = new Map(Object.entries(input.stored ?? {}))
  const deleted = new Set(input.deleted ?? [])
  const failing = { create: false, put: false, remove: new Set<string>() }
  let created = 0
  return {
    storage,
    failing,
    respond: {
      "event.subscribe": () => Stream.never,
      "model.list": () => Effect.succeed({ data: [] }),
      "storage.get": (key: string) => Effect.succeed(storage.get(key)),
      "storage.set": (key: string, value: string) =>
        failing.put && key === KEEP_ALIVE_CHILDREN ? Effect.fail({ _tag: "Storage.Unavailable" }) : Effect.sync(() => void storage.set(key, value)),
      "session.create": (args: { parentID?: string }) => {
        if (failing.create) return Effect.fail({ _tag: "Session.Unavailable" })
        if (args.parentID !== undefined && deleted.has(args.parentID)) return Effect.fail({ _tag: "Session.NotFoundError" })
        const id = `ses_keep_${++created}`
        // A root the host deletes as soon as it is made (`orphanRoots`): a child under it is then a missing parent.
        if (args.parentID === undefined && input.orphanRoots) deleted.add(id)
        return Effect.succeed({ id })
      },
      "session.remove": (input: { sessionID: string }) => {
        if (failing.remove.has(input.sessionID)) return Effect.fail({ _tag: "Session.Unavailable" })
        return deleted.has(input.sessionID) ? Effect.fail({ _tag: "Session.NotFoundError" }) : Effect.void
      },
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
/** The parent creates (no `parentID`) and the child creates (under a `parentID`). */
const parentCreates = (spy: SpyContext) => creates(spy).filter((call) => (call.args[0] as { parentID?: string }).parentID === undefined)
const childCreates = (spy: SpyContext) => creates(spy).filter((call) => (call.args[0] as { parentID?: string }).parentID !== undefined)
const removes = (spy: SpyContext) => callsOf(spy, "session.remove")
const removedIDs = (spy: SpyContext) => removes(spy).map((call) => (call.args[0] as { sessionID: string }).sessionID)
/** The storage and session calls the keep-alive makes (not the setup registrations or the event pump). */
const keepAliveCalls = (spy: SpyContext) => spy.calls.filter((call) => KEEP_ALIVE_METHODS.has(call.path))
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const trackedIDs = (host: { storage: Map<string, string> }) => JSON.parse(host.storage.get(KEEP_ALIVE_CHILDREN) ?? "[]") as string[]

describe("#310 the keep-alive runs after setup, on the interval", () => {
  test("setup returns before the first keep-alive call, and the loop starts after it", async () => {
    const host = fakeHost()
    const { spy } = load(await options(), "/projects/a", host.respond)
    expect(spy.during("setup").filter((path) => KEEP_ALIVE_METHODS.has(path))).toEqual([])
    await until(async () => keepAliveCalls(spy).length > 0, 2_000, "the first keep-alive tick")
    expect(keepAliveCalls(spy)[0]!.phase).toBe("after-setup")
  })

  test("each interval creates a child under the one parent and removes the child the previous tick left; no rename", async () => {
    const host = fakeHost()
    const { spy } = load(await options(), "/projects/a", host.respond)
    await until(async () => removes(spy).length >= 2, 2_000, "two removes")
    expect(parentCreates(spy)).toHaveLength(1)
    expect(new Set(childCreates(spy).map((call) => (call.args[0] as { parentID: string }).parentID))).toEqual(new Set(["ses_keep_1"]))
    expect(childCreates(spy).every((call) => (call.args[0] as { title: string }).title === KEEP_ALIVE_TITLE)).toBe(true)
    // Parent is ses_keep_1, the first child ses_keep_2, the second ses_keep_3: each tick removes the child before it.
    expect(removedIDs(spy).slice(0, 2)).toEqual(["ses_keep_2", "ses_keep_3"])
    expect(callsOf(spy, "session.update")).toEqual([])
  })

  test("the first tick creates the parent with no location argument (so it is this Location), denies it every permission, and stores its id", async () => {
    const host = fakeHost()
    const { spy } = load(await options(), "/projects/a", host.respond)
    await until(async () => callsOf(spy, "storage.set").length > 0, 2_000, "the stored parent id")
    expect(parentCreates(spy)[0]!.args[0]).toMatchObject({
      title: KEEP_ALIVE_TITLE,
      metadata: { plugboard: "keep-alive" },
      permissions: [{ action: "*", resource: "*", effect: "deny" }],
    })
    expect(parentCreates(spy)[0]!.args[0]).not.toHaveProperty("location")
    expect(callsOf(spy, "storage.set")[0]!.args).toEqual([KEEP_ALIVE_KEY, "ses_keep_1"])
    await until(async () => childCreates(spy).length >= 1, 2_000, "a child")
    expect(childCreates(spy)[0]!.args[0]).toEqual({ title: KEEP_ALIVE_TITLE, parentID: "ses_keep_1" })
  })

  test("a parent stored by an earlier plugboard is reused as the parent; only children are created", async () => {
    const host = fakeHost({ stored: { [KEEP_ALIVE_KEY]: "ses_old" } })
    const { spy } = load(await options(), "/projects/a", host.respond)
    await until(async () => childCreates(spy).length >= 1, 2_000, "a child under the stored parent")
    expect(parentCreates(spy)).toEqual([])
    expect((childCreates(spy)[0]!.args[0] as { parentID: string }).parentID).toBe("ses_old")
  })

  test("a parent that is gone is created again, and the children follow it", async () => {
    const host = fakeHost({ stored: { [KEEP_ALIVE_KEY]: "ses_gone" }, deleted: ["ses_gone"] })
    const { spy } = load(await options(), "/projects/a", host.respond)
    await until(async () => childCreates(spy).some((call) => (call.args[0] as { parentID: string }).parentID === "ses_keep_1"), 2_000, "a child under the new parent")
    expect(parentCreates(spy)).toHaveLength(1)
    expect(host.storage.get(KEEP_ALIVE_KEY)).toBe("ses_keep_1")
  })

  test("a new parent that is gone at once throws out of the tick, tracks nothing, and is tried again on the next tick", async () => {
    const host = fakeHost({ stored: { [KEEP_ALIVE_KEY]: "ses_gone" }, deleted: ["ses_gone"], orphanRoots: true })
    const loaded = load(await options(), "/projects/a", host.respond)
    await until(async () => parentCreates(loaded.spy).length >= 2, 2_000, "a second parent attempt")
    expect(host.storage.get(KEEP_ALIVE_CHILDREN)).toBeUndefined()
    // The loop would keep failing and logging; stop it so the next test's log capture stays clean.
    loaded.unload()
  })

  test("a failed create writes nothing, throws out of that tick only, and the loop recovers", async () => {
    const host = fakeHost()
    const { spy } = load(await options(), "/projects/a", host.respond)
    await until(async () => trackedIDs(host).length === 1, 2_000, "steady state: one tracked child")
    host.failing.create = true
    await pause(15)
    const snapshot = JSON.stringify(trackedIDs(host))
    const failedBefore = creates(spy).length
    await pause(25)
    expect(creates(spy).length).toBeGreaterThan(failedBefore)
    expect(JSON.stringify(trackedIDs(host))).toBe(snapshot)
    host.failing.create = false
    await until(async () => trackedIDs(host).length === 1 && JSON.stringify(trackedIDs(host)) !== snapshot, 2_000, "the loop to recover")
  })

  test("a failed write of the children list removes the child it just created, so nothing leaks", async () => {
    const host = fakeHost()
    host.failing.put = true
    const loaded = load(await options(), "/projects/a", host.respond)
    await until(async () => removedIDs(loaded.spy).includes("ses_keep_2"), 2_000, "the child removed after the failed write")
    host.failing.put = false
    expect(host.storage.get(KEEP_ALIVE_CHILDREN)).toBeUndefined()
    loaded.unload()
  })

  test("a children list that is not JSON counts as empty: the tick goes on and tracks the new child", async () => {
    const host = fakeHost({ stored: { [KEEP_ALIVE_KEY]: "ses_old", [KEEP_ALIVE_CHILDREN]: "{not json" } })
    const { spy } = load(await options(), "/projects/a", host.respond)
    await until(async () => childCreates(spy).length >= 1, 2_000, "a child")
    await until(async () => trackedIDs(host).length === 1, 2_000, "the new child tracked")
    expect(removedIDs(spy)).not.toContain("ses_old")
  })

  test("a failed remove is kept tracked and retried on a later tick, so nothing leaks", async () => {
    const host = fakeHost()
    // The first child is ses_keep_2 (the parent is ses_keep_1). Its removal fails on the tick that would remove it.
    host.failing.remove.add("ses_keep_2")
    const { spy } = load(await options(), "/projects/a", host.respond)
    await until(async () => removedIDs(spy).includes("ses_keep_2"), 2_000, "the failing removal")
    await until(async () => trackedIDs(host).includes("ses_keep_2"), 2_000, "ses_keep_2 kept tracked")
    host.failing.remove.clear()
    await until(async () => removedIDs(spy).filter((id) => id === "ses_keep_2").length >= 2 && trackedIDs(host).length === 1, 2_000, "the retried removal")
    expect(trackedIDs(host).includes("ses_keep_2")).toBe(false)
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

  test("the keep-alive sessions are not request sessions: no history index, no usage, no session store entry", async () => {
    const host = fakeHost()
    const { spy } = load(await options(), "/projects/a", host.respond)
    await until(async () => removes(spy).length >= 1, 2_000, "a remove")
    expect(new Set(callsOf(spy, "storage.set").map((call) => call.args[0]))).toEqual(new Set([KEEP_ALIVE_KEY, KEEP_ALIVE_CHILDREN]))
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
