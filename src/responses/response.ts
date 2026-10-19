/**
 * Neutral results -> OpenAI Responses wire objects: one response object, or the named SSE
 * events of a stream.
 *
 * One state machine (`runResponse`) serves both: it emits stream events as it goes and returns
 * the final response object, so the JSON body and the stream never disagree. A non-streaming
 * call passes a no-op `emit`. Reasoning deltas are dropped unless the exchange asks for them (option
 * `reasoningOutput`): then each run of them is one `reasoning` output item with a `summary_text` part, as OpenAI sends.
 */
import type { PlugError, PlugEvent, PlugFinish, PlugUsage } from "../contract.js"
import { debugEnabled, logDebug } from "../log.js"
import { structuredMissing, textFallback } from "../openai/response.js"

type ToolCall = Extract<PlugEvent, { type: "tool-call" }>

/**
 * How a call to a flattened tool goes back to the client: `namespace` tools come back as the bare `name` plus `namespace` (the
 * shape Codex parses), `custom` tools as a `custom_tool_call` whose `input` is the raw text.
 */
export interface ToolRoute {
  readonly name: string
  readonly namespace?: string
  readonly custom?: true
}

/** What the encoder needs besides the model events: Responses presentation state. The request decoder produces it. */
export interface ResponsesExchange {
  /** The model string the client sent; echoed in every response object. A request that used an alias with fallbacks echoes the target that answered (`CallContext.onServed`). */
  model: string
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
  /** The caller's `text.format` schema: a text answer is taken when the model skipped the respond call (`textFallback`, #173). */
  readonly structuredSchema?: Readonly<Record<string, unknown>>
  /** The flattened tools of the request whose call goes back under another name, in a namespace, or as a custom tool call (src/responses/request.ts). */
  readonly toolRoutes?: ReadonlyMap<string, ToolRoute>
  /** Option `reasoningOutput` (since 0.36.0): reasoning is returned as a `reasoning` item. Never in structured output. */
  readonly reasoningOutput?: boolean
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
  /** The structured answer came from the final text, not the respond call (`textFallback`). */
  readonly structuredFallback?: boolean
}

type Item = Record<string, unknown>

const args = (input: unknown) => (typeof input === "string" ? input : JSON.stringify(input ?? {}))

/** The one argument that carries the raw text of a freeform (`custom`) tool through the function the model sees. */
export const FREEFORM_ARGUMENT = "input"

/**
 * The raw text of a freeform tool call: the argument the model gave, or the text it sent instead of arguments. A model that left the
 * argument out gets an empty input, which the client runs as an empty program: JSON of the arguments would be run as the tool's own
 * language. The gap is a debug line (the tool name only).
 */
