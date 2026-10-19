/**
 * First-run discovery and status documents: `GET /v1` (JSON), `GET /` (small HTML page) and the
 * authenticated `GET /plugboard/status`. Pure builders over the options, the catalog and a runtime
 * snapshot; no I/O, no host calls. `src/openai/route.ts` loads the catalog and sends the result.
 *
 * Disclosure rule: the discovery pages are reachable without a key, so they only describe the
 * configuration when that is safe. On a keyless endpoint (loopback only) everything is shown.
 * When `keys` are configured, a caller without an `Authorization` header sees the address, the
 * authentication requirement, the endpoint list and a curl example, and nothing about apps,
 * allowlist, aliases or the catalog. A caller with a valid key additionally sees its own app name
 * (never the other apps), the allowlist, the aliases and the catalog suggestion. Keys themselves
 * never appear anywhere, and nothing here echoes a request header or path.
 *
 * The HTML page is built from the same document as the JSON, has no scripts or external assets,
 * and every dynamic value goes through `escapeHtml`.
 */

import type { ServerResponse } from "node:http"
import escapeText from "escape-html"
import type { PlugboardOptions } from "./config.js"
import type { CatalogModel } from "./contract.js"
import { listAvailableModels } from "./models.js"
import type { RuntimeSnapshot } from "./metrics.js"

const NAME = "opencode-plugboard"
/** Providers listed in the catalog summary; the rest are counted, not listed. */
const MAX_PROVIDERS = 50
const EXAMPLES_PER_PROVIDER = 3
const PLACEHOLDER_MODEL = "provider/model"

/** A text response with the headers every page of this module shares. */
export function sendText(response: ServerResponse, status: number, contentType: string, body: string, headers: Record<string, string> = {}): void {
  if (response.headersSent || response.destroyed) return
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    ...headers,
  })
  response.end(body)
}

const escapeHtml = (value: unknown): string => escapeText(String(value))

/** `http://host:port` for a listen address; an IPv6 literal gets brackets. */
export function origin(listen: PlugboardOptions["listen"]): string {
  const host = listen.host.includes(":") && !listen.host.startsWith("[") ? `[${listen.host}]` : listen.host
  return `http://${host}:${listen.port}`
}

