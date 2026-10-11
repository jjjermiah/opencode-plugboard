/**
 * `FakeModelCaller`: a scripted `ModelCaller` for the HTTP and front-end tests. It plays a
 * script of steps per call and records what the route handed it, so a test can say "the model
 * streamed X" and then assert on the wire.
 *
 * Steps:
 *   - a `PlugEvent`: yielded as is;
 *   - `{ record: id }`: calls `context.onRecord(id)` (the session caller does this before its first event);
 *   - `{ wait: promise }`: holds the stream until the promise settles (or the request aborts);
 *   - `"hang"`: holds until the request aborts, like a model that never answers;
 *   - `{ throw: error }`: the stream rejects, like a backend bug.
 *
 * Like the real session caller, the fake ends its stream (no more events) once `context.signal`
 * aborts.
 */
import type { CallContext, ModelCaller, PlugEvent, PlugRequest } from "../../src/contract.js"

export type ScriptStep = PlugEvent | { readonly record: string } | { readonly wait: Promise<unknown> } | "hang" | { readonly throw: unknown }
export type Script = ReadonlyArray<ScriptStep>

export interface RecordedCall {
  readonly request: PlugRequest
  readonly context: CallContext
  /** Steps yielded so far. */
  yielded: number
  /** The stream finished (ran out of steps, aborted, threw, or the consumer returned early). */
  closed: boolean
  /** Resolves with the abort reason once `context.signal` aborts. */
  readonly aborted: Promise<unknown>
}

const abortedWith = (signal: AbortSignal): Promise<unknown> =>
  signal.aborted ? Promise.resolve(signal.reason) : new Promise((resolve) => signal.addEventListener("abort", () => resolve(signal.reason), { once: true }))

/** Settles with `promise`, or with `undefined` as soon as `signal` aborts. */
const orAbort = (promise: Promise<unknown>, signal: AbortSignal) => Promise.race([promise, abortedWith(signal).then(() => undefined)])

export class FakeModelCaller implements ModelCaller {
  readonly calls: RecordedCall[] = []
  private readonly script: (request: PlugRequest, call: number) => Script

  /** One script for every call, or a function of the request and the zero-based call number. */
  constructor(script: Script | ((request: PlugRequest, call: number) => Script) = []) {
    this.script = typeof script === "function" ? script : () => script
  }

  /** The only call; fails the test when there were none or several. */
  get call(): RecordedCall {
    if (this.calls.length !== 1) throw new Error(`expected exactly one model call, got ${this.calls.length}`)
    return this.calls[0]!
  }

  stream(request: PlugRequest, context: CallContext): AsyncIterable<PlugEvent> {
    const recorded: RecordedCall = { request, context, yielded: 0, closed: false, aborted: abortedWith(context.signal) }
    this.calls.push(recorded)
    const steps = this.script(request, this.calls.length - 1)
    return (async function* () {
      try {
        for (const step of steps) {
          if (context.signal.aborted) return
          if (step === "hang") {
            await recorded.aborted
            return
          }
          if ("record" in step) context.onRecord?.(step.record)
          else if ("wait" in step) await orAbort(step.wait, context.signal)
          else if ("throw" in step) throw step.throw
          else {
            recorded.yielded++
            yield step
          }
        }
      } finally {
        recorded.closed = true
      }
    })()
  }
}
