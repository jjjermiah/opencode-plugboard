/**
 * `history.hidden` (since 0.30.0, #337): a request session is a child of one per-app parent titled `plugboard: <app>`, which
 * OpenCode's top-level lists do not show. The parent is the app-scope anchor (src/session/affinity.ts): made once, recreated
 * once if it was deleted, and shared with a promptCache app-scope anchor. Checked on the fake host's `parentID`; the live
 * session list is not checkable from here (see the PR).
 */
import { describe, expect, test } from "bun:test"
import type { AppPolicy, PromptCache } from "../../src/config.js"
import type { CallContext, PlugEvent } from "../../src/contract.js"
import { createAffinity } from "../../src/session/affinity.js"
import { createSessionCaller } from "../../src/session/caller.js"
import { MissingParentError } from "../../src/session/host.js"
import { recordSession, sweepHistory } from "../../src/session/prune.js"
import { createSessionStore } from "../../src/session/state.js"
import { plugRequest } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { bus, FakeHistoryPort, FakeSessionPort } from "../support/session.js"
import { FakeStorage } from "../support/usage.js"

const logs = captureLogs()
const PARENT = "plugboard: bot"
const APP_RECORD = "affinity/bot/anchor/app/"

interface Setup {
  readonly historyHidden?: boolean
  readonly apps?: Record<string, AppPolicy>
  readonly promptCache?: PromptCache
  readonly storage?: FakeStorage
}

function setup(options: Setup = {}) {
  const port = new FakeSessionPort()
  const sessions = createSessionStore()
  const storage = options.storage ?? new FakeStorage()
  const caller = createSessionCaller({
    port,
    sessions,
    maxTools: 2,
    affinity: createAffinity({ storage }),
    historyHidden: options.historyHidden,
    apps: options.apps,
    promptCache: options.promptCache,
  })
  port.script.prompt = async (input) => {
    queueMicrotask(() => [bus(input.sessionID).textDelta("Hi"), bus(input.sessionID).stepEnded("stop"), bus(input.sessionID).executionSucceeded()].forEach((event) => sessions.dispatch(event)))
  }
  return { port, sessions, caller, storage }
}

async function drain(stream: AsyncIterable<PlugEvent>): Promise<PlugEvent[]> {
  const out: PlugEvent[] = []
  for await (const event of stream) out.push(event)
  return out
}

const context = (extra: Partial<CallContext> = {}): CallContext => ({ app: "bot", signal: new AbortController().signal, ...extra })
const parents = (port: FakeSessionPort) => port.created.filter((created) => created.title === PARENT)
const children = (port: FakeSessionPort) => port.created.filter((created) => created.title !== PARENT)

