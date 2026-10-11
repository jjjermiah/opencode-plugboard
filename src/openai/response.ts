/**
 * Neutral results -> OpenAI wire objects: Chat Completions as one JSON body or SSE chunks, the
 * `/v1/models` list, and error bodies.
 *
 * Reasoning deltas are dropped: Chat Completions has no standard field for them.
 */
import type { PlugError, PlugErrorKind, PlugEvent, PlugFinish, PlugUsage } from "../contract.js"
import type { ListedModel } from "../models.js"

type ToolCall = Extract<PlugEvent, { type: "tool-call" }>

/**
 * What the encoders need to know about the exchange besides the model events: Chat Completions
 * presentation state. The request decoder produces it; the model call never sees it.
 */
export interface OpenAiExchange {
  /** The model string the client sent; echoed in every response object. A request that used an alias with fallbacks echoes the target that answered (`CallContext.onServed`). */
  model: string
  readonly stream: boolean
  /** `stream_options.include_usage`: the stream carries a usage field per chunk and a final usage chunk. */
  readonly includeUsage: boolean
  /** Name of the forced tool that carries `response_format` output; its input is unwrapped into the message content. */
  readonly structuredTool?: string
  /**
   * The caller's own tools are offered next to the structured tool. A call to any of them is the
   * response (normal `tool_calls`, prose and the structured answer dropped); the structured
   * answer is content only when the step called no caller tool.
   */
  readonly callerTools?: boolean
  /**
   * `response_format: json_object`: the model is only asked in a system instruction, and sometimes
   * wraps the answer in a markdown code fence. A single fence around text that parses as JSON is
   * stripped from the content (`unfence`).
   */
  readonly jsonObject?: boolean
}

/** How a streamed exchange ended. Nothing was written when `failure` is set and `started` is false: the caller answers with a real HTTP error. */
export interface StreamResult {
  readonly failure?: PlugError
  /** Whether any frame was written (the response is committed as a 200 SSE stream). */
  readonly started: boolean
  /** The usage the model reported, when the exchange succeeded. */
  readonly usage?: PlugUsage
}

/**
 * One choice of a fanned-out stream (`n` > 1, see `src/openai/fanout.ts`): the chunks share the
 * stream's `id` and `created` and carry this choice's `index`. The encoder then writes this
 * choice's chunks only. The error frame, the usage chunk and `[DONE]` belong to the whole
 * stream and are written by the fan-out.
 */
export interface StreamChoice {
  readonly id: string
  readonly created: number
  readonly index: number
}

const ERROR_TYPES: Record<PlugErrorKind, string> = {
  invalid_request: "invalid_request_error",
  authentication: "authentication_error",
  permission: "permission_error",
  not_found: "not_found_error",
  rate_limit: "rate_limit_error",
  server: "server_error",
  timeout: "timeout_error",
}

const FINISH_REASONS: Record<Exclude<PlugFinish, "error">, string> = {
  stop: "stop",
  length: "length",
  "tool-calls": "tool_calls",
  "content-filter": "content_filter",
}

export const encodeError = (error: PlugError): object => ({
  error: { message: error.message, type: ERROR_TYPES[error.kind], param: error.param ?? null, code: error.code ?? null },
})

/** Epoch ms -> ISO 8601, or undefined for a value Date cannot represent. */
const isoDate = (ms: number | undefined): string | undefined => {
  if (ms === undefined) return undefined
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/**
 * The `plugboard` object of a model entry: what the catalog knows beyond the OpenAI fields. Absent
 * facts are omitted. `cost` is USD per million tokens (an entry with `aboveContext` applies when
 * the prompt exceeds that many tokens; the entry without it is the base price); `released` is ISO 8601.
 */
const encodePlugboard = (model: ListedModel["model"]) => ({
  capabilities: model.capabilities ?? {},
  contextLimit: model.contextLimit,
  limit: model.limits,
  modalities: model.modalities,
  cost: model.cost?.map(({ input, output, cacheRead, cacheWrite, aboveContext }) => ({
    input,
    output,
    cache: { read: cacheRead, write: cacheWrite },
    ...(aboveContext === undefined ? {} : { aboveContext }),
  })),
  status: model.status,
  family: model.family,
  released: isoDate(model.released),
})

/** `GET /v1/models` body. */
export const encodeModelList = (models: ReadonlyArray<ListedModel>): object => ({
  object: "list",
  data: models.map(({ id, ref, model }) => ({
    id,
    object: "model",
    created: 0,
    owned_by: ref.providerID,
    plugboard: encodePlugboard(model),
  })),
})

const encodeUsage = (usage: PlugUsage) => {
  const prompt = usage.inputTokens ?? 0
  const completion = usage.outputTokens ?? 0
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    prompt_tokens_details: { cached_tokens: usage.cacheReadTokens ?? 0 },
    completion_tokens_details: { reasoning_tokens: usage.reasoningTokens ?? 0 },
  }
}

