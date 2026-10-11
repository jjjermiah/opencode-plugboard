/**
 * Several choices for one request (`n` > 1 on Chat Completions, `n` or several prompts on legacy
 * completions): one independent `ModelCaller` call per choice, run concurrently, each in its own
 * session, merged into one response.
 *
 * Every choice is a full model call and a kept history session, which is why `maxN` caps them.
 * The choices share nothing: no history, no seed, no ordering.
 *
 * Failure policy: if any choice fails, the request fails and the other choices are cancelled
 * (their sessions are interrupted). A partial answer set would look like a complete one, and
 * callers that sample n times for evaluation would silently average over fewer samples.
 *   - non-stream: the first failure becomes the HTTP error.
 *   - stream, nothing sent yet: the same HTTP error.
 *   - stream, already committed: an `error` frame and `[DONE]`, as for a single stream.
 * Client disconnect and the request deadline cancel every choice (the group signal includes the
 * request's).
 *
 * The wire encoders stay per-choice and come in through `ChoiceCodec`: Chat Completions here,
 * legacy completions in `src/completions/response.ts`. This module owns what is shared: the
 * group cancellation, the merge of JSON bodies and the interleaving of SSE chunks.
 */

import type { ServerResponse } from "node:http"
import type { PlugError, PlugEvent, PlugRequest, PlugUsage } from "../contract.js"
import { reportServed, type ServedInfo } from "../fallback.js"
import { RequestAborted, boundEvents, sendJson, sseWriter, type RequestScope } from "../http.js"
import { chatUsageChunk, collectCompletion, encodeError, streamCompletion, type OpenAiExchange, type StreamChoice, type StreamResult } from "./response.js"
import type { RouteHost } from "./route.js"

const SESSION_HEADER = "x-plugboard-session"

/** The per-choice wire encoder a front-end supplies. */
export interface ChoiceCodec {
  readonly stream: boolean
  readonly includeUsage: boolean
  /** Prefix of the shared stream id (`chatcmpl-`, `cmpl-`). */
  readonly idPrefix: string
  /** One choice as a complete JSON body with `choices[0]` and `usage`. */
  collect(events: AsyncIterable<PlugEvent>, index: number): Promise<{ status: number; body: object }>
  /** One choice of the shared stream: this choice's chunks only (see `StreamChoice`). */
  streamChoice(events: AsyncIterable<PlugEvent>, write: (chunk: string) => void, choice: StreamChoice): Promise<StreamResult>
  /** The final chunk with the summed usage (`include_usage`). */
  usageChunk(choice: Omit<StreamChoice, "index">, usage: PlugUsage): object
  /** Echo the served model of an alias with fallbacks as the response model. Used for a single call only: with several choices the body keeps the requested model. */
  setModel(model: string): void
}

/** The Chat Completions encoder as a `ChoiceCodec`. */
export const chatCodec = (exchange: OpenAiExchange): ChoiceCodec => ({
  stream: exchange.stream,
  includeUsage: exchange.includeUsage,
  idPrefix: "chatcmpl-",
  collect: (events) => collectCompletion(events, exchange),
  streamChoice: (events, write, choice) => streamCompletion(events, exchange, write, choice),
  usageChunk: (choice, usage) => chatUsageChunk(exchange.model, choice.id, choice.created, usage),
  setModel: (model) => void (exchange.model = model),
})

export interface ChoicesCall {
  readonly app: string
  /** One resolved model call per choice, in choice order. Every entry is a full call with its own session. */
  readonly calls: ReadonlyArray<PlugRequest>
  readonly response: ServerResponse
  readonly scope: RequestScope
  /** The route's log fields: the outcome of a stream that failed after it committed, and the first served model. */
  readonly info: ServedInfo & { failed?: string }
  readonly codec: ChoiceCodec
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** A queue that is an async iterable: the encoder of one choice reads what the interleaver feeds it. */
function channel<T>() {
  const items: T[] = []
  let closed = false
  let wake: (() => void) | undefined
  return {
    push(item: T) {
      items.push(item)
      wake?.()
    },
    close() {
      closed = true
      wake?.()
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<T> {
      while (true) {
        if (items.length > 0) {
          yield items.shift()!
          continue
        }
        if (closed) return
        await new Promise<void>((resolve) => {
          wake = resolve
        })
        wake = undefined
      }
    },
  }
}

/** A scope whose signal also aborts when one choice fails; deadline and error stay the request's. */
function groupScope(scope: RequestScope, signal: AbortSignal): RequestScope {
  return {
    signal,
    get timedOut() {
      return scope.timedOut
    },
    timeoutError: scope.timeoutError,
    race<T>(promise: Promise<T>): Promise<T> {
      promise.catch(() => {})
      if (signal.aborted) return Promise.reject(signal.reason)
      return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(signal.reason)
        signal.addEventListener("abort", onAbort, { once: true })
        promise.then(
          (value) => {
            signal.removeEventListener("abort", onAbort)
            resolve(value)
          },
          (error) => {
            signal.removeEventListener("abort", onAbort)
            reject(error)
          },
        )
      })
    },
    dispose() {},
  }
}

/** Numbers add up, objects add up per key. */
const sumDeep = (a: unknown, b: unknown): unknown => {
  if (typeof a === "number" && typeof b === "number") return a + b
  if (isRecord(a) && isRecord(b)) return Object.fromEntries(Object.keys(a).map((key) => [key, sumDeep(a[key], b[key])]))
  return a ?? b
}

