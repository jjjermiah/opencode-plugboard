/**
 * Session event translation.
 *
 * `RequestCollector` receives the OpenCode bus events of ONE plugboard request session
 * (already filtered by the process-wide session store) and turns them into `PlugEvent`s that the
 * ModelCaller streams out through `events()` (not buffered beyond the queue).
 *
 * The turn is stopped from inside the model loop (see `session/seeds.ts`): once the step has ended
 * (`session.step.ended`) with at least one tool call, the owner is asked to interrupt the
 * session before a second model step can start, and the request finishes as `tool-calls`.
 * The collector never calls the host itself; the owner passes `stopTurn`.
 */

import type { PlugError, PlugEvent, PlugFinish, PlugUsage } from "../contract.js"
import type { BusEvent } from "./host.js"

/** Minimal async queue: producers `push`, one consumer iterates; `close` ends the iteration. */
class EventQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = []
  private waiter?: () => void
  private closed = false

  push(item: T): void {
    if (this.closed) return
    this.items.push(item)
    this.wake()
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
      const item = this.items.shift()
      if (item !== undefined) {
        yield item
        continue
      }
      if (this.closed) return
      await new Promise<void>((resolve) => {
        this.waiter = resolve
      })
    }
  }
}

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
}

const toUsage = (tokens?: RawUsage): PlugUsage | undefined =>
  tokens
    ? {
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        reasoningTokens: tokens.reasoning,
        cacheReadTokens: tokens.cache?.read,
        cacheWriteTokens: tokens.cache?.write,
      }
    : undefined

/** Host `SessionError` (`{ type, message, status?, response? }`) to a `PlugError`. */
function toPlugError(error: RawError | undefined, fallback: string): PlugError {
  const status = typeof error?.status === "number" && error.status >= 400 ? error.status : undefined
  const message = error?.message || fallback
  const base = { message, ...(error?.type ? { code: error.type } : {}) }
  if (status === 401) return { status, kind: "authentication", ...base }
  if (status === 403) return { status, kind: "permission", ...base }
  if (status === 404) return { status, kind: "not_found", ...base }
  if (status === 429) return { status, kind: "rate_limit", ...base }
  if (status === 408 || status === 504) return { status, kind: "timeout", ...base }
  if (status !== undefined && status < 500) return { status, kind: "invalid_request", ...base }
  return { status: status ?? 502, kind: "server", ...base }
}

export interface CollectorHooks {
  /** The step ended with tool calls: stop the turn before the runner starts another model step. */
  readonly stopTurn: () => void
}

export class RequestCollector {
  private readonly queue = new EventQueue<PlugEvent>()
  private readonly emittedText = new Map<number, number>()
  private readonly toolNames = new Map<string, string>()
  private readonly calls = new Set<string>()
  private usage?: RawUsage
  private finished = false
  private executionDone = false
  private wasCancelled = false

  constructor(private readonly hooks: CollectorHooks) {}

  /** True once a `finish` or `error` event was emitted (or the stream was ended); later events are ignored. */
  get terminal(): boolean {
    return this.finished
  }

  /** True once the OpenCode execution ended (succeeded, failed or interrupted). */
  get executionEnded(): boolean {
    return this.executionDone
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
      case "session.tool.input.started":
        this.toolNames.set(String(item.id), String(item.name ?? ""))
        return
      case "session.tool.called": {
        if (this.finished) return
        const id = String(item.id)
        if (this.calls.has(id)) return
        this.calls.add(id)
        this.emit({ type: "tool-call", id, name: String(item.name ?? this.toolNames.get(id) ?? ""), input: item.input })
        return
      }
      case "session.usage.updated":
        // Assumed invariant: `tokens` is the host's token-usage record (RawUsage shape).
        this.usage = (item.tokens as RawUsage | undefined) ?? this.usage
        return
      case "session.step.ended":
        this.usage = (item.tokens as RawUsage | undefined) ?? this.usage
        if (!this.finished && this.calls.size > 0) this.hooks.stopTurn()
        this.finishWith(this.calls.size > 0 ? "tool-calls" : toFinish(item.finish))
        return
      case "session.step.failed": {
        this.usage = (item.tokens as RawUsage | undefined) ?? this.usage
        // Assumed invariant: `error` is the host's `SessionError` (RawError shape).
        const error = item.error as RawError | undefined
        if (this.calls.size > 0 && error?.type === "aborted") return this.finishWith("tool-calls")
        if (item.finish === "content-filter") return this.finishWith("content-filter")
        if (error?.type === "aborted" && this.wasCancelled) return this.end()
        return this.fail(toPlugError(error, "Model step failed"))
      }
      case "session.execution.failed":
        this.executionDone = true
        if (!this.finished) this.fail(toPlugError(item.error as RawError | undefined, "Session execution failed"))
        this.end()
        return
      case "session.execution.interrupted":
      case "session.execution.succeeded":
        this.executionDone = true
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

  private fail(error: PlugError): void {
    if (this.finished) return
    this.emit({ type: "error", error })
    this.end()
  }

  private emit(event: PlugEvent): void {
    this.queue.push(event)
  }
}

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
