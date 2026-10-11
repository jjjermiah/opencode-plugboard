/**
 * Neutral results -> OpenAI Responses wire objects: one response object, or the named SSE
 * events of a stream.
 *
 * One state machine (`runResponse`) serves both: it emits stream events as it goes and returns
 * the final response object, so the JSON body and the stream never disagree. A non-streaming
 * call passes a no-op `emit`. Reasoning deltas are dropped (no reasoning items are produced).
 */
import type { PlugError, PlugEvent, PlugFinish, PlugUsage } from "../contract.js"

type ToolCall = Extract<PlugEvent, { type: "tool-call" }>

/** What the encoder needs besides the model events: Responses presentation state. The request decoder produces it. */
export interface ResponsesExchange {
  /** The model string the client sent; echoed in every response object. */
  readonly model: string
  readonly stream: boolean
  /** Request fields echoed into the response object (instructions, tools, temperature, ...). */
  readonly envelope: Readonly<Record<string, unknown>>
  /** Name of the forced tool that carries `text.format` json_schema output; its input becomes the message text. */
  readonly structuredTool?: string
  /**
   * The caller's own tools are offered next to the structured tool. A call to any of them is the
   * response (function_call items, prose and the structured answer dropped); the structured
   * answer is the message text only when the step called no caller tool.
   */
  readonly callerTools?: boolean
}

/** A stream event as emitted: `type` is also the SSE event name. */
export type ResponsesStreamEvent = { readonly type: string; readonly sequence_number: number } & Record<string, unknown>

/** How an exchange ended. Nothing was emitted when `failure` is set and `started` is false: the caller answers with a real HTTP error. */
export interface ResponseRun {
  readonly failure?: PlugError
  /** Whether `response.created` was emitted (a streamed response is committed as a 200 SSE stream). */
  readonly started: boolean
  /** The final response object (completed, incomplete or failed once started). */
  readonly response?: object
}

type Item = Record<string, unknown>

const args = (input: unknown) => (typeof input === "string" ? input : JSON.stringify(input ?? {}))

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`

const encodeUsage = (usage: PlugUsage) => {
  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  return {
    input_tokens: input,
    input_tokens_details: { cached_tokens: usage.cacheReadTokens ?? 0 },
    output_tokens: output,
    output_tokens_details: { reasoning_tokens: usage.reasoningTokens ?? 0 },
    total_tokens: input + output,
  }
}

const noFinish = (): PlugError => ({ status: 500, kind: "server", message: "Model stream ended without a finish event" })
const failedRun = (): PlugError => ({ status: 500, kind: "server", message: "Model run failed" })

/** SSE frame of one stream event: `event: <type>` then `data: <json>`. */
export const sseFrame = (event: ResponsesStreamEvent): string => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`

/**
 * Structured-output projection, same rules as the Chat Completions front-end: in structured mode
 * the message text is exactly the arguments of the first call to the `respond` tool; prose and
 * other calls are suppressed. Without an answer the exchange fails, except when the model
 * stopped for `length` or `content-filter`, which keep their status with empty output.
 */
const structuredFailure = (exchange: ResponsesExchange, finish: Exclude<PlugFinish, "error">, answered: boolean): PlugError | undefined =>
  exchange.structuredTool === undefined || answered || finish === "length" || finish === "content-filter"
    ? undefined
    : {
        status: 502,
        kind: "server",
        code: "structured_output_missing",
        message: `The model finished without calling the \`${exchange.structuredTool}\` tool, so there is no structured output`,
      }

