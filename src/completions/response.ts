/**
 * Neutral results -> the legacy `text_completion` wire objects: one JSON body per choice, or SSE
 * chunks per choice, for `src/openai/fanout.ts` to merge.
 *
 * Reasoning deltas and tool calls are dropped: the legacy format has neither, and the request
 * offers no tools. `logprobs` is always null.
 */
import { isPlugError, type PlugError, type PlugEvent, type PlugFinish, type PlugUsage } from "../contract.js"
import type { ChoiceCodec } from "../openai/fanout.js"
import { args, encodeError, structuredMissing, textFallback, unfence, type CollectedChoice, type StreamChoice, type StreamResult } from "../openai/response.js"
import { StopScan } from "../stop.js"

/** What the encoders need besides the model events; the request decoder produces it, the model call never sees it. */
export interface CompletionsExchange {
  /** The model string the client sent; echoed in every response object. A request that used an alias with fallbacks echoes the target that answered (`CallContext.onServed`). */
  model: string
  readonly stream: boolean
  /** `stream_options.include_usage`: a final chunk with `choices: []` and the summed usage. */
  readonly includeUsage: boolean
  /** Choices per prompt. Choice `i` answers prompt `floor(i / perPrompt)`. */
  readonly perPrompt: number
  /** `echo`: each prompt, written ahead of the text of its choices. */
  readonly echo?: ReadonlyArray<string>
  /** The request's `stop`. A plain stop whose text ends with one of these leaves the sequence out (src/stop.ts). */
  readonly stop?: ReadonlyArray<string>
  /** `response_format: json_schema`: the name of the forced tool whose input is the answer (`respond`). The answer is its arguments as text. */
  readonly structuredTool?: string
  /** The caller's `json_schema`: a text answer is taken when the model skipped the call and its text is that JSON (`textFallback`). */
  readonly structuredSchema?: Readonly<Record<string, unknown>>
  /** `response_format: json_object`: a single markdown fence around the answer is stripped (`unfence`). */
  readonly jsonObject?: boolean
}

const FINISH_REASONS: Record<Exclude<PlugFinish, "error">, string> = {
  stop: "stop",
  length: "length",
  // The request offers no tools; should a model call one anyway, the turn simply stopped.
  "tool-calls": "stop",
  "content-filter": "content_filter",
}

const noFinish = (): PlugError => ({ status: 500, kind: "server", message: "Model stream ended without a finish event" })
const failedRun = (): PlugError => ({ status: 500, kind: "server", message: "Model run failed" })

const now = () => Math.floor(Date.now() / 1000)

const encodeUsage = (usage: PlugUsage) => {
  const prompt = usage.inputTokens ?? 0
  const completion = usage.outputTokens ?? 0
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion }
}

const prefixOf = (exchange: CompletionsExchange, index: number) => exchange.echo?.[Math.floor(index / exchange.perPrompt)] ?? ""

/** A choice's settled answer: its text, the finish reason and the usage. */
interface Settled {
  readonly text: string
  readonly reason: Exclude<PlugFinish, "error">
  readonly usage?: PlugUsage
  /** The structured answer came from the text (see `textFallback`), not the respond call. */
  readonly fallback?: boolean
}

/**
 * Reads one whole choice. A structured answer is the arguments of the `respond` call (the text is
 * ignored); a json_object answer loses one code fence. Without the call a structured choice fails,
 * as in Chat Completions (`structuredMissing`).
 */
async function settle(events: AsyncIterable<PlugEvent>, exchange: CompletionsExchange): Promise<Settled | PlugError> {
  let text = ""
  let answer: string | undefined
  let finish: Exclude<PlugFinish, "error"> | undefined
  let usage: PlugUsage | undefined
  let failure: PlugError | undefined
  // Not structured output: a stop sequence in the answer ends it (src/stop.ts).
  const scan = exchange.structuredTool === undefined ? new StopScan(exchange.stop ?? []) : undefined
  for await (const event of events) {
    if (event.type === "text-delta") {
      text += scan ? scan.push(event.text) : event.text
      if (scan?.matched !== undefined) {
        finish = "stop"
        break
      }
    } else if (event.type === "tool-call") {
      if (exchange.structuredTool !== undefined && event.name === exchange.structuredTool) answer ??= args(event.input)
    } else if (event.type === "finish") {
      usage = event.usage ?? usage
      if (event.reason === "error") failure ??= failedRun()
      else finish = event.reason
    } else if (event.type === "error") {
      failure = event.error
      break
    }
  }
  if (!failure && !finish) failure = noFinish()
  if (failure || !finish) return failure ?? noFinish()
  if (scan) text += scan.finish()
  if (exchange.structuredTool !== undefined) {
    if (answer !== undefined) return { text: answer, reason: finish, usage }
    const fallback = exchange.structuredSchema === undefined ? undefined : textFallback(text, exchange.structuredSchema)
    if (fallback === undefined) return structuredMissing()
    return { text: fallback, reason: finish, usage, fallback: true }
  }
  return { text: exchange.jsonObject ? unfence(text) : text, reason: finish, usage }
}

