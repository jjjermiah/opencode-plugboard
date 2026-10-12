/**
 * Neutral results -> Anthropic Messages wire objects: one message object, or the named SSE
 * events of a stream, plus the Anthropic error body.
 *
 * One state machine (`runMessage`) serves both: it emits stream events as it goes and returns the
 * final message, so the JSON body and the stream never disagree. A non-streaming call passes a
 * no-op `emit`. Thinking blocks are produced only when the request asked for thinking.
 */
import type { PlugError, PlugEvent, PlugFinish, PlugUsage } from "../contract.js"

type ToolCall = Extract<PlugEvent, { type: "tool-call" }>

/** What the encoder needs besides the model events: Messages presentation state. The request decoder produces it. */
export interface MessagesExchange {
  /** The model string the client sent; echoed in the message object. A request that used an alias with fallbacks echoes the target that answered (`CallContext.onServed`). */
  model: string
  readonly stream: boolean
  /** `thinking` was enabled or adaptive: reasoning text is returned as thinking blocks. */
  readonly thinking: boolean
  /** The request's `stop_sequences`. The host reports a stop without the sequence that caused it, so the end of the text is checked. */
  readonly stop?: ReadonlyArray<string>
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
}

type Block = Record<string, unknown>

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`

/** Host call ids are not always Anthropic-shaped; `toolu_` plus the id with unsafe characters replaced. */
const toolId = (id: string) => (/^toolu_[A-Za-z0-9_-]+$/.test(id) ? id : `toolu_${id.replace(/[^A-Za-z0-9_-]/g, "_")}`)

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
  }
}

const STOP_REASON: Record<Exclude<PlugFinish, "error">, string> = {
  stop: "end_turn",
  length: "max_tokens",
  "tool-calls": "tool_use",
  "content-filter": "refusal",
}

/** The longest stop sequence the text ends with, if any. */
const stopTail = (tail: string, stops: ReadonlyArray<string>): string | undefined =>
  stops.filter((stop) => tail.endsWith(stop)).sort((a, b) => b.length - a.length)[0]

const noFinish = (): PlugError => ({ status: 500, kind: "server", message: "Model stream ended without a finish event" })
const failedRun = (): PlugError => ({ status: 500, kind: "server", message: "Model run failed" })

/** Anthropic's error `type` for a neutral error. */
const errorType = (error: PlugError): string => {
  if (error.status === 413) return "request_too_large"
  if (error.status === 529) return "overloaded_error"
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

/** SSE frame of one stream event: `event: <type>` then `data: <json>`. */
export const sseFrame = (event: MessagesStreamEvent): string => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`

export async function runMessage(
  events: AsyncIterable<PlugEvent>,
  exchange: MessagesExchange,
  emit: (event: MessagesStreamEvent) => void,
): Promise<MessageRun> {
  const id = newId("msg")
  const content: Block[] = []
  /** Blocks opened so far: the next block's `index`. */
  let nextIndex = 0
  let open: { kind: "text" | "thinking"; index: number; text: string } | undefined
  let started = false
  let pinged = false
  let calls = 0
  let finish: Exclude<PlugFinish, "error"> | undefined
  let usage: PlugUsage | undefined
  let failure: PlugError | undefined
  // Text is held back by the longest stop sequence (`holdback` characters), so a sequence at the end of
  // the answer can be found and removed before it is sent. Without stop sequences nothing is held.
  const holdback = Math.max(0, ...(exchange.stop ?? []).map((stop) => stop.length))
  let held = ""

  const message = (extra: Record<string, unknown>) => ({
    id,
    type: "message",
    role: "assistant",
    model: exchange.model,
    content,
    stop_reason: null,
    stop_sequence: null,
    usage: encodeUsage(undefined),
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
    // The signature is always empty: the host does not expose the provider's thinking signature (#146), so a
    // replayed thinking block cannot carry the real one. Clients that replay thinking are told by the docs.
    content.push(open.kind === "text" ? { type: "text", text: open.text } : { type: "thinking", thinking: open.text, signature: "" })
    open = undefined
  }
  const releaseHeld = () => {
    const out = held
    held = ""
    delta("text", out)
  }
  const text = (chunk: string) => {
    if (holdback === 0) return delta("text", chunk)
    held += chunk
    if (held.length > holdback) {
      const out = held.slice(0, held.length - holdback)
      held = held.slice(out.length)
      delta("text", out)
    }
  }
  const delta = (kind: "text" | "thinking", text: string) => {
    if (text.length === 0) return
    start()
    if (open && open.kind !== kind) close()
    if (!open) {
      open = { kind, index: nextIndex++, text: "" }
      emit({
        type: "content_block_start",
        index: open.index,
        content_block: kind === "text" ? { type: "text", text: "" } : { type: "thinking", thinking: "", signature: "" },
      })
      ping()
    }
    open.text += text
    emit({
      type: "content_block_delta",
      index: open.index,
      delta: kind === "text" ? { type: "text_delta", text } : { type: "thinking_delta", thinking: text },
    })
  }
  /** Tool calls arrive whole, so each goes out as one `input_json_delta` holding the full input. */
  const toolCall = (call: ToolCall) => {
    releaseHeld()
    start()
    close()
    const index = nextIndex++
    const toolUseId = toolId(call.id)
    const input = toolInput(call.input)
    emit({ type: "content_block_start", index, content_block: { type: "tool_use", id: toolUseId, name: call.name, input: {} } })
    ping()
    emit({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } })
    emit({ type: "content_block_stop", index })
    content.push({ type: "tool_use", id: toolUseId, name: call.name, input })
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
      else finish = event.reason
      continue
    }
    if (event.type === "reasoning-delta") {
      releaseHeld()
      if (exchange.thinking) delta("thinking", event.text)
    } else if (event.type === "text-delta") text(event.text)
    else toolCall(event)
  }

  failure ??= finish ? undefined : noFinish()
  if (failure) {
    if (!started) return { failure, started }
    // The stream is already committed: close what is open and end with an `error` event (no `message_stop`).
    releaseHeld()
    close()
    emit(encodeError(failure))
    return { failure, started }
  }
  // A plain stop with no tool calls that ends on a stop sequence: the sequence is not part of the answer.
  const matched = holdback > 0 && finish === "stop" && calls === 0 ? stopTail(held, exchange.stop ?? []) : undefined
  if (matched !== undefined) held = held.slice(0, held.length - matched.length)
  releaseHeld()
  start()
  close()
  ping()
  const reason = finish === "stop" && calls > 0 ? "tool-calls" : (finish ?? "stop")
  const stopReason = matched !== undefined ? "stop_sequence" : STOP_REASON[reason as Exclude<PlugFinish, "error">]
  const stopSequence = matched ?? null
  const final = message({ stop_reason: stopReason, stop_sequence: stopSequence, usage: encodeUsage(usage) })
  emit({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: stopSequence }, usage: final.usage })
  emit({ type: "message_stop" })
  return { started, message: final }
}
