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
import { log, logError, logWarn } from "../log.js"
import type { BusEvent, StoredAnswer } from "./host.js"
import { StopScan } from "../stop.js"
import { placeholderAliases, placeholderRewriter } from "../tool-placeholders.js"
import { rememberReasoning } from "../reasoning-replay.js"
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

/**
 * The error a request fails with when the model answered nothing usable: its only tool calls named no declared tool and it wrote no text (#463).
 * The class and code are those of a failed model run (`toPlugError`'s fallback). The text says nothing about the call.
 */
const NO_ANSWER: PlugError = {
  status: 502,
  kind: "server",
  code: "model_run_failed",
  message: "The model returned neither text nor a call to a declared tool",
}

/**
 * A reasoning block's signature from the host's provider state, or undefined when there is none. The host
 * publishes the state already unwrapped from its provider key (`{ signature }`, publish-llm-event.ts
 * `providerState`); the wrapped form (`{ <provider>: { signature } }`) is accepted too.
 */
function signatureOf(state: unknown): string | undefined {
  if (typeof state !== "object" || state === null) return undefined
  const direct = (state as { signature?: unknown }).signature
  if (typeof direct === "string" && direct.length > 0) return direct
  for (const value of Object.values(state)) {
    const signature = typeof value === "object" && value !== null ? (value as { signature?: unknown }).signature : undefined
    if (typeof signature === "string" && signature.length > 0) return signature
  }
  return undefined
}

/**
 * A redacted reasoning block's opaque payload from the host's provider state (#385), or undefined. The host publishes the
 * state the same way as the signature (`publish-llm-event.ts`), with `redactedData` in place of `signature`.
 */
