/**
 * Seed tools.
 *
 * OpenCode's `session.hook("context")` may only advertise tool definitions that
 * correspond to a *registered* Tool.Info (unmatched entries are dropped), so plugboard owns a
 * pool of registered seeds (`maxTools` of them, spec D22) and re-keys them in the hook:
 * the caller's name becomes the map key (what the provider sees), while the seed keeps its
 * own `name` (what the executor dispatches on).
 *
 * A seed's `execute` never returns. Measured on 2.0.26: failing it (even with a typed
 * non-`Tool.Error`) is converted to a normal tool failure, so the turn continues with a
 * second model step (11 steps in 8 s on glm-5.3-flash). The documented decline path
 * (`Permission.DeclinedError`) is only reachable from inside host tools. So the seed
 * blocks, and plugboard stops the turn itself by interrupting the session as soon as
 * the model stream has finished (`session.step.streamed`); the captured
 * `session.tool.called` events are what a `tool_calls` response needs.
 *
 * Seeds are registered only inside the plugboard data root (D17), denied to every agent there,
 * and allowed again by the permissions of plugboard's own request sessions (R10).
 */

export const SEED_PREFIX = "plugboard_seed_"
