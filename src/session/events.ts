/**
 * Session event translation.
 *
 * `RequestCollector` receives the OpenCode bus events of ONE plugboard request session
 * (already filtered by the process-wide session store) and turns them into `PlugEvent`s that the
 * ModelCaller streams out through `events()` (not buffered beyond the queue).
 *
 * The turn is stopped from inside the model loop (see `session/seeds.ts`): once the step has ended
 * (`session.step.ended`) with at least one caller tool call, the owner is asked to interrupt the
 * session before a second model step can start, and the request finishes as `tool-calls`.
 * The collector never calls the host itself; the owner passes `stopTurn`.
 *
 * A call to one of the app's `serverTools` is not the caller's: OpenCode runs it, the runner starts
 * the next step with its result, and the collector neither emits it nor stops the turn. A step with
 * only server calls continues; a step that also holds a caller call is returned to the caller as usual.
 * Server steps are counted and capped (`maxServerToolSteps`), and so are the calls (`maxServerToolCalls`); each
 * server call is logged once. A server call that lands after the request ended is logged as
 * `server_tool.after_request` and its step stops the turn again (#196).
 */

import { isPlugError, type PlugError, type PlugEvent, type PlugFinish, type PlugUsage } from "../contract.js"
import { log, logError } from "../log.js"
import type { BusEvent } from "./host.js"
import { FAILURE_EVENT } from "./state.js"

/** At most this many events may wait for a slow consumer, and at most this many (estimated) bytes of them. */
const MAX_QUEUED_EVENTS = 10_000
const MAX_QUEUED_BYTES = 8 * 1024 * 1024

/** The error a request fails with when its consumer cannot keep up. */
const RESPONSE_OVERFLOW: PlugError = {
  status: 502,
  kind: "server",
  code: "response_overflow",
  message: "The response was not read fast enough; too much output was waiting",
}

/** A reasoning block's signature from the host's provider metadata (`{ <provider>: { signature } }`), or undefined when there is none. */
function signatureOf(state: unknown): string | undefined {
  if (typeof state !== "object" || state === null) return undefined
  for (const value of Object.values(state)) {
    const signature = typeof value === "object" && value !== null ? (value as { signature?: unknown }).signature : undefined
    if (typeof signature === "string" && signature.length > 0) return signature
  }
  return undefined
}

/** Rough size of an event's payload, for the queue's byte bound. */
function sizeOf(event: PlugEvent): number {
  switch (event.type) {
    case "text-delta":
    case "reasoning-delta":
      return event.text.length
    case "tool-call":
      return 64 + event.name.length + (JSON.stringify(event.input) ?? "").length
    default:
      return 256
  }
}

/**
 * Minimal async queue: producers `push`, one consumer iterates; `close` ends the iteration.
 * Bounded: `push` refuses an item that would exceed the item or byte limit (the caller decides
 * what to do; it never waits), so a slow consumer cannot make one request grow without limit.
 */
class EventQueue<T> implements AsyncIterable<T> {
  private items: Array<{ item: T; size: number }> = []
  private bytes = 0
  private waiter?: () => void
  private closed = false

  constructor(
    private readonly maxItems: number,
    private readonly maxBytes: number,
  ) {}

  /** False when the item was refused for size (nothing was queued). Unbounded when `force`. */
  push(item: T, size: number, force = false): boolean {
    if (this.closed) return true
    if (!force && (this.items.length >= this.maxItems || this.bytes + size > this.maxBytes)) return false
    this.items.push({ item, size })
    this.bytes += size
    this.wake()
    return true
  }

  /** Drop everything that waits (the consumer is gone or too slow). */
  clear(): void {
    this.items = []
    this.bytes = 0
  }

  close(): void {
    this.closed = true
    this.wake()
  }

  private wake() {
    const waiter = this.waiter
    this.waiter = undefined
    waiter?.()
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      const next = this.items.shift()
      if (next !== undefined) {
        this.bytes -= next.size
        yield next.item
        continue
      }
      if (this.closed) return
      await new Promise<void>((resolve) => {
        this.waiter = resolve
      })
    }
  }
}