export async function runResponse(
  events: AsyncIterable<PlugEvent>,
  exchange: ResponsesExchange,
  emit: (event: ResponsesStreamEvent) => void,
): Promise<ResponseRun> {
  const id = newId("resp")
  const createdAt = Math.floor(Date.now() / 1000)
  let sequence = 0
  const send = (type: string, data: Record<string, unknown>) => emit({ type, sequence_number: sequence++, ...data })
  const envelope = (status: string, output: Item[], extra: Record<string, unknown> = {}) => ({
    id,
    object: "response",
    created_at: createdAt,
    status,
    error: null,
    incomplete_details: null,
    model: exchange.model,
    output,
    ...exchange.envelope,
    ...extra,
  })

  const items: Item[] = []
  /** Output items that are open or done: the next item's `output_index`. */
  let nextIndex = 0
  let open: { id: string; index: number; text: string } | undefined
  let started = false
  let calls = 0
  let answered = false
  /** With caller tools offered the structured answer waits for the finish: a caller tool call in the same step replaces it. */
  let held: ToolCall | undefined
  let finish: Exclude<PlugFinish, "error"> | undefined
  let usage: PlugUsage | undefined
  let failure: PlugError | undefined

  const start = () => {
    if (started) return
    started = true
    send("response.created", { response: envelope("in_progress", []) })
    send("response.in_progress", { response: envelope("in_progress", []) })
  }
  const messageItem = (itemId: string, status: string, text: string | undefined): Item => ({
    id: itemId,
    type: "message",
    status,
    role: "assistant",
    content: text === undefined ? [] : [{ type: "output_text", text, annotations: [], logprobs: [] }],
  })
  const text = (delta: string) => {
    if (delta.length === 0) return
    start()
    if (!open) {
      open = { id: newId("msg"), index: nextIndex++, text: "" }
      send("response.output_item.added", { output_index: open.index, item: messageItem(open.id, "in_progress", undefined) })
      send("response.content_part.added", {
        item_id: open.id,
        output_index: open.index,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [], logprobs: [] },
      })
    }
    open.text += delta
    send("response.output_text.delta", { item_id: open.id, output_index: open.index, content_index: 0, delta, logprobs: [] })
  }
  const closeMessage = () => {
    if (!open) return
    const part = { type: "output_text", text: open.text, annotations: [], logprobs: [] }
    send("response.output_text.done", { item_id: open.id, output_index: open.index, content_index: 0, text: open.text, logprobs: [] })
    send("response.content_part.done", { item_id: open.id, output_index: open.index, content_index: 0, part })
    const item = messageItem(open.id, "completed", open.text)
    send("response.output_item.done", { output_index: open.index, item })
    items.push(item)
    open = undefined
  }
  /** Tool calls arrive whole, so each goes out as one arguments delta. */
  const toolCall = (call: ToolCall) => {
    start()
    closeMessage()
    const index = nextIndex++
    const itemId = newId("fc")
    const argumentsText = args(call.input)
    const item = (status: string, text: string): Item => ({ id: itemId, type: "function_call", status, call_id: call.id, name: call.name, arguments: text })
    send("response.output_item.added", { output_index: index, item: item("in_progress", "") })
    send("response.function_call_arguments.delta", { item_id: itemId, output_index: index, delta: argumentsText })
    send("response.function_call_arguments.done", { item_id: itemId, output_index: index, name: call.name, arguments: argumentsText })
    const done = item("completed", argumentsText)
    send("response.output_item.done", { output_index: index, item: done })
    items.push(done)
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
    if (event.type === "reasoning-delta") continue
    if (exchange.structuredTool !== undefined) {
      // Structured mode: only the first answer is content; prose and other tool calls are
      // suppressed, except the caller's own tools when they are offered.
      if (event.type === "tool-call" && event.name === exchange.structuredTool) {
        if (!answered) {
          answered = true
          if (exchange.callerTools) held = event
          else text(args(event.input))
        }
        continue
      }
      if (!(exchange.callerTools && event.type === "tool-call")) continue
    }
    if (event.type === "text-delta") text(event.text)
    else toolCall(event)
  }

  const passthrough = exchange.callerTools === true && calls > 0
  const structuredAnswer = exchange.structuredTool !== undefined && !passthrough
  failure ??= finish ? (passthrough ? undefined : structuredFailure(exchange, finish, answered)) : noFinish()
  if (failure) {
    if (!started) return { failure, started }
    closeMessage()
    const response = envelope("failed", items, {
      error: { code: failure.code ?? failure.kind, message: failure.message },
      ...(usage ? { usage: encodeUsage(usage) } : {}),
    })
    send("response.failed", { response })
    return { failure, started, response }
  }
  start()
  if (held && structuredAnswer) text(args(held.input))
  closeMessage()
  const incomplete = finish === "length" ? "max_output_tokens" : finish === "content-filter" ? "content_filter" : undefined
  const response = envelope(incomplete ? "incomplete" : "completed", items, {
    ...(incomplete ? { incomplete_details: { reason: incomplete } } : {}),
    ...(usage ? { usage: encodeUsage(usage) } : {}),
  })
  send(incomplete ? "response.incomplete" : "response.completed", { response })
  return { started, response }
}
