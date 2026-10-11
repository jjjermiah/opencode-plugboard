/** Plugin options: type, defaults, validation, caller authentication and the loopback check. */

import type { PlugError } from "./contract.js"
import { parseAllowEntry, type RemoteImages } from "./session/media.js"
import type { HistoryLimits } from "./session/prune.js"

/** Plugin options, after defaults and validation (see `parseOptions`). */
export interface PlugboardOptions {
  readonly listen: { readonly host: string; readonly port: number }
  /** App name -> API key. App names match APP_NAME_PATTERN; "default" is reserved. */
  readonly keys: Readonly<Record<string, string>>
  /** Allowlist: exact `provider/model`, `provider/model#variant`, or `provider/*` patterns. Empty = nothing allowed. */
  readonly models: ReadonlyArray<string>
  /** Alias -> `provider/model[#variant]`. Targets must also pass the allowlist. */
  readonly aliases: Readonly<Record<string, string>>
  readonly maxTools: number
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
}

export const APP_NAME_PATTERN = /^[a-z0-9-]+$/
export const DEFAULT_APP = "default"
const DEFAULTS = {
  host: "127.0.0.1",
  port: 4010,
  maxTools: 32,
  requestTimeoutMs: 600_000,
} as const

const KNOWN = new Set(["listen", "keys", "models", "aliases", "maxTools", "requestTimeoutMs", "remoteImages", "history", "dropUnsupportedParams", "logFormat", "metrics"])
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
  const appOfKey = new Map<string, string>()
  for (const [app, key] of Object.entries(input.keys ?? {})) {
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
  if (keyEntries.length === 0 && !isLoopbackHost(host))
    throw new Error(`plugboard refuses to listen on non-loopback host \`${host}\` without \`keys\``)

  const models = input.models ?? []
  if (!Array.isArray(models)) throw new Error("plugboard option `models` must be an array of strings")
  for (const pattern of models)
    if (typeof pattern !== "string" || !MODEL_PATTERN.test(pattern))
      throw new Error(`plugboard model \`${String(pattern)}\` must be \`provider/model\`, \`provider/model#variant\` or \`provider/*\``)

  const aliasEntries: Array<[string, string]> = []
  if (input.aliases !== undefined && !isRecord(input.aliases)) throw new Error("plugboard option `aliases` must be an object of alias -> model")
  for (const [alias, target] of Object.entries(input.aliases ?? {})) {
    if (alias.length === 0 || /[\s]/.test(alias)) throw new Error(`plugboard alias \`${alias}\` must be a non-empty string without whitespace`)
    // Plain-object lookups downstream would hit the prototype accessor instead of the alias.
    if (alias === "__proto__") throw new Error("plugboard alias `__proto__` is not allowed")
    if (typeof target !== "string" || !ALIAS_TARGET.test(target))
      throw new Error(`plugboard alias \`${alias}\` must target \`provider/model\` or \`provider/model#variant\``)
    if (CANONICAL_SHAPE.test(alias))
      throw new Error(`plugboard alias \`${alias}\` is written like a \`provider/model\` id; aliases must not contain \`/\` (use a short name such as \`fast\`)`)
    aliasEntries.push([alias, target])
  }
  const aliases: Record<string, string> = Object.fromEntries(aliasEntries)

  const remoteImages = parseRemoteImages(input.remoteImages)
  if (input.dropUnsupportedParams !== undefined && typeof input.dropUnsupportedParams !== "boolean")
    throw new Error("plugboard option `dropUnsupportedParams` must be a boolean")

  if (input.logFormat !== undefined && input.logFormat !== "text" && input.logFormat !== "json")
    throw new Error("plugboard option `logFormat` must be `text` or `json`")
  if (input.metrics !== undefined && typeof input.metrics !== "boolean") throw new Error("plugboard option `metrics` must be a boolean")

  const historyInput = input.history
  if (historyInput !== undefined && !isRecord(historyInput)) throw new Error("plugboard option `history` must be an object")
  for (const key of Object.keys(historyInput ?? {}))
    if (!HISTORY_KNOWN.has(key)) throw new Error(`Unknown plugboard option \`history.${key}\` (known: ${[...HISTORY_KNOWN].join(", ")})`)
  const maxSessions = historyInput?.maxSessions === undefined ? undefined : positiveInt(historyInput.maxSessions, "history.maxSessions", 0)
  const maxAgeDays = historyInput?.maxAgeDays === undefined ? undefined : positiveInt(historyInput.maxAgeDays, "history.maxAgeDays", 0, MAX_AGE_DAYS)

  return {
    listen: { host, port: port ?? DEFAULTS.port },
    keys,
    models: models as string[],
    aliases,
    maxTools: positiveInt(input.maxTools, "maxTools", DEFAULTS.maxTools, 1024),
    requestTimeoutMs: positiveInt(input.requestTimeoutMs, "requestTimeoutMs", DEFAULTS.requestTimeoutMs, MAX_TIMER_MS),
    remoteImages,
    history: { ...(maxSessions === undefined ? {} : { maxSessions }), ...(maxAgeDays === undefined ? {} : { maxAgeDays }) },
    dropUnsupportedParams: input.dropUnsupportedParams !== false,
    logFormat: input.logFormat === "json" ? "json" : "text",
    metrics: input.metrics === true,
  }
}

const UNAUTHORIZED: PlugError = {
  status: 401,
  message: "Missing or invalid API key",
  kind: "authentication",
  code: "invalid_api_key",
}

function same(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

/** No keys -> app `default`; with keys every request needs `Authorization: Bearer <key>`. */
export function authenticate(options: PlugboardOptions, authorization: string | undefined): { app: string } | PlugError {
  const entries = Object.entries(options.keys)
  if (entries.length === 0) return { app: DEFAULT_APP }
  const token = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "")?.[1]
  if (!token) return UNAUTHORIZED
  let app: string | undefined
  for (const [name, key] of entries) if (same(token, key)) app = name
  return app === undefined ? UNAUTHORIZED : { app }
}
