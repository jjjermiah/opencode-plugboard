/** Core: resolve `provider/model[#variant]` against the Location's model catalog. */

export interface ModelRef {
  readonly providerID: string
  readonly id: string
  readonly variant?: string
}

export function parseModelRef(input: unknown): ModelRef | undefined {
  if (typeof input !== "string" || input.length === 0) return undefined
  const hash = input.indexOf("#")
  const head = hash === -1 ? input : input.slice(0, hash)
  const variant = hash === -1 ? undefined : input.slice(hash + 1)
  const slash = head.indexOf("/")
  if (slash <= 0 || slash === head.length - 1) return undefined
  return {
    providerID: head.slice(0, slash),
    id: head.slice(slash + 1),
    ...(variant ? { variant } : {}),
  }
}

export interface CatalogModel {
  readonly id?: string
  readonly modelID?: string
  readonly providerID?: string
  readonly name?: string
  readonly variants?: ReadonlyArray<{ readonly id?: string }>
}

/** Flattens the V2 catalog into the OpenAI `/v1/models` list, variants as `provider/model#variant`. */
export function toOpenAIModels(models: ReadonlyArray<CatalogModel>) {
  const data: Array<Record<string, unknown>> = []
  for (const model of models) {
    const providerID = String(model.providerID ?? "")
    const id = String(model.modelID ?? model.id ?? "")
    if (!providerID || !id) continue
    const base = `${providerID}/${id}`
    data.push({ id: base, object: "model", created: 0, owned_by: providerID })
    for (const variant of model.variants ?? []) {
      if (!variant?.id) continue
      data.push({ id: `${base}#${variant.id}`, object: "model", created: 0, owned_by: providerID })
    }
  }
  return data
}

export function refToString(ref: ModelRef) {
  return `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`
}