/**
 * The host's session token record (`TokenUsage.Info`, `session.step.ended` / `session.usage.updated`
 * `tokens`). It is a NON-overlapping breakdown (`packages/core/src/session/usage.ts`): `input` is
 * the non-cached prompt, `output` the visible (non-reasoning) completion, `reasoning` the hidden
 * reasoning, and `cache.read` / `cache.write` the cached prompt parts.
 */
interface RawUsage {
  readonly input?: number
  readonly output?: number
  readonly reasoning?: number
  readonly cache?: { readonly read?: number; readonly write?: number }
}

interface RawError {
  readonly type?: string
  readonly message?: string
  readonly status?: number
  /** Raw provider response. Read for classification and the log only; never copied to the caller. */
  readonly response?: { readonly body?: string }
}

const total = (...parts: Array<number | undefined>): number | undefined =>
  parts.some((part) => typeof part === "number") ? parts.reduce<number>((sum, part) => sum + (typeof part === "number" ? part : 0), 0) : undefined

/**
 * Host breakdown to `PlugUsage`, whose totals are inclusive (see `PlugUsage`):
 *   inputTokens  = input + cache.read + cache.write
 *   outputTokens = output + reasoning
 * reasoning and cache fields pass through as the subsets they are.
 */
const toUsage = (tokens?: RawUsage): PlugUsage | undefined =>
  tokens
    ? {
        inputTokens: total(tokens.input, tokens.cache?.read, tokens.cache?.write),
        outputTokens: total(tokens.output, tokens.reasoning),
        reasoningTokens: tokens.reasoning,
        cacheReadTokens: tokens.cache?.read,
        cacheWriteTokens: tokens.cache?.write,
      }
    : undefined

/** Provider wording for "the prompt does not fit the model" (a subset of the host's own matcher; the host does not forward its classification). */
const CONTEXT_OVERFLOW =
  /context[_ ](?:length|window)|maximum context|prompt (?:is )?too long|too many tokens|token limit|input length.*exceeds|exceeds the (?:available )?context|reduce the length of the messages/i

/**
 * Provider wording that the status does not settle (#171). A ChatGPT subscription at its limit is a
 * `provider.invalid-request` with `subscription_sharing_usage_limit_exceeded` and no status. These
 * are matched on the message and the raw body, and only ever decide a class; the text never leaves.
 */
const USAGE_LIMIT = /usage[_ ]limit|quota/i
const RATE_LIMIT = /rate[_ ]limit|too many requests/i
const AUTH_FAILURE = /unauthori[sz]ed|invalid[_ ]api[_ ]key|incorrect api key|not logged in|log in again|sign in|permission denied/i
const MODEL_NOT_FOUND = /model[^\n]{0,60}(?:not found|does not exist|not supported|unknown)|unknown model|model_not_found/i
/** A provider overload: Anthropic's `overloaded_error` (its 529), in the message or the body of the failure (#204). */
const OVERLOADED = /overloaded/i

const AUTH_MESSAGE = "The model provider rejected its credentials; the plugboard host needs to sign in again"

/**
 * Host `SessionError` (`{ type, message, status?, response? }`) to a `PlugError`. Provider and host
 * error text can carry endpoints, account or organization ids, so it never reaches the caller:
 * the caller gets a stable `code` and a fixed message per class. The classes a caller can act on
 * stay distinct (rate limit, quota, context length, provider credentials, timeout, content filter).
 * The raw text goes to the log only (`RequestCollector.failFromHost`).
 */
