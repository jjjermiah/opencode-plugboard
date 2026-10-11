/** Plugin options: type, defaults, validation, caller authentication and the loopback check. */

import { createHash, timingSafeEqual } from "node:crypto"
import type { PlugError } from "./contract.js"
import { allowedBy, parseModelRef } from "./models.js"
import { parseAllowEntry, type RemoteImages } from "./session/media.js"
import type { HistoryLimits } from "./session/prune.js"

/** How `/v1/models` spells a model id: the canonical `provider/model#variant`, a UI-safe slug, or both. Resolution accepts either. */
export type ModelIds = "canonical" | "slugs" | "both"

/** Plugin options, after defaults and validation (see `parseOptions`). */
export interface PlugboardOptions {
  readonly listen: { readonly host: string; readonly port: number }
  /** App name -> API key, from `keys` and `apps.<name>.key` merged. App names match APP_NAME_PATTERN; "default" is reserved. */
  readonly keys: Readonly<Record<string, string>>
  /** Per-app policy (`apps`); only apps that set a policy field appear. Look one up with `appPolicy`. */
  readonly apps: Readonly<Record<string, AppPolicy>>
  /** Allowlist: exact `provider/model`, `provider/model#variant`, or `provider/*` patterns. Empty = nothing allowed. */
  readonly models: ReadonlyArray<string>
  /** Alias -> `provider/model[#variant]`. Targets must also pass the allowlist. */
  readonly aliases: Readonly<Record<string, string>>
  /**
   * Alias -> the targets after the first, in order, for an alias written as an array. `aliases` holds the
   * first target, so everything that resolves an alias keeps working; the model caller retries the rest
   * (`src/fallback.ts`). Absent for an alias with one target. Every target passes the allowlist.
   */
  readonly fallbacks: Readonly<Record<string, ReadonlyArray<string>>>
  readonly maxTools: number
  /** Most model calls one request may fan out to: `n` for chat completions, prompts x `n` for legacy completions. Each is a full call and a kept session. */
  readonly maxN: number
  readonly requestTimeoutMs: number
  /**
   * Fetch http(s) image URLs server-side. Off by default: it is an SSRF vector into the host's network.
   * `true` fetches public addresses only (loopback, private, link-local, CGNAT and ULA ranges are refused);
   * `{ allow }` is on too, and lists the hosts (`name`, `*.suffix`), addresses or CIDR ranges that may be
   * fetched even when they are not public.
   */
  readonly remoteImages: RemoteImages
  /** Prune old request sessions (see `src/session/prune.ts`). A limit that is unset is not applied; with neither, history is kept forever. Applies per app. */
  readonly history: HistoryLimits
  /** Drop sampling parameters the target model is known to reject (reported in `x-plugboard-dropped-params`). On by default; off forwards them as sent. */
  readonly dropUnsupportedParams: boolean
  /** Log line format: `text` (`key=value`, the default) or `json` (one object per line). Process-wide: the live generation's value applies. */
  readonly logFormat: "text" | "json"
  /** Serve `GET /metrics` (Prometheus text). Off by default; same authentication as `/v1`. */
  readonly metrics: boolean
  /** Ids listed by `/v1/models`: canonical, slugs (`provider--model__variant`) or both. See `toSlug` in `src/models.ts`. */
  readonly modelIds: ModelIds
}

export type SystemMode = "prepend" | "append" | "replace"

/**
 * What the operator fixes for one app, whatever the caller sends (option `apps`). `models` only narrows the
 * global allowlist: entries are `provider/model[#variant]`, `provider/*` or alias names.
 */
export interface AppPolicy {
  readonly models?: ReadonlyArray<string>
  /** Text added to the caller's system prompt, or replacing it (`systemMode`). */
  readonly system?: string
  readonly systemMode: SystemMode
  /** false: the caller's tools are dropped before the model sees them. */
  readonly tools: boolean
  /** Lowers the global `maxTools` for this app. */
  readonly maxTools?: number
}

export const APP_NAME_PATTERN = /^[a-z0-9-]+$/
export const DEFAULT_APP = "default"
const DEFAULTS = {
  host: "127.0.0.1",
  port: 4010,
  maxTools: 32,
  maxN: 1,
  requestTimeoutMs: 600_000,
} as const

