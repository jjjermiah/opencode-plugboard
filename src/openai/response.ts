/**
 * PlugEvents -> OpenAI Chat Completions responses: one JSON body, or SSE chunks (spec D12, D13, D23).
 *
 * Reasoning deltas are dropped: Chat Completions has no standard field for them.
 */
import type { PlugError, PlugEvent, PlugFinish, PlugRequest, PlugUsage } from "../contract.ts"

type ToolCall = Extract<PlugEvent, { type: "tool-call" }>

const FINISH_REASONS: Record<Exclude<PlugFinish, "error">, string> = {
  stop: "stop",
  length: "length",
  "tool-calls": "tool_calls",
  "content-filter": "content_filter",
}

export const encodeError = (error: PlugError): object => ({
  error: { message: error.message, type: error.type, param: error.param ?? null, code: error.code ?? null },
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
 * structured output (D13) ends as a plain `stop`.
 */
const finishReason = (reason: Exclude<PlugFinish, "error">, calls: number, structured: boolean) => {
  if (reason === "length" || reason === "content-filter") return FINISH_REASONS[reason]
  if (structured) return "stop"
  return calls > 0 ? "tool_calls" : FINISH_REASONS[reason]
}

const noFinish = (): PlugError => ({
  status: 500,
  type: "server_error",
  message: "Model stream ended without a finish event",
})

const failedRun = (): PlugError => ({ status: 500, type: "server_error", message: "Model run failed" })

const newId = () => `chatcmpl-${crypto.randomUUID().replaceAll("-", "").slice(0, 29)}`
const now = () => Math.floor(Date.now() / 1000)

export async function collectCompletion(
  events: AsyncIterable<PlugEvent>,
  request: PlugRequest,
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

  // Structured output: the forced tool's input is the answer.
  const answer = request.structured && calls.find((call) => call.name === request.structured?.toolName)
  const toolCalls = answer ? [] : calls
  const message: Record<string, unknown> = {
    role: "assistant",
    content: answer ? args(answer.input) : text.length > 0 ? text : null,
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
      model: request.model,
      choices: [{ index: 0, message, logprobs: null, finish_reason: finishReason(finish, toolCalls.length, !!answer) }],
      ...(usage ? { usage: encodeUsage(usage) } : {}),
    },
  }
}

/**
 * Writes SSE frames via `write` (each frame is one complete `data: ...\n\n` string).
 * A mid-stream error is written as an `error` frame and then `data: [DONE]`.
 * `includeUsage` mirrors `stream_options.include_usage`.
 */
export async function streamCompletion(
  events: AsyncIterable<PlugEvent>,
  request: PlugRequest,
  write: (chunk: string) => void,
  options: { includeUsage?: boolean } = {},
): Promise<void> {
  const id = newId()
  const created = now()
  const frame = (value: object) => write(`data: ${JSON.stringify(value)}\n\n`)
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    frame({
      id,
      object: "chat.completion.chunk",
      created,
      model: request.model,
      choices: [{ index: 0, delta, finish_reason: finish, logprobs: null }],
      ...(options.includeUsage ? { usage: null } : {}),
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
    start()
    if (event.type === "text-delta") {
      if (event.text.length > 0) chunk({ content: event.text })
    } else if (request.structured?.toolName === event.name) {
      answered = true
      chunk({ content: args(event.input) })
    } else {
      // Tool calls arrive whole, so each goes out as one chunk with the next index.
      chunk({ tool_calls: [{ index: calls++, id: event.id, type: "function", function: { name: event.name, arguments: args(event.input) } }] })
    }
  }

  failure ??= finish ? undefined : noFinish()
  if (failure) {
    frame(encodeError(failure))
    write("data: [DONE]\n\n")
    return
  }
  start()
  chunk({}, finishReason(finish!, calls, answered))
  if (options.includeUsage && usage)
    frame({ id, object: "chat.completion.chunk", created, model: request.model, choices: [], usage: encodeUsage(usage) })
  write("data: [DONE]\n\n")
}
