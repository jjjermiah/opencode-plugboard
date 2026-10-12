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
import type { CatalogCost, CatalogModel } from "../contract.js"
import type { OperatorRule } from "./seeds.js"

export type HostContext = Plugin.Context

/**
 * A child session's parent (the anchor, `promptCache`) no longer exists: it was deleted in OpenCode, so the host failed with
 * `Session.NotFoundError` (packages/core/src/session.ts, the `parentID` check). The caller recreates the anchor once.
 */
export class MissingParentError extends Error {
  constructor() {
    super("The anchor session of this request no longer exists")
    this.name = "MissingParentError"
  }
}

/** JSON value, the shape of session metadata (the host's `Json`). */
export type Json = string | number | boolean | null | ReadonlyArray<Json> | { readonly [key: string]: Json }

/** Promise-shaped view of the host calls the session caller needs (the entry wires them to `ctx.session`). */
export interface SessionPort {
  create(input: {
    readonly directory: string
    readonly model: { readonly providerID: string; readonly id: string; readonly variant?: string }
    /** The OpenCode agent the session runs as (option `agents`); absent: the host's default agent. */
    readonly agent?: string
    readonly title: string
    readonly metadata: { readonly [key: string]: Json }
    readonly permissions: ReadonlyArray<{ action: string; resource: string; effect: "allow" | "deny" }>
    /** The anchor session this one is a child of (`promptCache` affinity `anchor`). A child takes its parent's location, so `directory` is not sent. */
    readonly parentID?: string
  }): Promise<{ id: string }>
  prompt(input: { readonly sessionID: string; readonly text: string; readonly files: ReadonlyArray<{ uri: string; name: string }> }): Promise<unknown>
  interrupt(sessionID: string): Promise<void>
  /** Deletes a host session. Used only for a session that was created after its request was aborted (#155). */
  remove(sessionID: string): Promise<void>
  /** The content of skill `id` in the Location at `directory`, or undefined when there is none. Briefly cached per directory. */
  skill(directory: string, id: string): Promise<string | undefined>
  /** The agent `id` in the Location at `directory` (its `system` prompt may be absent), or undefined when there is none. */
  agent(directory: string, id: string): Promise<{ readonly system?: string } | undefined>
  /**
   * The ids of the OpenCode tools this location offers directly to a model (`codemode: false`), the only
   * ones a request session can call by name. CodeMode-wrapped tools are reached through `execute`, which a
   * request session denies, so they are not listed. A tool whose permission name differs from its id is
   * not listed either: the session's permission rules are written by id.
   */
  directTools(): Promise<ReadonlyArray<string>>
  /**
   * The permission rules of the agent a request session runs as: `agent`, or the host's selected default when absent
   * (the first selectable agent of the list). Undefined when there is no such agent. Read per request for an app with
   * `serverTools` (#194), never at setup.
   */
  agentRules(directory: string, agent: string | undefined): Promise<ReadonlyArray<OperatorRule> | undefined>
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
type HostAgent = NonNullable<HostCreate["agent"]>

/** How long a directory's skill list is reused: a skill edit is seen within this window (per plugin generation). */
const SKILL_CACHE_MS = 30_000

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
  const skillsByDirectory = new Map<string, { readonly at: number; readonly skills: ReadonlyMap<string, string> }>()
  return {
    create: (input) =>
      (input.parentID === undefined
        ? run(
            ctx.session.create({
              model: hostModel(input.model),
              ...(input.agent === undefined ? {} : { agent: input.agent as HostAgent }),
              title: input.title,
              metadata: input.metadata,
              permissions: input.permissions,
              location: { directory: hostDirectory(input.directory) },
            } satisfies HostCreate),
          )
        : childOrMissing(
            ctx.session.create({
              model: hostModel(input.model),
              title: input.title,
              metadata: input.metadata,
              permissions: input.permissions,
              parentID: input.parentID as NonNullable<HostCreate["parentID"]>,
            } satisfies HostCreate),
          )
      ).then((created) => ({ id: String(created.id) })),
    skill: async (directory, id) => {
      const now = Date.now()
      let held = skillsByDirectory.get(directory)
      if (held === undefined || now - held.at >= SKILL_CACHE_MS) {
        const listed = await run(ctx.skill.list({ location: { directory } }))
        held = { at: now, skills: new Map(listed.data.map((skill): [string, string] => [skill.id, skill.content])) }
        skillsByDirectory.set(directory, held)
      }
      return held.skills.get(id)
    },
    agent: async (directory, id) => {
      const listed = await run(ctx.agent.list({ location: { directory } }))
      return listed.data.find((agent) => agent.id === id)
    },
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
    remove: (sessionID) => run(ctx.session.remove({ sessionID: hostSessionID(sessionID) } satisfies Parameters<HostSession["remove"]>[0])).then(() => undefined),
    agentRules: async (directory, id) => {
      const listed = await run(ctx.agent.list({ location: { directory } }))
      const agent = id === undefined ? listed.data.find((item) => item.mode !== "subagent" && !item.hidden) : listed.data.find((item) => item.id === id)
      return agent?.permissions.map((rule) => ({ action: rule.action, resource: rule.resource, effect: rule.effect }))
    },
    directTools: () =>
      run(ctx.tool.list()).then((tools) =>
        tools.filter((tool) => tool.options?.codemode === false && (tool.options?.permission ?? tool.id) === tool.id).map((tool) => tool.id),
      ),
  }
}

