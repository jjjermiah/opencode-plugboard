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
/** One permission rule of a request session. */
export interface PermissionRule {
  readonly action: string
  readonly resource: string
  readonly effect: "allow" | "deny"
}

export const REQUEST_PERMISSIONS: ReadonlyArray<PermissionRule> = [
  { action: "*", resource: "*", effect: "deny" },
  { action: `${SEED_PREFIX}*`, resource: "*", effect: "allow" },
]

/** One rule of an OpenCode permission ruleset, as the operator's agent has it (`Permission.Rule`). */
export interface OperatorRule {
  readonly action: string
  readonly resource: string
  readonly effect: "allow" | "deny" | "ask"
}

/**
 * The host's wildcard match (`Wildcard.match` in OpenCode's core): `*` is any run of characters, `?` one character,
 * and a pattern that ends in ` *` also matches without the space and the star.
 */
export function wildcardMatch(input: string, pattern: string): boolean {
  const escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  const source = escaped.endsWith(" .*") ? `${escaped.slice(0, -3)}( .*)?` : escaped
  return new RegExp(`^${source}$`, "s").test(input.replaceAll("\\", "/"))
}

/** The operator's rules for one tool, in the order the host evaluates them (a later rule wins). */
const rulesFor = (tool: string, rules: ReadonlyArray<OperatorRule>): ReadonlyArray<OperatorRule> => rules.filter((rule) => wildcardMatch(tool, rule.action))

/**
 * The first listed server tool that the operator's rules do not allow, or undefined when each one has an allow rule.
 * A tool with no matching rule is not allowed: the host would ask, and a request session cannot answer a prompt.
 */
export function ungrantedServerTool(opencodeTools: ReadonlyArray<string>, rules: ReadonlyArray<OperatorRule>): string | undefined {
  return opencodeTools.find((tool) => !rulesFor(tool, rules).some((rule) => rule.effect === "allow"))
}

/**
 * Session permissions of a request session of an app with option `opencodeTools` (#194). The host takes the last
 * matching rule (`Permission.evaluate`, findLast) and the session rules come after the agent's, so for each listed
 * tool: a deny for every resource, then the operator's own rules for that tool, rewritten to the tool's id, in their
 * order. A resource the operator's rules name is decided by them (a deny stays a deny, an allow allows); any other
 * resource is denied. An `ask` is a deny: nobody answers a prompt from a request session. An app without
 * `opencodeTools` gets exactly `REQUEST_PERMISSIONS`.
 */
export function requestPermissions(opencodeTools: ReadonlyArray<string>, operatorRules: ReadonlyArray<OperatorRule> = []): ReadonlyArray<PermissionRule> {
  return [
    ...REQUEST_PERMISSIONS,
    ...opencodeTools.flatMap((tool) => [
      { action: tool, resource: "*", effect: "deny" as const },
      ...rulesFor(tool, operatorRules).map((rule) => ({ action: tool, resource: rule.resource, effect: rule.effect === "allow" ? ("allow" as const) : ("deny" as const) })),
    ]),
  ]
}

/** The caller tools that get a seed in the model request (`tool_choice` none offers none, a named tool only that one). */
export function seedToolsFor(request: PlugRequest): ReadonlyArray<PlugTool> {
  const choice = request.toolChoice
  if (choice === "none") return []
  return typeof choice === "object" ? request.tools.filter((tool) => tool.name === choice.name) : request.tools
}