/** The bodies of successful choices as one: `choices` in order with their `index`, `usage` summed, the rest from the first. */
function mergeBodies(bodies: ReadonlyArray<object>): object {
  const [head] = bodies as ReadonlyArray<Record<string, unknown>>
  const choices = (bodies as ReadonlyArray<{ choices: object[] }>).map((body, index) => ({ ...body.choices[0], index }))
  const usage = (bodies as ReadonlyArray<{ usage?: unknown }>).map((body) => body.usage).reduce((total, next) => (total === undefined ? next : sumDeep(total, next)), undefined as unknown)
  return { ...head, choices, ...(usage === undefined ? {} : { usage }) }
}

const addUsage = (a: PlugUsage, b: PlugUsage): PlugUsage => {
  const out: { -readonly [K in keyof PlugUsage]: PlugUsage[K] } = {}
  for (const key of ["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens"] as const) {
    if (a[key] !== undefined || b[key] !== undefined) out[key] = (a[key] ?? 0) + (b[key] ?? 0)
  }
  return out
}

export async function serveChoices(host: Pick<RouteHost, "caller">, { app, calls, response, scope, info, codec }: ChoicesCall): Promise<void> {
  const fail = (error: PlugError) => sendJson(response, error.status, encodeError(error))
  // Abandoned requests (client gone, deadline passed) must never reach the model caller.
  if (scope.signal.aborted) throw scope.signal.reason

  const group = new AbortController()
  const cancel = () => group.abort(new RequestAborted("disconnected"))
  const gscope = groupScope(scope, AbortSignal.any([scope.signal, group.signal]))
  /** History record ids as the callers report them, in choice order, for the response header (comma separated). */
  const records: Array<string | undefined> = []
  // Headers: the first choice to be served wins. Body model: only a single call echoes the served model.
  const served = reportServed(response, info, (s) => {
    if (calls.length === 1) codec.setModel(s.model)
  })
  const open = (index: number) =>
    boundEvents(
      host.caller.stream(calls[index]!, {
        app,
        signal: gscope.signal,
        onRecord: (recordID) => {
          if (response.headersSent || response.destroyed || !/^[\x21-\x7e]+$/.test(recordID)) return
          records[index] = recordID
          response.setHeader(SESSION_HEADER, records.filter((id) => id !== undefined).join(","))
        },
        onServed: served,
      }),
      gscope,
    )

  if (!codec.stream) {
    const results = await new Promise<Array<{ status: number; body: object }>>((resolve, reject) => {
      const done: Array<{ status: number; body: object }> = []
      let left = calls.length
      calls.forEach((_, index) => {
        codec.collect(open(index), index).then(
          (result) => {
            if (result.status !== 200) {
              cancel()
              return resolve([result])
            }
            done[index] = result
            if (--left === 0) resolve(done)
          },
          (error) => {
            cancel()
            reject(error)
          },
        )
      })
    })
    const first = results[0]!
    return sendJson(response, first.status, results.length === 1 ? first.body : mergeBodies(results.map((result) => result.body)))
  }

  const sse = sseWriter(response, scope.signal)
  const shared = { id: `${codec.idPrefix}${crypto.randomUUID().replaceAll("-", "").slice(0, 29)}`, created: Math.floor(Date.now() / 1000) }
  const channels = calls.map(() => channel<PlugEvent>())
  let failure: PlugError | undefined
  let usage: PlugUsage | undefined
  const runs = channels.map((events, index) =>
    codec.streamChoice(events, sse.write, { ...shared, index }).then((result) => {
      if (result.failure && !failure) {
        failure = result.failure
        cancel()
      }
      if (result.usage) usage = usage ? addUsage(usage, result.usage) : result.usage
    }),
  )

  // The choice an event belongs to. Set just before it is yielded; the consumer reads it before it
  // pulls again, so it cannot change in between.
  let current = 0
  /**
   * The choices' events as one stream, so one `sse.paced` serves all: backpressure, and the
   * keepalive commit at the first non-terminal event of any choice. At most one event per choice
   * is pulled ahead. A choice's stream ending closes its channel.
   */
  async function* merged(): AsyncGenerator<PlugEvent> {
    const iterators = calls.map((_, index) => open(index)[Symbol.asyncIterator]())
    type Step = { index: number; result?: IteratorResult<PlugEvent>; error?: unknown; threw?: true }
    const pending = new Map<number, Promise<Step>>()
    const arm = (index: number) =>
      pending.set(
        index,
        iterators[index]!.next().then(
          (result): Step => ({ index, result }),
          (error): Step => ({ index, error, threw: true }),
        ),
      )
    try {
      for (let index = 0; index < iterators.length; index++) arm(index)
      while (pending.size > 0 && !failure) {
        const step = await Promise.race(pending.values())
        pending.delete(step.index)
        if (step.threw) throw step.error
        if (step.result!.done) {
          channels[step.index]!.close()
          continue
        }
        current = step.index
        yield step.result!.value
        arm(step.index)
      }
    } finally {
      for (const iterator of iterators) void iterator.return?.(undefined)?.catch?.(() => {})
      for (const events of channels) events.close()
    }
  }

  try {
    for await (const event of sse.paced(merged())) channels[current]!.push(event)
  } catch (error) {
    cancel()
    await Promise.all(runs)
    throw error
  }
  await Promise.all(runs)

  if (!failure && !sse.started && !response.headersSent) failure = { status: 502, kind: "server", message: "No response from the model" }
  if (failure) {
    if (!sse.started && !response.headersSent) {
      if (!scope.signal.aborted || scope.timedOut) fail(failure)
    } else {
      info.failed = failure.code ?? failure.kind
      sse.write(`data: ${JSON.stringify(encodeError(failure))}\n\ndata: [DONE]\n\n`)
      if (!response.writableEnded) response.end()
    }
    return
  }
  if (codec.includeUsage && usage) sse.write(`data: ${JSON.stringify(codec.usageChunk(shared, usage))}\n\n`)
  sse.write("data: [DONE]\n\n")
  if (!response.writableEnded) response.end()
}
