/** The response side of per-app policy (option `apps`): what a route tells the caller about changes the policy made. */

import type { ServerResponse } from "node:http"
import type { PolicyNote } from "./contract.js"

export const POLICY_HEADER = "x-plugboard-policy"

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
