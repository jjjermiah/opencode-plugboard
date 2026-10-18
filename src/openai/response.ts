/**
 * Neutral results -> OpenAI wire objects: Chat Completions as one JSON body or SSE chunks, the
 * `/v1/models` list, and error bodies.
 *
 * Reasoning deltas are dropped unless the exchange asks for them (option `reasoningOutput`): Chat
 * Completions has no standard field, so they go out as `reasoning_content` and `reasoning` (`reasoningFields`).
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
  /** The caller's `json_schema`, checked against a text answer when the model skipped the respond call (`textFallback`). */
  readonly structuredSchema?: Readonly<Record<string, unknown>>
  /** Option `reasoningOutput` (since 0.36.0): reasoning text is returned, not dropped. Never in structured output. */
  readonly reasoningOutput?: boolean
}

/** Set on a complete answer that came from the final text, not the respond call (`textFallback`). */
export const STRUCTURED_FALLBACK_HEADER = "x-plugboard-structured-fallback"

/** One choice as a complete JSON body, with the status to send it with. */
export interface CollectedChoice {
  readonly status: number
  readonly body: object
  readonly retryAfterSeconds?: number
  /** The structured answer was taken from the text (the response carries `STRUCTURED_FALLBACK_HEADER`). */
  readonly structuredFallback?: boolean
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
  /**
   * Called before this choice writes its first chunk. The fan-out writes the opening chunks (the role delta) of every
   * choice up to this one, in index order (#423). Absent: the encoder writes its own role chunk.
   */
  readonly open?: () => void
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

/** USD per million tokens -> OpenRouter's price per token as a decimal string (`0.000003`), never an exponent. */
const perToken = (usdPerMillion: number): string => {
  // Plain decimal digits of the value (never an exponent), so a tiny non-zero price stays non-zero.
  const value = usdPerMillion / 1_000_000
  if (value === 0) return "0"
  // 13 significant digits: the float division leaves noise past the 16th (1e-13 comes out as 9.9999...e-14).
  const [mantissa = "0", exponent = "0"] = value.toExponential(12).split("e")
  const digits = mantissa.replace(".", "").replace(/0+$/, "")
  const point = Number(exponent)
  if (point < 0) return `0.${"0".repeat(-point - 1)}${digits}`
  return digits.length <= point + 1 ? digits.padEnd(point + 1, "0") : `${digits.slice(0, point + 1)}.${digits.slice(point + 1)}`
}

/**
 * The OpenRouter names a client may already read: `context_length` and `pricing` (USD per token, base entry only; `aboveContext`
 * tiers are not in it), plus `max_output_tokens`. A fact the catalog does not know is left out, never zero.
 */
const standardFields = (model: ListedModel["model"]) => {
  const context = model.limits?.context ?? model.contextLimit
  const output = model.limits?.output
  const base = model.cost?.find((entry) => entry.aboveContext === undefined)
  return {
    ...(context === undefined ? {} : { context_length: context }),
    ...(output === undefined ? {} : { max_output_tokens: output }),
    ...(base === undefined
      ? {}
      : {
          pricing: {
            prompt: perToken(base.input),
            completion: perToken(base.output),
            ...(base.cacheRead === undefined ? {} : { input_cache_read: perToken(base.cacheRead) }),
            ...(base.cacheWrite === undefined ? {} : { input_cache_write: perToken(base.cacheWrite) }),
          },
        }),
  }
}

/** `GET /v1/models` body. */
export const encodeModelList = (models: ReadonlyArray<ListedModel>): object => ({
  object: "list",
  data: models.map(({ id, ref, model, skill, agent }) => ({
    id,
    object: "model",
    created: 0,
    owned_by: ref.providerID,
    ...standardFields(model),
    plugboard: { ...encodePlugboard(model), ...(skill === undefined ? {} : { skill }), ...(agent === undefined ? {} : { agent }) },
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

export const args = (input: unknown) => (typeof input === "string" ? input : JSON.stringify(input ?? {}))

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
 * The 502 for a structured turn that ended without its answer (no forced-tool call, and no text that is the
 * schema's JSON). Shared by every front-end. The message names no internal tool: the caller never sees one (#282).
 */
export const structuredMissing = (): PlugError => ({
  status: 502,
  kind: "server",
  code: "structured_output_missing",
  message: "The model did not return JSON matching the response schema. Say the expected JSON, with its keys and types, in the prompt.",
})

/**
 * Structured-output projection, shared by the JSON and SSE encoders so both give the same body.
 * In structured mode (`exchange.structuredTool` set) the content is exactly the arguments of
 * the first call to that tool: prose, reasoning and any other tool call are suppressed, and
 * later calls to it are ignored. Without an answer the exchange fails with 502 (#172): a turn that
 * ends with no structured output is never a 200 with empty content, whatever its finish reason.
 */
const structured = {
  isAnswer: (exchange: OpenAiExchange, call: ToolCall) => exchange.structuredTool !== undefined && call.name === exchange.structuredTool,
  content: (call: ToolCall) => args(call.input),
  /** The failure for a finished structured exchange, if any. */
  failure: (exchange: OpenAiExchange, answered: boolean): PlugError | undefined => (exchange.structuredTool === undefined || answered ? undefined : structuredMissing()),
}

const isObjectValue = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

const hasOwn = (value: Record<string, unknown>, key: string) => Object.hasOwn(value, key)

/** Whether a parsed JSON value has one JSON Schema type (`integer` is a whole number; an unknown type matches anything). */
const hasType = (value: unknown, type: unknown): boolean => {
  switch (type) {
    case "object":
      return isObjectValue(value)
    case "array":
      return Array.isArray(value)
    case "string":
      return typeof value === "string"
    case "number":
      return typeof value === "number"
    case "integer":
      return Number.isInteger(value)
    case "boolean":
      return typeof value === "boolean"
    case "null":
      return value === null
    default:
      return true
  }
}

/**
 * The part of JSON Schema checked on a text answer. The runtime carries no schema library (ajv is a
 * dev dependency), so this is deliberately small: the top-level `type` (one type or a list), the
 * top-level `required` keys, and the `type` of each top-level property that is present. Anything
 * else in the schema (enum, nested objects, formats, additionalProperties) is not checked.
 */
export function matchesSchema(value: unknown, schema: Readonly<Record<string, unknown>>): boolean {
  const types = Array.isArray(schema.type) ? schema.type : schema.type === undefined ? undefined : [schema.type]
  if (types !== undefined && !types.some((type) => hasType(value, type))) return false
  if (!isObjectValue(value)) return true
  const required = Array.isArray(schema.required) ? schema.required : []
  if (!required.every((key) => typeof key === "string" && hasOwn(value, key))) return false
  if (!isObjectValue(schema.properties)) return true
  return Object.entries(schema.properties).every(([key, property]) => {
    if (!hasOwn(value, key) || !isObjectValue(property) || property.type === undefined) return true
    const propertyTypes = Array.isArray(property.type) ? property.type : [property.type]
    return propertyTypes.some((type) => hasType(value[key], type))
  })
}

/**
 * The answer of a structured turn that never called the respond tool, when its final text is the JSON
 * the schema asks for (one code fence is stripped first). Undefined for any other text.
 */
export function textFallback(text: string, schema: Readonly<Record<string, unknown>>): string | undefined {
  // The whole text (fenced or not), else the one fenced block inside prose: Claude, told not to call
  // tools, skips `respond` and answers "Here is the JSON: ```json {...}```" (found by the live suite).
  const fenced = [...text.matchAll(FENCE_ANYWHERE)].map((match) => match[1]!.trim())
  const candidates = [unfence(text.trim()), ...(fenced.length === 1 ? fenced : [])]
  for (const candidate of candidates) {
    let value: unknown
    try {
      value = JSON.parse(candidate)
    } catch {
      continue
    }
    if (matchesSchema(value, schema)) return candidate
  }
  return undefined
}

/** Every fenced code block (```json or a bare ```) anywhere in the text. */
const FENCE_ANYWHERE = /```[ \t]*(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*```/gi

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

/**
 * The reasoning text of a delta or message under both names in use: `reasoning_content` (DeepSeek's original, read by
 * LiteLLM and the Vercel AI SDK) and `reasoning` (vLLM, OpenRouter). vLLM's own docs warn that a client reading one
 * name silently gets nothing, so both carry the same text.
 */
const reasoningFields = (text: string) => ({ reasoning_content: text, reasoning: text })

const newId = () => `chatcmpl-${crypto.randomUUID().replaceAll("-", "").slice(0, 29)}`
const now = () => Math.floor(Date.now() / 1000)

export async function collectCompletion(events: AsyncIterable<PlugEvent>, exchange: OpenAiExchange): Promise<CollectedChoice> {
  let text = ""
  let reasoning = ""
  const calls: ToolCall[] = []
  let finish: Exclude<PlugFinish, "error"> | undefined
  let usage: PlugUsage | undefined
  let failure: PlugError | undefined

  for await (const event of events) {
    if (event.type === "text-delta") text += event.text
    else if (event.type === "reasoning-delta") reasoning += event.text
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
    return { status: error.status, body: encodeError(error), retryAfterSeconds: error.retryAfterSeconds }
  }

  const answer = calls.find((call) => structured.isAnswer(exchange, call))
  const others = calls.filter((call) => !structured.isAnswer(exchange, call))
  // With the caller's tools offered, a call to one of them wins over the structured answer.
  const passthrough = exchange.callerTools === true && others.length > 0
  const isStructured = exchange.structuredTool !== undefined && !passthrough
  const fallback = isStructured && answer === undefined && exchange.structuredSchema !== undefined ? textFallback(text, exchange.structuredSchema) : undefined
  const missing = passthrough ? undefined : structured.failure(exchange, answer !== undefined || fallback !== undefined)
  if (missing) return { status: missing.status, body: encodeError(missing) }
  const toolCalls = isStructured ? [] : others
  const message: Record<string, unknown> = {
    role: "assistant",
    content: isStructured ? (answer ? structured.content(answer) : (fallback ?? null)) : exchange.structuredTool === undefined && text.length > 0 ? (exchange.jsonObject ? unfence(text) : text) : null,
    refusal: null,
  }
  if (exchange.reasoningOutput && exchange.structuredTool === undefined && reasoning.length > 0) Object.assign(message, reasoningFields(reasoning))
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
      // Always present (#390): a host that reported no usage for the run gives zeros rather than an absent field.
      usage: encodeUsage(usage ?? {}),
    },
    ...(fallback !== undefined ? { structuredFallback: true } : {}),
  }
}

/** One chunk of a chat stream: the shared envelope around one choice's `delta`. */
const chatChunk = (exchange: OpenAiExchange, id: string, created: number, index: number, delta: Record<string, unknown>, finish: string | null = null) => ({
  id,
  object: "chat.completion.chunk",
  created,
  model: exchange.model,
  choices: [{ index, delta, finish_reason: finish, logprobs: null }],
  ...(exchange.includeUsage ? { usage: null } : {}),
})

/** The opening chunk of one choice of a fanned-out stream: its role delta, before any content (#423). */
export const roleChunk = (exchange: OpenAiExchange, choice: StreamChoice): object => chatChunk(exchange, choice.id, choice.created, choice.index, { role: "assistant", content: "" })

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
export async function streamCompletion(events: AsyncIterable<PlugEvent>, exchange: OpenAiExchange, write: (chunk: string) => void, choice?: StreamChoice): Promise<StreamResult> {
  const id = choice?.id ?? newId()
  const created = choice?.created ?? now()
  const index = choice?.index ?? 0
  const frame = (value: object) => write(`data: ${JSON.stringify(value)}\n\n`)
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) => frame(chatChunk(exchange, id, created, index, delta, finish))

  let started = false
  let calls = 0
  let answered = false
  /** The text of a structured turn (not streamed): it is the answer only if the respond call never comes. */
  let collected = ""
  /** With caller tools offered the structured answer waits for the finish: a caller tool call in the same step replaces it. */
  let held: ToolCall | undefined
  let finish: Exclude<PlugFinish, "error"> | undefined
  let usage: PlugUsage | undefined
  let failure: PlugError | undefined
  const start = () => {
    if (started) return
    started = true
    if (choice?.open) choice.open()
    else chunk({ role: "assistant", content: "" })
  }
  const send = (text: string) => {
    if (text.length > 0) chunk({ content: text })
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
    send(text)
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
      if (exchange.reasoningOutput && exchange.structuredTool === undefined && event.text.length > 0) {
        flush()
        start()
        chunk(reasoningFields(event.text))
      }
      continue
    }
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
      if (event.type === "text-delta") collected += event.text
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
    if (event.type === "text-delta") send(event.text)
    else {
      // Tool calls arrive whole, so each goes out as one chunk with the next index.
      chunk({ tool_calls: [{ index: calls++, id: event.id, type: "function", function: { name: event.name, arguments: args(event.input) } }] })
    }
  }

  const passthrough = exchange.callerTools === true && calls > 0
  const isStructured = exchange.structuredTool !== undefined && !passthrough
  const fallback = isStructured && !answered && exchange.structuredSchema !== undefined ? textFallback(collected, exchange.structuredSchema) : undefined
  failure ??= finish ? (passthrough ? undefined : structured.failure(exchange, answered || fallback !== undefined)) : noFinish()
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
  if (fallback !== undefined) chunk({ content: fallback })
  chunk({}, finishReason(finish!, calls, isStructured))
  if (choice) return { started, ...(usage ? { usage } : {}) }
  if (exchange.includeUsage) frame(chatUsageChunk(exchange.model, id, created, usage ?? {}))
  write("data: [DONE]\n\n")
  return { started }
}
