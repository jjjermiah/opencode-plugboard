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
  /** The model string the client sent; echoed in every response object. */
  readonly model: string
  readonly stream: boolean
  /** `stream_options.include_usage`: the stream carries a usage field per chunk and a final usage chunk. */
  readonly includeUsage: boolean
  /** Name of the forced tool that carries `response_format` output; its input is unwrapped into the message content. */
  readonly structuredTool?: string
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

/** `GET /v1/models` body. */
export const encodeModelList = (models: ReadonlyArray<ListedModel>): object => ({
  object: "list",
  data: models.map(({ id, ref, model }) => ({
    id,
    object: "model",
    created: 0,
    owned_by: ref.providerID,
    plugboard: { capabilities: model.capabilities ?? {}, contextLimit: model.contextLimit },
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

  const isStructured = exchange.structuredTool !== undefined
  const answer = calls.find((call) => structured.isAnswer(exchange, call))
  const missing = structured.failure(exchange, finish, answer !== undefined)
  if (missing) return { status: missing.status, body: encodeError(missing) }
  const toolCalls = isStructured ? [] : calls
  const message: Record<string, unknown> = {
    role: "assistant",
    content: isStructured ? (answer ? structured.content(answer) : null) : text.length > 0 ? text : null,
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

/**
 * Writes SSE frames via `write` (each frame is one complete `data: ...\n\n` string).
 * A mid-stream error is written as an `error` frame and then `data: [DONE]`.
 */
export async function streamCompletion(
  events: AsyncIterable<PlugEvent>,
  exchange: OpenAiExchange,
  write: (chunk: string) => void,
): Promise<void> {
  const id = newId()
  const created = now()
  const frame = (value: object) => write(`data: ${JSON.stringify(value)}\n\n`)
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    frame({
      id,
      object: "chat.completion.chunk",
      created,
      model: exchange.model,
      choices: [{ index: 0, delta, finish_reason: finish, logprobs: null }],
      ...(exchange.includeUsage ? { usage: null } : {}),
    })

  let started = false
  let calls = 0
  let answered = false
  let finish: Exclude<PlugFinish, "error"> | undefined
  let usage: PlugUsage | undefined
  let failure: PlugError | undefined
  const start = () => {
    if (started) return
    started = true
    chunk({ role: "assistant", content: "" })
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
      // Structured mode: only the first answer is content; everything else is suppressed.
      if (event.type === "tool-call" && !answered && structured.isAnswer(exchange, event)) {
        answered = true
        start()
        chunk({ content: structured.content(event) })
      }
      continue
    }
    start()
    if (event.type === "text-delta") {
      if (event.text.length > 0) chunk({ content: event.text })
    } else {
      // Tool calls arrive whole, so each goes out as one chunk with the next index.
      chunk({ tool_calls: [{ index: calls++, id: event.id, type: "function", function: { name: event.name, arguments: args(event.input) } }] })
    }
  }

  failure ??= finish ? structured.failure(exchange, finish, answered) : noFinish()
  if (failure) {
    frame(encodeError(failure))
    write("data: [DONE]\n\n")
    return
  }
  start()
  chunk({}, finishReason(finish!, calls, exchange.structuredTool !== undefined))
  if (exchange.includeUsage && usage)
    frame({ id, object: "chat.completion.chunk", created, model: exchange.model, choices: [], usage: encodeUsage(usage) })
  write("data: [DONE]\n\n")
}