const shellQuote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`

export interface Endpoint {
  readonly method: string
  readonly path: string
  readonly auth: boolean
  readonly description: string
}

/**
 * Every endpoint plugboard serves, in the order the document lists them. Dispatch lives in
 * `src/openai/route.ts` and the front-end routes; `test/http/discovery.test.ts` probes each served
 * route and fails when this list omits one (#136). `/plugboard/usage`, `/plugboard/dashboard` and `/plugboard/metrics` are added only when their options are on.
 */
export const ENDPOINTS: ReadonlyArray<Endpoint> = [
  { method: "GET", path: "/", auth: false, description: "This page." },
  { method: "GET", path: "/v1", auth: false, description: "This page as JSON." },
  { method: "GET", path: "/plugboard/health", auth: false, description: 'Liveness: {"ok":true}. Also at the root as /healthz.' },
  { method: "GET", path: "/plugboard/ready", auth: false, description: 'Readiness: {"ready":true}, or a 503 problem with the reason until the backend can serve. Also at the root as /readyz.' },
  { method: "GET", path: "/v1/models", auth: true, description: "Models this app may call (OpenAI shape)." },
  { method: "GET", path: "/v1/models/{id}", auth: true, description: "One model." },
  { method: "POST", path: "/v1/chat/completions", auth: true, description: "OpenAI Chat Completions." },
  { method: "POST", path: "/v1/completions", auth: true, description: "Legacy OpenAI completions." },
  { method: "POST", path: "/v1/responses", auth: true, description: "OpenAI Responses (stateless)." },
  { method: "POST", path: "/v1/messages", auth: true, description: "Anthropic Messages (x-api-key or Bearer)." },
  { method: "POST", path: "/v1/messages/count_tokens", auth: true, description: "Anthropic token count (an estimate, not the provider's exact count)." },
  { method: "GET", path: "/v1beta/models", auth: true, description: "Gemini model list." },
  { method: "GET", path: "/v1beta/models/{model}", auth: true, description: "One Gemini model." },
  { method: "POST", path: "/v1beta/models/{model}:generateContent", auth: true, description: "Gemini generateContent." },
  { method: "POST", path: "/v1beta/models/{model}:streamGenerateContent", auth: true, description: "Gemini streamGenerateContent, with ?alt=sse." },
  { method: "POST", path: "/v1beta/models/{model}:countTokens", auth: true, description: "Gemini token count (an estimate)." },
  { method: "GET", path: "/plugboard/status", auth: true, description: "Runtime status: generations, address, model count, uptime." },
]

function endpoints(options: PlugboardOptions): ReadonlyArray<Endpoint> {
  return [
    ...ENDPOINTS,
    ...(options.usage.enabled
      ? [
          { method: "GET", path: "/plugboard/usage", auth: true, description: "Per-app usage by day: requests, tokens, cost, latency. The admin key reads every app." },
          { method: "GET", path: "/plugboard/dashboard", auth: false, description: "Usage dashboard page. Its data needs a key (`/plugboard/usage`)." },
        ]
      : []),
    ...(options.metrics ? [{ method: "GET", path: "/plugboard/metrics", auth: true, description: "Prometheus metrics." }] : []),
    // The admin key only (option `adminKey`); without it these paths are a 404 (src/admin/route.ts).
    ...(options.adminKey === undefined
      ? []
      : [
          { method: "GET", path: "/plugboard/admin/keys", auth: true, description: "Admin: the config and runtime app keys, without key values." },
          { method: "POST", path: "/plugboard/admin/keys", auth: true, description: "Admin: a new app key for `{ app }`, returned once." },
          { method: "DELETE", path: "/plugboard/admin/keys/{keyId}", auth: true, description: "Admin: revoke a runtime app key." },
        ]),
  ]
}

type ModelsState = "ready" | "no_models_configured" | "none_available" | "catalog_unavailable"

interface ProviderSummary {
  readonly id: string
  readonly models: number
  readonly examples: ReadonlyArray<string>
}

/** The `GET /v1` document. Fields marked "detail" are present only when the caller may see the configuration. */
export interface Discovery {
  readonly name: string
  readonly baseUrl: string
  readonly listen: { readonly host: string; readonly port: number }
  readonly authentication: { readonly required: boolean; readonly scheme?: "Bearer" }
  readonly hint?: string
  /** detail: the caller's own app name, or `default` on a keyless endpoint. */
  readonly apps?: ReadonlyArray<string>
  /** detail */
  readonly models?: {
    readonly state: ModelsState
    readonly allowlist: ReadonlyArray<string>
    readonly aliases: Readonly<Record<string, string>>
    /** Alias -> the targets tried after its first one, for aliases written as a list. Absent when there are none. */
    readonly fallbacks?: Readonly<Record<string, ReadonlyArray<string>>>
    /** Ids `GET /v1/models` lists (allowlist intersected with the catalog, plus aliases). */
    readonly available?: number
    readonly hint?: string
  }
  /** detail: a paste-ready `models` option built from the catalog (one wildcard per provider). */
  readonly suggestedModels?: ReadonlyArray<string>
  /** detail: what the catalog offers, by provider. */
  readonly catalog?: { readonly providers: ReadonlyArray<ProviderSummary>; readonly moreProviders?: number }
  readonly endpoints: ReadonlyArray<Endpoint>
  readonly example: { readonly curl: string }
}

export interface DiscoveryInput {
  /** The public origin a trusted proxy names (`src/forwarded.ts`, #266): the base URL uses it. Absent: the listen address. */
  readonly publicOrigin?: string
  readonly options: PlugboardOptions
  /** The authenticated app; undefined when the caller sent no credentials (only possible when `keys` are set). */
  readonly app?: string
  /** The serving Location's catalog; undefined when it could not be loaded (or was not asked for). */
  readonly catalog?: ReadonlyArray<CatalogModel>
}

function summarize(catalog: ReadonlyArray<CatalogModel>): { providers: ProviderSummary[]; more: number } {
  const byProvider = new Map<string, string[]>()
  for (const model of catalog) {
    const ids = byProvider.get(model.providerID) ?? []
    if (!ids.includes(model.id)) ids.push(model.id)
    byProvider.set(model.providerID, ids)
  }
  const all = [...byProvider.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return {
    providers: all.slice(0, MAX_PROVIDERS).map(([id, ids]) => ({ id, models: ids.length, examples: ids.slice(0, EXAMPLES_PER_PROVIDER).map((model) => `${id}/${model}`) })),
    more: Math.max(0, all.length - MAX_PROVIDERS),
  }
}

export function buildDiscovery({ options, app, catalog, publicOrigin }: DiscoveryInput): Discovery {
  const keyed = Object.keys(options.keys).length > 0
  const base = `${publicOrigin ?? origin(options.listen)}/v1`
  const detail = !keyed || app !== undefined
  const auth = keyed ? ({ required: true, scheme: "Bearer" } as const) : { required: false }

  const listed = detail && catalog ? listAvailableModels(options, catalog, app) : []
  const summary = detail && catalog ? summarize(catalog) : undefined
  const suggested = summary?.providers.map((provider) => `${provider.id}/*`)

  let state: ModelsState = "ready"
  let modelsHint: string | undefined
  const example = JSON.stringify(suggested && suggested.length > 0 ? { models: suggested } : { models: ["provider/*"] })
  if (options.models.length === 0) {
    state = "no_models_configured"
    modelsHint = `The \`models\` option is empty, so every model call fails with 403 no_models_configured. Add an allowlist to the plugin options, for example ${example}`
  } else if (!catalog) {
    state = "catalog_unavailable"
    modelsHint = "The model catalog could not be loaded from the OpenCode server."
  } else if (listed.length === 0) {
    state = "none_available"
    modelsHint = "Nothing in the `models` allowlist matches a model the server offers. Check the provider and model ids against the catalog below."
  }

  const first = listed[0]?.id ?? PLACEHOLDER_MODEL
  const body = JSON.stringify({ model: first, messages: [{ role: "user", content: "Say hello." }] })
  const curl = [`curl -s ${base}/chat/completions`, `-H "Content-Type: application/json"`, ...(keyed ? [`-H "Authorization: Bearer $PLUGBOARD_KEY"`] : []), `-d ${shellQuote(body)}`].join(" ")

  return {
    name: NAME,
    baseUrl: base,
    listen: { host: options.listen.host, port: options.listen.port },
    authentication: auth,
    ...(detail ? {} : { hint: "Authentication is required. Send `Authorization: Bearer <key>` to see this app's configuration: the allowlist, aliases and a model suggestion." }),
    ...(detail ? { apps: [app ?? "default"] } : {}),
    ...(detail
      ? {
          models: {
            state,
            allowlist: options.models,
            aliases: options.aliases,
            ...(Object.keys(options.fallbacks).length > 0 ? { fallbacks: options.fallbacks } : {}),
            ...(catalog ? { available: listed.length } : {}),
            ...(modelsHint ? { hint: modelsHint } : {}),
          },
        }
      : {}),
    ...(suggested && suggested.length > 0 ? { suggestedModels: suggested } : {}),
    ...(summary ? { catalog: { providers: summary.providers, ...(summary.more > 0 ? { moreProviders: summary.more } : {}) } } : {}),
    endpoints: endpoints(options),
    example: { curl },
  }
}

const pre = (text: string) => `<pre>${escapeHtml(text)}</pre>`
const list = (items: ReadonlyArray<string>) => `<ul>${items.map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join("")}</ul>`

/** The `GET /` page: the discovery document as small, script-free HTML. */
export function renderDiscoveryHtml(doc: Discovery): string {
  const sections: string[] = []
  sections.push(`<p>Base URL: <code>${escapeHtml(doc.baseUrl)}</code></p>`)
  sections.push(`<p>Authentication: ${doc.authentication.required ? "required. Send <code>Authorization: Bearer &lt;key&gt;</code>." : "none (keyless, loopback only)."}</p>`)
  if (doc.hint) sections.push(`<p class="hint">${escapeHtml(doc.hint)}</p>`)
  if (doc.apps) sections.push(`<h2>App</h2>${list(doc.apps)}`)
  if (doc.models) {
    const models = doc.models
    sections.push(`<h2>Models</h2>`)
    if (models.hint) sections.push(`<p class="hint">${escapeHtml(models.hint)}</p>`)
    if (models.available !== undefined) sections.push(`<p>${escapeHtml(models.available)} model ids available.</p>`)
    sections.push(`<h3>Allowlist</h3>${models.allowlist.length > 0 ? list(models.allowlist) : "<p>Empty.</p>"}`)
    const aliases = Object.entries(models.aliases)
    if (aliases.length > 0) sections.push(`<h3>Aliases</h3>${list(aliases.map(([alias, target]) => [alias, target, ...(models.fallbacks?.[alias] ?? [])].join(" -> ")))}`)
  }
  if (doc.suggestedModels) {
    sections.push(`<h2>Suggested <code>models</code> option</h2>${pre(`"models": ${JSON.stringify(doc.suggestedModels)}`)}`)
  }
  if (doc.catalog) {
    const rows = doc.catalog.providers
      .map(
        (provider) =>
          `<tr><td><code>${escapeHtml(provider.id)}</code></td><td>${escapeHtml(provider.models)}</td><td>${provider.examples.map((example) => `<code>${escapeHtml(example)}</code>`).join(" ")}</td></tr>`,
      )
      .join("")
    const more = doc.catalog.moreProviders ? `<p>${escapeHtml(doc.catalog.moreProviders)} more providers not listed.</p>` : ""
    sections.push(`<h2>Catalog</h2><table><tr><th>Provider</th><th>Models</th><th>Examples</th></tr>${rows}</table>${more}`)
  }
  if (doc.endpoints.some((endpoint) => endpoint.path === "/plugboard/dashboard")) sections.push(`<p><a href="/plugboard/dashboard">Usage dashboard</a></p>`)
  sections.push(`<h2>Try it</h2>${pre(doc.example.curl)}`)
  sections.push(
    `<h2>Endpoints</h2><table><tr><th>Method</th><th>Path</th><th>Key</th><th></th></tr>${doc.endpoints
      .map(
        (endpoint) =>
          `<tr><td>${escapeHtml(endpoint.method)}</td><td><code>${escapeHtml(endpoint.path)}</code></td><td>${endpoint.auth ? "yes" : "no"}</td><td>${escapeHtml(endpoint.description)}</td></tr>`,
      )
      .join("")}</table>`,
  )
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.name)}</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:48rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
code,pre{font-family:ui-monospace,monospace;font-size:.9em}
pre{background:#f4f4f4;padding:.75rem;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.25rem .5rem;text-align:left;vertical-align:top}
.hint{border-left:4px solid #c80;background:#fff7e6;padding:.5rem .75rem}
</style>
</head>
<body>
<h1>${escapeHtml(doc.name)}</h1>
${sections.join("\n")}
<p><a href="/v1">JSON version of this page</a></p>
</body>
</html>
`
}

/** The facts `/readyz` and `/plugboard/ready` decide from (`RuntimeStatus` in src/runtime.ts). */
export interface ReadinessFacts {
  readonly generations: number
  readonly servingConfirmed: boolean
  readonly pumpRunning: boolean
  readonly catalogLoaded: boolean
  readonly configError?: { readonly message: string }
}

/**
 * `GET /readyz` (#160): whether the backend can serve a request. The reason names the first piece
 * that is missing, in the order a person fixes them. A recorded options error comes first and is
 * its own message (#159); nothing else from the config is shown.
 */
export function readiness(facts: ReadinessFacts): { ready: true } | { ready: false; reason: string } {
  if (facts.configError) return { ready: false, reason: facts.configError.message }
  if (facts.generations === 0) return { ready: false, reason: "no plugboard generation is live; the server is reloading or the plugin is not loaded" }
  if (!facts.servingConfirmed) return { ready: false, reason: "no app directory has been used since start; one model request to an app confirms it" }
  if (!facts.pumpRunning) return { ready: false, reason: "the event pump is not running; the next request to an app starts it" }
  if (!facts.catalogLoaded) return { ready: false, reason: "the model catalog has not loaded yet" }
  return { ready: true }
}

/**
 * `GET /plugboard/status`: authenticated runtime facts. `models` is absent when the catalog could not be loaded. `app` is absent
 * for the admin key, which names no app (#311).
 */
export function buildStatus(input: {
  readonly options: PlugboardOptions
  readonly app?: string
  readonly runtime: RuntimeSnapshot & {
    readonly runtimeVersion: number
    readonly listener?: { readonly host: string; readonly port: number; readonly bound: boolean }
    readonly servingConfirmed: boolean
    readonly configError?: { readonly message: string; readonly at: number }
  }
  readonly catalog?: ReadonlyArray<CatalogModel>
  readonly now?: number
  /** The plugboard package version (`src/version.ts`), and the host OpenCode version when the plugin context has one (#347). */
  readonly packageVersion?: string
  readonly opencodeVersion?: string
}): object {
  const { options, app, runtime, catalog } = input
  const now = input.now ?? Date.now()
  return {
    ok: true,
    app,
    ...(input.packageVersion === undefined ? {} : { packageVersion: input.packageVersion }),
    ...(input.opencodeVersion === undefined ? {} : { opencodeVersion: input.opencodeVersion }),
    runtimeVersion: runtime.runtimeVersion,
    startedAt: new Date(runtime.startedAt).toISOString(),
    uptimeSeconds: Math.max(0, Math.floor((now - runtime.startedAt) / 1000)),
    listen: { host: options.listen.host, port: options.listen.port, bound: runtime.listener?.bound ?? false },
    generations: runtime.generations,
    servingConfirmed: runtime.servingConfirmed,
    eventPump: { running: runtime.pumpRunning },
    sessionGuards: runtime.guards,
    models: catalog ? { catalog: catalog.length, available: listAvailableModels(options, catalog, app).length } : { error: "catalog_unavailable" },
    metrics: options.metrics,
    // The circuit breaker of list aliases (src/breaker.ts): the targets being skipped now, and until when.
    fallbackCooldown: {
      enabled: options.fallbackCooldown !== false,
      cooling: (runtime.cooldowns ?? []).map((target) => ({ model: target.model, state: target.state, failures: target.failures, until: new Date(target.until).toISOString() })),
    },
    // The plugin options error the last Location to load the plugin hit (#159); absent when options parse.
    ...(runtime.configError ? { configError: { message: runtime.configError.message, at: new Date(runtime.configError.at).toISOString() } } : {}),
  }
}
