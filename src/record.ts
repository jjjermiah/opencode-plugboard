/**
 * The exchange record (#586): one JSON document per model request, kept in plugboard's storage under the app, so you can read what
 * a client sent and what plugboard answered, with the routing and the errors in between. It is on by default (option
 * `history.storeRequestBody`, per app or global) and stores everything, with no size cap: images, long histories and streams can be
 * megabytes each.
 *
 * What is in it:
 * - `request`: method, path, query and every header, and the body as received, byte for byte (`{ text }`, or `{ base64 }` when the
 *   bytes are not UTF-8). The only redactions are the values of `Authorization`, `x-api-key`, `x-goog-api-key` and a `key` query
 *   parameter (Gemini's way of sending a key).
 * - `response`: the status, every header and the body as sent. A stream is its raw SSE bytes.
 * - `timing`: received, first byte, finished.
 * - `routing`: the app, the model requested, the model served, the fallback chain taken, the breaker's decisions, the cache result.
 * - `calls`: per model call (one per choice of `n`), the final response assembled from the events (text, reasoning, tool calls, finish
 *   reason), the usage as the model reported it, the cost, and the session id.
 * - `errors`: every failure with its full body, including the host's own error before plugboard maps it to a caller-safe one.
 *
 * `ExchangeRecorder` is built per request by the route, reached by the layers below through `currentRecorder` (an async-local
 * store, like the request id of the log) so no layer's signature changes, and turned into the record when the response is over.
 */

import { AsyncLocalStorage } from "node:async_hooks"
import type { IncomingHttpHeaders, ServerResponse } from "node:http"
import type { CallContext, CallTotals, ModelCaller, PlugError, PlugEvent, PlugRequest, PlugUsage, PolicyNote, ServedModel } from "./contract.js"

export const REDACTED = "[redacted]"
/** Header names (lower case) whose value is never stored. */
const REDACTED_HEADERS: ReadonlySet<string> = new Set(["authorization", "x-api-key", "x-goog-api-key"])
/** Query parameters whose value is never stored: Gemini clients may send the key as `?key=`. */
const REDACTED_QUERY: ReadonlySet<string> = new Set(["key"])

/** Bytes kept exactly: as `text` when they are valid UTF-8, else as `base64`. */
export type ExactBytes = { readonly text: string } | { readonly base64: string }

export function exactBytes(bytes: Buffer): ExactBytes {
  const text = bytes.toString("utf8")
  return Buffer.from(text, "utf8").equals(bytes) ? { text } : { base64: bytes.toString("base64") }
}

/** A value as plain JSON: circular references, bigints and functions are made safe so the record always serializes. */
export function jsonSafe(value: unknown): unknown {
  try {
    const seen = new WeakSet<object>()
    return JSON.parse(
      JSON.stringify(value, (_key, item: unknown) => {
        if (typeof item === "bigint") return item.toString()
        if (typeof item === "function") return `[function ${item.name}]`
        if (item instanceof Error) return { name: item.name, message: item.message }
        if (typeof item === "object" && item !== null) {
          if (seen.has(item)) return "[circular]"
          seen.add(item)
        }
        return item
      }) ?? "null",
    )
  } catch {
    return String(value)
  }
}

/** Request headers with the secret values redacted (names kept, so a reader sees a credential was sent). */
function redactedHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    out[name] = REDACTED_HEADERS.has(name.toLowerCase()) ? (Array.isArray(value) ? value.map(() => REDACTED) : REDACTED) : value
  }
  return out
}

/** The query as ordered name and value pairs, repeated names kept. */
function queryPairs(url: URL): Array<[string, string]> {
  return [...url.searchParams.entries()].map(([name, value]): [string, string] => [name, REDACTED_QUERY.has(name.toLowerCase()) ? REDACTED : value])
}

