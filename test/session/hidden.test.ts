/**
 * `history.hidden` (since 0.29.0, #337): a request session is a child of one per-app parent titled `plugboard: <app>`, which
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
import { createSessionStore } from "../../src/session/state.js"
import { plugRequest } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { bus, FakeSessionPort } from "../support/session.js"
import { FakeStorage } from "../support/usage.js"

const logs = captureLogs()
const PARENT = "plugboard: bot"

interface Setup {
  readonly historyHidden?: boolean
  readonly apps?: Record<string, AppPolicy>
  readonly promptCache?: PromptCache
}

function setup(options: Setup = {}) {
  const port = new FakeSessionPort()
  const sessions = createSessionStore()
  const caller = createSessionCaller({ port, sessions, maxTools: 2, affinity: createAffinity({ storage: new FakeStorage() }), ...options })
  port.script.prompt = async (input) => {
    queueMicrotask(() =>
      [bus(input.sessionID).textDelta("Hi"), bus(input.sessionID).stepEnded("stop"), bus(input.sessionID).executionSucceeded()].forEach((event) => sessions.dispatch(event)),
    )
  }
  return { port, sessions, caller }
}

async function drain(stream: AsyncIterable<PlugEvent>): Promise<PlugEvent[]> {
  const out: PlugEvent[] = []
  for await (const event of stream) out.push(event)
  return out
}

const context = (): CallContext => ({ app: "bot", signal: new AbortController().signal })
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

  test("with a promptCache app-scope anchor too, one parent serves both", async () => {
    const run = setup({ historyHidden: true, promptCache: { affinity: "anchor", scope: "app" } })
    await drain(run.caller.stream(plugRequest(), context()))
    await drain(run.caller.stream(plugRequest(), context()))
    const [parent] = parents(run.port)
    expect(parents(run.port)).toHaveLength(1)
    expect(children(run.port)).toHaveLength(2)
    for (const child of children(run.port)) expect(child.parentID).toBe(parent!.id)
  })
})
