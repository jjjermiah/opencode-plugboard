/**
 * Caller stop sequences, applied by plugboard to the answer text (#145, #149, #390).
 *
 * The sequences are not sent to the model (the host hook drops them, src/session/context.ts). A provider
 * that stopped at one would also stop inside reasoning, where the model may quote the prompt (#390), so the
 * answer would end before it started. `withStopSequences` scans the answer text as it streams instead. The
 * first sequence ends the answer: the text before it is sent, the sequence and what follows are not, the host
 * run is interrupted (`CallContext.stopAnswer`), and the finish is passed on with the usage of the run, so
 * the spend is counted. Reasoning and tool calls never end the answer. A tool call before the sequence makes
 * the turn a tool turn, as Anthropic reports it.
 */
import type { CallContext, ModelCaller, PlugEvent, PlugRequest } from "./contract.js"
import { logWarn } from "./log.js"

/** Where the earliest of `stops` starts in `text`, and which one (the longer one where two start together). */
export function stopAt(text: string, stops: ReadonlyArray<string>): { readonly index: number; readonly stop: string } | undefined {
  let found: { index: number; stop: string } | undefined
  for (const stop of stops) {
    if (stop.length === 0) continue
    const index = text.indexOf(stop)
    if (index < 0) continue
    if (found === undefined || index < found.index || (index === found.index && stop.length > found.stop.length)) found = { index, stop }
  }
  return found
}

/**
 * Streamed answer text, scanned as it arrives. The last `size` characters (the longest sequence) are held
 * back until later text shows whether they start a sequence. Once a sequence is found, `matched` is set and
 * nothing more is sent.
 */
export class StopScan {
  private held = ""
  private found: string | undefined
  private readonly size: number

  constructor(private readonly stops: ReadonlyArray<string>) {
    this.size = Math.max(0, ...stops.map((stop) => stop.length))
  }

  /** The sequence that ended the answer, once one is found. */
  get matched(): string | undefined {
    return this.found
  }

  /** Adds streamed answer text and returns what can be sent now. Empty once a sequence is found. */
  push(chunk: string): string {
    if (this.size === 0) return chunk
    if (this.found !== undefined) return ""
    const text = this.held + chunk
    const hit = stopAt(text, this.stops)
    if (hit !== undefined) {
      this.found = hit.stop
      this.held = ""
      return text.slice(0, hit.index)
    }
    const out = text.slice(0, Math.max(0, text.length - this.size))
    this.held = text.slice(out.length)
    return out
  }

  /** Everything still held, unchanged, before a tool call: a held prefix that did not complete a sequence is answer text. */
  release(): string {
    const out = this.found === undefined ? this.held : ""
    this.held = ""
    return out
  }

  /** The end of the text: the held text that is left, unless a sequence was found. */
  finish(): string {
    const out = this.found === undefined ? this.held : ""
    this.held = ""
    return out
  }
}

/**
 * The model caller with the caller's stop sequences applied to the answer text (`request.generation.stop`, which
 * carries the app's `sampling.stop` default too). Structured output has no text to scan: it is a tool call whose
 * arguments are the answer, so it passes through unchanged.
 */
export function withStopSequences(inner: ModelCaller, onMissingUsage?: (app: string) => void): ModelCaller {
  return {
    stream(request: PlugRequest, context: CallContext): AsyncIterable<PlugEvent> {
      const stops = request.generation.stop
      if (stops === undefined || stops.length === 0 || request.structuredTool !== undefined) return inner.stream(request, context)
      const stopping = new AbortController()
      return answer(inner.stream(request, { ...context, stopAnswer: stopping.signal }), stops, stopping, context.app, onMissingUsage)
    },
  }
}

async function* answer(
  events: AsyncIterable<PlugEvent>,
  stops: ReadonlyArray<string>,
  stopping: AbortController,
  app: string,
  onMissingUsage: ((app: string) => void) | undefined,
): AsyncGenerator<PlugEvent> {
  const scan = new StopScan(stops)
  // The stream is read to its finish even after a match: the host's finish carries the usage of the run (#390).
  for await (const event of events) {
    if (event.type === "text-delta") {
      if (scan.matched !== undefined) continue
      const out = scan.push(event.text)
      if (out.length > 0) yield { type: "text-delta", text: out }
      if (scan.matched !== undefined) stopping.abort()
    } else if (event.type === "tool-call") {
      if (scan.matched !== undefined) continue
      const rest = scan.release()
      if (rest.length > 0) yield { type: "text-delta", text: rest }
      yield event
    } else if (event.type === "reasoning-delta") {
      if (scan.matched === undefined) yield event
    } else if (event.type === "finish" && event.reason !== "error") {
      const rest = scan.finish()
      if (rest.length > 0) yield { type: "text-delta", text: rest }
      const sequence = scan.matched
      if (sequence === undefined) yield event
      else {
        // The host reported no usage for the run (its step did not finish in the settle window, #390): counted and logged, no estimate.
        if (event.usage === undefined) {
          logWarn("request.stop_usage_missing", { app })
          onMissingUsage?.(app)
        }
        yield { type: "finish", reason: "stop", ...(event.usage ? { usage: event.usage } : {}), stopSequence: sequence }
      }
    } else yield event
  }
}
