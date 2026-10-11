/**
 * The host adapter: the one place that touches OpenCode's Effect plugin API on behalf of the
 * session code. It turns `ctx.session` into the Promise-shaped `SessionPort`, `ctx.model.list`
 * into a neutral catalog, and defines the narrow shapes the session code reads from the host (the
 * `context` hook event, the flat bus-event record).
 *
 * Pinned to the OpenCode version in docs/architecture.md. Beyond `Effect.runPromise` this module
 * only imports host types; no module under `session/` imports `@opencode/ai` or core internals at
 * runtime.
 */

import type { Plugin } from "@opencode/plugin/effect"
import type { SessionContext } from "@opencode/plugin/effect/session"
import { Effect } from "effect"
import type { CatalogModel } from "../contract.js"

export type HostContext = Plugin.Context
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

/**
 * `ctx.session` as a Promise port. The host's Effect types carry branded IDs and an
 * unconstrained requirements parameter that the structural `SessionPort` does not model, so the
 * cast sites below are the only places that erase them. Invariant at every site: the input is the
 * shape the host's own method takes (checked by the host at runtime), and the effect needs no
 * services (the host provides them).
 */
export function createSessionPort(ctx: HostContext): SessionPort {
  const run = <A>(effect: Effect.Effect<A, unknown, unknown>): Promise<A> => Effect.runPromise(effect as Effect.Effect<A>)
  return {
    create: (input) =>
      run(
        ctx.session.create({
          model: input.model,
          title: input.title,
          metadata: input.metadata,
          permissions: input.permissions,
          location: { directory: input.directory },
        } as Parameters<HostContext["session"]["create"]>[0]),
      ) as Promise<{ id: string }>,
    prompt: (input) => run(ctx.session.prompt(input as Parameters<HostContext["session"]["prompt"]>[0])),
    interrupt: (sessionID) =>
      run(ctx.session.interrupt({ sessionID } as Parameters<HostContext["session"]["interrupt"]>[0])).then(() => undefined),
  }
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined

/**
 * Reduces `ctx.model.list` data (V2 `Model.Info`, tolerant of missing fields) to the catalog.
 * Models with `enabled: false` are dropped; `modelID` wins over `id`; variants may be `{ id }` or strings.
 */
function toCatalog(raw: ReadonlyArray<unknown>): CatalogModel[] {
  const catalog: CatalogModel[] = []
  for (const item of raw) {
    const model = record(item)
    if (!model || model.enabled === false) continue
    const providerID = model.providerID
    const id = model.modelID ?? model.id
    if (typeof providerID !== "string" || typeof id !== "string" || !providerID || !id) continue
    const variants = (Array.isArray(model.variants) ? model.variants : [])
      .map((v) => (typeof v === "string" ? v : record(v)?.id))
      .filter((v): v is string => typeof v === "string" && v.length > 0)
    const caps = record(model.capabilities)
    const input = caps && Array.isArray(caps.input) ? caps.input : undefined
    const context = record(model.limit)?.context
    catalog.push({
      providerID,
      id,
      ...(typeof model.name === "string" ? { name: model.name } : {}),
      variants: [...new Set(variants)],
      ...(caps
        ? {
            capabilities: {
              ...(typeof caps.tools === "boolean" ? { tools: caps.tools } : {}),
              ...(input ? { image: input.includes("image") } : {}),
            },
          }
        : {}),
      ...(typeof context === "number" ? { contextLimit: context } : {}),
    })
  }
  return catalog
}

/** The serving Location's enabled models, as the neutral catalog. */
export async function loadCatalog(ctx: HostContext): Promise<ReadonlyArray<CatalogModel>> {
  const listed = await Effect.runPromise(ctx.model.list({}))
  return toCatalog(listed.data ?? [])
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

/** A flattened bus event: `{ type, ...data }` as routed by the process-wide session store. */
export type BusEvent = Record<string, unknown>

/** Short readable text for an unknown thrown value. */
export const describeError = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message
  const text = String(error)
  return text.length > 400 ? text.slice(0, 400) + "…" : text
}