function redactedDataOf(state: unknown): string | undefined {
  if (typeof state !== "object" || state === null) return undefined
  const direct = (state as { redactedData?: unknown }).redactedData
  if (typeof direct === "string" && direct.length > 0) return direct
  for (const value of Object.values(state)) {
    const data = typeof value === "object" && value !== null ? (value as { redactedData?: unknown }).redactedData : undefined
    if (typeof data === "string" && data.length > 0) return data
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
/**
 * A provider that refuses a replayed thinking block's signature (#424). The word has to sit near "thinking" or "reasoning",
 * so another signature error keeps the generic class. Only the class is kept: the provider's text is logged, not sent.
 */
const SIGNATURE_REJECTED = /signature[^\n]{0,60}(?:thinking|reasoning)|(?:thinking|reasoning)[^\n]{0,60}signature/i

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
    if (SIGNATURE_REJECTED.test(detail) && (status === undefined || status === 400 || status === 422))
      return { status: status ?? 400, kind: "invalid_request", code: "provider_rejected_request", message: "The model provider rejected the signature of a replayed thinking block" }
    if (status === 404) return { status, kind: "not_found", code: "provider_rejected_request", message: "The model provider rejected the request" }
    if (status !== undefined && status < 500) return { status, kind: "invalid_request", code: "provider_rejected_request", message: "The model provider rejected the request" }
    // A status past 511 is not a standard HTTP status (Cloudflare uses 520 to 527): the client gets 502, the gateway class (#391).
    return { status: status !== undefined && status <= 511 ? status : 502, kind: "server", code: "provider_unavailable", message: "The model provider is unavailable or returned an error" }
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
  /**
   * A fallback target follows this call (`CallContext.fallbackNext`). A retry the host schedules before any output then
   * fails the call at once with `provider_retry`, so the chain moves on; otherwise the host's retries run (#391).
   */
  readonly failFastRetry?: boolean
  /** The app, for the `server_tool.call` log lines. */
  readonly app?: string
  /** The app's `serverTools` (option `apps`): OpenCode runs these calls, the caller never sees them. */
  readonly serverTools?: ReadonlySet<string>
  /** Model steps that may run server tools before the turn is stopped. The owner passes it with `serverTools`. */
  readonly maxServerToolSteps?: number
  /** Server tool calls allowed across all steps; the call past it fails the request. The owner passes it with `serverTools`. */
  readonly maxServerToolCalls?: number
  /**
   * The request's stop sequences (not structured output). The collector scans the text it emits and marks the match itself, so
   * a tool call queued behind the matching text is already after the match (#390 review: the stop wrapper only sees text when it reads it).
   */
  readonly stopSequences?: ReadonlyArray<string>
  /** Called once, when a stop sequence matches the text (`stopSequences`). The owner starts the settle window. */
  readonly onStopAnswer?: () => void
  /** The request's tool names, caller and server tools: the ids the model may name them by are rewritten only for these (#411). */
  readonly toolNames?: readonly string[]
  /**
   * The request's caller tools, as the request offers them after the app's tool policy. A tool call must name one of them (#463):
   * any other name is dropped and logged. Server tools are not caller tools (`serverTools`), they keep their own handling.
   */
  readonly callerTools: readonly string[]
}

interface ServerCall {
  readonly name: string
  readonly startedAt: number
  done: boolean
}

export class RequestCollector {
  private readonly queue = new EventQueue<PlugEvent>(MAX_QUEUED_EVENTS, MAX_QUEUED_BYTES)
  private readonly stopScan: StopScan | undefined
  private readonly emittedText = new Map<number, number>()
  private readonly toolNames = new Map<string, string>()
  /** Reasoning text with this request's placeholder ids named by their tool names (#411). */
  private readonly reasoningNames: ReturnType<typeof placeholderRewriter>
  /** The open reasoning block as the host sent it, and as it was emitted: the difference is what a replay restores (#411). */
  private reasoningRaw = ""
  private reasoningSent = ""
  private readonly calls = new Set<string>()
  /** Tool names the request declared (`CollectorHooks.callerTools`). */
  private readonly callerNames: ReadonlySet<string>
  /** Calls dropped for a name the request did not declare (#463), by id, and how many. */
  private readonly dropped = new Set<string>()
  private undeclared = 0
  /** True once any text (not reasoning) was emitted: a run whose only calls were dropped, and that wrote no text, fails (#463). */
  private answered = false
  private readonly serverCalls = new Map<string, ServerCall>()
  private stepServerCalls = 0
  /** Server calls that landed after the request ended (#196), by id, and their count; `lateStepCalls` is the current step's. */
  private readonly lateIDs = new Set<string>()
  private lateCalls = 0
  private lateStepCalls = 0
  private serverSteps = 0
  private usage?: RawUsage
  /** True once any output event (not an error) was emitted: the answer is committed and no retry may restart it. */
  private anyEmitted = false
  private finished = false
  /** A stop sequence ended the answer and the run was interrupted for it (`markStopped`). */
  private stopped = false
  private executionDone = false
  private wasCancelled = false
  private settled = false
  private reportHook: (() => void) | undefined
  /** The host was stopped because the client left (a tool call or a step that asks for more): once. */
  private leftStopped = false
  /** When the last bus event reached `push` (any type, also one the collector ignores), in ms since the epoch; 0 before the first. */
  private heardAt = 0

  constructor(private readonly hooks: CollectorHooks) {
    this.reasoningNames = placeholderRewriter(placeholderAliases(hooks.toolNames ?? []))
    this.callerNames = new Set(hooks.callerTools)
    this.stopScan = hooks.stopSequences !== undefined && hooks.stopSequences.length > 0 ? new StopScan(hooks.stopSequences) : undefined
  }

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

  /** The host's usage for the run so far (the last `session.usage.updated` or step token record), or undefined before any. */
  get spent(): PlugUsage | undefined {
    return toUsage(this.usage)
  }

  /** The request's events, in order. Ends when the collector is terminal. */
  events(): AsyncIterable<PlugEvent> {
    return this.queue
  }

  /** When the host last sent any event for this request (0 before the first). A silent stream is told apart from a slow model by this (#515). */
  get lastEventAt(): number {
    return this.heardAt
  }

  /**
   * Settle the request from the host's stored last assistant message, for a stream that stopped delivering its terminal events (#515).
   * The message is replayed as the events the host would have sent: each text part as `session.text.ended` (the collector sends only
   * the text its deltas did not carry, so a stream that already sent parts gets the rest and no repeat), each tool call as
   * `session.tool.called` (a call already seen is skipped by id), then the step end or failure with its finish reason and tokens. The
   * collector's own rules then decide the finish, so the result is the one the event path gives.
   *
   * Returns true when the request is terminal. False means the answer is not final yet: the step still runs, or it ended with server
   * tools only, so the host starts another step. Nothing past the text and calls is replayed then, so asking again counts nothing twice.
   */
  settleFromAnswer(answer: StoredAnswer): boolean {
    if (this.finished) return true
    if (!answer.completed || (answer.error === undefined && answer.finish === undefined)) return false
    let ordinal = 0
    for (const part of answer.parts) {
      if (part.type === "text") this.push({ type: "session.text.ended", ordinal: ordinal++, text: part.text })
      else this.push({ type: "session.tool.called", id: part.id, name: part.name, input: part.input })
    }
    if (answer.error !== undefined) this.push({ type: "session.step.failed", error: answer.error, tokens: answer.tokens })
    else {
      // The host runs the next step by itself (the event path does not finish on this step end either).
      if (this.calls.size === 0 && this.stepServerCalls > 0 && (toFinish(answer.finish) === "stop" || toFinish(answer.finish) === "tool-calls")) return false
      this.push({ type: "session.step.ended", finish: answer.finish, tokens: answer.tokens })
    }
    return this.finished
  }

  /** Calls `done` once, when the host reports the end of a step or of the execution: the usage of the run is final from then on. */
  whenReported(done: () => void): void {
    this.reportHook = done
  }

  private reported(): void {
    const hook = this.reportHook
    this.reportHook = undefined
    hook?.()
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
    this.heardAt = Date.now()
    switch (item.type) {
      case "session.text.delta": {
        if (this.finished) return
        this.endReasoningText()
        const ordinal = Number(item.ordinal ?? 0)
        const delta = String(item.delta ?? "")
        this.emittedText.set(ordinal, (this.emittedText.get(ordinal) ?? 0) + delta.length)
        if (delta.length > 0) this.emit({ type: "text-delta", text: delta })
        if (this.stopScan !== undefined && !this.stopped && delta.length > 0) {
          this.stopScan.push(delta)
          if (this.stopScan.matched !== undefined) {
            this.markStopped()
            this.hooks.onStopAnswer?.()
          }
        }
        return
      }
      case "session.text.ended": {
        if (this.finished) return
        this.endReasoningText()
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
        const raw = String(item.delta ?? "")
        this.reasoningRaw += raw
        const delta = this.reasoningNames.push(raw)
        this.reasoningSent += delta
        if (delta.length > 0) this.emit({ type: "reasoning-delta", text: delta })
        return
      }
      case "session.reasoning.ended": {
        // The block's provider metadata carries the provider's signature (#146). It goes out as an empty-text reasoning-delta.
        if (this.finished) return
        const signature = signatureOf(item.state)
        this.endReasoningText(signature)
        if (signature !== undefined) this.emit({ type: "reasoning-delta", text: "", signature })
        // A redacted block has no text and no signature, only its opaque payload (#385).
        const redactedData = redactedDataOf(item.state)
        if (redactedData !== undefined) this.emit({ type: "reasoning-delta", text: "", redactedData })
        return
      }
      case "session.tool.input.started":
        this.toolNames.set(String(item.id), String(item.name ?? ""))
        return
      case "session.tool.called": {
        const id = String(item.id)
        const name = String(item.name ?? this.toolNames.get(id) ?? "")
        this.endReasoningText()
        if (this.finished) {
          if (this.hooks.serverTools?.has(name)) this.lateServerCall(id, name)
          // A client that left mid-run (the settle window): no tool runs for it, and the run is stopped at once (no further step).
          if (this.wasCancelled && !this.executionDone && !this.leftStopped) {
            this.leftStopped = true
            this.hooks.stopTurn()
          }
          return
        }
        // After a match no tool runs: the answer is complete, and the run ends at once (#390 review).
        if (this.stopped) return this.finishStopped(true)
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
        // #463: a caller tool call must name a tool the request declared. Any other name never reaches the caller.
        if (!this.callerNames.has(name)) return this.dropUndeclared(id, name)
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
        this.reported()
        // Text and reasoning ordinals count from 0 in each assistant message, so the next step starts its counts again.
        this.emittedText.clear()
        this.usage = (item.tokens as RawUsage | undefined) ?? this.usage
        // After a match the step is the last one: no server tools are run and no next step starts (#390 review).
        // A plain end leaves the host to finish the run itself; a pending client tool call needs the interrupt.
        if (this.stopped) return this.finishStopped(this.calls.size > 0)
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
        // A client that left mid-run: a step that asks for another (server tools, or a finish that is not a plain stop) is stopped at
        // once, so no further step starts. A client tool call already stopped the run above (`calls` is non-empty then).
        if (this.wasCancelled && !this.executionDone && !this.leftStopped && this.calls.size === 0 && (reason !== "stop" || serverCalls > 0)) {
          this.leftStopped = true
          this.hooks.stopTurn()
        }
        if (this.calls.size === 0 && serverCalls > 0) return this.serverStepEnded(reason)
        // #463: every call the step made was undeclared and no text was written: nothing to return, so the request fails.
        if (this.calls.size === 0 && this.undeclared > 0 && !this.answered) return this.abort(NO_ANSWER)
        // A tool-calls finish needs a valid call (#463). Without one the step is a stop, and no further step runs.
        if (this.calls.size === 0 && reason === "tool-calls") {
          // A finished run was already stopped by the branch above (a late call, #196): only a live run is stopped here.
          if (!this.finished && !this.executionDone) this.hooks.stopTurn()
          return this.finishWith("stop")
        }
        if (this.calls.size === 0 && reason === "stop") this.settled = true
        this.finishWith(withCalls(reason, this.calls.size > 0))
        return
      }
      case FAILURE_EVENT:
        // Synthetic, from inside the process (lost event stream, preparation mismatch).
        if (isPlugError(item.error)) this.abort(item.error)
        return
      case "session.step.failed": {
        this.reported()
        this.usage = (item.tokens as RawUsage | undefined) ?? this.usage
        // Assumed invariant: `error` is the host's `SessionError` (RawError shape).
        const error = item.error as RawError | undefined
        // The host can run another step after a failed one; the response is over, the turn must be too.
        // After a match the answer before it is complete: a host failure now does not discard it, and the warning says so (#390 review).
        if (this.stopped && error?.type !== "aborted") {
          if (this.finished) return
          logWarn("request.stop_step_failed", { requestID: this.hooks.requestID, app: this.hooks.app, error: error?.type ?? "unknown" })
          return this.finishStopped(true)
        }
        if (!this.executionDone && error?.type !== "aborted") this.hooks.stopTurn()
        if (this.calls.size > 0 && error?.type === "aborted") return this.finishWith("tool-calls")
        if (error?.type === "aborted" && this.stopped) return this.finishWith("stop")
        if (item.finish === "content-filter") return this.finishWith("content-filter")
        if (error?.type === "aborted" && this.wasCancelled) return this.end()
        return this.failFromHost(error, "Model step failed")
      }
      case "session.retry.scheduled": {
        // The host waits, then runs the model step again (OpenCode 2.0.27 `session.retry.scheduled`). Before any output, a
        // call with a fallback target after it is not made to wait: the retry is a failure now, and the chain moves on (#391).
        const error = item.error as RawError | undefined
        const failFast = this.hooks.failFastRetry === true && !this.anyEmitted
        log("provider.retry_scheduled", { requestID: this.hooks.requestID, type: error?.type ?? "unknown", status: error?.status ?? 0, attempt: Number(item.attempt ?? 0), failFast })
        if (failFast) this.abort({ status: 503, kind: "server", code: "provider_retry", message: "The model provider failed; the next target is tried" })
        return
      }
      case "session.execution.failed":
        this.reported()
        this.executionDone = true
        this.logUnfinishedServerCalls()
        if (!this.finished) this.failFromHost(item.error as RawError | undefined, "Session execution failed")
        this.end()
        return
      case "session.execution.interrupted":
      case "session.execution.succeeded":
        this.reported()
        this.executionDone = true
        this.logUnfinishedServerCalls()
        if (!this.finished) {
          if (this.calls.size > 0) this.finishWith("tool-calls")
          else if (this.wasCancelled) this.end()
          else if (this.undeclared > 0 && !this.answered) this.fail(NO_ANSWER)
          else if (item.type === "session.execution.succeeded" || this.stopped) this.finishWith("stop")
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
    this.endReasoningText()
    this.finished = true
    this.queue.close()
  }

  private finishWith(reason: PlugFinish): void {
    if (this.finished) return
    this.endReasoningText()
    this.emit({ type: "finish", reason, usage: toUsage(this.usage) })
    this.end()
  }

  /**
   * Finish now with the usage counted so far: the host did not end a run that a stop sequence interrupted (#390). No-op once terminal.
   */
  finishNow(): void {
    this.finishWith("stop")
  }

  /**
   * A stop sequence ended the answer, so the host run is being interrupted on purpose (#390). The host then reports the
   * interrupt as an aborted step failure (OpenCode 2.0.27, `Step interrupted`), which is the expected end, not an error.
   */
  markStopped(): void {
    this.stopped = true
  }

  /** The answer is complete (a stop matched): end the run now, with the usage counted so far. The host is interrupted if it still runs. */
  private finishStopped(interrupt: boolean): void {
    if (this.finished) return
    // Finish first: an interrupt may report back synchronously, and the run must already be over when it does.
    this.finishWith("stop")
    if (interrupt && !this.executionDone) this.hooks.stopTurn()
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

  /**
   * A call to a name the request did not declare is dropped, once per call (#463). The log carries the request, the app and the
   * name cut to 64 characters, and nothing else from the call.
   */
  private dropUndeclared(id: string, name: string): void {
    if (this.dropped.has(id)) return
    this.dropped.add(id)
    this.undeclared++
    logWarn("tool_call.undeclared", { requestID: this.hooks.requestID, app: this.hooks.app, tool: name.slice(0, 64) })
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
    this.endReasoningText()
    this.emit({ type: "error", error })
    this.end()
  }

  /**
   * The reasoning text held back for a placeholder id goes out now: at the end of a reasoning block, and before any
   * text, tool call, step end, failure or finish (#411). A block that ends with a signature and was rewritten is kept
   * under that signature, so a replay can restore the text the provider signed (`reasoning-replay.ts`).
   */
  private endReasoningText(signature?: string): void {
    if (this.finished) return
    const rest = this.reasoningNames.flush()
    if (rest.length > 0) {
      this.reasoningSent += rest
      this.emit({ type: "reasoning-delta", text: rest })
    }
    if (signature !== undefined && this.reasoningRaw.length > 0 && this.reasoningRaw !== this.reasoningSent) {
      rememberReasoning(signature, this.reasoningRaw)
    }
    this.reasoningRaw = ""
    this.reasoningSent = ""
  }

  private emit(event: PlugEvent): void {
    if (event.type !== "error") this.anyEmitted = true
    if (event.type === "text-delta" && event.text.length > 0) this.answered = true
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
