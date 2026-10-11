/**
 * The session store (src/session/state.ts): request guards keyed by session ID, shared across
 * generations. A guard outlives its HTTP response and is released by the host's execution end,
 * or by the bounded 30 s retire.
 */
import { describe, expect, jest, test } from "bun:test"
import { createSessionStore, type EventSink } from "../../src/session/state.js"
import { plugRequest } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { bus } from "../support/session.js"

const logs = captureLogs()

const sink = () => {
  const pushed: Array<Record<string, unknown>> = []
  return { pushed, push: (event: Record<string, unknown>) => void pushed.push(event) } satisfies EventSink & { pushed: unknown[] }
}
const state = (sessionID: string, collector: EventSink = sink()) => ({ sessionID, app: "app", requestID: `req_${sessionID}`, request: plugRequest(), collector })

describe("session store", () => {
  test("dispatch flattens an envelope to { type, ...data } for its session only", () => {
    const store = createSessionStore()
    const mine = sink()
    store.register(state("ses_1", mine))
    store.dispatch(bus("ses_1").textDelta("hi"))
    store.dispatch(bus("ses_2").textDelta("not mine"))
    store.dispatch({ type: "server.heartbeat" })
    store.dispatch(null)
    expect(mine.pushed).toEqual([{ type: "session.text.delta", sessionID: "ses_1", delta: "hi", ordinal: 0 }])
  })

  test.each(["executionSucceeded", "executionFailed", "executionInterrupted"] as const)("%s releases the guard", (end) => {
    const store = createSessionStore()
    store.register(state("ses_1"))
    store.dispatch(bus("ses_1")[end]())
    expect(store.lookup("ses_1")).toBeUndefined()
    expect(store.size()).toBe(0)
  })

  test("a sink that throws is logged and the store keeps working", () => {
    const store = createSessionStore()
    store.register(state("ses_1", { push: () => { throw new Error("bad sink") } }))
    store.dispatch(bus("ses_1").textDelta("x"))
    expect(logs.of("session.event_failed")[0]!.fields.error).toBe("bad sink")
  })

  test("register calls onRegister; a hook that throws is logged, the guard still registered", () => {
    const seen: string[] = []
    const store = createSessionStore({ onRegister: (registered) => void seen.push(registered.sessionID) })
    store.register(state("ses_1"))
    expect(seen).toEqual(["ses_1"])
    const failing = createSessionStore({ onRegister: () => { throw new Error("index down") } })
    failing.register(state("ses_2"))
    expect(failing.lookup("ses_2")).toBeDefined()
    expect(logs.of("session.register_hook_failed")).toHaveLength(1)
  })

  test("failAll pushes the synthetic failure to every guard and counts them", () => {
    const store = createSessionStore()
    const a = sink()
    const b = sink()
    store.register(state("ses_a", a))
    store.register(state("ses_b", b))
    const error = { status: 502, kind: "server" as const, message: "lost" }
    expect(store.failAll(error)).toBe(2)
    expect([a.pushed, b.pushed]).toEqual([[{ type: "plugboard.failure", error }], [{ type: "plugboard.failure", error }]])
  })

  test("release reports whether the session was registered", () => {
    const store = createSessionStore()
    store.register(state("ses_1"))
    expect(store.release("ses_1")).toBe(true)
    expect(store.release("ses_1")).toBe(false)
  })
})

describe("#33 retire: the guard outlives the response, boundedly", () => {
  test("a retired guard stays until the host reports the execution end", () => {
    jest.useFakeTimers()
    try {
      const store = createSessionStore()
      store.register(state("ses_1"))
      const onTimeout = jest.fn()
      store.retire("ses_1", { timeoutMs: 30_000, onTimeout })
      jest.advanceTimersByTime(29_999)
      expect(store.lookup("ses_1")).toBeDefined()
      store.dispatch(bus("ses_1").executionSucceeded())
      expect(store.lookup("ses_1")).toBeUndefined()
      jest.advanceTimersByTime(10_000)
      expect(onTimeout).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })

  test("without an execution end, the timeout logs session.cleanup_timeout, calls onTimeout once and releases", () => {
    jest.useFakeTimers()
    try {
      const store = createSessionStore()
      store.register(state("ses_1"))
      const onTimeout = jest.fn()
      store.retire("ses_1", { timeoutMs: 30_000, onTimeout })
      store.retire("ses_1", { timeoutMs: 1, onTimeout })
      jest.advanceTimersByTime(30_000)
      expect(onTimeout).toHaveBeenCalledTimes(1)
      expect(store.lookup("ses_1")).toBeUndefined()
      expect(logs.of("session.cleanup_timeout")[0]!.fields).toMatchObject({ sessionID: "ses_1", requestID: "req_ses_1", outcome: "execution_end_not_confirmed" })
    } finally {
      jest.useRealTimers()
    }
  })

  test("a throwing onTimeout is logged and the guard is still released", () => {
    jest.useFakeTimers()
    try {
      const store = createSessionStore()
      store.register(state("ses_1"))
      store.retire("ses_1", { timeoutMs: 10, onTimeout: () => { throw new Error("interrupt failed") } })
      jest.advanceTimersByTime(10)
      expect(store.lookup("ses_1")).toBeUndefined()
      expect(logs.of("session.cleanup_failed")).toHaveLength(1)
    } finally {
      jest.useRealTimers()
    }
  })

  test("re-registering the same session clears the old retire timer", () => {
    jest.useFakeTimers()
    try {
      const store = createSessionStore()
      store.register(state("ses_1"))
      const onTimeout = jest.fn()
      store.retire("ses_1", { timeoutMs: 10, onTimeout })
      store.register(state("ses_1"))
      jest.advanceTimersByTime(100)
      expect(onTimeout).not.toHaveBeenCalled()
      expect(store.lookup("ses_1")).toBeDefined()
    } finally {
      jest.useRealTimers()
    }
  })

  test("retiring an unknown session does nothing", () => {
    expect(() => createSessionStore().retire("ses_x", { timeoutMs: 1, onTimeout() {} })).not.toThrow()
  })
})