describe("history.hidden: request sessions under the app's parent (#337)", () => {
  test("hidden off still creates top-level sessions: no parent, no parentID", async () => {
    const run = setup()
    await drain(run.caller.stream(plugRequest(), context()))
    await drain(run.caller.stream(plugRequest(), context()))
    expect(run.port.created).toHaveLength(2)
    expect(parents(run.port)).toHaveLength(0)
    expect(run.port.created.every((created) => created.parentID === undefined)).toBe(true)
  })

  test("global on: every request is a child of one parent titled plugboard: <app>, made once", async () => {
    const run = setup({ historyHidden: true })
    await drain(run.caller.stream(plugRequest(), context()))
    await drain(run.caller.stream(plugRequest(), context()))
    const [parent] = parents(run.port)
    expect(parents(run.port)).toHaveLength(1)
    expect(children(run.port)).toHaveLength(2)
    for (const child of children(run.port)) expect(child.parentID).toBe(parent!.id)
  })

  test("an app's own history.hidden turns it on while the global option is off", async () => {
    const run = setup({ apps: { bot: { systemMode: "prepend", tools: true, history: { hidden: true } } } })
    await drain(run.caller.stream(plugRequest(), context()))
    const [parent] = parents(run.port)
    expect(run.port.created.at(-1)!.parentID).toBe(parent!.id)
  })

  test("an app's own history.hidden: false keeps that app top-level while the global option is on", async () => {
    const run = setup({ historyHidden: true, apps: { bot: { systemMode: "prepend", tools: true, history: { hidden: false } } } })
    await drain(run.caller.stream(plugRequest(), context()))
    expect(parents(run.port)).toHaveLength(0)
    expect(run.port.created[0]!.parentID).toBeUndefined()
  })

  test("the parent is recreated once if it was deleted in OpenCode, and the request is retried once", async () => {
    const run = setup({ historyHidden: true })
    await drain(run.caller.stream(plugRequest(), context()))
    const stale = parents(run.port)[0]!.id
    run.port.script.create = async (input) => {
      if (input.parentID === stale) throw new MissingParentError()
      return { id: `ses_${run.port.created.length + 1}` }
    }
    const events = await drain(run.caller.stream(plugRequest(), context()))
    expect(events.some((event) => event.type === "error")).toBe(false)
    run.port.script.create = undefined
    const fresh = parents(run.port)[1]!
    expect(fresh.id).not.toBe(stale)
    expect(run.port.created.at(-1)!.parentID).toBe(fresh.id)
    expect(logs.of("affinity.anchor_recreated")).toHaveLength(1)
    expect(logs.of("affinity.anchor_recreated")[0]!.fields.previous).toBe(stale)
  })

  test("concurrent requests after a parent delete share one replacement: no second parent is made", async () => {
    const run = setup({ historyHidden: true })
    await drain(run.caller.stream(plugRequest(), context()))
    const stale = parents(run.port)[0]!.id
    // Both requests read the stale parent before either is refused (the first waits for the second). The second
    // refusal then waits until the replacement is stored, so a `forget` that drops whatever record is there (the old
    // code) would drop the fresh record, and the second request would make another parent.
    let refused = 0
    let next = 0
    const until = async (condition: () => boolean) => {
      for (let spins = 0; spins < 2000 && !condition(); spins++) await new Promise((done) => setImmediate(done))
    }
    run.port.script.create = async (input) => {
      if (input.title === PARENT) return { id: `ses_parent_${++next}` }
      if (input.parentID !== stale) return { id: `ses_child_${++next}` }
      refused++
      if (refused === 1) await until(() => refused >= 2)
      else await until(() => run.storage.values.has(APP_RECORD))
      throw new MissingParentError()
    }
    const [a, b] = await Promise.all([drain(run.caller.stream(plugRequest(), context())), drain(run.caller.stream(plugRequest(), context()))])
    run.port.script.create = undefined
    expect([...a, ...b].some((event) => event.type === "error")).toBe(false)
    expect(refused).toBe(2)
    const fresh = parents(run.port).filter((parent) => parent.id.startsWith("ses_parent_"))
    expect(fresh).toHaveLength(1)
    const recent = run.port.created.slice(-2)
    for (const child of recent) expect(child.parentID).toBe(fresh[0]!.id)
  })

  test("with a promptCache app-scope anchor too, one parent serves both", async () => {
    const run = setup({ historyHidden: true, promptCache: { affinity: "anchor", scope: "app" } })
    await drain(run.caller.stream(plugRequest(), context()))
    await drain(run.caller.stream(plugRequest(), context()))
    const [parent] = parents(run.port)
    expect(parents(run.port)).toHaveLength(1)
    expect(children(run.port)).toHaveLength(2)
    for (const child of children(run.port)) expect(child.parentID).toBe(parent!.id)
  })

  test("a parent made by promptCache keeps its title when history.hidden is turned on (documented exception)", async () => {
    const storage = new FakeStorage()
    const before = setup({ promptCache: { affinity: "anchor", scope: "app" }, storage })
    await drain(before.caller.stream(plugRequest(), context()))
    const anchor = before.port.created[0]!
    expect(anchor.title).toBe("plugboard anchor: bot")

    const after = setup({ historyHidden: true, storage })
    await drain(after.caller.stream(plugRequest(), context()))
    expect(after.port.created).toHaveLength(1)
    expect(after.port.created[0]!.parentID).toBe(anchor.id)
  })

  test("at the cap, the hidden request runs top-level, warned once per app, not once per request", async () => {
    const storage = new FakeStorage()
    // A stored per-user record from an earlier `scope: user` config fills the cap of 1; it is never dropped.
    await storage.put("affinity/bot/anchor/user/alice", JSON.stringify({ sessionID: "ses_old" }))
    const run = setup({ historyHidden: true, promptCache: { affinity: "off", scope: "app", maxAnchors: 1 }, storage })
    for (let turn = 0; turn < 3; turn++) {
      const events = await drain(run.caller.stream(plugRequest(), context()))
      expect(events.some((event) => event.type === "error")).toBe(false)
    }
    expect(parents(run.port)).toHaveLength(0)
    expect(run.port.created).toHaveLength(3)
    expect(run.port.created.every((created) => created.parentID === undefined)).toBe(true)
    expect(logs.of("history.hidden_parent_unavailable")).toHaveLength(1)
  })

  test("the request still gets its history record and the child is what pruning indexes, never the parent", async () => {
    const run = setup({ historyHidden: true })
    const recorded: string[] = []
    await drain(run.caller.stream(plugRequest(), context({ onRecord: (sessionID) => void recorded.push(sessionID) })))
    const parent = parents(run.port)[0]!
    const child = children(run.port)[0]!
    expect(recorded).toEqual([child.id])
    expect(child.parentID).toBe(parent.id)

    // Pruning still sees the child: its index entry is swept like any other request session.
    const port = new FakeHistoryPort()
    port.sessions.add(child.id)
    await recordSession(port, "bot", child.id, Date.now() - 10 * 86_400_000)
    const swept = await sweepHistory({ port, limits: { maxAgeDays: 1 }, sessions: createSessionStore(), now: Date.now(), signal: new AbortController().signal })
    expect(swept.removed).toBe(1)
    expect(port.removed).toEqual([child.id])
  })
})
