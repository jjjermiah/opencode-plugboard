/**
 * `x-plugboard-usage` (#52): the tokens and USD cost of the model calls a response answered, so a
 * caller sees what one request cost without asking `GET /v1/usage`. It is set only while usage
 * recording is on (`withUsage`, src/usage.ts), and only on a non-streaming response: a stream
 * sends its headers with its first event, before the usage is known, so it has no such header.
 */
import type { ServerResponse } from "node:http"
import type { CallTotals } from "./contract.js"

export const USAGE_HEADER = "x-plugboard-usage"

/** The totals of one response, summed over its calls. `costUsd` is undefined when any call had no price. */
interface Totals {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly costUsd?: number
}

/** `input=<n>; output=<n>; cache_read=<n>; cost_usd=<x.xxxxxx>`; the cost part is left out for an unpriced model. */
export function formatUsage(totals: Totals): string {
  const parts = [`input=${totals.inputTokens}`, `output=${totals.outputTokens}`, `cache_read=${totals.cacheReadTokens}`]
  if (totals.costUsd !== undefined) parts.push(`cost_usd=${totals.costUsd.toFixed(6)}`)
  return parts.join("; ")
}

/**
 * The `CallContext.onUsage` of one response: each answered call adds its totals and the header
 * is rewritten while the headers are still open, so the fan-out's `n` choices sum into one value.
 * `undefined` for a stream (see the module comment).
 */
export function reportUsage(response: ServerResponse, stream: boolean): ((call: CallTotals) => void) | undefined {
  if (stream) return undefined
  let totals: Totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }
  return (call) => {
    if (response.headersSent || response.destroyed) return
    const costUsd = totals.costUsd === undefined || call.costUsd === undefined ? undefined : totals.costUsd + call.costUsd
    totals = {
      inputTokens: totals.inputTokens + call.inputTokens,
      outputTokens: totals.outputTokens + call.outputTokens,
      cacheReadTokens: totals.cacheReadTokens + call.cacheReadTokens,
      ...(costUsd === undefined ? {} : { costUsd }),
    }
    response.setHeader(USAGE_HEADER, formatUsage(totals))
  }
}
