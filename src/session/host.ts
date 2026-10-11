/**
 * The narrow view of the OpenCode host that the session code depends on: the Promise-shaped
 * session port, the shape of the `context` hook event, and the flat bus-event record.
 *
 * Everything here is type-only except `describeError`. The entry (`index.ts`) wires
 * `SessionPort` to `ctx.session`; no module under `session/` imports `@opencode/ai` or core
 * internals at runtime.
 */

import type { SessionContext } from "@opencode/plugin/effect/session"

/** Promise-shaped view of the host calls the session caller needs (the entry wires them to `ctx.session`). */
export interface SessionPort {
  create(input: {
    readonly directory: string
    readonly model: { readonly providerID: string; readonly id: string; readonly variant?: string }
    readonly title: string
    readonly metadata: Record<string, unknown>
    readonly permissions: ReadonlyArray<{ action: string; resource: string; effect: "allow" | "deny" }>
  }): Promise<{ id: string }>
  prompt(input: { readonly sessionID: string; readonly text: string; readonly files: ReadonlyArray<{ uri: string; name: string }> }): Promise<unknown>
  interrupt(sessionID: string): Promise<void>
}

/** One part of a host message. Media parts carry host-built Assets that plugboard passes through untouched. */
export interface HostPart {
  readonly type: string
  readonly [key: string]: unknown
}

/** A tool descriptor as the `context` hook exposes it. Plugboard rewrites it in place (see `context.ts`). */
export interface HostToolDescriptor {
  description: string
  input: unknown
}

/**
 * The parts of the `session.hook("context")` event plugboard reads and writes. The host passes
 * its mutable `SessionContext`; assigning to these fields is how the hook replaces the model
 * request. Fields plugboard treats defensively are optional here.
 */
export interface ContextHookEvent {
  readonly sessionID: string
  system: unknown[]
  messages?: Array<{ content?: unknown }>
  options?: Record<string, unknown>
  tools?: Record<string, HostToolDescriptor>
}

// Compile-time gate: fails to build when the pinned host's `SessionContext` stops being usable as a `ContextHookEvent`.
type Assert<T extends true> = T
export type HostContextMatches = Assert<SessionContext extends ContextHookEvent ? true : false>

/** A flattened bus event: `{ type, ...data }` as routed by the process-wide registry. */
export type BusEvent = Record<string, unknown>

/** Short readable text for an unknown thrown value. */
export const describeError = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message
  const text = String(error)
  return text.length > 400 ? text.slice(0, 400) + "…" : text
}