const KNOWN = new Set(["listen", "keys", "apps", "models", "aliases", "maxTools", "maxN", "requestTimeoutMs", "remoteImages", "history", "dropUnsupportedParams", "logFormat", "metrics", "modelIds"])
const HISTORY_KNOWN = new Set(["maxSessions", "maxAgeDays"])
/** About 100 years: keeps `maxAgeDays * 86_400_000` a safe integer. */
const MAX_AGE_DAYS = 36_500
const MODEL_PATTERN = /^[^/#*\s]+\/(\*|[^#*\s]+(#[^#*\s]+)?)$/
const ALIAS_TARGET = /^[^/#*\s]+\/[^#*\s]+(#[^#*\s]+)?$/
/** `provider/model...` shaped: an alias like this would collide with real model ids in listing and resolution. */
const CANONICAL_SHAPE = /^[^/\s]+\/\S/
/** Largest delay Node timers accept (2^31 - 1); longer values overflow and fire immediately. */
const MAX_TIMER_MS = 2_147_483_647

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * The hosts plugboard treats as loopback: `localhost`, `127.0.0.1` and `::1` (brackets and case
 * ignored). This is exactly the set the Host header check in `src/http.ts` accepts, so a listen
 * address that passes the keyless-loopback rule can also be reached by a request that passes the
 * Host check; other loopback addresses (`127.0.0.2`) are not loopback here and need `keys`.
 */
export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "")
  return h === "localhost" || h === "127.0.0.1" || h === "::1"
}

function positiveInt(value: unknown, name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max)
    throw new Error(`plugboard option \`${name}\` must be an integer between 1 and ${max}`)
  return value
}

const REMOTE_IMAGES_ERROR =
  "plugboard option `remoteImages` must be a boolean or `{ allow: [...] }` with host names, IP addresses or CIDR ranges that may be fetched even when they are not public"

function parseRemoteImages(value: unknown): RemoteImages {
  if (value === undefined) return false
  if (typeof value === "boolean") return value
  if (!isRecord(value)) throw new Error(REMOTE_IMAGES_ERROR)
  for (const key of Object.keys(value))
    if (key !== "allow") throw new Error(`Unknown plugboard option \`remoteImages.${key}\` (known: allow)`)
  const allow = value.allow ?? []
  if (!Array.isArray(allow)) throw new Error(REMOTE_IMAGES_ERROR)
  for (const entry of allow)
    if (typeof entry !== "string" || parseAllowEntry(entry) === undefined)
      throw new Error(`plugboard \`remoteImages.allow\` entry \`${String(entry)}\` must be a host name (\`images.internal\`, \`*.internal\`), an IP address or a CIDR range`)
  return { allow: allow as string[] }
}

/**
 * `keys` and the `key` of each `apps` entry as one list. An app named in both must carry the same
 * value: two sources that disagree are a config mistake, not a precedence rule. Values are validated
 * by the caller of this function (non-empty strings, unique).
 */
function mergedKeys(keys: unknown, apps: unknown): Array<[string, unknown]> {
  const merged = new Map<string, unknown>(Object.entries(isRecord(keys) ? keys : {}))
  for (const [app, policy] of Object.entries(isRecord(apps) ? apps : {})) {
    if (!isRecord(policy) || policy.key === undefined) continue
    if (merged.has(app) && merged.get(app) !== policy.key)
      throw new Error(`plugboard app \`${app}\` has a different key in \`keys\` and in \`apps.${app}.key\`; set it in one place or make them equal`)
    merged.set(app, policy.key)
  }
  return [...merged]
}

const APP_KNOWN = new Set(["key", "models", "system", "systemMode", "tools", "maxTools"])
const SYSTEM_MODES: ReadonlySet<string> = new Set(["prepend", "append", "replace"])
const MODEL_IDS: ReadonlySet<string> = new Set(["canonical", "slugs", "both"])

