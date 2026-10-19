/** The response side of per-app policy (option `apps`): what a route tells the caller about changes the policy made. */

import type { ServerResponse } from "node:http"
import type { PlugRequest, PolicyNote } from "./contract.js"

export const POLICY_HEADER = "x-plugboard-policy"
export const SERVER_TOOLS_HEADER = "x-plugboard-server-tools"
/** Set when the request asked for one tool call per answer and plugboard keeps only the first (#202). */
export const PARALLEL_TOOLS_HEADER = "x-plugboard-parallel-tools"

/** Set when the request declared hosted tools (`web_search` from Codex, ...) and plugboard left them out (#498). */
export const DROPPED_TOOLS_HEADER = "x-plugboard-dropped-tools"

/** `x-plugboard-dropped-tools`: the hosted tool types left out of the request, comma separated, before any body (a stream gets it too). */
export function reportDroppedTools(response: ServerResponse, types: ReadonlyArray<string>): void {
  if (types.length > 0) response.setHeader(DROPPED_TOOLS_HEADER, types.join(","))
}

/**
 * `x-plugboard-parallel-tools: limited` for a request that asked for one tool call per answer. The host has no
 * switch for it on every route, so the session collector keeps the first call; the header says so before any body.
 */
export function reportParallelTools(response: ServerResponse, request: Pick<PlugRequest, "parallelToolCalls">): void {
  if (request.parallelToolCalls === false) response.setHeader(PARALLEL_TOOLS_HEADER, "limited")
}

/**
 * The `CallContext.onPolicy` of a route: `x-plugboard-policy` (the notes, comma separated) while the
 * headers are still open. The first writer wins, so several choices of one request report once.
 */
export function reportPolicy(response: ServerResponse): (notes: ReadonlyArray<PolicyNote>) => void {
  return (notes) => {
    if (notes.length === 0 || response.headersSent || response.destroyed || response.hasHeader(POLICY_HEADER)) return
    response.setHeader(POLICY_HEADER, notes.join(","))
  }
}

/**
 * The `CallContext.onServerTools` of a route: `x-plugboard-server-tools` with the number of server tool calls
 * OpenCode ran for the answer, while the headers are open. Choices of `n` add up (each one reports once,
 * when it ends, and the body is not sent before all of them). A stream gets no callback: its headers go first.
 */
export function reportServerTools(response: ServerResponse, stream: boolean): ((count: number) => void) | undefined {
  if (stream) return undefined
  let total = 0
  return (count) => {
    if (count <= 0 || response.headersSent || response.destroyed) return
    total += count
    response.setHeader(SERVER_TOOLS_HEADER, String(total))
  }
}
