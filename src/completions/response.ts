/**
 * Neutral results -> the legacy `text_completion` wire objects: one JSON body per choice, or SSE
 * chunks per choice, for `src/openai/fanout.ts` to merge.
 *
 * Reasoning deltas and tool calls are dropped: the legacy format has neither, and the request
 * offers no tools. `logprobs` is always null.
 */
import type { PlugError, PlugEvent, PlugFinish, PlugUsage } from "../contract.js"
import type { ChoiceCodec } from "../openai/fanout.js"
import { encodeError, type StreamChoice, type StreamResult } from "../openai/response.js"

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

/** One choice as a complete body: `choices[0]` carries the text, `usage` the totals. */
async function collectText(events: AsyncIterable<PlugEvent>, exchange: CompletionsExchange, index: number): Promise<{ status: number; body: object }> {
  let text = ""
  let finish: Exclude<PlugFinish, "error"> | undefined
  let usage: PlugUsage | undefined
  let failure: PlugError | undefined
  for await (const event of events) {
    if (event.type === "text-delta") text += event.text
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
  return {
    status: 200,
    body: {
      id: `cmpl-${crypto.randomUUID().replaceAll("-", "").slice(0, 29)}`,
      object: "text_completion",
      created: now(),
      model: exchange.model,
      choices: [{ text: prefixOf(exchange, index) + text, index: 0, logprobs: null, finish_reason: FINISH_REASONS[finish] }],
      ...(usage ? { usage: encodeUsage(usage) } : {}),
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
      chunk(event.text)
    }
  }
  failure ??= finish ? undefined : noFinish()
  if (failure) return { failure, started }
  start()
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
