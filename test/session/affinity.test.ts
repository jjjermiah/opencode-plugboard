/**
 * Prompt-cache affinity (src/session/affinity.ts, option `promptCache`, issue #80): the anchor session of a scope key
 * is made once and remembered, request sessions are its children under mode `anchor`, the scope follows the policy,
 * and an anchor never serves another app (I29).
 */
import { describe, expect, test } from "bun:test"
import type { AppPolicy } from "../../src/config.js"
import type { CallContext, PlugEvent } from "../../src/contract.js"
import { AFFINITY_HEADER, createAffinity, PROMPT_CACHE_OFF, reportAffinity, scopeKey } from "../../src/session/affinity.js"
import { createSessionCaller, type SessionCallerDeps } from "../../src/session/caller.js"
import { createSessionStore } from "../../src/session/state.js"
import { plugRequest } from "../support/fixtures.js"
import { bus, FakeSessionPort, type BusEnvelope } from "../support/session.js"
import { FakeStorage } from "../support/usage.js"

describe("scopeKey: the key that scopes one anchor", () => {
  test("app scope is one key for every request; user scope is the caller's user", () => {
    expect(scopeKey({ affinity: "anchor", scope: "app" }, { user: "alice" })).toBe("")
    expect(scopeKey({ affinity: "anchor", scope: "user" }, { user: "alice" })).toBe("alice")
  })

  test("user scope without a user has no key, so the request gets no affinity", () => {
    expect(scopeKey({ affinity: "anchor", scope: "user" }, {})).toBeUndefined()
  })

  test("the default policy is off, app scope", () => {
    expect(PROMPT_CACHE_OFF).toEqual({ affinity: "off", scope: "app" })
  })
})

describe("createAffinity: one anchor per key, made once", () => {
  test("the second call on a key returns the stored anchor without making another", async () => {
    const storage = new FakeStorage()
    const affinity = createAffinity({ storage })
    let made = 0
    const make = async () => `ses_anchor_${++made}`
    expect(await affinity.anchor("bot", "app", "", make)).toBe("ses_anchor_1")
    expect(await affinity.anchor("bot", "app", "", make)).toBe("ses_anchor_1")
    expect(made).toBe(1)
  })

  test("the anchor survives a restart: a new store over the same storage reuses it", async () => {
    const storage = new FakeStorage()
    await createAffinity({ storage }).anchor("bot", "app", "", async () => "ses_kept")
    let made = 0
    expect(await createAffinity({ storage }).anchor("bot", "app", "", async () => (made++, "ses_new"))).toBe("ses_kept")
    expect(made).toBe(0)
  })

  test("concurrent first requests on one key share one creation", async () => {
    const affinity = createAffinity({ storage: new FakeStorage() })
    let made = 0
    const make = async () => {
      made++
      await new Promise((resolve) => setTimeout(resolve, 5))
      return "ses_once"
    }
    const ids = await Promise.all([affinity.anchor("bot", "app", "", make), affinity.anchor("bot", "app", "", make), affinity.anchor("bot", "app", "", make)])
    expect(ids).toEqual(["ses_once", "ses_once", "ses_once"])
    expect(made).toBe(1)
  })

  test("a failed creation is not remembered: the next call makes the anchor", async () => {
    const affinity = createAffinity({ storage: new FakeStorage() })
    await expect(affinity.anchor("bot", "app", "", async () => Promise.reject(new Error("host down")))).rejects.toThrow("host down")
    expect(await affinity.anchor("bot", "app", "", async () => "ses_later")).toBe("ses_later")
  })

  test("a stored record that does not parse is no record: a new anchor is made", async () => {
    const storage = new FakeStorage()
    await storage.put("affinity/bot/anchor/app/", "not json")
    expect(await createAffinity({ storage }).anchor("bot", "app", "", async () => "ses_fresh")).toBe("ses_fresh")
  })

  test("I29: an anchor never serves another app, nor another scope key", async () => {
    const affinity = createAffinity({ storage: new FakeStorage() })
    expect(await affinity.anchor("alpha", "app", "", async () => "ses_alpha")).toBe("ses_alpha")
    expect(await affinity.anchor("beta", "app", "", async () => "ses_beta")).toBe("ses_beta")
    expect(await affinity.anchor("alpha", "user", "alice", async () => "ses_alice")).toBe("ses_alice")
    expect(await affinity.anchor("alpha", "user", "bob", async () => "ses_bob")).toBe("ses_bob")
  })
})

