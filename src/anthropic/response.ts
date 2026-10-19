/**
 * Neutral results -> Anthropic Messages wire objects: one message object, or the named SSE
 * events of a stream, plus the Anthropic error body.
 *
 * One state machine (`runMessage`) serves both: it emits stream events as it goes and returns the
 * final message, so the JSON body and the stream never disagree. A non-streaming call passes a
 * no-op `emit`. Thinking blocks are produced only when the request asked for thinking.
 */
import type { PlugError, PlugEvent, PlugFinish, PlugUsage } from "../contract.js"
import type { ListedModel } from "../models.js"
import { structuredMissing, textFallback } from "../openai/response.js"

type ToolCall = Extract<PlugEvent, { type: "tool-call" }>

/** What the encoder needs besides the model events: Messages presentation state. The request decoder produces it. */
export interface MessagesExchange {
  /** The model string the client sent; echoed in the message object. A request that used an alias with fallbacks echoes the target that answered (`CallContext.onServed`). */
  model: string
  readonly stream: boolean
  /** `thinking` was enabled or adaptive: reasoning text is returned as thinking blocks. */
  readonly thinking: boolean
  /** Name of the forced tool that carries `output_config.format` output; its input becomes the JSON text of the answer. */
  readonly structuredTool?: string
  /** The caller's schema, checked against a text answer when the model skipped the respond call (`textFallback`). */
  readonly structuredSchema?: Readonly<Record<string, unknown>>
  /**
   * The caller's own tools are offered next to the structured tool. A call to any of them is the
   * response (normal `tool_use`, prose and the structured answer dropped); the structured answer is
   * the text only when the step called no caller tool.
   */
  readonly callerTools?: boolean
}

/** A stream event as emitted: `type` is also the SSE event name. */
export type MessagesStreamEvent = { readonly type: string } & Record<string, unknown>

/** How an exchange ended. Nothing was emitted when `failure` is set and `started` is false: the caller answers with a real HTTP error. */
export interface MessageRun {
  readonly failure?: PlugError
  /** Whether `message_start` was emitted (a streamed response is committed as a 200 SSE stream). */
  readonly started: boolean
  /** The final message object. */
  readonly message?: object
  /** The structured answer came from the final text, not the respond call (`textFallback`). */
  readonly structuredFallback?: boolean
}