/** Validates `apps` (the `key` field was merged into `keys` already) into per-app policies. */
function parseApps(
  raw: unknown,
  context: { keys: Readonly<Record<string, string>>; aliases: Readonly<Record<string, string>>; maxTools: number },
): Record<string, AppPolicy> {
  const entries: Array<[string, AppPolicy]> = []
  for (const [app, value] of Object.entries(isRecord(raw) ? raw : {})) {
    const at = `plugboard \`apps.${app}\``
    if (app !== DEFAULT_APP && !APP_NAME_PATTERN.test(app)) throw new Error(`plugboard app name \`${app}\` must match ${APP_NAME_PATTERN} (or be \`${DEFAULT_APP}\`)`)
    if (!isRecord(value)) throw new Error(`${at} must be an object`)
    for (const field of Object.keys(value))
      if (!APP_KNOWN.has(field)) throw new Error(`Unknown plugboard option \`apps.${app}.${field}\` (known: ${[...APP_KNOWN].join(", ")})`)
    const keyed = Object.keys(context.keys).length > 0
    if (app === DEFAULT_APP && (keyed || value.key !== undefined))
      throw new Error(`${at} configures the keyless app and cannot be used together with \`keys\`; name the app and give it a key instead`)
    if (app !== DEFAULT_APP && !Object.hasOwn(context.keys, app)) throw new Error(`${at} has no key: add \`key\` there or an entry in \`keys\``)

    if (value.models !== undefined) {
      if (!Array.isArray(value.models) || value.models.length === 0)
        throw new Error(`${at}.models must be a non-empty array (omit it to inherit the global \`models\`)`)
      for (const entry of value.models)
        if (typeof entry !== "string" || !(MODEL_PATTERN.test(entry) || Object.hasOwn(context.aliases, entry)))
          throw new Error(`${at}.models entry \`${String(entry)}\` must be \`provider/model\`, \`provider/model#variant\`, \`provider/*\` or an alias name`)
    }
    if (value.system !== undefined && (typeof value.system !== "string" || value.system.trim().length === 0))
      throw new Error(`${at}.system must be a non-empty string`)
    if (value.systemMode !== undefined && (typeof value.systemMode !== "string" || !SYSTEM_MODES.has(value.systemMode)))
      throw new Error(`${at}.systemMode must be \`prepend\`, \`append\` or \`replace\``)
    if (value.systemMode !== undefined && value.system === undefined) throw new Error(`${at}.systemMode needs \`system\``)
    if (value.tools !== undefined && typeof value.tools !== "boolean") throw new Error(`${at}.tools must be a boolean`)
    const maxTools = value.maxTools === undefined ? undefined : positiveInt(value.maxTools, `apps.${app}.maxTools`, 0, context.maxTools)

    const policy: AppPolicy = {
      ...(value.models === undefined ? {} : { models: value.models as string[] }),
      ...(value.system === undefined ? {} : { system: value.system as string }),
      systemMode: (value.systemMode as SystemMode | undefined) ?? "prepend",
      tools: value.tools !== false,
      ...(maxTools === undefined ? {} : { maxTools }),
    }
    // An app that only carries a key has no policy to look up.
    if (value.models !== undefined || value.system !== undefined || value.tools !== undefined || maxTools !== undefined) entries.push([app, policy])
  }
  return Object.fromEntries(entries)
}

/** The policy configured for `app` (`default` for the keyless app), if any. Own-property lookup: an app name never reaches the prototype. */
export function appPolicy(options: Pick<PlugboardOptions, "apps">, app: string): AppPolicy | undefined {
  return Object.hasOwn(options.apps, app) ? options.apps[app] : undefined
}

