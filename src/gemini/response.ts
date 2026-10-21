/**
 * Neutral results -> Gemini wire objects: `GenerateContentResponse` (one JSON body, or the chunks
 * of a stream), the model list, and Google-shaped error bodies.
 *
 * One state machine (`runGenerate`) serves both: it emits a chunk per piece of output as it goes
 * and returns the aggregated response, so the JSON body and the stream cannot disagree. A
 * non-streaming call passes a no-op `emit`. Reasoning deltas are dropped (no thought parts).
 */
import type { PlugError, PlugErrorKind, PlugEvent, PlugFinish, PlugUsage } from "../contract.js"
import type { StreamWire } from "../http.js"
import { GEMINI_MODELS_LIST, MODELS_LIST, type ListedModel } from "../models.js"
import type { ChoiceCodec } from "../openai/fanout.js"
import { structuredMissing, textFallback, unfence, type CollectedChoice } from "../openai/response.js"
import { WRAP_KEY } from "./request.js"

type ToolCall = Extract<PlugEvent, { type: "tool-call" }>

/** What the encoder needs besides the model events: Gemini presentation state. The request decoder produces it. */
export interface GeminiExchange {
  /** The model string from the URL; echoed as `modelVersion`. A request that used an alias with fallbacks echoes the target that answered (`CallContext.onServed`). */
  model: string
  readonly stream: boolean
  /** Name of the forced tool that carries `responseSchema` output; its input becomes the text of the answer. */
  readonly structuredTool?: string
  /** The schema was not an object, so the answer sits under one property of the tool input and is unwrapped. */
  readonly wrapped?: boolean
  /**
   * The caller's own tools are offered next to the structured tool. A call to any of them is the
   * response (function calls, prose and the structured answer dropped); the structured answer is
   * the text only when the step called no caller tool.
   */
  readonly callerTools?: boolean
  /** `responseMimeType: application/json` without a schema: a single code fence around JSON text is stripped. */
  readonly jsonObject?: boolean
  /** The caller's schema as sent (converted): a text answer is taken when the model skipped the call (`textFallback`, #173). */
  readonly structuredSchema?: Readonly<Record<string, unknown>>
}

/** How an exchange ended. Nothing was emitted when `failure` is set and `started` is false: the caller answers with a real HTTP error. */
export interface GenerateRun {
  readonly failure?: PlugError
  /** Whether any chunk was emitted (a streamed response is committed as a 200 SSE stream). */
  readonly started: boolean
  /** The aggregated response (non-streaming body). Absent on failure. */
  readonly response?: object
  /** The structured answer came from the final text, not the respond call (`textFallback`). */
  readonly structuredFallback?: boolean
  /** The usage the model reported, when the exchange succeeded. */
  readonly usage?: PlugUsage
}

/**
 * One candidate of several (`candidateCount` > 1, see `src/openai/fanout.ts`): its chunks carry this `index` and the
 * shared `responseId`, and its last chunk leaves out `usageMetadata`, which the fan-out sums into one final chunk.
 */
export interface GeminiCandidate {
  readonly index: number
  readonly responseId: string
}

type Part = Record<string, unknown>

// ---------------------------------------------------------------- errors, models

const STATUSES: Record<PlugErrorKind, string> = {
  invalid_request: "INVALID_ARGUMENT",
  authentication: "UNAUTHENTICATED",
  permission: "PERMISSION_DENIED",
  not_found: "NOT_FOUND",
  rate_limit: "RESOURCE_EXHAUSTED",
  server: "INTERNAL",
  timeout: "DEADLINE_EXCEEDED",
}

