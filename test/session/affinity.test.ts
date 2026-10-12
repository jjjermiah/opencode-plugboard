/**
 * Prompt-cache affinity (src/session/affinity.ts, option `promptCache`, issue #80): the anchor session of a scope key
 * is made once and remembered, request sessions are its children under mode `anchor`, the scope follows the policy,
 * an app holds at most `maxAnchors` anchors (beyond it a key gets no affinity: header `none`), and an anchor never
 * serves another app (I29).
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

const CAP = 1000

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
    const affinity = createAffinity({ storage: new FakeStorage() })
    let made = 0
    const make = async () => `ses_anchor_${++made}`
    expect(await affinity.anchor("bot", "app", "", CAP, make)).toBe("ses_anchor_1")
    expect(await affinity.anchor("bot", "app", "", CAP, make)).toBe("ses_anchor_1")
    expect(made).toBe(1)
  })

  test("the anchor survives a restart: a new store over the same storage reuses it", async () => {
    const storage = new FakeStorage()
    await createAffinity({ storage }).anchor("bot", "app", "", CAP, async () => "ses_kept")
    let made = 0
    expect(await createAffinity({ storage }).anchor("bot", "app", "", CAP, async () => (made++, "ses_new"))).toBe("ses_kept")
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
    const ids = await Promise.all([affinity.anchor("bot", "app", "", CAP, make), affinity.anchor("bot", "app", "", CAP, make), affinity.anchor("bot", "app", "", CAP, make)])
    expect(ids).toEqual(["ses_once", "ses_once", "ses_once"])
    expect(made).toBe(1)
  })

  test("a failed creation is not remembered: the next call makes the anchor", async () => {
    const affinity = createAffinity({ storage: new FakeStorage() })
    await expect(affinity.anchor("bot", "app", "", CAP, async () => Promise.reject(new Error("host down")))).rejects.toThrow("host down")
    expect(await affinity.anchor("bot", "app", "", CAP, async () => "ses_later")).toBe("ses_later")
  })

  test("a stored record that does not parse is no record: a new anchor is made", async () => {
    const storage = new FakeStorage()
    await storage.put("affinity/bot/anchor/app/", "not json")
    expect(await createAffinity({ storage }).anchor("bot", "app", "", CAP, async () => "ses_fresh")).toBe("ses_fresh")
  })

  test("forget drops the stored anchor, so the next call makes a new one", async () => {
    const affinity = createAffinity({ storage: new FakeStorage() })
    await affinity.anchor("bot", "user", "alice", CAP, async () => "ses_old")
    await affinity.forget("bot", "user", "alice")
    expect(await affinity.anchor("bot", "user", "alice", CAP, async () => "ses_new")).toBe("ses_new")
  })

  test("I29: an anchor never serves another app, nor another scope key", async () => {
    const affinity = createAffinity({ storage: new FakeStorage() })
    expect(await affinity.anchor("alpha", "app", "", CAP, async () => "ses_alpha")).toBe("ses_alpha")
    expect(await affinity.anchor("beta", "app", "", CAP, async () => "ses_beta")).toBe("ses_beta")
    expect(await affinity.anchor("alpha", "user", "alice", CAP, async () => "ses_alice")).toBe("ses_alice")
    expect(await affinity.anchor("alpha", "user", "bob", CAP, async () => "ses_bob")).toBe("ses_bob")
  })
})

describe("maxAnchors: the cap per app", () => {
  test("a new key beyond the cap gets no anchor, and make is not called", async () => {
    const affinity = createAffinity({ storage: new FakeStorage() })
    for (const user of ["alice", "bob"]) await affinity.anchor("bot", "user", user, 2, async () => `ses_${user}`)
    let made = 0
    expect(await affinity.anchor("bot", "user", "carol", 2, async () => (made++, "ses_carol"))).toBeUndefined()
    expect(made).toBe(0)
  })

  test("a key that already has its anchor keeps it when the app is at the cap", async () => {
    const affinity = createAffinity({ storage: new FakeStorage() })
    for (const user of ["alice", "bob"]) await affinity.anchor("bot", "user", user, 2, async () => `ses_${user}`)
    expect(await affinity.anchor("bot", "user", "alice", 2, async () => "ses_never")).toBe("ses_alice")
  })

  test("the cap is per app: another app is not full", async () => {
    const affinity = createAffinity({ storage: new FakeStorage() })
    for (const user of ["alice", "bob"]) await affinity.anchor("bot", "user", user, 2, async () => `ses_${user}`)
    expect(await affinity.anchor("other", "user", "carol", 2, async () => "ses_other")).toBe("ses_other")
  })
})

describe("reportAffinity: the x-plugboard-affinity header", () => {
  test("sets the mode while the headers are open, and not after they are sent", () => {
    const headers = new Map<string, string>()
    const response = { headersSent: false, destroyed: false, setHeader: (name: string, value: string) => void headers.set(name, value) }
    reportAffinity(response)("anchor")
    expect(headers.get(AFFINITY_HEADER)).toBe("anchor")
    reportAffinity(response)("none")
    expect(headers.get(AFFINITY_HEADER)).toBe("none")
    headers.clear()
    reportAffinity({ ...response, headersSent: true })("anchor")
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
  return { port, sessions, caller }
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
    const modes: string[] = []
    for (let turn = 0; turn < 2; turn++) await drain(run.caller.stream(plugRequest(), context({ onAffinity: (mode) => void modes.push(mode) })))
    const [anchor, first, second] = run.port.created
    expect(run.port.created).toHaveLength(3)
    expect(anchor!.title).toBe("plugboard anchor: bot")
    expect(anchor!.parentID).toBeUndefined()
    expect(first!.parentID).toBe(anchor!.id)
    expect(second!.parentID).toBe(anchor!.id)
    expect(first!.id).not.toBe(second!.id)
    expect(modes).toEqual(["anchor", "anchor"])
  })

  test("off by default: no anchor, no parent, and no header", async () => {
    const run = setup()
    const modes: string[] = []
    await drain(run.caller.stream(plugRequest(), context({ onAffinity: (mode) => void modes.push(mode) })))
    expect(run.port.created).toHaveLength(1)
    expect(run.port.created[0]!.parentID).toBeUndefined()
    expect(modes).toEqual([])
  })

  test("user scope: one anchor per user; a request with no user gets no affinity, reported as none", async () => {
    const run = setup({ promptCache: { affinity: "anchor", scope: "user" } })
    const modes: string[] = []
    const reporting = context({ onAffinity: (mode) => void modes.push(mode) })
    await drain(run.caller.stream(plugRequest({ user: "alice" }), reporting))
    await drain(run.caller.stream(plugRequest({ user: "bob" }), reporting))
    await drain(run.caller.stream(plugRequest(), reporting))
    const anchors = run.port.created.filter((created) => created.title.startsWith("plugboard anchor"))
    expect(anchors.map((created) => created.title)).toEqual(["plugboard anchor: bot/alice", "plugboard anchor: bot/bob"])
    expect(run.port.created.filter((created) => created.parentID === undefined)).toHaveLength(anchors.length + 1)
    expect(modes).toEqual(["anchor", "anchor", "none"])
  })

  test("beyond maxAnchors a new user gets no affinity: a top-level session, header none, no anchor made", async () => {
    const run = setup({ promptCache: { affinity: "anchor", scope: "user", maxAnchors: 1 } })
    const modes: string[] = []
    const reporting = context({ onAffinity: (mode) => void modes.push(mode) })
    await drain(run.caller.stream(plugRequest({ user: "alice" }), reporting))
    await drain(run.caller.stream(plugRequest({ user: "bob" }), reporting))
    await drain(run.caller.stream(plugRequest({ user: "alice" }), reporting))
    const anchors = run.port.created.filter((created) => created.title.startsWith("plugboard anchor"))
    expect(anchors.map((created) => created.title)).toEqual(["plugboard anchor: bot/alice"])
    const bob = run.port.created.find((created) => created.title.includes("hello") && created.title.startsWith("[bob]"))
    expect(bob).toBeDefined()
    expect(bob!.parentID).toBeUndefined()
    expect(modes).toEqual(["anchor", "none", "anchor"])
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
