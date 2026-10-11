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

/** JSON value, the shape of session metadata (the host's `Json`). */
export type Json = string | number | boolean | null | ReadonlyArray<Json> | { readonly [key: string]: Json }

/** Promise-shaped view of the host calls the session caller needs (the entry wires them to `ctx.session`). */
export interface SessionPort {
  create(input: {
    readonly directory: string
    readonly model: { readonly providerID: string; readonly id: string; readonly variant?: string }
    readonly title: string
    readonly metadata: { readonly [key: string]: Json }
    readonly permissions: ReadonlyArray<{ action: string; resource: string; effect: "allow" | "deny" }>
  }): Promise<{ id: string }>
  prompt(input: { readonly sessionID: string; readonly text: string; readonly files: ReadonlyArray<{ uri: string; name: string }> }): Promise<unknown>
  interrupt(sessionID: string): Promise<void>
}

type HostSession = HostContext["session"]

/**
 * The host's branded session ID. It is a string with a type-level brand and no runtime form, so
 * the one cast below is the only unchecked step: the ID always comes from the host's own
 * `session.create` result (or an event of that session).
 */
type HostSessionID = Parameters<HostSession["interrupt"]>[0]["sessionID"]
const hostSessionID = (id: string): HostSessionID => id as HostSessionID

type HostCreate = NonNullable<Parameters<HostSession["create"]>[0]>
type HostModelRef = NonNullable<HostCreate["model"]>
type HostDirectory = NonNullable<HostCreate["location"]>["directory"]

/**
 * Branded model ref and directory. Same kind of cast as the session ID: the values are the
 * resolved catalog ref (a model the host listed) and the app directory `ensureAppDir` returned
 * (absolute, inside the data root); the host validates both again at runtime.
 */
const hostModel = (model: { readonly providerID: string; readonly id: string; readonly variant?: string }): HostModelRef => ({
  providerID: model.providerID as HostModelRef["providerID"],
  id: model.id as HostModelRef["id"],
  ...(model.variant ? { variant: model.variant as NonNullable<HostModelRef["variant"]> } : {}),
})
const hostDirectory = (directory: string): HostDirectory => directory as HostDirectory

/**
 * `ctx.session` as a Promise port. Inputs are built as object literals that must `satisfy` the
 * host's own parameter types, so a host upgrade that changes them fails `bunx tsc --noEmit`;
 * the only casts are the branded IDs (session, model, directory), one helper each. The host's effects need no services (it provides them).
 */
export function createSessionPort(ctx: HostContext): SessionPort {
  const run = <A>(effect: Effect.Effect<A, unknown>): Promise<A> => Effect.runPromise(effect)
  return {
    create: (input) =>
      run(
        ctx.session.create({
          model: hostModel(input.model),
          title: input.title,
          metadata: input.metadata,
          permissions: input.permissions,
          location: { directory: hostDirectory(input.directory) },
        } satisfies HostCreate),
      ).then((created) => ({ id: String(created.id) })),
    prompt: (input) =>
      run(
        ctx.session.prompt({
          sessionID: hostSessionID(input.sessionID),
          text: input.text,
          files: input.files,
        } satisfies Parameters<HostSession["prompt"]>[0]),
      ),
    interrupt: (sessionID) =>
      run(ctx.session.interrupt({ sessionID: hostSessionID(sessionID) } satisfies Parameters<HostSession["interrupt"]>[0])).then(() => undefined),
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
