/**
 * A deleted anchor is recreated once (prompt-cache affinity, #80): the host's `Session.NotFoundError` for a missing
 * parent becomes `MissingParentError`; the caller forgets the stored anchor, makes one new anchor, and retries the child
 * create once. It never loops, and an anchor is never registered in the session store (so never pruned: src/session/prune.ts).
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { CallContext, PlugEvent } from "../../src/contract.js"
import { createAffinity } from "../../src/session/affinity.js"
import { createSessionCaller } from "../../src/session/caller.js"
import { createSessionPort, MissingParentError, type HostContext } from "../../src/session/host.js"
import { createSessionStore } from "../../src/session/state.js"
import { captureLogs } from "../support/logs.js"
import { plugRequest } from "../support/fixtures.js"
import { bus, FakeSessionPort } from "../support/session.js"
import { FakeStorage } from "../support/usage.js"

const logs = captureLogs()

describe("the host's missing-parent failure", () => {
  const hostWith = (failure: unknown) => createSessionPort({ session: { create: () => Effect.fail(failure) } } as unknown as HostContext)
  const child = { directory: "/app", model: { providerID: "p", id: "m" }, title: "t", metadata: {}, permissions: [], parentID: "ses_gone" }

  test("Session.NotFoundError for the parent is a MissingParentError", async () => {
    await expect(hostWith({ _tag: "Session.NotFoundError", sessionID: "ses_gone" }).create(child)).rejects.toBeInstanceOf(MissingParentError)
  })

  test("any other host failure passes through unchanged", async () => {
    const error = await hostWith({ _tag: "Session.BusyError" })
      .create(child)
      .catch((caught: unknown) => caught)
    expect(error).not.toBeInstanceOf(MissingParentError)
    expect(error).toEqual({ _tag: "Session.BusyError" })
  })
})

/** A caller with anchors on for the app `bot`, over a fake host and a real store. */
function setup() {
  const port = new FakeSessionPort()
  const sessions = createSessionStore()
  const storage = new FakeStorage()
  const caller = createSessionCaller({
    port,
    sessions,
    maxTools: 2,
    affinity: createAffinity({ storage }),
    promptCache: { affinity: "anchor", scope: "app" },
  })
  port.script.prompt = async (input) => {
    queueMicrotask(() => [bus(input.sessionID).textDelta("Hi"), bus(input.sessionID).stepEnded("stop"), bus(input.sessionID).executionSucceeded()].forEach((event) => sessions.dispatch(event)))
  }
  return { port, sessions, caller }
}

async function drain(stream: AsyncIterable<PlugEvent>): Promise<PlugEvent[]> {
  const out: PlugEvent[] = []
  for await (const event of stream) out.push(event)
  return out
}

const context = (): CallContext => ({ app: "bot", signal: new AbortController().signal })

describe("a deleted anchor is recreated once", () => {
  test("the stale anchor is replaced, the child retried once, and the event is logged", async () => {
    const run = setup()
    await drain(run.caller.stream(plugRequest(), context()))
    const staleAnchor = run.port.created[0]!.id
    expect(run.port.created[1]!.parentID).toBe(staleAnchor)

    // The user deletes the anchor in OpenCode: children of it fail with the host's missing-parent error.
    let refused = 0
    run.port.script.create = async (input) => {
      if (input.parentID === staleAnchor) {
        refused++
        throw new MissingParentError()
      }
      return { id: `ses_${run.port.created.length + 1}` }
    }
    const events = await drain(run.caller.stream(plugRequest(), context()))
    expect(events.some((event) => event.type === "error")).toBe(false)
    expect(refused).toBe(1)

    const anchors = run.port.created.filter((created) => created.title === "plugboard anchor: bot")
    expect(anchors).toHaveLength(2)
    const fresh = anchors[1]!
    expect(fresh.id).not.toBe(staleAnchor)
    expect(run.port.created.at(-1)!.parentID).toBe(fresh.id)
    expect(logs.of("affinity.anchor_recreated")).toHaveLength(1)
    expect(logs.of("affinity.anchor_recreated")[0]!.fields.previous).toBe(staleAnchor)
  })

  test("the new anchor is remembered: the next request uses it without another recreation", async () => {
    const run = setup()
    await drain(run.caller.stream(plugRequest(), context()))
    const staleAnchor = run.port.created[0]!.id
    run.port.script.create = async (input) => {
      if (input.parentID === staleAnchor) throw new MissingParentError()
      return { id: `ses_${run.port.created.length + 1}` }
    }
    await drain(run.caller.stream(plugRequest(), context()))
    run.port.script.create = undefined
    await drain(run.caller.stream(plugRequest(), context()))
    const anchors = run.port.created.filter((created) => created.title === "plugboard anchor: bot")
    expect(anchors).toHaveLength(2)
    expect(run.port.created.at(-1)!.parentID).toBe(anchors[1]!.id)
    expect(logs.of("affinity.anchor_recreated")).toHaveLength(1)
  })

  test("never loops: a child that still has a missing parent after the retry fails the request", async () => {
    const run = setup()
    let childAttempts = 0
    run.port.script.create = async (input) => {
      if (input.parentID !== undefined) {
        childAttempts++
        throw new MissingParentError()
      }
      return { id: `ses_${run.port.created.length + 1}` }
    }
    const events = await drain(run.caller.stream(plugRequest(), context()))
    expect(childAttempts).toBe(2)
    expect(events).toEqual([{ type: "error", error: { status: 502, kind: "server", message: "plugboard session backend failed", code: "backend_failed" } }])
    expect(logs.of("affinity.anchor_recreated")).toHaveLength(1)
  })

  test("anchors are never registered in the session store, so history pruning (which indexes registered sessions) never sees them", async () => {
    const run = setup()
    await drain(run.caller.stream(plugRequest(), context()))
    const anchor = run.port.created.find((created) => created.title === "plugboard anchor: bot")!
    expect(run.sessions.lookup(anchor.id)).toBeUndefined()
  })
})
