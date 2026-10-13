/**
 * Caller stop sequences, applied by plugboard to the answer text (#145, #149, #390).
 *
 * The sequences are not sent to the model (`appGeneration` in src/openai/sampling.ts). A provider that
 * stops at one also stops inside reasoning, where the model may quote the prompt (#390), so the
 * answer would end before it started. Here the answer text is scanned as it arrives. The first
 * sequence ends the answer: the text before it is sent, the sequence and what follows are not, and
 * the route stops reading so the host run is interrupted. Reasoning and tool calls never pass through
 * the scan. Anthropic reports the sequence as `stop_sequence`; the other routes leave it out.
 */

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
 * Streamed answer text, scanned as it arrives. The last `size` characters (the longest sequence) are
 * held back until later text shows whether they start a sequence. Once a sequence is found,
 * `matched` is set and nothing more is sent.
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

  /** Everything still held, unchanged. Used before a tool call or reasoning, which cannot end the answer. */
  release(): string {
    const out = this.found === undefined ? this.held : ""
    this.held = ""
    return out
  }

  /** The end of the text: the held text, cut at a sequence it contains. */
  finish(): string {
    const text = this.found === undefined ? this.held : ""
    this.held = ""
    const hit = stopAt(text, this.stops)
    if (hit === undefined) return text
    this.found = hit.stop
    return text.slice(0, hit.index)
  }
}
