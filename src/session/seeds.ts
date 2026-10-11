/**
 * Seed tools.
 *
 * OpenCode's `session.hook("context")` may only advertise tool definitions that
 * correspond to a *registered* Tool.Info (unmatched entries are dropped), so plugboard owns a
 * pool of registered seeds (`maxTools` of them) and re-keys them in the hook:
 * the caller's name becomes the map key (what the provider sees), while the seed keeps its
 * own `name` (what the executor dispatches on).
 *
 * A seed's `execute` returns at once with `SEED_RESULT`, so history shows the call as
 * completed. A tool result always makes the runner start a second model step
 * (`record.needsContinuation`, runner/step.ts), and no tool result, hook or agent setting
 * ends the loop (failing the seed, even with a typed non-`Tool.Error`, is converted to a
 * normal tool failure, and `Permission.DeclinedError` is only reachable from host tools).
 * So plugboard stops the turn itself: once the step has settled with a normal `tool-calls`
 * finish (`session.step.ended`) it interrupts the session. Nothing orders that interrupt
 * before the runner's next step, so a second step can occasionally start and be wasted (extra
 * tokens, a stray assistant message in history, never a wrong response; tracked in issue #14).
 * The captured `session.tool.called` events are what a `tool_calls` response needs.
 * Seeds are registered only inside the plugboard data root, denied to every agent there,
 * and allowed again by the permissions of plugboard's own request sessions. Those permissions
 * deny every other tool (defense in depth: if a second step ever runs outside the context
 * hook's replacement, it cannot run real OpenCode tools).
 */

import type { PlugRequest, PlugTool } from "../contract.js"

export const SEED_PREFIX = "plugboard_seed_"

/** Output of every seed tool call: the caller, not OpenCode, runs the tool. */
export const SEED_RESULT = "Returned to caller (opencode-plugboard)"

/**
 * Session permissions of a request session. The host takes the last matching rule (session rules
 * come after the agent's): everything is denied, then the seeds are allowed again.
 */
export const REQUEST_PERMISSIONS: ReadonlyArray<{ action: string; resource: string; effect: "allow" | "deny" }> = [
  { action: "*", resource: "*", effect: "deny" },
  { action: `${SEED_PREFIX}*`, resource: "*", effect: "allow" },
]

/** The caller tools that get a seed in the model request (`tool_choice` none offers none, a named tool only that one). */
export function seedToolsFor(request: PlugRequest): ReadonlyArray<PlugTool> {
  const choice = request.toolChoice
  if (choice === "none") return []
  return typeof choice === "object" ? request.tools.filter((tool) => tool.name === choice.name) : request.tools
}