function toPlugError(error: RawError | undefined, fallback: string): PlugError {
  const status = typeof error?.status === "number" && error.status >= 400 ? error.status : undefined
  const type = error?.type ?? ""
  // Our own constant (the session caller reports a prompt that could not start); the host never uses this type.
  if (type === "prompt_failed") return { status: 502, kind: "server", code: "prompt_failed", message: error?.message || fallback }
  if (type === "provider.rate-limit" || status === 429) {
    return { status: 429, kind: "rate_limit", code: "rate_limited", message: "The model provider is rate limiting requests; retry later" }
  }
  if (type === "provider.quota") {
    return { status: 429, kind: "rate_limit", code: "quota_exceeded", message: "The model provider's usage quota is exhausted" }
  }
  if ((type === "provider.invalid-request" || status === 400 || status === 413) && CONTEXT_OVERFLOW.test(`${error?.message ?? ""}\n${error?.response?.body ?? ""}`)) {
    return { status: 400, kind: "invalid_request", code: "context_length_exceeded", param: "messages", message: "The request is longer than the model's context window" }
  }
  if (type === "provider.auth" || status === 401 || status === 403) {
    if (status === 401) return { status, kind: "authentication", code: "provider_auth_failed", message: AUTH_MESSAGE }
    if (status === 403) return { status, kind: "permission", code: "provider_auth_failed", message: AUTH_MESSAGE }
    return { status: 502, kind: "server", code: "provider_auth_failed", message: AUTH_MESSAGE }
  }
  if (type === "provider.content-filter") {
    return { status: 400, kind: "invalid_request", code: "content_filter", message: "The model provider's content filter blocked the request" }
  }
  if (type === "provider.timeout" || status === 408 || status === 504) {
    return { status: 504, kind: "timeout", code: "provider_timeout", message: "The model provider timed out" }
  }
  if (type.startsWith("provider.")) {
    const detail = `${error?.message ?? ""}\n${error?.response?.body ?? ""}`
    if (USAGE_LIMIT.test(detail)) return { status: 429, kind: "rate_limit", code: "quota_exceeded", message: "The model provider's usage quota is exhausted" }
    if (RATE_LIMIT.test(detail)) return { status: 429, kind: "rate_limit", code: "rate_limited", message: "The model provider is rate limiting requests; retry later" }
    // Its own 529 or an overloaded_error. Sent as 503 here; the Messages route answers it as 529 (src/anthropic/response.ts).
    if (status === 529 || OVERLOADED.test(detail)) return { status: 503, kind: "server", code: "provider_overloaded", message: "The model provider is overloaded; retry later" }
    if (MODEL_NOT_FOUND.test(detail)) return { status: 404, kind: "not_found", code: "model_not_found", param: "model", message: "The model provider does not know the requested model" }
    if (AUTH_FAILURE.test(detail)) return { status: 502, kind: "server", code: "provider_auth_failed", message: AUTH_MESSAGE }
    if (status === 404) return { status, kind: "not_found", code: "provider_rejected_request", message: "The model provider rejected the request" }
    if (status !== undefined && status < 500) return { status, kind: "invalid_request", code: "provider_rejected_request", message: "The model provider rejected the request" }
    return { status: status ?? 502, kind: "server", code: "provider_unavailable", message: "The model provider is unavailable or returned an error" }
  }
  return { status: 502, kind: "server", code: "model_run_failed", message: fallback }
}

export interface CollectorHooks {
  /** The request asked for one tool call per answer (#202): the first caller tool call is kept, the rest are dropped. */
  readonly singleToolCall?: boolean
  /** The step ended with tool calls: stop the turn before the runner starts another model step. */
  readonly stopTurn: () => void
  /** The request's id, for the log line that carries a failure's raw host text. */
  readonly requestID?: string
  /** The app, for the `server_tool.call` log lines. */
  readonly app?: string
  /** The app's `serverTools` (option `apps`): OpenCode runs these calls, the caller never sees them. */
  readonly serverTools?: ReadonlySet<string>
  /** Model steps that may run server tools before the turn is stopped. The owner passes it with `serverTools`. */
  readonly maxServerToolSteps?: number
  /** Server tool calls allowed across all steps; the call past it fails the request. The owner passes it with `serverTools`. */
  readonly maxServerToolCalls?: number
}