/** Validates raw plugin options and applies defaults. Throws `Error` with an actionable message. */
export function parseOptions(raw: unknown): PlugboardOptions {
  if (raw !== undefined && raw !== null && !isRecord(raw)) throw new Error("plugboard options must be an object")
  const input: Record<string, unknown> = raw ?? {}
  for (const key of Object.keys(input))
    if (!KNOWN.has(key)) throw new Error(`Unknown plugboard option \`${key}\` (known: ${[...KNOWN].join(", ")})`)

  const listenInput = input.listen
  if (listenInput !== undefined && !isRecord(listenInput)) throw new Error("plugboard option `listen` must be an object")
  const host = listenInput?.host ?? DEFAULTS.host
  if (typeof host !== "string" || host.length === 0) throw new Error("plugboard option `listen.host` must be a non-empty string")
  const port = listenInput?.port
  if (port !== undefined && (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535))
    throw new Error("plugboard option `listen.port` must be an integer between 1 and 65535")

  const keyEntries: Array<[string, string]> = []
  if (input.keys !== undefined && !isRecord(input.keys)) throw new Error("plugboard option `keys` must be an object of app name -> key")
  if (input.apps !== undefined && !isRecord(input.apps)) throw new Error("plugboard option `apps` must be an object of app name -> policy")
  const appOfKey = new Map<string, string>()
  for (const [app, key] of mergedKeys(input.keys, input.apps)) {
    if (app === DEFAULT_APP) throw new Error(`plugboard key name \`${DEFAULT_APP}\` is reserved for keyless loopback use`)
    if (!APP_NAME_PATTERN.test(app)) throw new Error(`plugboard key name \`${app}\` must match ${APP_NAME_PATTERN}`)
    if (typeof key !== "string" || key.length === 0)
      throw new Error(`plugboard key \`${app}\` must be a non-empty string (is its {env:VAR} set?)`)
    // Two apps sharing a key value would be indistinguishable: the last one would win silently.
    const other = appOfKey.get(key)
    if (other !== undefined) throw new Error(`plugboard keys \`${other}\` and \`${app}\` have the same value; every app needs its own key`)
    appOfKey.set(key, app)
    keyEntries.push([app, key])
  }
  // Own-property construction: a key such as `__proto__` must stay a key, never reach the prototype.
  const keys: Record<string, string> = Object.fromEntries(keyEntries)
  digestsOf(keys)
  if (keyEntries.length === 0 && !isLoopbackHost(host))
    throw new Error(`plugboard refuses to listen on non-loopback host \`${host}\` without \`keys\``)

  const models = input.models ?? []
  if (!Array.isArray(models)) throw new Error("plugboard option `models` must be an array of strings")
  for (const pattern of models)
    if (typeof pattern !== "string" || !MODEL_PATTERN.test(pattern))
      throw new Error(`plugboard model \`${String(pattern)}\` must be \`provider/model\`, \`provider/model#variant\` or \`provider/*\``)

  const aliasEntries: Array<[string, string]> = []
  const fallbackEntries: Array<[string, string[]]> = []
  if (input.aliases !== undefined && !isRecord(input.aliases)) throw new Error("plugboard option `aliases` must be an object of alias -> model or alias -> [model, ...]")
  for (const [alias, target] of Object.entries(input.aliases ?? {})) {
    if (alias.length === 0 || /[\s]/.test(alias)) throw new Error(`plugboard alias \`${alias}\` must be a non-empty string without whitespace`)
    // Plain-object lookups downstream would hit the prototype accessor instead of the alias.
    if (alias === "__proto__") throw new Error("plugboard alias `__proto__` is not allowed")
    const chain = Array.isArray(target) ? target : [target]
    if (chain.length === 0) throw new Error(`plugboard alias \`${alias}\` must list at least one target`)
    for (const entry of chain) {
      if (typeof entry !== "string" || !ALIAS_TARGET.test(entry))
        throw new Error(`plugboard alias \`${alias}\` must target \`provider/model\` or \`provider/model#variant\` (or a list of them)`)
      // A list is new, so it is strict: a target the allowlist would refuse can never serve, so fail at load.
      if (Array.isArray(target) && !allowedBy(models as string[], parseModelRef(entry)!))
        throw new Error(`plugboard alias \`${alias}\` target \`${entry}\` is not allowed by the \`models\` option`)
    }
    if (CANONICAL_SHAPE.test(alias))
      throw new Error(`plugboard alias \`${alias}\` is written like a \`provider/model\` id; aliases must not contain \`/\` (use a short name such as \`fast\`)`)
    aliasEntries.push([alias, chain[0] as string])
    if (chain.length > 1) fallbackEntries.push([alias, chain.slice(1) as string[]])
  }
  const aliases: Record<string, string> = Object.fromEntries(aliasEntries)
  const fallbacks: Record<string, string[]> = Object.fromEntries(fallbackEntries)

  const maxTools = positiveInt(input.maxTools, "maxTools", DEFAULTS.maxTools, 1024)
  const apps = parseApps(input.apps, { keys, aliases, maxTools })

  const remoteImages = parseRemoteImages(input.remoteImages)
  if (input.dropUnsupportedParams !== undefined && typeof input.dropUnsupportedParams !== "boolean")
    throw new Error("plugboard option `dropUnsupportedParams` must be a boolean")

  if (input.logFormat !== undefined && input.logFormat !== "text" && input.logFormat !== "json")
    throw new Error("plugboard option `logFormat` must be `text` or `json`")
  if (input.metrics !== undefined && typeof input.metrics !== "boolean") throw new Error("plugboard option `metrics` must be a boolean")
  if (input.modelIds !== undefined && (typeof input.modelIds !== "string" || !MODEL_IDS.has(input.modelIds)))
    throw new Error("plugboard option `modelIds` must be `canonical`, `slugs` or `both`")

  const historyInput = input.history
  if (historyInput !== undefined && !isRecord(historyInput)) throw new Error("plugboard option `history` must be an object")
  for (const key of Object.keys(historyInput ?? {}))
    if (!HISTORY_KNOWN.has(key)) throw new Error(`Unknown plugboard option \`history.${key}\` (known: ${[...HISTORY_KNOWN].join(", ")})`)
  const maxSessions = historyInput?.maxSessions === undefined ? undefined : positiveInt(historyInput.maxSessions, "history.maxSessions", 0)
  const maxAgeDays = historyInput?.maxAgeDays === undefined ? undefined : positiveInt(historyInput.maxAgeDays, "history.maxAgeDays", 0, MAX_AGE_DAYS)

  return {
    listen: { host, port: port ?? DEFAULTS.port },
    keys,
    apps,
    models: models as string[],
    aliases,
    fallbacks,
    maxTools,
    maxN: positiveInt(input.maxN, "maxN", DEFAULTS.maxN, 64),
    requestTimeoutMs: positiveInt(input.requestTimeoutMs, "requestTimeoutMs", DEFAULTS.requestTimeoutMs, MAX_TIMER_MS),
    remoteImages,
    history: { ...(maxSessions === undefined ? {} : { maxSessions }), ...(maxAgeDays === undefined ? {} : { maxAgeDays }) },
    dropUnsupportedParams: input.dropUnsupportedParams !== false,
    logFormat: input.logFormat === "json" ? "json" : "text",
    metrics: input.metrics === true,
    modelIds: (input.modelIds as ModelIds | undefined) ?? "canonical",
  }
}