/**
 * What the history index needs from the host: the plugin's own key-value storage (`ctx.storage`,
 * namespaced by plugin id and shared by every Location of the server) and `session.remove`. The
 * plugin session API has no `list`, so plugboard indexes its own request sessions in that storage
 * and prunes from the index (src/session/prune.ts).
 */
export interface HistoryPort {
  put(key: string, value: string): Promise<void>
  drop(key: string): Promise<void>
  /** Keys under `prefix` in ascending order, after `after` (exclusive); `next` is set when more remain. */
  scan(input: { readonly prefix: string; readonly after?: string; readonly limit: number }): Promise<{ readonly keys: ReadonlyArray<string>; readonly next?: string }>
  /** `missing` when the session no longer exists (the host's `Session.NotFoundError`); any other failure rejects. */
  removeSession(sessionID: string): Promise<"removed" | "missing">
}

const failureTag = (error: unknown): unknown => (typeof error === "object" && error !== null ? (error as { _tag?: unknown })._tag : undefined)

/**
 * Runs an effect whose failure is a missing parent (`Session.NotFoundError`) as `MissingParentError`. The failure is
 * captured as a value first, so the promise rejects with the typed error and not with the runtime's wrapper.
 */
const childOrMissing = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.match({ onSuccess: (value) => ({ failed: false as const, value }), onFailure: (error) => ({ failed: true as const, error }) }),
    ),
  ).then((result) => {
    if (!result.failed) return result.value
    throw failureTag(result.error) === "Session.NotFoundError" ? new MissingParentError() : result.error
  })

/** `ctx.storage` and `ctx.session.remove` as a Promise port. The branded session ID is the same host-issued string as above. */
export function createHistoryPort(ctx: HostContext): HistoryPort {
  return {
    put: (key, value) => Effect.runPromise(ctx.storage.set(key, value)),
    drop: (key) => Effect.runPromise(ctx.storage.remove(key)),
    scan: (input) =>
      Effect.runPromise(ctx.storage.scan(input)).then((result) => ({
        keys: result.entries.map((entry) => entry.key),
        ...(result.next === undefined ? {} : { next: result.next }),
      })),
    removeSession: (sessionID) =>
      Effect.runPromise(
        ctx.session.remove({ sessionID: hostSessionID(sessionID) } satisfies Parameters<HostSession["remove"]>[0]).pipe(
          Effect.match({ onSuccess: () => undefined, onFailure: (error) => ({ error }) }),
        ),
      ).then((failed) => {
        if (failed === undefined) return "removed" as const
        if (failureTag(failed.error) === "Session.NotFoundError") return "missing" as const
        throw failed.error
      }),
  }
}

