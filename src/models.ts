/** Model refs and the allowlist/alias policy over a neutral catalog. Protocol-neutral: front-ends format the results. */

import { appPolicy, type AppPolicy, type PlugboardOptions } from "./config.js"
import type { CatalogModel, ModelRef, PlugError } from "./contract.js"

/** Alias target prefix that binds a skill: `skill:<id>@provider/model[#variant]` (see `parseAliasTarget`). */
export const SKILL_PREFIX = "skill:"
/** Listed id prefix of an agent (option `agents`): `agent/<name>`. Aliases cannot contain `/`, so the two never collide. */
export const AGENT_PREFIX = "agent/"
const SKILL_TARGET = /^skill:([^@\s#*/]+)@([^@/#*\s]+\/[^@#*\s]+(#[^#*\s]+)?)$/

/** `provider/model[#variant]`. The model id may contain slashes (`openrouter/vendor/model`). */
export function parseModelRef(s: string): ModelRef | undefined {
  if (typeof s !== "string") return undefined
  const slash = s.indexOf("/")
  if (slash <= 0) return undefined
  const hash = s.indexOf("#", slash + 1)
  const id = s.slice(slash + 1, hash === -1 ? undefined : hash)
  const variant = hash === -1 ? undefined : s.slice(hash + 1)
  if (!id || s.slice(0, slash).includes("#")) return undefined
  if (variant !== undefined && (!variant || variant.includes("#"))) return undefined
  return { providerID: s.slice(0, slash), id, ...(variant ? { variant } : {}) }
}

export function refToString(ref: ModelRef): string {
  return `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`
}

/**
 * A UI-safe spelling of a canonical id: `/` becomes `--` and `#` becomes `__`, so some chat UIs that mangle
 * `/` and `#` keep it intact. `anthropic/claude-haiku-4-5#high` -> `anthropic--claude-haiku-4-5__high`.
 */
export function toSlug(id: string): string {
  return id.replaceAll("/", "--").replaceAll("#", "__")
}

/**
 * The canonical id a slug stands for, or undefined when `slug` is not one. The first `--` ends the provider, the
 * first `__` starts the variant; a `--` inside the model id is read back as `/`. Ids where that does not round
 * trip are not listed as slugs (see `listAvailableModels`), so they are never offered and never resolved this way.
 */
export function fromSlug(slug: string): string | undefined {
  if (typeof slug !== "string" || /[\s/#*]/.test(slug)) return undefined
  const sep = slug.indexOf("--")
  if (sep <= 0) return undefined
  const providerID = slug.slice(0, sep)
  const rest = slug.slice(sep + 2)
  const at = rest.indexOf("__")
  const model = (at === -1 ? rest : rest.slice(0, at)).replaceAll("--", "/")
  const variant = at === -1 ? undefined : rest.slice(at + 2)
  if (variant !== undefined && (!variant || variant.includes("__"))) return undefined
  const id = refToString({ providerID, id: model, ...(variant === undefined ? {} : { variant }) })
  return parseModelRef(id) ? id : undefined
}

/** `provider/*` any model of the provider; `provider/model` any variant; `provider/model#variant` exactly. */
export function allowedBy(models: ReadonlyArray<string>, ref: ModelRef): boolean {
  return models.some((pattern) => {
    if (pattern.endsWith("/*")) return pattern.slice(0, -2) === ref.providerID
    const p = parseModelRef(pattern)
    return p !== undefined && p.providerID === ref.providerID && p.id === ref.id && (p.variant === undefined || p.variant === ref.variant)
  })
}

const allowed = (options: PlugboardOptions, ref: ModelRef): boolean => allowedBy(options.models, ref)

/** An alias target as written in `aliases`: `provider/model[#variant]`, or `skill:<id>@` in front of one. */
export interface AliasTarget {
  readonly ref: ModelRef
  /** The skill the alias binds, for a `skill:` target. */
  readonly skill?: string
}

/** The model (and skill) an alias target names, or undefined when it is neither form. */
export function parseAliasTarget(target: string): AliasTarget | undefined {
  if (!target.startsWith(SKILL_PREFIX)) {
    const ref = parseModelRef(target)
    return ref === undefined ? undefined : { ref }
  }
  const match = SKILL_TARGET.exec(target)
  const ref = match ? parseModelRef(match[2]!) : undefined
  return match && ref ? { ref, skill: match[1]! } : undefined
}

/**
 * What a request name stands for, beyond a plain model: a skill alias (its skill id) or an agent (its name
 * in option `agents`). Undefined for plain model ids and plain aliases. The caller reads it to add the
 * skill's content or the agent's system prompt to the session.
 */
export type Persona = { readonly kind: "skill"; readonly skill: string } | { readonly kind: "agent"; readonly agent: string }

export function personaOf(options: Pick<PlugboardOptions, "aliases" | "agents">, name: string): Persona | undefined {
  const target = own(options.aliases, name)
  if (target !== undefined) {
    const skill = parseAliasTarget(target)?.skill
    return skill === undefined ? undefined : { kind: "skill", skill }
  }
  if (!name.startsWith(AGENT_PREFIX)) return undefined
  const agent = name.slice(AGENT_PREFIX.length)
  return Object.hasOwn(options.agents, agent) ? { kind: "agent", agent } : undefined
}

/**
 * Per-app narrowing (`apps.<name>.models`), applied on top of the global allowlist, never instead of it.
 * `name` is what the caller sent (an alias or a model id). An entry that is an alias name admits that
 * name; a pattern entry admits every resolved model it matches, whichever name reached it. No `models`
 * on the app means no narrowing. Alias names never match as patterns: they are not `provider/model` shaped.
 */
function inAppScope(policy: AppPolicy | undefined, name: string, ref: ModelRef): boolean {
  return policy?.models === undefined || policy.models.includes(name) || allowedBy(policy.models, ref)
}

/** 404 `model_not_found` when `app` may not use the (already resolved) model; the same error as an unknown model. */
export function checkAppModel(policy: AppPolicy | undefined, name: string, ref: ModelRef): PlugError | undefined {
  if (inAppScope(policy, name, ref)) return undefined
  return { status: 404, message: `Model ${name} is not available`, kind: "not_found", code: "model_not_found", param: "model" }
}

function find(catalog: ReadonlyArray<CatalogModel>, ref: ModelRef): CatalogModel | undefined {
  const model = catalog.find((m) => m.providerID === ref.providerID && m.id === ref.id)
  return model && (ref.variant === undefined || model.variants.includes(ref.variant)) ? model : undefined
}

function own(map: Readonly<Record<string, string>>, key: string): string | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined
}

/**
 * Alias or `provider/model[#variant]` -> ModelRef. `reasoningEffort` picks the variant of that name when the
 * ref has none and the model offers it. Errors: 403 when nothing is allowed, 404 for unknown/not-allowed models.
 */
export function resolveModel(
  options: PlugboardOptions,
  model: string,
  catalog: ReadonlyArray<CatalogModel>,
  reasoningEffort?: string,
): ModelRef | PlugError {
  if (options.models.length === 0)
    return {
      status: 403,
      message: "No models are allowed: set the plugboard `models` option",
      kind: "permission",
      code: "no_models_configured",
    }
  const notAvailable: PlugError = {
    status: 404,
    message: `Model ${model} is not available`,
    kind: "not_found",
    code: "model_not_found",
    param: "model",
  }
  // Aliases keep priority over slugs; a slug and a canonical id both resolve, whatever `modelIds` lists.
  // An agent runs on the model its `agents` entry names (the allowlist still applies below).
  const target = own(options.aliases, model)
  const persona = personaOf(options, model)
  let ref =
    target !== undefined
      ? parseAliasTarget(target)?.ref
      : persona?.kind === "agent"
        ? parseModelRef(options.agents[persona.agent]!)
        : parseModelRef(fromSlug(model) ?? model)
  if (!ref) return notAvailable
  if (!ref.variant && reasoningEffort && find(catalog, { ...ref, variant: reasoningEffort }))
    ref = { ...ref, variant: reasoningEffort }
  return allowed(options, ref) && find(catalog, ref) ? ref : notAvailable
}

/** One servable model id: a catalog id (`provider/model[#variant]`) or an alias, with the catalog model behind it. */
export interface ListedModel {
  readonly id: string
  readonly ref: ModelRef
  readonly model: CatalogModel
  /** The skill an alias binds (`skill:` target), listed as `plugboard.skill`. */
  readonly skill?: string
  /** The agent an `agent/<name>` id runs, listed as `plugboard.agent`. */
  readonly agent?: string
}

/**
 * The allowlist intersected with the catalog, plus aliases whose target qualifies. Ids are unique except an alias may repeat one.
 * Each model is listed as its canonical id, its slug, or both, per `options.modelIds`; a model whose slug does not
 * round trip (see `fromSlug`) is left out in `slugs` mode. Aliases are listed as they are.
 * With `app`, the list is narrowed to that app's `models` (see `inAppScope`), judged on the canonical id.
 */
export function listAvailableModels(options: PlugboardOptions, catalog: ReadonlyArray<CatalogModel>, app?: string): ListedModel[] {
  const policy = app === undefined ? undefined : appPolicy(options, app)
  const entry = (id: string, ref: ModelRef, model: CatalogModel): ListedModel => ({ id, ref, model })
  const data: ListedModel[] = []
  // The catalog can list a model more than once (and repeat variants); ids must be unique.
  const seen = new Set<string>()
  for (const model of catalog) {
    const base = { providerID: model.providerID, id: model.id }
    for (const ref of [base, ...model.variants.map((variant) => ({ ...base, variant }))]) {
      const id = refToString(ref)
      if (seen.has(id) || !allowed(options, ref) || !inAppScope(policy, id, ref)) continue
      seen.add(id)
      if (options.modelIds !== "slugs") data.push(entry(id, ref, model))
      const slug = toSlug(id)
      if (options.modelIds !== "canonical" && fromSlug(slug) === id) data.push(entry(slug, ref, model))
    }
  }
  for (const [alias, target] of Object.entries(options.aliases)) {
    const parsed = parseAliasTarget(target)
    const ref = parsed?.ref
    const model = ref && allowed(options, ref) && inAppScope(policy, alias, ref) ? find(catalog, ref) : undefined
    if (ref && model) data.push({ ...entry(alias, ref, model), ...(parsed.skill === undefined ? {} : { skill: parsed.skill }) })
  }
  for (const [name, target] of Object.entries(options.agents)) {
    const id = `${AGENT_PREFIX}${name}`
    const ref = parseModelRef(target)
    const model = ref && allowed(options, ref) && inAppScope(policy, id, ref) ? find(catalog, ref) : undefined
    if (ref && model) data.push({ ...entry(id, ref, model), agent: name })
  }
  return data
}

/** Capabilities `GET /v1/models?capability=` can filter on: the flags the catalog reports (`CatalogModel.capabilities`). */
export type Capability = "vision" | "tools"

const CAPABILITY_FLAG: Readonly<Record<Capability, "image" | "tools">> = { vision: "image", tools: "tools" }

/** The capability a query value names, or undefined for anything else (`json` has no catalog flag, so it is not one). */
export function parseCapability(value: string): Capability | undefined {
  return Object.hasOwn(CAPABILITY_FLAG, value) ? (value as Capability) : undefined
}

/** The listed models whose catalog entry sets that capability flag to true. Order is kept. */
export function filterByCapability(models: ReadonlyArray<ListedModel>, capability: Capability): ListedModel[] {
  const flag = CAPABILITY_FLAG[capability]
  return models.filter(({ model }) => model.capabilities?.[flag] === true)
}

/**
 * The targets an alias falls back to, in order: the fallbacks that are allowed and enabled on the server.
 * Empty for a plain model id or an alias without fallbacks. The primary target is `resolveModel`'s answer.
 * With `app`, a target outside that app's `models` is skipped (an app scoped to the alias name admits every target).
 */
export function fallbackRefs(options: PlugboardOptions, alias: string, catalog: ReadonlyArray<CatalogModel>, app?: string): ModelRef[] {
  const policy = app === undefined ? undefined : appPolicy(options, app)
  const targets = Object.hasOwn(options.fallbacks, alias) ? options.fallbacks[alias]! : []
  const refs: ModelRef[] = []
  for (const target of targets) {
    const ref = parseModelRef(target)
    if (ref && allowed(options, ref) && inAppScope(policy, alias, ref) && find(catalog, ref)) refs.push(ref)
  }
  return refs
}