const UNAUTHORIZED: PlugError = {
  status: 401,
  message: "Missing or invalid API key",
  kind: "authentication",
  code: "invalid_api_key",
}

const sha256 = (text: string): Buffer => createHash("sha256").update(text).digest()

/**
 * SHA-256 digest of each key, computed once per `keys` object (at parse; lazily for an options
 * object built without `parseOptions`). Comparing fixed-size digests means a wrong token's length
 * and content do not change how long the comparison takes.
 */
const keyDigests = new WeakMap<object, ReadonlyArray<readonly [string, Buffer]>>()

function digestsOf(keys: Readonly<Record<string, string>>): ReadonlyArray<readonly [string, Buffer]> {
  let digests = keyDigests.get(keys)
  if (!digests) keyDigests.set(keys, (digests = Object.entries(keys).map(([name, key]) => [name, sha256(key)] as const)))
  return digests
}

/** No keys -> app `default`; with keys every request needs `Authorization: Bearer <key>`. */
export function authenticate(options: PlugboardOptions, authorization: string | undefined): { app: string } | PlugError {
  const entries = digestsOf(options.keys)
  if (entries.length === 0) return { app: DEFAULT_APP }
  const token = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "")?.[1]
  if (!token) return UNAUTHORIZED
  const digest = sha256(token)
  let app: string | undefined
  // Every key is compared, no early exit.
  for (const [name, expected] of entries) if (timingSafeEqual(digest, expected)) app = name
  return app === undefined ? UNAUTHORIZED : { app }
}
