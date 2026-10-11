/**
 * Session-backend event translation.
 *
 * `RequestCollector` receives the OpenCode bus events of ONE plugboard request session
 * (already filtered by the process-wide registry, R11) and turns them into `PlugEvent`s on an
 * `EventQueue` that the ModelCaller streams out (not buffered).
 *
 * The turn is stopped from inside the model loop (see `seeds.ts`): once the step has ended
 * (`session.step.ended`) with at least one tool call, the owner is asked to interrupt the
 * session before a second model step can start, and the request finishes as `tool-calls`.
 */

import type { PlugError, PlugEvent, PlugFinish, PlugUsage } from "./contract.js"

/** Minimal async queue: producers `push`, one consumer iterates; `close` ends the iteration. */
export class EventQueue<T> implements AsyncIterable<T> {
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

/** Host `SessionError` (`{ type, message, status?, response? }`) to an OpenAI-style error. */
export function toPlugError(error: { type?: string; message?: string; status?: number } | undefined, fallback: string): PlugError {
  const status = typeof error?.status === "number" && error.status >= 400 ? error.status : undefined
  const message = error?.message || fallback
  const base = { message, ...(error?.type ? { code: error.type } : {}) }
  if (status === 401) return { status, type: "authentication_error", ...base }
  if (status === 403) return { status, type: "permission_error", ...base }
  if (status === 404) return { status, type: "not_found_error", ...base }
  if (status === 429) return { status, type: "rate_limit_error", ...base }
  if (status === 408 || status === 504) return { status, type: "timeout_error", ...base }
  if (status !== undefined && status < 500) return { status, type: "invalid_request_error", ...base }
  return { status: status ?? 502, type: "server_error", ...base }
}

export interface CollectorHooks {
  /** The step ended with tool calls: stop the turn before the runner starts another model step. */
  readonly stopTurn: () => void
}

export class RequestCollector {
  readonly queue = new EventQueue<PlugEvent>()
  private readonly emittedText = new Map<number, number>()
  private readonly toolNames = new Map<string, string>()
  private readonly calls = new Set<string>()
  private usage?: RawUsage
  /** True once a `finish` or `error` event was emitted; later events are ignored. */
  terminal = false
  /** True once the OpenCode execution ended (succeeded, failed or interrupted). */
  executionEnded = false
  /** Set by the backend when the client went away or the request timed out. */
  cancelled = false

  constructor(private readonly hooks: CollectorHooks) {}

  /** `item` is the flattened bus event: `{ type, ...data }`. */
  push(item: Record<string, any>): void {
    switch (item.type) {
      case "session.text.delta": {
        if (this.terminal) return
        const ordinal = Number(item.ordinal ?? 0)
        const delta = String(item.delta ?? "")
        this.emittedText.set(ordinal, (this.emittedText.get(ordinal) ?? 0) + delta.length)
        if (delta.length > 0) this.emit({ type: "text-delta", text: delta })
        return
      }
      case "session.text.ended": {
        if (this.terminal) return
        // Deltas are live-only; if any were missed, the ended event carries the full text.
        const ordinal = Number(item.ordinal ?? 0)
        const full = String(item.text ?? "")
        const seen = this.emittedText.get(ordinal) ?? 0
        if (full.length > seen) this.emit({ type: "text-delta", text: full.slice(seen) })
        this.emittedText.set(ordinal, full.length)
        return
      }
      case "session.reasoning.delta": {
        if (this.terminal) return
        const delta = String(item.delta ?? "")
        if (delta.length > 0) this.emit({ type: "reasoning-delta", text: delta })
        return
      }
      case "session.tool.input.started":
        this.toolNames.set(String(item.id), String(item.name ?? ""))
        return
      case "session.tool.called": {
        if (this.terminal) return
        const id = String(item.id)
        if (this.calls.has(id)) return
        this.calls.add(id)
        this.emit({ type: "tool-call", id, name: String(item.name ?? this.toolNames.get(id) ?? ""), input: item.input })
        return
      }
      case "session.usage.updated":
        this.usage = (item.tokens as RawUsage) ?? this.usage
        return
      case "session.step.ended":
        this.usage = (item.tokens as RawUsage) ?? this.usage
        if (!this.terminal && this.calls.size > 0) this.hooks.stopTurn()
        this.finishWith(this.calls.size > 0 ? "tool-calls" : toFinish(item.finish))
        return
      case "session.step.failed": {
        this.usage = (item.tokens as RawUsage) ?? this.usage
        const error = item.error as { type?: string; message?: string; status?: number } | undefined
        if (this.calls.size > 0 && error?.type === "aborted") return this.finishWith("tool-calls")
        if (item.finish === "content-filter") return this.finishWith("content-filter")
        if (error?.type === "aborted" && this.cancelled) return this.end()
        return this.fail(toPlugError(error, "Model step failed"))
      }
      case "session.execution.failed":
        this.executionEnded = true
        if (!this.terminal) this.fail(toPlugError(item.error, "Session execution failed"))
        this.end()
        return
      case "session.execution.interrupted":
      case "session.execution.succeeded":
        this.executionEnded = true
        if (!this.terminal) {
          if (this.calls.size > 0) this.finishWith("tool-calls")
          else if (this.cancelled) this.end()
          else if (item.type === "session.execution.succeeded") this.finishWith("stop")
          else this.fail({ status: 500, type: "server_error", message: "Request was interrupted before the model finished" })
        }
        this.end()
        return
      default:
        return
    }
  }

  /** Close the stream without a terminal event (client gone). */
  end(): void {
    this.terminal = true
    this.queue.close()
  }

  private finishWith(reason: PlugFinish): void {
    if (this.terminal) return
    this.emit({ type: "finish", reason, usage: toUsage(this.usage) })
    this.end()
  }

  private fail(error: PlugError): void {
    if (this.terminal) return
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
