/**
 * Caller stop sequences on the answer text (#145, #149). A provider ends the answer at a sequence
 * but does not always return it, and Anthropic, OpenAI and Gemini all leave it out of the answer
 * when the stop is the one that ended it. The host reports only `stop`, so the end of a plain
 * stop's text is checked for a sequence, which is removed and reported. A streamed text keeps its
 * last characters back (`StopHoldback`) until the finish decides whether they end in a sequence.
 */

/** The longest of `stops` that `tail` ends with, if any. */
export const stopTail = (tail: string, stops: ReadonlyArray<string>): string | undefined =>
  stops.filter((stop) => tail.endsWith(stop)).sort((a, b) => b.length - a.length)[0]

/** Streamed text with its last `size` characters (the longest sequence) held back. Without sequences nothing is held. */
export class StopHoldback {
  private held = ""
  private readonly size: number

  constructor(private readonly stops: ReadonlyArray<string>) {
    this.size = Math.max(0, ...stops.map((stop) => stop.length))
  }

  /** Adds a chunk and returns the text that can be sent now: everything except the last `size` characters. */
  push(chunk: string): string {
    if (this.size === 0) return chunk
    this.held += chunk
    const out = this.held.slice(0, Math.max(0, this.held.length - this.size))
    this.held = this.held.slice(out.length)
    return out
  }

  /** Everything still held, unchanged. Used before a tool call or reasoning, which cannot be a stop. */
  release(): string {
    const out = this.held
    this.held = ""
    return out
  }

  /**
   * The end of the text. `plainStop` is true when the model stopped for `stop` with no tool call:
   * then a sequence the held text ends with is removed and returned as `matched`.
   */
  finish(plainStop: boolean): { readonly text: string; readonly matched?: string } {
    const matched = plainStop && this.size > 0 ? stopTail(this.held, this.stops) : undefined
    const text = matched === undefined ? this.held : this.held.slice(0, this.held.length - matched.length)
    this.held = ""
    return matched === undefined ? { text } : { text, matched }
  }
}

/** A complete text (no streaming): the text without the sequence it ends with, if any. */
export const stripStopTail = (text: string, stops: ReadonlyArray<string>): { readonly text: string; readonly matched?: string } => {
  const matched = stopTail(text, stops)
  return matched === undefined ? { text } : { text: text.slice(0, text.length - matched.length), matched }
}