const freeformInput = (call: ToolCall): string => {
  if (typeof call.input === "string") return call.input
  const value = typeof call.input === "object" && call.input !== null ? (call.input as Record<string, unknown>)[FREEFORM_ARGUMENT] : undefined
  if (typeof value === "string") return value
  if (debugEnabled()) logDebug("responses.custom_input_missing", { tool: call.name })
  return ""
}

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
 * `committed`: whether the transport already committed a 200 stream before any event was emitted
 * (the SSE writer does at the first reasoning event, #49). A failure then still opens the response
 * and ends it with `response.failed`, instead of leaving the client an empty 200 stream.
 */
export async function runResponse(
  events: AsyncIterable<PlugEvent>,
  exchange: ResponsesExchange,
  emit: (event: ResponsesStreamEvent) => void,
  committed: () => boolean = () => false,
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
  /** The open reasoning item: a run of reasoning deltas (summary part 0). Closed before any message or tool call. */
  let reasoning: { id: string; index: number; text: string } | undefined
  let started = false
  let calls = 0
  let answered = false
  /** The text of a structured turn (not emitted): it is the answer only if the respond call never comes (#173). */
  let collected = ""
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
  const reasoningDelta = (delta: string) => {
    if (delta.length === 0) return
    start()
    if (!reasoning) {
      closeMessage()
      reasoning = { id: newId("rs"), index: nextIndex++, text: "" }
      send("response.output_item.added", { output_index: reasoning.index, item: { id: reasoning.id, type: "reasoning", status: "in_progress", summary: [] } })
      send("response.reasoning_summary_part.added", {
        item_id: reasoning.id,
        output_index: reasoning.index,
        summary_index: 0,
        part: { type: "summary_text", text: "" },
      })
    }
    reasoning.text += delta
    send("response.reasoning_summary_text.delta", { item_id: reasoning.id, output_index: reasoning.index, summary_index: 0, delta })
  }
  /** `incomplete` when a failure cut the run short, else `completed` (the item's own status, as OpenAI sends it). */
  const closeReasoning = (status: "completed" | "incomplete" = "completed") => {
    if (!reasoning) return
    const part = { type: "summary_text", text: reasoning.text }
    send("response.reasoning_summary_text.done", { item_id: reasoning.id, output_index: reasoning.index, summary_index: 0, text: reasoning.text })
    send("response.reasoning_summary_part.done", { item_id: reasoning.id, output_index: reasoning.index, summary_index: 0, part })
    const item = { id: reasoning.id, type: "reasoning", status, summary: [part] }
    send("response.output_item.done", { output_index: reasoning.index, item })
    items.push(item)
    reasoning = undefined
  }
  const text = (delta: string) => {
    if (delta.length === 0) return
    start()
    closeReasoning()
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
  /** `incomplete` when the answer was cut by a limit or a filter: the item open at the cut is cut too (#425). */
  const closeMessage = (status: "completed" | "incomplete" = "completed") => {
    if (!open) return
    const part = { type: "output_text", text: open.text, annotations: [], logprobs: [] }
    send("response.output_text.done", { item_id: open.id, output_index: open.index, content_index: 0, text: open.text, logprobs: [] })
    send("response.content_part.done", { item_id: open.id, output_index: open.index, content_index: 0, part })
    const item = messageItem(open.id, status, open.text)
    send("response.output_item.done", { output_index: open.index, item })
    items.push(item)
    open = undefined
  }
  /** Tool calls arrive whole, so each goes out as one arguments delta. */
  const toolCall = (call: ToolCall) => {
    start()
    closeReasoning()
    closeMessage()
    const index = nextIndex++
    const route = exchange.toolRoutes?.get(call.name)
    const name = route?.name ?? call.name
    const where = route?.namespace === undefined ? {} : { namespace: route.namespace }
    if (route?.custom) {
      const itemId = newId("ctc")
      const input = freeformInput(call)
      const item = (status: string, text: string): Item => ({ id: itemId, type: "custom_tool_call", status, call_id: call.id, name, ...where, input: text })
      send("response.output_item.added", { output_index: index, item: item("in_progress", "") })
      send("response.custom_tool_call_input.delta", { item_id: itemId, output_index: index, delta: input })
      send("response.custom_tool_call_input.done", { item_id: itemId, output_index: index, input })
      const done = item("completed", input)
      send("response.output_item.done", { output_index: index, item: done })
      items.push(done)
      calls++
      return
    }
    const itemId = newId("fc")
    const argumentsText = args(call.input)
    const item = (status: string, text: string): Item => ({ id: itemId, type: "function_call", status, call_id: call.id, name, ...where, arguments: text })
    send("response.output_item.added", { output_index: index, item: item("in_progress", "") })
    send("response.function_call_arguments.delta", { item_id: itemId, output_index: index, delta: argumentsText })
    send("response.function_call_arguments.done", { item_id: itemId, output_index: index, name, arguments: argumentsText })
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
    if (event.type === "reasoning-delta") {
      // Not in structured output: its content is the answer's arguments.
      if (exchange.reasoningOutput && exchange.structuredTool === undefined) reasoningDelta(event.text)
      continue
    }
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
      if (event.type === "text-delta") collected += event.text
      if (!(exchange.callerTools && event.type === "tool-call")) continue
    }
    if (event.type === "text-delta") text(event.text)
    else toolCall(event)
  }

  const passthrough = exchange.callerTools === true && calls > 0
  const structuredAnswer = exchange.structuredTool !== undefined && !passthrough
  const fallback = structuredAnswer && !answered && exchange.structuredSchema !== undefined ? textFallback(collected, exchange.structuredSchema) : undefined
  const missing = passthrough || answered || fallback !== undefined || exchange.structuredTool === undefined ? undefined : structuredMissing()
  failure ??= finish ? missing : noFinish()
  if (failure) {
    if (!started && !committed()) return { failure, started }
    start()
    closeReasoning("incomplete")
    closeMessage()
    const response = envelope("failed", items, {
      error: { code: failure.code ?? failure.kind, message: failure.message },
      ...(usage ? { usage: encodeUsage(usage) } : {}),
    })
    send("response.failed", { response })
    return { failure, started: true, response }
  }
  start()
  if (held && structuredAnswer) text(args(held.input))
  if (fallback !== undefined) text(fallback)
  const incomplete = finish === "length" ? "max_output_tokens" : finish === "content-filter" ? "content_filter" : undefined
  closeReasoning(incomplete ? "incomplete" : "completed")
  closeMessage(incomplete ? "incomplete" : "completed")
  const response = envelope(incomplete ? "incomplete" : "completed", items, {
    ...(incomplete ? { incomplete_details: { reason: incomplete } } : {}),
    // Always present (#390): zeros when the host reported none for the run, as the chat body does.
    usage: encodeUsage(usage ?? {}),
  })
  send(incomplete ? "response.incomplete" : "response.completed", { response })
  return { started, response, ...(fallback !== undefined ? { structuredFallback: true } : {}) }
}
