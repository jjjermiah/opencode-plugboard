/** Core: model refs, catalog, allowlist, aliases and `/v1/models` (D9, D14, R2). */

import type { CatalogModel, ModelRef, PlugError, PlugboardOptions } from "./contract.ts"

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

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined

/**
 * Reduces `ctx.model.list` data (V2 `Model.Info`, tolerant of missing fields) to the catalog.
 * Models with `enabled: false` are dropped; `modelID` wins over `id`; variants may be `{ id }` or strings.
 */
export function toCatalog(raw: unknown[]): CatalogModel[] {
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

/** D14: `provider/*` any model of the provider; `provider/model` any variant; `provider/model#variant` exactly. */
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
      type: "permission_error",
      code: "no_models_configured",
    }
  const notAvailable: PlugError = {
    status: 404,
    message: `Model ${model} is not available`,
    type: "not_found_error",
    code: "model_not_found",
    param: "model",
  }
  let ref = parseModelRef(own(options.aliases, model) ?? model)
  if (!ref) return notAvailable
  if (!ref.variant && reasoningEffort && find(catalog, { ...ref, variant: reasoningEffort }))
    ref = { ...ref, variant: reasoningEffort }
  return allowed(options, ref) && find(catalog, ref) ? ref : notAvailable
}

/** R2: OpenAI model objects for the allowlist intersected with the catalog, plus aliases whose target qualifies. */
export function listModels(options: PlugboardOptions, catalog: ReadonlyArray<CatalogModel>): object[] {
  const entry = (id: string, ref: ModelRef, model: CatalogModel) => ({
    id,
    object: "model",
    created: 0,
    owned_by: ref.providerID,
    plugboard: { capabilities: model.capabilities ?? {}, contextLimit: model.contextLimit },
  })
  const data: object[] = []
  for (const model of catalog) {
    const base = { providerID: model.providerID, id: model.id }
    for (const ref of [base, ...model.variants.map((variant) => ({ ...base, variant }))])
      if (allowed(options, ref)) data.push(entry(refToString(ref), ref, model))
  }
  for (const [alias, target] of Object.entries(options.aliases)) {
    const ref = parseModelRef(target)
    const model = ref && allowed(options, ref) ? find(catalog, ref) : undefined
    if (ref && model) data.push(entry(alias, ref, model))
  }
  return data
}