/** Google's `{error:{code,message,status,details?}}`; `code` is the HTTP status. An unknown model points at `GET /v1beta/models`, the list a Gemini client can call. */
export const encodeGeminiError = (error: PlugError): object => {
  const message = error.code === "model_not_found" ? error.message.replace(`${MODELS_LIST} lists`, `${GEMINI_MODELS_LIST} lists`) : error.message
  return {
    error: {
      code: error.status,
      message,
      status: error.status === 503 ? "UNAVAILABLE" : STATUSES[error.kind],
      ...(error.param ? { details: [{ "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [{ field: error.param, description: message }] }] } : {}),
    },
  }
}

const encodeModel = ({ id, ref, model }: ListedModel): object => ({
  name: `models/${id}`,
  version: "plugboard",
  displayName: model.name ?? id,
  description: `${ref.providerID} model served by opencode-plugboard`,
  ...(model.contextLimit !== undefined ? { inputTokenLimit: model.contextLimit } : {}),
  supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
})

/** `GET /v1beta/models` body (everything on one page). */
export const encodeGeminiModelList = (models: ReadonlyArray<ListedModel>): object => ({ models: models.map(encodeModel) })

/** `GET /v1beta/models/{model}` body. */
export const encodeGeminiModel = encodeModel

// ---------------------------------------------------------------- responses

const FINISH_REASONS: Record<Exclude<PlugFinish, "error">, string> = {
  stop: "STOP",
  // Gemini reports STOP when the model ends on a function call.
  "tool-calls": "STOP",
  length: "MAX_TOKENS",
  "content-filter": "SAFETY",
}

/** Gemini's candidate count excludes thoughts, which have their own field; the total is the sum. */
const encodeUsage = (usage: PlugUsage) => {
  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  const thoughts = usage.reasoningTokens ?? 0
  return {
    promptTokenCount: input,
    candidatesTokenCount: Math.max(output - thoughts, 0),
    totalTokenCount: input + output,
    ...(usage.cacheReadTokens ? { cachedContentTokenCount: usage.cacheReadTokens } : {}),
    ...(thoughts > 0 ? { thoughtsTokenCount: thoughts } : {}),
  }
}

const noFinish = (): PlugError => ({ status: 500, kind: "server", message: "Model stream ended without a finish event" })
const failedRun = (): PlugError => ({ status: 500, kind: "server", message: "Model run failed" })
export const noResponse = (): PlugError => ({ status: 502, kind: "server", message: "No response from the model" })

const argsOf = (input: unknown): Record<string, unknown> => (typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : { value: input })

/** The text of a structured answer: the tool input as JSON, or its wrapped property. */
const structuredText = (exchange: GeminiExchange, call: ToolCall): string => {
  const input = exchange.wrapped && typeof call.input === "object" && call.input !== null ? (call.input as Record<string, unknown>)[WRAP_KEY] : call.input
  return typeof input === "string" && !exchange.wrapped ? input : JSON.stringify(input ?? {})
}

export async function runGenerate(events: AsyncIterable<PlugEvent>, exchange: GeminiExchange, emit: (chunk: object) => void, of?: GeminiCandidate): Promise<GenerateRun> {
  const responseId = of?.responseId ?? crypto.randomUUID().replaceAll("-", "").slice(0, 22)
  const envelope = (parts: Part[], extra: Record<string, unknown> = {}, candidate: Record<string, unknown> = {}) => ({
    candidates: [{ content: { role: "model", parts }, ...candidate, index: of?.index ?? 0 }],
    ...extra,
    modelVersion: exchange.model,
    responseId,
  })

  // Only a non-streamed body needs the aggregated parts: a stream is already on the wire, so nothing grows (#153).
  const aggregate = !exchange.stream
  /** The aggregated parts: adjacent text merges into one part. */
  const parts: Part[] = []
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

  const push = (part: Part) => {
    started = true
    if (aggregate) {
      const last = parts.at(-1)
      if (typeof part.text === "string" && last && typeof last.text === "string") last.text += part.text
      else parts.push(part)
    }
    emit(envelope([part]))
  }
  const text = (delta: string) => {
    if (delta.length > 0) push({ text: delta })
  }
  const toolCall = (call: ToolCall) => {
    push({ functionCall: { name: call.name, args: argsOf(call.input) } })
    calls++
  }
  // json_object: text that opens with a backtick may be a fenced answer, so it waits until a tool
  // call or the finish shows the whole text; anything else streams as it comes.
  let pending = ""
  let passing = false
  const flush = () => {
    if (pending.length === 0) return
    const out = unfence(pending)
    pending = ""
    text(out)
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
          else text(structuredText(exchange, event))
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
    if (event.type === "text-delta") text(event.text)
    else toolCall(event)
  }

  const passthrough = exchange.callerTools === true && calls > 0
  const fallback = exchange.structuredTool !== undefined && !passthrough && !answered && exchange.structuredSchema !== undefined ? textFallback(collected, exchange.structuredSchema) : undefined
  const missing = passthrough || answered || fallback !== undefined || exchange.structuredTool === undefined ? undefined : structuredMissing()
  failure ??= finish ? missing : noFinish()
  if (failure) return { failure, started }
  flush()
  if (held && !passthrough) text(structuredText(exchange, held))
  if (fallback !== undefined) text(fallback)
  const candidate = { finishReason: FINISH_REASONS[finish!] }
  const extra = usage && !of ? { usageMetadata: encodeUsage(usage) } : {}
  // The last chunk carries the finish reason and usage, with an empty text part as Google's does.
  emit(envelope([{ text: "" }], extra, candidate))
  started = true
  return { started, response: envelope(parts.length > 0 ? parts : [{ text: "" }], extra, candidate), ...(usage ? { usage } : {}), ...(fallback !== undefined ? { structuredFallback: true } : {}) }
}

/** SSE frame of one stream chunk (`alt=sse`): `data: <json>`, no event name and no `[DONE]`. */
export const sseChunk = (chunk: object): string => `data: ${JSON.stringify(chunk)}\n\n`

/** `alt=sse`: one `data:` frame per chunk, nothing at the end (an error is one more frame). */
export const sseWire = (): StreamWire => ({ contentType: "text/event-stream; charset=utf-8", keepalive: ": keepalive\n\n", frame: sseChunk, end: () => "" })

/**
 * No `alt` (Google's default): the stream is one JSON array, written as it goes. `[` opens it with the first chunk,
 * each next chunk follows a comma, `]` closes it. An error after the first chunk is one more element, so the array
 * stays valid JSON to the end. A newline is the keepalive: whitespace is allowed anywhere between JSON tokens.
 */
export const arrayWire = (): StreamWire => {
  let opened = false
  return {
    contentType: "application/json; charset=utf-8",
    keepalive: "\n",
    frame(chunk) {
      const lead = opened ? "," : "["
      opened = true
      return `${lead}\n${JSON.stringify(chunk)}`
    },
    end: () => "\n]\n",
  }
}

/** Numbers add up per key; a key only one side has is kept. */
const addCounts = (a: Record<string, number>, b: Record<string, number>): Record<string, number> => {
  const total = { ...a }
  for (const [key, value] of Object.entries(b)) total[key] = (total[key] ?? 0) + value
  return total
}

/** The bodies of successful candidates as one: `candidates` in order with their `index`, `usageMetadata` summed, the rest from the first. */
function mergeCandidates(bodies: ReadonlyArray<object>): object {
  const list = bodies as ReadonlyArray<{ candidates: object[]; usageMetadata?: Record<string, number> }>
  const usage = list.reduce<Record<string, number> | undefined>(
    (total, body) => (body.usageMetadata === undefined ? total : total === undefined ? body.usageMetadata : addCounts(total, body.usageMetadata)),
    undefined,
  )
  return { ...list[0], candidates: list.map((body, index) => ({ ...body.candidates[0], index })), ...(usage === undefined ? {} : { usageMetadata: usage }) }
}

/**
 * The Gemini encoder as a `ChoiceCodec`, for `candidateCount` > 1: one model call per candidate, merged by the
 * shared fan-out. A streamed candidate writes its own chunks (with its `index`) and no usage; the fan-out ends the
 * stream with one chunk of the summed `usageMetadata`, then the wire's end.
 */
export const geminiCodec = (exchange: GeminiExchange, wire: StreamWire): ChoiceCodec => ({
  stream: exchange.stream,
  includeUsage: true,
  idPrefix: "",
  async collect(events): Promise<CollectedChoice> {
    const run = await runGenerate(events, exchange, () => {})
    if (run.failure || !run.response) {
      const failure = run.failure ?? noResponse()
      return { status: failure.status, body: encodeGeminiError(failure), retryAfterSeconds: failure.retryAfterSeconds }
    }
    return { status: 200, body: run.response, ...(run.structuredFallback ? { structuredFallback: true } : {}) }
  },
  async streamChoice(events, write, choice) {
    const run = await runGenerate(events, exchange, (chunk) => write(wire.frame(chunk)), { index: choice.index, responseId: choice.id })
    return { started: run.started, ...(run.failure ? { failure: run.failure } : {}), ...(run.usage ? { usage: run.usage } : {}) }
  },
  usageChunk: (choice, usage) => ({ usageMetadata: encodeUsage(usage), modelVersion: exchange.model, responseId: choice.id }),
  setModel: (model) => void (exchange.model = model),
  encodeError: encodeGeminiError,
  merge: mergeCandidates,
  wire,
})