const args = (input: unknown) => (typeof input === "string" ? input : JSON.stringify(input ?? {}))

/**
 * Final finish_reason. Tool calls force `tool_calls` even when the upstream says `stop`;
 * structured output ends as a plain `stop`.
 */
const finishReason = (reason: Exclude<PlugFinish, "error">, calls: number, structured: boolean) => {
  if (reason === "length" || reason === "content-filter") return FINISH_REASONS[reason]
  if (structured) return "stop"
  return calls > 0 ? "tool_calls" : FINISH_REASONS[reason]
}

const noFinish = (): PlugError => ({
  status: 500,
  kind: "server",
  message: "Model stream ended without a finish event",
})

const failedRun = (): PlugError => ({ status: 500, kind: "server", message: "Model run failed" })

/**
 * Structured-output projection, shared by the JSON and SSE encoders so both give the same body.
 * In structured mode (`exchange.structuredTool` set) the content is exactly the arguments of
 * the first call to that tool: prose, reasoning and any other tool call are suppressed, and
 * later calls to it are ignored. Without an answer the exchange fails, except when the model
 * stopped for `length` or `content-filter`, which keep their finish reasons with empty content.
 */
const structured = {
  isAnswer: (exchange: OpenAiExchange, call: ToolCall) => exchange.structuredTool !== undefined && call.name === exchange.structuredTool,
  content: (call: ToolCall) => args(call.input),
  /** The failure for a finished structured exchange, if any. */
  failure: (exchange: OpenAiExchange, finish: Exclude<PlugFinish, "error">, answered: boolean): PlugError | undefined =>
    exchange.structuredTool === undefined || answered || finish === "length" || finish === "content-filter"
      ? undefined
      : {
          status: 502,
          kind: "server",
          code: "structured_output_missing",
          message: `The model finished without calling the \`${exchange.structuredTool}\` tool, so there is no structured output`,
        },
}

/** One markdown code fence (```json or a bare ```) around the whole text. */
const FENCED = /^```[ \t]*(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*```$/i

/**
 * The inside of a single code fence that wraps the whole text, when the inside parses as JSON;
 * anything else comes back unchanged (prose around the fence, two fences, non-JSON).
 */
export function unfence(text: string): string {
  const inside = FENCED.exec(text.trim())?.[1]
  if (inside === undefined) return text
  try {
    JSON.parse(inside)
    return inside.trim()
  } catch {
    return text
  }
}

const newId = () => `chatcmpl-${crypto.randomUUID().replaceAll("-", "").slice(0, 29)}`
const now = () => Math.floor(Date.now() / 1000)

export async function collectCompletion(
  events: AsyncIterable<PlugEvent>,
  exchange: OpenAiExchange,
): Promise<{ status: number; body: object }> {
  let text = ""
  const calls: ToolCall[] = []
  let finish: Exclude<PlugFinish, "error"> | undefined
  let usage: PlugUsage | undefined
  let failure: PlugError | undefined

  for await (const event of events) {
    if (event.type === "text-delta") text += event.text
    else if (event.type === "tool-call") calls.push(event)
    else if (event.type === "finish") {
      usage = event.usage ?? usage
      if (event.reason === "error") failure ??= failedRun()
      else finish = event.reason
    } else if (event.type === "error") {
      failure = event.error
      break
    }
  }
  if (!failure && !finish) failure = noFinish()
  if (failure || !finish) {
    const error = failure ?? noFinish()
    return { status: error.status, body: encodeError(error) }
  }

  const answer = calls.find((call) => structured.isAnswer(exchange, call))
  const others = calls.filter((call) => !structured.isAnswer(exchange, call))
  // With the caller's tools offered, a call to one of them wins over the structured answer.
  const passthrough = exchange.callerTools === true && others.length > 0
  const isStructured = exchange.structuredTool !== undefined && !passthrough
  const missing = passthrough ? undefined : structured.failure(exchange, finish, answer !== undefined)
  if (missing) return { status: missing.status, body: encodeError(missing) }
  const toolCalls = isStructured ? [] : others
  const message: Record<string, unknown> = {
    role: "assistant",
    content: isStructured
      ? answer
        ? structured.content(answer)
        : null
      : exchange.structuredTool === undefined && text.length > 0
        ? exchange.jsonObject
          ? unfence(text)
          : text
        : null,
    refusal: null,
  }
  if (toolCalls.length > 0)
    message.tool_calls = toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: args(call.input) },
    }))
  return {
    status: 200,
    body: {
      id: newId(),
      object: "chat.completion",
      created: now(),
      model: exchange.model,
      choices: [{ index: 0, message, logprobs: null, finish_reason: finishReason(finish, toolCalls.length, isStructured) }],
      ...(usage ? { usage: encodeUsage(usage) } : {}),
    },
  }
}