interface ServerCall {
  readonly name: string
  readonly startedAt: number
  done: boolean
}

export class RequestCollector {
  private readonly queue = new EventQueue<PlugEvent>(MAX_QUEUED_EVENTS, MAX_QUEUED_BYTES)
  private readonly emittedText = new Map<number, number>()
  private readonly toolNames = new Map<string, string>()
  private readonly calls = new Set<string>()
  private readonly serverCalls = new Map<string, ServerCall>()
  private stepServerCalls = 0
  /** Server calls that landed after the request ended (#196), by id, and their count; `lateStepCalls` is the current step's. */
  private readonly lateIDs = new Set<string>()
  private lateCalls = 0
  private lateStepCalls = 0
  private serverSteps = 0
  private usage?: RawUsage
  private finished = false
  private executionDone = false
  private wasCancelled = false
  private settled = false

  constructor(private readonly hooks: CollectorHooks) {}

  /** True once a `finish` or `error` event was emitted (or the stream was ended); later events are ignored. */
  get terminal(): boolean {
    return this.finished
  }

  /** True once the OpenCode execution ended (succeeded, failed or interrupted). */
  get executionEnded(): boolean {
    return this.executionDone
  }

  /** True once a step ended with a plain `stop` and no tool calls: the runner finishes by itself, nothing needs interrupting. */
  get turnSettled(): boolean {
    return this.settled
  }

  /** How many server tool calls OpenCode ran in this session (each counted when it started). */
  get serverCallCount(): number {
    return this.serverCalls.size
  }

  /** True once the owner cancelled the request (client gone or timeout). */
  get cancelled(): boolean {
    return this.wasCancelled
  }

  /** The request's events, in order. Ends when the collector is terminal. */
  events(): AsyncIterable<PlugEvent> {
    return this.queue
  }

  /** Mark the request cancelled by its owner (client gone or timed out) and close the stream without a terminal event. */
  cancel(): void {
    this.wasCancelled = true
    this.end()
  }

