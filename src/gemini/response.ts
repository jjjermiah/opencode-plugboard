/**
 * Neutral results -> Gemini wire objects: `GenerateContentResponse` (one JSON body, or the chunks
 * of a stream), the model list, and Google-shaped error bodies.
 *
 * One state machine (`runGenerate`) serves both: it emits a chunk per piece of output as it goes
 * and returns the aggregated response, so the JSON body and the stream cannot disagree. A
 * non-streaming call passes a no-op `emit`. Reasoning deltas are dropped (no thought parts).
 */
import type { PlugError, PlugErrorKind, PlugEvent, PlugFinish, PlugUsage } from "../contract.js"
import type { ListedModel } from "../models.js"
import { structuredMissing, textFallback, unfence } from "../openai/response.js"
import { StopScan } from "../stop.js"
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
  /** The request's `generationConfig.stopSequences`. A plain stop whose text ends with one of these leaves the sequence out (src/stop.ts). Not applied to structured output. */
  readonly stop?: ReadonlyArray<string>
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

/** Google's `{error:{code,message,status,details?}}`; `code` is the HTTP status. */
export const encodeGeminiError = (error: PlugError): object => ({
  error: {
    code: error.status,
    message: error.message,
    status: error.status === 503 ? "UNAVAILABLE" : STATUSES[error.kind],
    ...(error.param
      ? { details: [{ "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [{ field: error.param, description: error.message }] }] }
      : {}),
  },
})

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

const argsOf = (input: unknown): Record<string, unknown> =>
  typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : { value: input }

/** The text of a structured answer: the tool input as JSON, or its wrapped property. */
const structuredText = (exchange: GeminiExchange, call: ToolCall): string => {
  const input = exchange.wrapped && typeof call.input === "object" && call.input !== null ? (call.input as Record<string, unknown>)[WRAP_KEY] : call.input
  return typeof input === "string" && !exchange.wrapped ? input : JSON.stringify(input ?? {})
}


export async function runGenerate(events: AsyncIterable<PlugEvent>, exchange: GeminiExchange, emit: (chunk: object) => void): Promise<GenerateRun> {
  const responseId = crypto.randomUUID().replaceAll("-", "").slice(0, 22)
  const envelope = (parts: Part[], extra: Record<string, unknown> = {}, candidate: Record<string, unknown> = {}) => ({
    candidates: [{ content: { role: "model", parts }, ...candidate, index: 0 }],
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
  // A stop sequence in the answer ends it; the text is held back until it is ruled out (src/stop.ts). Structured output has none.
  const holdback = exchange.structuredTool === undefined ? new StopScan(exchange.stop ?? []) : undefined
  const text = (delta: string) => {
    const out = holdback ? holdback.push(delta) : delta
    if (out.length > 0) push({ text: out })
  }
  const releaseHeld = () => {
    const rest = holdback?.release() ?? ""
    if (rest.length > 0) push({ text: rest })
  }
  const toolCall = (call: ToolCall) => {
    releaseHeld()
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
    if (holdback?.matched !== undefined) {
      finish = "stop"
      break
    }
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
    if (event.type !== "text-delta") {
      flush()
      if (holdback?.matched !== undefined) {
        finish = "stop"
        break
      }
    }
    if (event.type === "text-delta") {
      text(event.text)
      if (holdback?.matched !== undefined) {
        finish = "stop"
        break
      }
    } else toolCall(event)
  }

  const passthrough = exchange.callerTools === true && calls > 0
  const fallback = exchange.structuredTool !== undefined && !passthrough && !answered && exchange.structuredSchema !== undefined ? textFallback(collected, exchange.structuredSchema) : undefined
  const missing = passthrough || answered || fallback !== undefined || exchange.structuredTool === undefined ? undefined : structuredMissing()
  failure ??= finish ? missing : noFinish()
  if (failure) return { failure, started }
  flush()
  if (holdback) {
    const rest = holdback.finish()
    if (rest.length > 0) push({ text: rest })
  }
  if (held && !passthrough) text(structuredText(exchange, held))
  if (fallback !== undefined) text(fallback)
  const candidate = { finishReason: FINISH_REASONS[finish!] }
  const extra = usage ? { usageMetadata: encodeUsage(usage) } : {}
  // The last chunk carries the finish reason and usage, with an empty text part as Google's does.
  emit(envelope([{ text: "" }], extra, candidate))
  started = true
  return { started, response: envelope(parts.length > 0 ? parts : [{ text: "" }], extra, candidate), ...(fallback !== undefined ? { structuredFallback: true } : {}) }
}

/** SSE frame of one stream chunk (`alt=sse`): `data: <json>`, no event name and no `[DONE]`. */
export const sseChunk = (chunk: object): string => `data: ${JSON.stringify(chunk)}\n\n`
