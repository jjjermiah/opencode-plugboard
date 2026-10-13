#!/usr/bin/env bun
/**
 * Prints the OpenCode client `models` block for a plugboard hub (#376): one entry per id from the
 * hub's `GET /v1/models`, with `limit` (context and output tokens) and `cost` (USD per million
 * tokens, the unit OpenCode uses). Paste it under `provider.<name>` in the client's config.
 *
 *   PLUGBOARD_KEY=<app key> bun .github/scripts/opencode-models.ts http://127.0.0.1:4010
 *
 * Input is the hub's `context_length`, `max_output_tokens`, `plugboard.limit.input` and `pricing` (USD per
 * token, decimal strings). Ids with a `#variant` suffix are skipped; the base id is listed on its own. Context tiers (`aboveContext` in `plugboard.cost`) become OpenCode cost entries with a
 * `tier`. A fact the hub does not list is left out: no entry gets a made-up limit or price.
 */

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)
const finite = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

/** A price string in USD per token (`"0.000003"`) as USD per million tokens. */
const perMillion = (value: unknown): number | undefined => {
  if (typeof value !== "string" && typeof value !== "number") return undefined
  const perToken = Number(value)
  return Number.isFinite(perToken) ? Number((perToken * 1_000_000).toPrecision(12)) : undefined
}

/** `{ read, write }` with only the known prices; undefined when neither is known. */
const cacheOf = (read: number | undefined, write: number | undefined): Json | undefined => {
  const cache: Json = {}
  if (read !== undefined) cache.read = read
  if (write !== undefined) cache.write = write
  return Object.keys(cache).length === 0 ? undefined : cache
}

/**
 * OpenCode's `cost` for one model: the base price from `pricing`, then one entry per context tier
 * from `plugboard.cost` (the entries with `aboveContext`). A single base price is one object, as
 * OpenCode accepts. No base price means no `cost`, not a zero one.
 */
export function costOf(model: Json): Json | Json[] | undefined {
  const pricing = isRecord(model.pricing) ? model.pricing : undefined
  const input = perMillion(pricing?.prompt)
  const output = perMillion(pricing?.completion)
  if (input === undefined || output === undefined) return undefined
  const base: Json = { input, output }
  const cache = cacheOf(perMillion(pricing?.input_cache_read), perMillion(pricing?.input_cache_write))
  if (cache) base.cache = cache

  const plugboard = isRecord(model.plugboard) ? model.plugboard : {}
  const tiers: Json[] = []
  for (const entry of Array.isArray(plugboard.cost) ? plugboard.cost : []) {
    if (!isRecord(entry) || finite(entry.aboveContext) === undefined) continue
    const tier: Json = { input: finite(entry.input), output: finite(entry.output), tier: { type: "context", size: entry.aboveContext } }
    const tierCache = isRecord(entry.cache) ? cacheOf(finite(entry.cache.read), finite(entry.cache.write)) : undefined
    if (tierCache) tier.cache = tierCache
    tiers.push(tier)
  }
  return tiers.length === 0 ? base : [base, ...tiers]
}

/** One model's OpenCode entry: `limit` and `cost`, each only when the hub reports it. */
export function modelEntry(model: Json): Json {
  const limit: Json = {}
  const plugboard = isRecord(model.plugboard) ? model.plugboard : {}
  const context = finite(model.context_length)
  const output = finite(model.max_output_tokens)
  const input = isRecord(plugboard.limit) ? finite(plugboard.limit.input) : undefined
  if (context !== undefined) limit.context = context
  if (input !== undefined) limit.input = input
  if (output !== undefined) limit.output = output
  const cost = costOf(model)
  return { ...(Object.keys(limit).length === 0 ? {} : { limit }), ...(cost === undefined ? {} : { cost }) }
}

/** The `models` block for a `GET /v1/models` body: keyed by the id the client sends. */
export function modelsBlock(body: unknown): Record<string, Json> {
  const data = isRecord(body) && Array.isArray(body.data) ? body.data : undefined
  if (!data) throw new Error("not a /v1/models body: no data array")
  const block: Record<string, Json> = {}
  for (const model of data) {
    // A `#variant` id is not a model of its own: OpenCode reads `provider/model#variant` as the base model plus a variant.
    if (isRecord(model) && typeof model.id === "string" && !model.id.includes("#")) block[model.id] = modelEntry(model)
  }
  return block
}

async function main(argv: string[], env: Record<string, string | undefined>): Promise<void> {
  const [hub] = argv
  const key = env.PLUGBOARD_KEY
  if (!hub || !key) {
    console.error("usage: PLUGBOARD_KEY=<app key> bun .github/scripts/opencode-models.ts <hub url, e.g. http://127.0.0.1:4010>")
    process.exit(2)
  }
  const base = hub.replace(/\/+$/, "").replace(/\/v1$/, "")
  const response = await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${key}` } })
  if (!response.ok) {
    console.error(`GET ${base}/v1/models: HTTP ${response.status}`)
    process.exit(1)
  }
  console.log(JSON.stringify(modelsBlock(await response.json()), null, 2))
}

if (import.meta.main) await main(process.argv.slice(2), process.env)