  /**
   * `item` is the flattened bus event: `{ type, ...data }`. Field types are not verified here:
   * the host's event payloads are read defensively (`String(...)`, `Number(...)`), and the few
   * structured fields (`tokens`, `error`) are cast to the shapes in `RawUsage` / `RawError`.
   */
  push(item: BusEvent): void {
    switch (item.type) {
      case "session.text.delta": {
        if (this.finished) return
        const ordinal = Number(item.ordinal ?? 0)
        const delta = String(item.delta ?? "")
        this.emittedText.set(ordinal, (this.emittedText.get(ordinal) ?? 0) + delta.length)
        if (delta.length > 0) this.emit({ type: "text-delta", text: delta })
        return
      }
      case "session.text.ended": {
        if (this.finished) return
        // Deltas are live-only; if any were missed, the ended event carries the full text.
        const ordinal = Number(item.ordinal ?? 0)
        const full = String(item.text ?? "")
        const seen = this.emittedText.get(ordinal) ?? 0
        if (full.length > seen) this.emit({ type: "text-delta", text: full.slice(seen) })
        this.emittedText.set(ordinal, full.length)
        return
      }
      case "session.reasoning.delta": {
        if (this.finished) return
        const delta = String(item.delta ?? "")
        if (delta.length > 0) this.emit({ type: "reasoning-delta", text: delta })
        return
      }
      case "session.reasoning.ended": {
        // The block's provider metadata carries the provider's signature (#146). It goes out as an empty-text reasoning-delta.
        if (this.finished) return
        const signature = signatureOf(item.state)
        if (signature !== undefined) this.emit({ type: "reasoning-delta", text: "", signature })
        return
      }
      case "session.tool.input.started":
        this.toolNames.set(String(item.id), String(item.name ?? ""))
        return
      case "session.tool.called": {
        const id = String(item.id)
        const name = String(item.name ?? this.toolNames.get(id) ?? "")
        if (this.finished) {
          if (this.hooks.serverTools?.has(name)) this.lateServerCall(id, name)
          return
        }
        if (this.calls.has(id) || this.serverCalls.has(id)) return
        if (this.hooks.serverTools?.has(name)) {
          this.serverCalls.set(id, { name, startedAt: Date.now(), done: false })
          this.stepServerCalls++
          // The cap counts calls across steps (#198). The call past it is not returned to the caller, and the turn stops.
          if (this.serverCalls.size > (this.hooks.maxServerToolCalls ?? 0))
            this.abort({
              status: 502,
              kind: "server",
              code: "server_tool_calls_exceeded",
              message: "The model used more OpenCode tool calls than this app allows",
            })
          return
        }
        if (this.hooks.singleToolCall && this.calls.size > 0) return
        this.calls.add(id)
        this.emit({ type: "tool-call", id, name, input: item.input })
        return
      }
      case "session.tool.success":
      case "session.tool.failed": {
        const call = this.serverCalls.get(String(item.id))
        if (!call || call.done) return
        call.done = true
        log("server_tool.call", {
          requestID: this.hooks.requestID,
          app: this.hooks.app,
          tool: call.name,
          durationMs: Date.now() - call.startedAt,
          ok: item.type === "session.tool.success",
        })
        return
      }
      case "session.usage.updated":
        // Assumed invariant: `tokens` is the host's token-usage record (RawUsage shape).
        this.usage = (item.tokens as RawUsage | undefined) ?? this.usage
        return
      case "session.step.ended": {
        this.usage = (item.tokens as RawUsage | undefined) ?? this.usage
        const serverCalls = this.stepServerCalls
        this.stepServerCalls = 0
        // A late step that ran server calls: the host is still running the session, so the turn is stopped again (#196).
        const late = this.lateStepCalls
        this.lateStepCalls = 0
        if (this.finished && late > 0 && !this.executionDone) this.hooks.stopTurn()
        // Also after the response finished: a later step that ended with calls means the first
        // interrupt lost the race or failed; ask again (the guard stays until the execution ends).
        if (this.calls.size > 0 && !this.executionDone) this.hooks.stopTurn()
        const reason = toFinish(item.finish)
        if (this.calls.size === 0 && serverCalls > 0) return this.serverStepEnded(reason)
        if (this.calls.size === 0 && reason === "stop") this.settled = true
        this.finishWith(withCalls(reason, this.calls.size > 0))
        return
      }
      case FAILURE_EVENT:
        // Synthetic, from inside the process (lost event stream, preparation mismatch).
        if (isPlugError(item.error)) this.abort(item.error)
        return
      case "session.step.failed": {
        this.usage = (item.tokens as RawUsage | undefined) ?? this.usage
        // Assumed invariant: `error` is the host's `SessionError` (RawError shape).
        const error = item.error as RawError | undefined
        // The host can run another step after a failed one; the response is over, the turn must be too.
        if (!this.executionDone && error?.type !== "aborted") this.hooks.stopTurn()
        if (this.calls.size > 0 && error?.type === "aborted") return this.finishWith("tool-calls")
        if (item.finish === "content-filter") return this.finishWith("content-filter")
        if (error?.type === "aborted" && this.wasCancelled) return this.end()
        return this.failFromHost(error, "Model step failed")
      }
      case "session.execution.failed":
        this.executionDone = true
        this.logUnfinishedServerCalls()
        if (!this.finished) this.failFromHost(item.error as RawError | undefined, "Session execution failed")
        this.end()
        return
      case "session.execution.interrupted":
      case "session.execution.succeeded":
        this.executionDone = true
        this.logUnfinishedServerCalls()
        if (!this.finished) {
          if (this.calls.size > 0) this.finishWith("tool-calls")
          else if (this.wasCancelled) this.end()
          else if (item.type === "session.execution.succeeded") this.finishWith("stop")
          else this.fail({ status: 500, kind: "server", message: "Request was interrupted before the model finished" })
        }
        this.end()
        return
      default:
        return
    }
  }