describe("reportAffinity: the x-plugboard-affinity header", () => {
  test("sets anchor while the headers are open, and not after they are sent", () => {
    const headers = new Map<string, string>()
    const response = { headersSent: false, destroyed: false, setHeader: (name: string, value: string) => void headers.set(name, value) }
    reportAffinity(response)()
    expect(headers.get(AFFINITY_HEADER)).toBe("anchor")
    headers.clear()
    reportAffinity({ ...response, headersSent: true })()
    expect(headers.size).toBe(0)
  })
})

/** A caller with the anchor store on, and `policy` for the app `app` (or the global option when `apps` is absent). */
function setup(options: { promptCache?: SessionCallerDeps["promptCache"]; apps?: Record<string, AppPolicy> } = {}) {
  const port = new FakeSessionPort()
  const sessions = createSessionStore()
  const caller = createSessionCaller({ port, sessions, maxTools: 2, affinity: createAffinity({ storage: new FakeStorage() }), ...options })
  const answer = (events: (sessionID: string) => BusEnvelope[]) => {
    port.script.prompt = async (input) => {
      queueMicrotask(() => events(input.sessionID).forEach((event) => sessions.dispatch(event)))
    }
  }
  answer((id) => [bus(id).textDelta("Hi"), bus(id).stepEnded("stop"), bus(id).executionSucceeded()])
  return { port, caller }
}

async function drain(stream: AsyncIterable<PlugEvent>): Promise<PlugEvent[]> {
  const out: PlugEvent[] = []
  for await (const event of stream) out.push(event)
  return out
}

const context = (overrides: Partial<CallContext> = {}): CallContext => ({ app: "bot", signal: new AbortController().signal, ...overrides })

describe("mode anchor on the session caller", () => {
  test("the anchor is made once; every request session is its child, and the header is reported", async () => {
    const run = setup({ promptCache: { affinity: "anchor", scope: "app" } })
    let reported = 0
    for (let turn = 0; turn < 2; turn++) await drain(run.caller.stream(plugRequest(), context({ onAffinity: () => void reported++ })))
    const [anchor, first, second] = run.port.created
    expect(run.port.created).toHaveLength(3)
    expect(anchor!.title).toBe("plugboard anchor: bot")
    expect(anchor!.parentID).toBeUndefined()
    expect(first!.parentID).toBe(anchor!.id)
    expect(second!.parentID).toBe(anchor!.id)
    expect(first!.id).not.toBe(second!.id)
    expect(reported).toBe(2)
  })

  test("off by default: no anchor and no parent, as before", async () => {
    const run = setup()
    let reported = 0
    await drain(run.caller.stream(plugRequest(), context({ onAffinity: () => void reported++ })))
    expect(run.port.created).toHaveLength(1)
    expect(run.port.created[0]!.parentID).toBeUndefined()
    expect(reported).toBe(0)
  })

  test("user scope: one anchor per user; a request with no user gets no affinity", async () => {
    const run = setup({ promptCache: { affinity: "anchor", scope: "user" } })
    await drain(run.caller.stream(plugRequest({ user: "alice" }), context()))
    await drain(run.caller.stream(plugRequest({ user: "bob" }), context()))
    await drain(run.caller.stream(plugRequest(), context()))
    const anchors = run.port.created.filter((created) => created.title.startsWith("plugboard anchor"))
    expect(anchors.map((created) => created.title)).toEqual(["plugboard anchor: bot/alice", "plugboard anchor: bot/bob"])
    expect(run.port.created.filter((created) => created.parentID === undefined)).toHaveLength(anchors.length + 1)
  })

  test("an app's own promptCache overrides the global one, in both directions", async () => {
    const apps = {
      bot: { systemMode: "prepend", tools: true, promptCache: { affinity: "anchor", scope: "app" } },
      plain: { systemMode: "prepend", tools: true, promptCache: { affinity: "off", scope: "app" } },
    } as Record<string, AppPolicy>
    const run = setup({ promptCache: { affinity: "anchor", scope: "app" }, apps })
    await drain(run.caller.stream(plugRequest(), context({ app: "bot" })))
    await drain(run.caller.stream(plugRequest(), context({ app: "plain" })))
    expect(run.port.created.map((created) => created.title)).toEqual(["plugboard anchor: bot", "hello", "hello"])
    expect(run.port.created[2]!.parentID).toBeUndefined()
  })
})