/**
 * `ctx.storage` as a Promise port for string values (the usage store keeps one JSON string per app
 * and day). Same host table and namespace as `HistoryPort`; the keys never overlap (`usage/` vs `history/`).
 */
export interface StoragePort {
  get(key: string): Promise<string | undefined>
  put(key: string, value: string): Promise<void>
  drop(key: string): Promise<void>
  scan(input: { readonly prefix: string; readonly after?: string; readonly limit: number }): Promise<{ readonly keys: ReadonlyArray<string>; readonly next?: string }>
}

export function createStoragePort(ctx: HostContext): StoragePort {
  return {
    get: (key) => Effect.runPromise(ctx.storage.get(key)).then((value) => (typeof value === "string" ? value : undefined)),
    put: (key, value) => Effect.runPromise(ctx.storage.set(key, value)),
    drop: (key) => Effect.runPromise(ctx.storage.remove(key)),
    scan: (input) =>
      Effect.runPromise(ctx.storage.scan(input)).then((result) => ({
        keys: result.entries.map((entry) => entry.key),
        ...(result.next === undefined ? {} : { next: result.next }),
      })),
  }
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined

const finite = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined)
const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined
const STATUSES = new Set(["alpha", "beta", "deprecated", "active"])

/** Host `Model.Cost[]` (USD per million tokens, optional context tier) -> neutral price entries; malformed entries are skipped. */
function toCosts(raw: unknown): CatalogCost[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const costs: CatalogCost[] = []
  for (const item of raw) {
    const cost = record(item)
    const input = finite(cost?.input)
    const output = finite(cost?.output)
    if (!cost || input === undefined || output === undefined) continue
    const cache = record(cost.cache)
    const tier = record(cost.tier)
    const size = tier?.type === "context" ? finite(tier.size) : undefined
    costs.push({
      input,
      output,
      cacheRead: finite(cache?.read) ?? 0,
      cacheWrite: finite(cache?.write) ?? 0,
      ...(size === undefined ? {} : { aboveContext: size }),
    })
  }
  return costs
}

/**
 * Reduces `ctx.model.list` data (V2 `Model.Info`, tolerant of missing fields) to the catalog.
 * Models with `enabled: false` are dropped; `modelID` wins over `id`; variants may be `{ id }` or strings.
 * Cost, limits, modalities, status, family and release date are carried as the host reports them
 * (`Model.Info`, packages/schema/src/model.ts); anything absent or malformed is left out.
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
    const limit = record(model.limit)
    const context = limit?.context
    const limits = { context: finite(limit?.context), input: finite(limit?.input), output: finite(limit?.output) }
    const modalityIn = strings(caps?.input)
    const modalityOut = strings(caps?.output)
    const cost = toCosts(model.cost)
    const released = finite(record(model.time)?.released)
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
      ...(limits.context !== undefined || limits.input !== undefined || limits.output !== undefined
        ? { limits: Object.fromEntries(Object.entries(limits).filter(([, value]) => value !== undefined)) }
        : {}),
      ...(modalityIn || modalityOut ? { modalities: { input: modalityIn ?? [], output: modalityOut ?? [] } } : {}),
      ...(cost && cost.length > 0 ? { cost } : {}),
      ...(typeof model.status === "string" && STATUSES.has(model.status) ? { status: model.status as NonNullable<CatalogModel["status"]> } : {}),
      ...(typeof model.family === "string" && model.family ? { family: model.family } : {}),
      ...(released !== undefined ? { released } : {}),
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