/** The final chunk of a stream with `include_usage`: no choices, the totals. */
export const chatUsageChunk = (model: string, id: string, created: number, usage: PlugUsage): object => ({
  id,
  object: "chat.completion.chunk",
  created,
  model,
  choices: [],
  usage: encodeUsage(usage),
})

/**
 * Writes SSE frames via `write` (each frame is one complete `data: ...\n\n` string) and reports
 * how the exchange ended. A failure before the first frame is not written (the first wire-visible
 * output decides the HTTP status: see `StreamResult`); a failure after it is written as an
 * `error` frame and then `data: [DONE]`.
 */
export async function streamCompletion(
  events: AsyncIterable<PlugEvent>,
  exchange: OpenAiExchange,
  write: (chunk: string) => void,
  choice?: StreamChoice,
): Promise<StreamResult> {
  const id = choice?.id ?? newId()
  const created = choice?.created ?? now()
  const index = choice?.index ?? 0
  const frame = (value: object) => write(`data: ${JSON.stringify(value)}\n\n`)
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    frame({
      id,
      object: "chat.completion.chunk",
      created,
      model: exchange.model,
      choices: [{ index, delta, finish_reason: finish, logprobs: null }],
      ...(exchange.includeUsage ? { usage: null } : {}),
    })

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
    chunk({ role: "assistant", content: "" })
  }
  // json_object: text that opens with a backtick may be a fenced answer, so it waits (as `pending`)
  // until a tool call or the finish shows the whole text; anything else streams as it comes. A
  // fenced answer therefore arrives as one chunk.
  let pending = ""
  let passing = false
  const flush = () => {
    if (pending.length === 0) return
    const text = unfence(pending)
    pending = ""
    start()
    chunk({ content: text })
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
      if (event.type === "tool-call" && structured.isAnswer(exchange, event)) {
        if (!answered) {
          answered = true
          if (exchange.callerTools) held = event
          else {
            start()
            chunk({ content: structured.content(event) })
          }
        }
        continue
      }
      if (!(exchange.callerTools && event.type === "tool-call")) continue
    }
    if (exchange.jsonObject && event.type === "text-delta" && !passing) {
      pending += event.text
      const lead = pending.trimStart()
      if (lead.length > 0 && !lead.startsWith("`")) {
        passing = true
        flush()
      }
      continue
    }
    if (event.type !== "text-delta") flush()
    start()
    if (event.type === "text-delta") {
      if (event.text.length > 0) chunk({ content: event.text })
    } else {
      // Tool calls arrive whole, so each goes out as one chunk with the next index.
      chunk({ tool_calls: [{ index: calls++, id: event.id, type: "function", function: { name: event.name, arguments: args(event.input) } }] })
    }
  }

  const passthrough = exchange.callerTools === true && calls > 0
  const isStructured = exchange.structuredTool !== undefined && !passthrough
  failure ??= finish ? (passthrough ? undefined : structured.failure(exchange, finish, answered)) : noFinish()
  if (failure) {
    if (!started) return { failure, started }
    if (!choice) {
      frame(encodeError(failure))
      write("data: [DONE]\n\n")
    }
    return { failure, started }
  }
  flush()
  start()
  if (held && isStructured) chunk({ content: structured.content(held) })
  chunk({}, finishReason(finish!, calls, isStructured))
  if (choice) return { started, ...(usage ? { usage } : {}) }
  if (exchange.includeUsage && usage) frame(chatUsageChunk(exchange.model, id, created, usage))
  write("data: [DONE]\n\n")
  return { started }
}