/** The bytes as JSON when they parse as it, else as text. */
function parsedOrText(bytes: Buffer): unknown {
  const text = bytes.toString("utf8")
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** What one model call produced, assembled from its events. */
interface Assembled {
  text: string
  reasoning: string
  reasoningSignatures: string[]
  reasoningRedacted: string[]
  toolCalls: Array<{ id: string; name: string; input: unknown }>
  finish?: { reason: string; stopSequence?: string }
  error?: PlugError
}

/** One model call of the request: what it asked, what answered it, and what came back. */
export class CallRecorder {
  readonly assembled: Assembled = { text: "", reasoning: "", reasoningSignatures: [], reasoningRedacted: [], toolCalls: [] }
  served?: ServedModel
  cache?: "hit" | "miss"
  cacheDirective?: "bypass" | "refresh"
  policy?: ReadonlyArray<PolicyNote>
  affinity?: "anchor" | "none"
  session?: { id: string; directory?: string }
  usage?: PlugUsage
  totals?: CallTotals
  opencodeToolCalls?: number
  runUsage?: PlugUsage

  constructor(
    readonly index: number,
    private readonly request: PlugRequest,
  ) {}

  /** The model string the caller sent (an id or an alias). */
  get requestedModel(): string {
    return this.request.model
  }

  /** Folds one event of the call into the assembled response. */
  event(event: PlugEvent): void {
    const into = this.assembled
    if (event.type === "text-delta") into.text += event.text
    else if (event.type === "reasoning-delta") {
      into.reasoning += event.text
      if (event.signature !== undefined) into.reasoningSignatures.push(event.signature)
      if (event.redactedData !== undefined) into.reasoningRedacted.push(event.redactedData)
    } else if (event.type === "tool-call") into.toolCalls.push({ id: event.id, name: event.name, input: jsonSafe(event.input) })
    else if (event.type === "finish") {
      into.finish = { reason: event.reason, ...(event.stopSequence === undefined ? {} : { stopSequence: event.stopSequence }) }
      if (event.usage) this.usage = event.usage
    } else into.error = event.error
  }

  toJSON(): unknown {
    return {
      index: this.index,
      requestedModel: this.requestedModel,
      resolvedModel: `${this.request.ref.providerID}/${this.request.ref.id}${this.request.ref.variant ? `#${this.request.ref.variant}` : ""}`,
      served: this.served ?? null,
      cache: this.cache ?? null,
      cacheDirective: this.cacheDirective ?? null,
      policy: this.policy ?? null,
      affinity: this.affinity ?? null,
      session: this.session ?? null,
      usage: this.usage ?? this.runUsage ?? null,
      cost: this.totals ?? null,
      opencodeToolCalls: this.opencodeToolCalls ?? null,
      response: this.assembled,
    }
  }
}

/** A step of the routing: a breaker decision, a failed attempt, a move to the next target. */
export type TraceKind = "breaker" | "attempts" | "fallbacks"

export interface ExchangeInit {
  readonly id: string
  readonly app: string
  readonly method: string
  readonly url: URL
  readonly headers: IncomingHttpHeaders
  /** `Date.now()`, injectable for tests. */
  readonly now?: () => number
}

/** The record as stored. Plain JSON. */
export interface ExchangeRecord {
  readonly version: 1
  readonly id: string
  readonly app: string
  /** The request log's outcome: `ok`, `error`, `timeout`, `disconnected`, `status_<code>`, `body_<code>`. */
  readonly outcome: string
  readonly timing: { readonly receivedAt: string; readonly firstByteAt: string | null; readonly finishedAt: string; readonly firstByteMs: number | null; readonly totalMs: number }
  readonly request: { readonly method: string; readonly path: string; readonly query: Array<[string, string]>; readonly headers: Record<string, string | string[]>; readonly body: ExactBytes | null }
  readonly response: { readonly status: number; readonly headers: Record<string, unknown>; readonly body: ExactBytes }
  readonly routing: {
    readonly app: string
    readonly requestedModel: string | null
    readonly served: Array<ServedModel | null>
    readonly cache: Array<"hit" | "miss" | null>
    readonly breaker: unknown[]
    readonly attempts: unknown[]
    readonly fallbacks: unknown[]
  }
  readonly sessions: string[]
  readonly calls: unknown[]
  readonly errors: unknown[]
}

export class ExchangeRecorder {
  readonly id: string
  readonly app: string
  private readonly now: () => number
  private readonly receivedAt: number
  private firstByteAt: number | undefined
  private readonly method: string
  private readonly url: URL
  private readonly headers: Record<string, string | string[]>
  private readonly chunks: Buffer[] = []
  private head: { status?: number; headers: Record<string, unknown> } = { headers: {} }
  private readonly callRecorders: CallRecorder[] = []
  private readonly traces: Record<TraceKind, unknown[]> = { breaker: [], attempts: [], fallbacks: [] }
  private readonly failures: unknown[] = []

  constructor(init: ExchangeInit) {
    this.id = init.id
    this.app = init.app
    this.now = init.now ?? Date.now
    this.receivedAt = this.now()
    this.method = init.method
    this.url = init.url
    this.headers = redactedHeaders(init.headers)
  }

  /** A piece of the response as it is written. */
  chunk(data: unknown, encoding?: unknown): void {
    if (data === undefined || data === null) return
    const bytes = typeof data === "string" ? Buffer.from(data, typeof encoding === "string" ? (encoding as BufferEncoding) : "utf8") : Buffer.from(data as Uint8Array)
    if (bytes.length === 0) return
    this.firstByteAt ??= this.now()
    this.chunks.push(bytes)
  }

  /** The status and headers a `writeHead` call carried. */
  writeHead(status: number, headers: unknown): void {
    this.head.status = status
    if (Array.isArray(headers)) {
      const list = headers as unknown[]
      for (let i = 0; i + 1 < list.length; i += 2) this.head.headers[String(list[i]).toLowerCase()] = list[i + 1]
    } else if (typeof headers === "object" && headers !== null) for (const [name, value] of Object.entries(headers)) this.head.headers[name.toLowerCase()] = value
  }

  /** Starts the record of one model call (a choice of `n`, or a fallback chain's whole call). */
  beginCall(request: PlugRequest): CallRecorder {
    const call = new CallRecorder(this.callRecorders.length, request)
    this.callRecorders.push(call)
    return call
  }

  /** Adds a routing step, or an error body (`errors`, kind `error`). */
  trace(kind: TraceKind | "error", data: Record<string, unknown>): void {
    const safe = jsonSafe({ at: new Date(this.now()).toISOString(), ...data })
    if (kind === "error") this.failures.push(safe)
    else this.traces[kind].push(safe)
  }

  /** The record, once the response is over. `body` is the request body as read, if it was read. */
  finish(response: ServerResponse, body: Buffer | undefined, outcome: string): ExchangeRecord {
    const finishedAt = this.now()
    const headers: Record<string, unknown> = { ...response.getHeaders(), ...this.head.headers }
    const sessions = this.callRecorders.flatMap((call) => (call.session ? [call.session.id] : []))
    const calls = this.callRecorders
    const errors = [...this.failures]
    for (const call of calls) if (call.assembled.error) errors.push({ source: "plugboard", call: call.index, error: call.assembled.error })
    // An error the client was answered with, whole, also when it never came from a model call (a refused body, an unknown model).
    const status = this.head.status ?? response.statusCode
    const sent = Buffer.concat(this.chunks)
    if (status >= 400) errors.push({ source: "response", status, body: parsedOrText(sent) })
    return {
      version: 1,
      id: this.id,
      app: this.app,
      outcome,
      timing: {
        receivedAt: new Date(this.receivedAt).toISOString(),
        firstByteAt: this.firstByteAt === undefined ? null : new Date(this.firstByteAt).toISOString(),
        finishedAt: new Date(finishedAt).toISOString(),
        firstByteMs: this.firstByteAt === undefined ? null : this.firstByteAt - this.receivedAt,
        totalMs: finishedAt - this.receivedAt,
      },
      request: { method: this.method, path: this.url.pathname, query: queryPairs(this.url), headers: this.headers, body: body === undefined ? null : exactBytes(body) },
      response: { status, headers: jsonSafe(headers) as Record<string, unknown>, body: exactBytes(sent) },
      routing: {
        app: this.app,
        requestedModel: calls[0]?.requestedModel ?? null,
        served: calls.map((call) => call.served ?? null),
        cache: calls.map((call) => call.cache ?? null),
        breaker: this.traces.breaker,
        attempts: this.traces.attempts,
        fallbacks: this.traces.fallbacks,
      },
      sessions,
      calls: calls.map((call) => call.toJSON()),
      errors,
    }
  }
}

const store = new AsyncLocalStorage<ExchangeRecorder | undefined>()

/** Runs `fn` so every layer below it reaches `recorder` through `currentRecorder`. */
export const withRecorder = <T>(recorder: ExchangeRecorder | undefined, fn: () => T): T => store.run(recorder, fn)

/** The recorder of the request being handled, or undefined (not a model request, or recording is off). */
export const currentRecorder = (): ExchangeRecorder | undefined => store.getStore()

/** A routing step or an error for the request being handled; does nothing when it is not recorded. */
export function trace(kind: TraceKind | "error", data: Record<string, unknown>): void {
  store.getStore()?.trace(kind, data)
}

/**
 * Makes `response` copy what it writes into `recorder`: the status and headers of `writeHead`, and every chunk of `write` and `end`, as
 * sent. The response itself is unchanged.
 */
export function teeResponse(response: ServerResponse, recorder: ExchangeRecorder): void {
  const write = response.write.bind(response) as (...args: unknown[]) => boolean
  const end = response.end.bind(response) as (...args: unknown[]) => ServerResponse
  const writeHead = response.writeHead.bind(response) as (...args: unknown[]) => ServerResponse
  response.write = ((chunk: unknown, ...rest: unknown[]) => {
    recorder.chunk(chunk, rest[0])
    return write(chunk, ...rest)
  }) as typeof response.write
  response.end = ((chunk?: unknown, ...rest: unknown[]) => {
    if (typeof chunk !== "function") recorder.chunk(chunk, rest[0])
    return end(chunk, ...rest)
  }) as typeof response.end
  response.writeHead = ((status: number, ...rest: unknown[]) => {
    recorder.writeHead(
      status,
      rest.find((item) => typeof item === "object" && item !== null),
    )
    return writeHead(status, ...rest)
  }) as typeof response.writeHead
}

/**
 * The model caller that fills the call records of the request being handled: the events of each call, and the hooks the layers below
 * call (served model, cache, policy, affinity, usage, the session). It only observes: every hook is passed on, and a call outside a
 * recorded request goes straight through. The usage hook is always set, so the cost is recorded for a stream too.
 */
export function recording(inner: ModelCaller): ModelCaller {
  return {
    stream(request, context) {
      const recorder = currentRecorder()
      if (!recorder) return inner.stream(request, context)
      const call = recorder.beginCall(request)
      const seen: CallContext = {
        ...context,
        onRecord: (id, directory) => {
          call.session = { id, ...(directory === undefined ? {} : { directory }) }
          context.onRecord?.(id, directory)
        },
        onServed: (served) => {
          call.served = served
          context.onServed?.(served)
        },
        onCache: (result) => {
          call.cache = result
          context.onCache?.(result)
        },
        onCacheDirective: (mode) => {
          call.cacheDirective = mode
          context.onCacheDirective?.(mode)
        },
        onPolicy: (notes) => {
          call.policy = notes
          context.onPolicy?.(notes)
        },
        onAffinity: (mode) => {
          call.affinity = mode
          context.onAffinity?.(mode)
        },
        onUsage: (totals) => {
          call.totals = totals
          context.onUsage?.(totals)
        },
        onRunUsage: (usage) => {
          call.runUsage = usage
          context.onRunUsage?.(usage)
        },
        onOpencodeTools: (count) => {
          call.opencodeToolCalls = count
          context.onOpencodeTools?.(count)
        },
      }
      const events = inner.stream(request, seen)
      return (async function* () {
        for await (const event of events) {
          call.event(event)
          yield event
        }
      })()
    },
  }
}