type Block = Record<string, unknown>

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`

/** Host call ids are not always Anthropic-shaped; `toolu_` plus the id with unsafe characters replaced. */
const toolId = (id: string) => (/^toolu_[A-Za-z0-9_-]+$/.test(id) ? id : `toolu_${id.replace(/[^A-Za-z0-9_-]/g, "_")}`)

/** Every tool call plugboard returns is one the model made directly (not from a server tool), as Anthropic reports it. */
const DIRECT_CALLER = () => ({ type: "direct" as const })

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** Tool input must be a JSON object; a string is parsed, anything else becomes `{}`. */
const toolInput = (input: unknown): Record<string, unknown> => {
  if (isRecord(input)) return input
  if (typeof input === "string") {
    try {
      const parsed: unknown = JSON.parse(input)
      if (isRecord(parsed)) return parsed
    } catch {}
  }
  return {}
}

/**
 * Anthropic's `input_tokens` excludes cached tokens, which are reported on their own, while
 * `PlugUsage.inputTokens` includes them.
 */
const encodeUsage = (usage: PlugUsage | undefined) => {
  const read = usage?.cacheReadTokens ?? 0
  const write = usage?.cacheWriteTokens ?? 0
  return {
    input_tokens: Math.max(0, (usage?.inputTokens ?? 0) - read - write),
    output_tokens: usage?.outputTokens ?? 0,
    cache_creation_input_tokens: write,
    cache_read_input_tokens: read,
    output_tokens_details: null,
    server_tool_use: null,
  }
}

/**
 * A Message's usage: the counts above plus `cache_creation`, `inference_geo` and `service_tier`, which the SDK's `Usage` type
 * requires (null when plugboard has no value). message_delta carries the narrower `MessageDeltaUsage`, so it takes `encodeUsage` alone.
 */
const encodeMessageUsage = (usage: PlugUsage | undefined) => ({ ...encodeUsage(usage), cache_creation: null, inference_geo: null, service_tier: null })

const STOP_REASON: Record<Exclude<PlugFinish, "error">, string> = {
  stop: "end_turn",
  length: "max_tokens",
  "tool-calls": "tool_use",
  "content-filter": "refusal",
}

const noFinish = (): PlugError => ({ status: 500, kind: "server", message: "Model stream ended without a finish event" })
const failedRun = (): PlugError => ({ status: 500, kind: "server", message: "Model run failed" })

/** The `code` of a provider overload (events.ts): Anthropic's `overloaded_error`, answered with HTTP 529 (#204). */
const OVERLOADED = "provider_overloaded"

/** The HTTP status of a neutral error on this route: a provider overload is 529, the status Anthropic clients retry on. */
export const messagesStatus = (error: PlugError): number => (error.code === OVERLOADED ? 529 : error.status)

/** Anthropic's error `type` for a neutral error. */
const errorType = (error: PlugError): string => {
  if (error.status === 413) return "request_too_large"
  if (error.status === 529 || error.code === OVERLOADED) return "overloaded_error"
  switch (error.kind) {
    case "invalid_request":
      return "invalid_request_error"
    case "authentication":
      return "authentication_error"
    case "permission":
      return "permission_error"
    case "not_found":
      return "not_found_error"
    case "rate_limit":
      return "rate_limit_error"
    case "timeout":
      return "timeout_error"
    default:
      return "api_error"
  }
}

/** `{"type":"error","error":{"type","message"}}`: the body of every error on this route, and the data of a stream `error` event. */
export const encodeError = (error: PlugError) => ({ type: "error", error: { type: errorType(error), message: error.message } })

/** One model as Anthropic's `GET /v1/models/{id}` (and each `data` entry) names it. An unknown release date is the epoch. */
export const encodeModel = ({ id, model }: ListedModel) => {
  const released = model.released === undefined ? NaN : new Date(model.released).getTime()
  return { type: "model", id, display_name: model.name ?? id, created_at: new Date(Number.isNaN(released) ? 0 : released).toISOString() }
}

/** Anthropic's `limit` on `GET /v1/models`: default 20, from 1 to 1000. */
export const MODEL_PAGE_DEFAULT = 20
export const MODEL_PAGE_MAX = 1000

export interface ModelPageQuery {
  readonly limit: number
  readonly afterId?: string
  readonly beforeId?: string
}

/** The paging query of `GET /v1/models`. A refusal is a 400, the same shape as the other parameter refusals. */
export const modelPageQuery = (params: URLSearchParams): ModelPageQuery | PlugError => {
  const raw = params.get("limit")
  const limit = raw === null ? MODEL_PAGE_DEFAULT : /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  if (!(limit >= 1 && limit <= MODEL_PAGE_MAX)) return { status: 400, kind: "invalid_request", code: "invalid_limit", param: "limit", message: "limit must be a whole number from 1 to 1000" }
  const afterId = params.get("after_id") ?? undefined
  const beforeId = params.get("before_id") ?? undefined
  if (afterId !== undefined && beforeId !== undefined) return { status: 400, kind: "invalid_request", code: "invalid_cursor", param: "before_id", message: "after_id and before_id cannot both be set" }
  return { limit, afterId, beforeId }
}

/**
 * One page in catalog order. `after_id` starts after that model, `before_id` ends before it; `hasMore` says
 * whether the page's direction has models left. `undefined` when the cursor names no listed model.
 */
export const pageModels = (models: ReadonlyArray<ListedModel>, { limit, afterId, beforeId }: ModelPageQuery) => {
  if (beforeId !== undefined) {
    const end = models.findIndex((m) => m.id === beforeId)
    if (end < 0) return undefined
    const start = Math.max(0, end - limit)
    return { models: models.slice(start, end), hasMore: start > 0 }
  }
  const start = afterId === undefined ? 0 : models.findIndex((m) => m.id === afterId) + 1
  if (afterId !== undefined && start === 0) return undefined
  return { models: models.slice(start, start + limit), hasMore: start + limit < models.length }
}

/** `GET /v1/models` in Anthropic's list shape: one page, with `has_more` for its direction. */
export const encodeModelPage = (models: ReadonlyArray<ListedModel>, hasMore: boolean) => ({
  data: models.map(encodeModel),
  has_more: hasMore,
  first_id: models[0]?.id ?? null,
  last_id: models.at(-1)?.id ?? null,
})

/** SSE frame of one stream event: `event: <type>` then `data: <json>`. */
export const sseFrame = (event: MessagesStreamEvent): string => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`

