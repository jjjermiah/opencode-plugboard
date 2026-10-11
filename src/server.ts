/**
 * Compatibility façade for the HTTP entry point. The route table lives in `openai/route.ts` and
 * the ingress helpers in `http.ts`; this file keeps the old `createRouter(deps, host)` shape until
 * `index.ts` composes the route directly.
 */

import type { PlugboardOptions } from "./contract.js"
import { createOpenAiRoute } from "./openai/route.js"
import type { RouteHost } from "./openai/route.js"

export type { RouteHost }

/** Only `parseOptions` is still used by callers; the route imports everything else directly. */
export interface RouteDeps {
  parseOptions(raw: unknown): PlugboardOptions
}

export function createRouter(_deps: RouteDeps, host: RouteHost) {
  return createOpenAiRoute(host)
}