/** One choice as a complete body: `choices[0]` carries the text, `usage` the totals. */
async function collectText(events: AsyncIterable<PlugEvent>, exchange: CompletionsExchange, index: number): Promise<CollectedChoice> {
  const settled = await settle(events, exchange)
  if (isPlugError(settled)) return { status: settled.status, body: encodeError(settled), retryAfterSeconds: settled.retryAfterSeconds }
  return {
    ...(settled.fallback ? { structuredFallback: true } : {}),
    status: 200,
    body: {
      id: `cmpl-${crypto.randomUUID().replaceAll("-", "").slice(0, 29)}`,
      object: "text_completion",
      created: now(),
      model: exchange.model,
      choices: [{ text: prefixOf(exchange, index) + settled.text, index: 0, logprobs: null, finish_reason: FINISH_REASONS[settled.reason] }],
      ...(settled.usage ? { usage: encodeUsage(settled.usage) } : {}),
    },
  }
}

/**
 * One choice of the shared stream. Writes this choice's text chunks and its finish chunk, never
 * the error frame, usage chunk or `[DONE]` (see `StreamChoice`). Nothing is written before the
 * first text, so a failure before it is still a real HTTP error.
 */
async function streamText(
  events: AsyncIterable<PlugEvent>,
  exchange: CompletionsExchange,
  write: (chunk: string) => void,
  choice: StreamChoice,
): Promise<StreamResult> {
  const chunk = (text: string, finish: string | null = null) =>
    write(
      `data: ${JSON.stringify({
        id: choice.id,
        object: "text_completion",
        created: choice.created,
        model: exchange.model,
        choices: [{ text, index: choice.index, logprobs: null, finish_reason: finish }],
      })}\n\n`,
    )
  let started = false
  const start = () => {
    if (started) return
    started = true
    const prefix = prefixOf(exchange, choice.index)
    if (prefix.length > 0) chunk(prefix)
  }
  if (exchange.structuredTool !== undefined || exchange.jsonObject) {
    // A structured or json_object answer is only known at the end (the call, the fence), so it is written as one chunk.
    const settled = await settle(events, exchange)
    if (isPlugError(settled)) return { failure: settled, started: false }
    start()
    if (settled.text.length > 0) chunk(settled.text)
    chunk("", FINISH_REASONS[settled.reason])
    return { started, ...(settled.usage ? { usage: settled.usage } : {}) }
  }
  // A stop sequence in the answer ends it; the text is held back until it is ruled out (src/stop.ts).
  const holdback = new StopScan(exchange.stop ?? [])
  let finish: Exclude<PlugFinish, "error"> | undefined
  let usage: PlugUsage | undefined
  let failure: PlugError | undefined
  for await (const event of events) {
    if (event.type === "error") {
      failure = event.error
      break
    }
    if (event.type === "finish") {
      usage = event.usage ?? usage
      if (event.reason === "error") failure ??= failedRun()
      else finish = event.reason
    } else if (event.type === "text-delta" && event.text.length > 0) {
      start()
      const out = holdback.push(event.text)
      if (out.length > 0) chunk(out)
      if (holdback.matched !== undefined) {
        finish = "stop"
        break
      }
    }
  }
  failure ??= finish ? undefined : noFinish()
  if (failure) return { failure, started }
  start()
  const rest = holdback.finish()
  if (rest.length > 0) chunk(rest)
  chunk("", FINISH_REASONS[finish!])
  return { started, ...(usage ? { usage } : {}) }
}

export const completionsCodec = (exchange: CompletionsExchange): ChoiceCodec => ({
  stream: exchange.stream,
  includeUsage: exchange.includeUsage,
  idPrefix: "cmpl-",
  collect: (events, index) => collectText(events, exchange, index),
  streamChoice: (events, write, choice) => streamText(events, exchange, write, choice),
  usageChunk: (choice, usage) => ({
    id: choice.id,
    object: "text_completion",
    created: choice.created,
    model: exchange.model,
    choices: [],
    usage: encodeUsage(usage),
  }),
  setModel: (model) => void (exchange.model = model),
})