/** The text of a structured answer: the tool input as JSON (a string input is the JSON already). */
const structuredText = (call: ToolCall): string => (typeof call.input === "string" ? call.input : JSON.stringify(call.input ?? {}))

export async function runMessage(events: AsyncIterable<PlugEvent>, exchange: MessagesExchange, emit: (event: MessagesStreamEvent) => void): Promise<MessageRun> {
  const id = newId("msg")
  // Only a non-streamed body needs the aggregate: a stream is already on the wire, so nothing grows (#153).
  const aggregate = !exchange.stream
  const content: Block[] = []
  /** Blocks opened so far: the next block's `index`. */
  let nextIndex = 0
  let open: { kind: "text" | "thinking"; index: number; text: string; signature?: string } | undefined
  let started = false
  let pinged = false
  let calls = 0
  let answered = false
  /** The text of a structured turn (not emitted): it is the answer only if the respond call never comes. */
  let collected = ""
  /** With caller tools offered the structured answer waits for the finish: a caller tool call in the same step replaces it. */
  let held: ToolCall | undefined
  let finish: Exclude<PlugFinish, "error"> | undefined
  /** The caller's stop sequence that ended the answer, when one did (src/stop.ts). */
  let matched: string | undefined
  let usage: PlugUsage | undefined
  let failure: PlugError | undefined

  const message = (extra: Record<string, unknown>) => ({
    id,
    type: "message",
    role: "assistant",
    model: exchange.model,
    content,
    stop_reason: null,
    stop_sequence: null,
    container: null,
    diagnostics: null,
    stop_details: null,
    usage: encodeMessageUsage(undefined),
    ...extra,
  })
  const start = () => {
    if (started) return
    started = true
    emit({ type: "message_start", message: message({ content: [] }) })
  }
  /** The first content block is followed by one `ping`, as the Anthropic API does. */
  const ping = () => {
    if (pinged) return
    pinged = true
    emit({ type: "ping" })
  }
  const close = () => {
    if (!open) return
    emit({ type: "content_block_stop", index: open.index })
    // A thinking block carries the provider's signature when the host reported one (#146); otherwise it is empty. Plugboard drops
    // thinking blocks it receives, so a replayed block never reaches a provider with an empty signature.
    if (aggregate) content.push(open.kind === "text" ? { type: "text", text: open.text, citations: null } : { type: "thinking", thinking: open.text, signature: open.signature ?? "" })
    open = undefined
  }
  /** The provider's signature for the open thinking block (#146): a `signature_delta` before the block stops. */
  const sign = (signature: string) => {
    if (open?.kind !== "thinking") return
    open.signature = signature
    emit({ type: "content_block_delta", index: open.index, delta: { type: "signature_delta", signature } })
  }
  /** A redacted thinking block (#385): the provider's opaque payload, one whole block with no deltas, as the API sends it. */
  const redacted = (data: string) => {
    start()
    close()
    const index = nextIndex++
    emit({ type: "content_block_start", index, content_block: { type: "redacted_thinking", data } })
    ping()
    emit({ type: "content_block_stop", index })
    if (aggregate) content.push({ type: "redacted_thinking", data })
  }
  const text = (chunk: string) => delta("text", chunk)
  const delta = (kind: "text" | "thinking", text: string) => {
    if (text.length === 0) return
    start()
    if (open && open.kind !== kind) close()
    if (!open) {
      open = { kind, index: nextIndex++, text: "" }
      emit({
        type: "content_block_start",
        index: open.index,
        content_block: kind === "text" ? { type: "text", text: "", citations: null } : { type: "thinking", thinking: "", signature: "" },
      })
      ping()
    }
    if (aggregate) open.text += text
    emit({
      type: "content_block_delta",
      index: open.index,
      delta: kind === "text" ? { type: "text_delta", text } : { type: "thinking_delta", thinking: text },
    })
  }
  /** Tool calls arrive whole, so each goes out as one `input_json_delta` holding the full input. */
  const toolCall = (call: ToolCall) => {
    start()
    close()
    const index = nextIndex++
    const toolUseId = toolId(call.id)
    const input = toolInput(call.input)
    emit({ type: "content_block_start", index, content_block: { type: "tool_use", id: toolUseId, name: call.name, caller: DIRECT_CALLER(), input: {} } })
    ping()
    emit({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } })
    emit({ type: "content_block_stop", index })
    if (aggregate) content.push({ type: "tool_use", id: toolUseId, name: call.name, caller: DIRECT_CALLER(), input })
    calls++
  }

  for await (const event of events) {
    if (event.type === "error") {
      failure = event.error
      break
    }
    if (event.type === "finish") {
      usage = event.usage ?? usage
      if (event.reason === "error") failure ??= failedRun()
      else {
        finish = event.reason
        matched = event.stopSequence
      }
      continue
    }
    if (event.type === "reasoning-delta") {
      if (exchange.thinking) {
        if (event.redactedData !== undefined) redacted(event.redactedData)
        else {
          delta("thinking", event.text)
          if (event.signature !== undefined) sign(event.signature)
        }
      }
    } else if (exchange.structuredTool !== undefined) {
      // Structured mode: only the first answer is content; prose and other tool calls are suppressed, except the caller's own tools when offered.
      if (event.type === "tool-call" && event.name === exchange.structuredTool) {
        if (!answered) {
          answered = true
          if (exchange.callerTools) held = event
          else text(structuredText(event))
        }
      } else if (event.type === "text-delta") collected += event.text
      else if (exchange.callerTools) toolCall(event)
    } else if (event.type === "text-delta") text(event.text)
    else toolCall(event)
  }

  const passthrough = exchange.callerTools === true && calls > 0
  const structuredTurn = exchange.structuredTool !== undefined && !passthrough
  const fallback = structuredTurn && !answered && exchange.structuredSchema !== undefined ? textFallback(collected, exchange.structuredSchema) : undefined
  failure ??= finish ? (structuredTurn && !answered && fallback === undefined ? structuredMissing() : undefined) : noFinish()
  if (failure) {
    if (!started) return { failure, started }
    // The stream is already committed: close what is open and end with an `error` event (no `message_stop`).
    close()
    emit(encodeError(failure))
    return { failure, started }
  }
  if (held && !passthrough) text(structuredText(held))
  if (fallback !== undefined) text(fallback)
  start()
  close()
  ping()
  // A tool call in the turn makes it a tool turn, as Anthropic reports it: a sequence after the call does not change the reason.
  // A structured answer is text to the caller: its turn ends as `end_turn` although the model ended on the respond call.
  const reason = structuredTurn && finish === "tool-calls" ? "stop" : finish === "stop" && calls > 0 ? "tool-calls" : (finish ?? "stop")
  const sequence = calls === 0 && !answered ? (matched ?? null) : null
  const stopReason = sequence !== null ? "stop_sequence" : STOP_REASON[reason as Exclude<PlugFinish, "error">]
  const final = message({ stop_reason: stopReason, stop_sequence: sequence, usage: encodeMessageUsage(usage) })
  emit({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: sequence, container: null, stop_details: null }, usage: encodeUsage(usage) })
  emit({ type: "message_stop" })
  return { started, message: final, ...(fallback !== undefined ? { structuredFallback: true } : {}) }
}
