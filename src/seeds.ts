/**
 * Placeholder tools.
 *
 * OpenCode's `session.hook("context")` may only advertise tool definitions that
 * correspond to a *registered* Tool.Info (unmatched entries are dropped), so an
 * adapter that wants to send caller-supplied tools must own a pool of registered
 * seeds and re-key them in the hook: the caller's name becomes the map key (what
 * the provider sees), while the seed keeps its own `name` (what the executor
 * dispatches on).
 *
 * A seed's `execute` never returns. Measured on 2.0.26: failing it (even with a typed
 * non-`Tool.Error`) is converted to a normal tool failure, so the turn continues with a
 * second model step (11 steps in 8 s on glm-5.3-flash). The documented decline path
 * (`Permission.DeclinedError`) is only reachable from inside host tools. So the seed
 * blocks, and the adapter stops the turn itself by interrupting the session as soon as
 * the model stream has finished (`session.step.streamed`); the captured
 * `session.tool.called` events are what an OpenAI `tool_calls` response needs.
 */

export const SEED_PREFIX = "oa_seed_"
export const SEED_COUNT = 16
