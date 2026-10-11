/** Model refs and the allowlist/alias policy over a neutral catalog. Protocol-neutral: front-ends format the results. */

import type { PlugboardOptions } from "./config.js"
import type { CatalogModel, ModelRef, PlugError } from "./contract.js"

/** `provider/model[#variant]`. The model id may contain slashes (`openrouter/vendor/model`). */
function parseModelRef(s: string): ModelRef | undefined {
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

function refToString(ref: ModelRef): string {
  return `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`
}

/** `provider/*` any model of the provider; `provider/model` any variant; `provider/model#variant` exactly. */
function allowed(options: PlugboardOptions, ref: ModelRef): boolean {
  return options.models.some((pattern) => {
    if (pattern.endsWith("/*")) return pattern.slice(0, -2) === ref.providerID
    const p = parseModelRef(pattern)
    return p !== undefined && p.providerID === ref.providerID && p.id === ref.id && (p.variant === undefined || p.variant === ref.variant)
  })
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

/** The allowlist intersected with the catalog, plus aliases whose target qualifies. Ids are unique except an alias may repeat one. */
export function listAvailableModels(options: PlugboardOptions, catalog: ReadonlyArray<CatalogModel>): ListedModel[] {
  const entry = (id: string, ref: ModelRef, model: CatalogModel): ListedModel => ({ id, ref, model })
  const data: ListedModel[] = []
  // The catalog can list a model more than once (and repeat variants); ids must be unique.
  const seen = new Set<string>()
  for (const model of catalog) {
    const base = { providerID: model.providerID, id: model.id }
    for (const ref of [base, ...model.variants.map((variant) => ({ ...base, variant }))]) {
      const id = refToString(ref)
      if (seen.has(id) || !allowed(options, ref)) continue
      seen.add(id)
      data.push(entry(id, ref, model))
    }
  }
  for (const [alias, target] of Object.entries(options.aliases)) {
    const ref = parseModelRef(target)
    const model = ref && allowed(options, ref) ? find(catalog, ref) : undefined
    if (ref && model) data.push(entry(alias, ref, model))
  }
  return data
}
