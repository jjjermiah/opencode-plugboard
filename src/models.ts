/** Model refs and the allowlist/alias policy over a neutral catalog. Protocol-neutral: front-ends format the results. */

import { appPolicy, type AppPolicy, type PlugboardOptions } from "./config.js"
import type { CatalogModel, ModelRef, PlugError } from "./contract.js"

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

/** `provider/*` any model of the provider; `provider/model` any variant; `provider/model#variant` exactly. */
export function allowedBy(models: ReadonlyArray<string>, ref: ModelRef): boolean {
  return models.some((pattern) => {
    if (pattern.endsWith("/*")) return pattern.slice(0, -2) === ref.providerID
    const p = parseModelRef(pattern)
    return p !== undefined && p.providerID === ref.providerID && p.id === ref.id && (p.variant === undefined || p.variant === ref.variant)
  })
}

const allowed = (options: PlugboardOptions, ref: ModelRef): boolean => allowedBy(options.models, ref)

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
  let ref = parseModelRef(own(options.aliases, model) ?? model)
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
}

/**
 * The allowlist intersected with the catalog, plus aliases whose target qualifies. Ids are unique except an alias may repeat one.
 * With `app`, the list is narrowed to that app's `models` (see `inAppScope`).
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
      data.push(entry(id, ref, model))
    }
  }
  for (const [alias, target] of Object.entries(options.aliases)) {
    const ref = parseModelRef(target)
    const model = ref && allowed(options, ref) && inAppScope(policy, alias, ref) ? find(catalog, ref) : undefined
    if (ref && model) data.push(entry(alias, ref, model))
  }
  return data
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