  /** Fail the request with `error` and stop the turn. No-op once the request is terminal. */
  abort(error: PlugError): void {
    if (this.finished) return
    this.fail(error)
    this.hooks.stopTurn()
  }

  /** Close the stream without a terminal event (client gone). */
  end(): void {
    this.finished = true
    this.queue.close()
  }

  private finishWith(reason: PlugFinish): void {
    if (this.finished) return
    this.emit({ type: "finish", reason, usage: toUsage(this.usage) })
    this.end()
  }

  /**
   * A step that ran only server tools: the runner starts the next step with their results. The cap is
   * checked on each such step; past it the request fails and the turn is stopped.
   */
  private serverStepEnded(reason: PlugFinish): void {
    this.serverSteps++
    if (this.serverSteps > (this.hooks.maxServerToolSteps ?? 0)) {
      this.abort({
        status: 502,
        kind: "server",
        code: "server_tool_steps_exceeded",
        message: "The model used more OpenCode tool steps than this app allows",
      })
      return
    }
    if (reason === "stop" || reason === "tool-calls") return
    this.finishWith(reason)
  }

  /**
   * A server call that lands after the request ended (the client left, the timeout ran or the answer returned)
   * while the host still runs the session (#196). It is never returned to anyone: it is counted and logged once
   * under its own event name, and the step that ran it stops the turn (`session.step.ended`).
   */
  private lateServerCall(id: string, name: string): void {
    if (this.lateIDs.has(id)) return
    this.lateIDs.add(id)
    this.lateCalls++
    this.lateStepCalls++
    log("server_tool.after_request", {
      requestID: this.hooks.requestID,
      app: this.hooks.app,
      tool: name,
      lateCalls: this.lateCalls,
      serverCalls: this.serverCalls.size,
      serverSteps: this.serverSteps,
    })
  }

  /** Server calls the execution ended before they reported back are logged as not ok, once each. */
  private logUnfinishedServerCalls(): void {
    for (const call of this.serverCalls.values()) {
      if (call.done) continue
      call.done = true
      log("server_tool.call", {
        requestID: this.hooks.requestID,
        app: this.hooks.app,
        tool: call.name,
        durationMs: Date.now() - call.startedAt,
        ok: false,
      })
    }
  }

  /** Fail with the caller-safe mapping of a host error; the raw text is logged here and goes nowhere else. */
  private failFromHost(raw: RawError | undefined, fallback: string): void {
    if (this.finished) return
    const error = toPlugError(raw, fallback)
    logError("model.failed", {
      requestID: this.hooks.requestID,
      type: raw?.type,
      status: raw?.status,
      code: error.code,
      message: raw?.message?.slice(0, 500),
    })
    this.fail(error)
  }

  private fail(error: PlugError): void {
    if (this.finished) return
    this.emit({ type: "error", error })
    this.end()
  }

  private emit(event: PlugEvent): void {
    // Errors are always queued: they are how an overflow is reported.
    if (this.queue.push(event, sizeOf(event), event.type === "error")) return
    // The consumer is not keeping up: drop what waits, fail this request only, and stop the turn.
    this.queue.clear()
    this.queue.push({ type: "error", error: RESPONSE_OVERFLOW }, 0, true)
    this.end()
    if (!this.executionDone) this.hooks.stopTurn()
  }
}

/** A tool call turns a normal stop into `tool-calls`; a truncated, filtered or failed step keeps its reason. */
const withCalls = (reason: PlugFinish, hasCalls: boolean): PlugFinish => (hasCalls && (reason === "stop" || reason === "tool-calls") ? "tool-calls" : reason)

const toFinish = (finish: unknown): PlugFinish => {
  switch (finish) {
    case "length":
    case "content-filter":
    case "error":
      return finish
    case "tool-calls":
      return "tool-calls"
    default:
      return "stop"
  }
}
