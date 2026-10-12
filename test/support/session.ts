/**
 * Fakes for the session layer (src/session/*), shared with the runtime tests: a scriptable
 * `SessionPort`, an in-memory `HistoryPort`, and `bus`, a builder for the host bus envelopes the
 * event pump hands to `SessionStore.dispatch` (`{ type, data: { sessionID, ... } }`).
 *
 * Field names follow what `RequestCollector` reads (src/session/events.ts); when the host's event
 * shapes change, change them here once.
 */
import type { HistoryPort, Json, SessionPort } from "../../src/session/host.js"

type CreateInput = Parameters<SessionPort["create"]>[0]
type PromptInput = Parameters<SessionPort["prompt"]>[0]

/** A recorded `SessionPort`. Each method can be made to fail or wait via `script`. */
export class FakeSessionPort implements SessionPort {
  readonly created: Array<CreateInput & { readonly id: string }> = []
  readonly prompted: PromptInput[] = []
  readonly interrupted: string[] = []
  readonly removed: string[] = []
  /** Skills and agents the fake app directory has: `skills.set(id, content)`, `agents.set(id, { system })`. */
  readonly skills = new Map<string, string>()
  readonly agents = new Map<string, { readonly system?: string }>()
  /** The OpenCode tool ids `directTools()` reports (the location's direct tools). Empty by default. */
  readonly toolIDs: string[] = []
  /** Answers per method; default: create returns `ses_<n>`, prompt and interrupt resolve. */
  readonly script: {
    create?: (input: CreateInput) => Promise<{ id: string }>
    prompt?: (input: PromptInput) => Promise<unknown>
    interrupt?: (sessionID: string) => Promise<void>
    remove?: (sessionID: string) => Promise<void>
  } = {}

  async create(input: CreateInput): Promise<{ id: string }> {
    const { id } = this.script.create ? await this.script.create(input) : { id: `ses_${this.created.length + 1}` }
    this.created.push({ ...input, id })
    return { id }
  }

  prompt(input: PromptInput): Promise<unknown> {
    this.prompted.push(input)
    return this.script.prompt ? this.script.prompt(input) : Promise.resolve(undefined)
  }

  interrupt(sessionID: string): Promise<void> {
    this.interrupted.push(sessionID)
    return this.script.interrupt ? this.script.interrupt(sessionID) : Promise.resolve()
  }

  async remove(sessionID: string): Promise<void> {
    this.removed.push(sessionID)
    if (this.script.remove) await this.script.remove(sessionID)
  }

  async skill(_directory: string, id: string): Promise<string | undefined> {
    return this.skills.get(id)
  }

  async agent(_directory: string, id: string): Promise<{ readonly system?: string } | undefined> {
    return this.agents.get(id)
  }

  directTools(): Promise<ReadonlyArray<string>> {
    return Promise.resolve([...this.toolIDs])
  }
}

/**
 * `ctx.storage` plus `session.remove` in memory. Keys scan in ascending order like the host's
 * key-value table. `sessions` are the session IDs the host still has; `failing` ones reject on
 * remove.
 */
export class FakeHistoryPort implements HistoryPort {
  readonly entries = new Map<string, string>()
  readonly sessions = new Set<string>()
  readonly failing = new Set<string>()
  readonly removed: string[] = []

  async put(key: string, value: string): Promise<void> {
    this.entries.set(key, value)
  }

  async drop(key: string): Promise<void> {
    this.entries.delete(key)
  }

  async scan(input: { readonly prefix: string; readonly after?: string; readonly limit: number }) {
    const keys = [...this.entries.keys()].filter((key) => key.startsWith(input.prefix) && (input.after === undefined || key > input.after)).sort()
    const page = keys.slice(0, input.limit)
    return { keys: page, ...(keys.length > input.limit ? { next: page.at(-1)! } : {}) }
  }

  async removeSession(sessionID: string): Promise<"removed" | "missing"> {
    if (this.failing.has(sessionID)) throw new Error(`remove ${sessionID} failed`)
    if (!this.sessions.delete(sessionID)) return "missing"
    this.removed.push(sessionID)
    return "removed"
  }
}

/** A host bus envelope as the event pump receives it. */
export interface BusEnvelope {
  readonly type: string
  readonly data: { readonly sessionID: string; readonly [key: string]: unknown }
}

/** Host token usage (`RawUsage` in src/session/events.ts): non-overlapping, as OpenCode reports it. */
export interface HostTokens {
  readonly input?: number
  readonly output?: number
  readonly reasoning?: number
  readonly cache?: { readonly read?: number; readonly write?: number }
}

/** Host `SessionError` (`RawError` in src/session/events.ts). `response.body` is the provider's raw text. */
export interface HostError {
  readonly type: string
  readonly message?: string
  readonly status?: number
  readonly response?: { readonly body?: string }
}

/** Envelope builders for one session: `bus("ses_1").textDelta("Hi")`. */
export function bus(sessionID: string) {
  const envelope = (type: string, data: Record<string, unknown> = {}): BusEnvelope => ({ type, data: { sessionID, ...data } })
  return {
    textDelta: (delta: string, ordinal = 0) => envelope("session.text.delta", { delta, ordinal }),
    textEnded: (text: string, ordinal = 0) => envelope("session.text.ended", { text, ordinal }),
    reasoningDelta: (delta: string) => envelope("session.reasoning.delta", { delta }),
    /** The end of a reasoning block; `state` is the provider metadata the host attaches (`{ anthropic: { signature } }`). */
    reasoningEnded: (state: Json = {}) => envelope("session.reasoning.ended", { text: "", ordinal: 0, state }),
    toolInputStarted: (id: string, name: string) => envelope("session.tool.input.started", { id, name }),
    toolCalled: (id: string, name: string, input: Json = {}) => envelope("session.tool.called", { id, name, input }),
    usage: (tokens: HostTokens) => envelope("session.usage.updated", { tokens }),
    stepEnded: (finish = "stop", tokens?: HostTokens) => envelope("session.step.ended", { finish, ...(tokens ? { tokens } : {}) }),
    stepFailed: (error: HostError, finish?: string) => envelope("session.step.failed", { error, ...(finish ? { finish } : {}) }),
    executionSucceeded: () => envelope("session.execution.succeeded"),
    executionFailed: (error: HostError = { type: "unknown" }) => envelope("session.execution.failed", { error }),
    executionInterrupted: () => envelope("session.execution.interrupted"),
    toolSucceeded: (id: string) => envelope("session.tool.success", { id, content: [{ type: "text", text: "result" }], executed: true }),
    toolFailed: (id: string) => envelope("session.tool.failed", { id, error: { type: "unknown" }, executed: true }),
  }
}
