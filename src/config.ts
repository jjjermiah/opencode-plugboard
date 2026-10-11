/** Plugin options: defaults, validation (D7, D8, D14, D24) and caller authentication (D8). */

import { APP_NAME_PATTERN, DEFAULT_APP, DEFAULTS } from "./contract.ts"
import type { PlugError, PlugboardOptions } from "./contract.ts"

const KNOWN = new Set(["listen", "keys", "models", "aliases", "maxTools", "requestTimeoutMs", "remoteImages"])
const MODEL_PATTERN = /^[^/#*\s]+\/(\*|[^#*\s]+(#[^#*\s]+)?)$/
const ALIAS_TARGET = /^[^/#*\s]+\/[^#*\s]+(#[^#*\s]+)?$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function loopback(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "")
  return h === "localhost" || h === "::1" || /^127(\.\d{1,3}){3}$/.test(h)
}

function positiveInt(value: unknown, name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max)
    throw new Error(`plugboard option \`${name}\` must be an integer between 1 and ${max}`)
  return value
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

  const keys: Record<string, string> = {}
  if (input.keys !== undefined && !isRecord(input.keys)) throw new Error("plugboard option `keys` must be an object of app name -> key")
  for (const [app, key] of Object.entries(input.keys ?? {})) {
    if (app === DEFAULT_APP) throw new Error(`plugboard key name \`${DEFAULT_APP}\` is reserved for keyless loopback use`)
    if (!APP_NAME_PATTERN.test(app)) throw new Error(`plugboard key name \`${app}\` must match ${APP_NAME_PATTERN}`)
    if (typeof key !== "string" || key.length === 0)
      throw new Error(`plugboard key \`${app}\` must be a non-empty string (is its {env:VAR} set?)`)
    keys[app] = key
  }
  if (Object.keys(keys).length === 0 && !loopback(host))
    throw new Error(`plugboard refuses to listen on non-loopback host \`${host}\` without \`keys\``)

  const models = input.models ?? []
  if (!Array.isArray(models)) throw new Error("plugboard option `models` must be an array of strings")
  for (const pattern of models)
    if (typeof pattern !== "string" || !MODEL_PATTERN.test(pattern))
      throw new Error(`plugboard model \`${String(pattern)}\` must be \`provider/model\`, \`provider/model#variant\` or \`provider/*\``)

  const aliases: Record<string, string> = {}
  if (input.aliases !== undefined && !isRecord(input.aliases)) throw new Error("plugboard option `aliases` must be an object of alias -> model")
  for (const [alias, target] of Object.entries(input.aliases ?? {})) {
    if (alias.length === 0 || /[\s]/.test(alias)) throw new Error(`plugboard alias \`${alias}\` must be a non-empty string without whitespace`)
    if (typeof target !== "string" || !ALIAS_TARGET.test(target))
      throw new Error(`plugboard alias \`${alias}\` must target \`provider/model\` or \`provider/model#variant\``)
    aliases[alias] = target
  }

  if (input.remoteImages !== undefined && typeof input.remoteImages !== "boolean")
    throw new Error("plugboard option `remoteImages` must be a boolean")

  return {
    listen: { host, port: port ?? DEFAULTS.port },
    keys,
    models: models as string[],
    aliases,
    maxTools: positiveInt(input.maxTools, "maxTools", DEFAULTS.maxTools, 1024),
    requestTimeoutMs: positiveInt(input.requestTimeoutMs, "requestTimeoutMs", DEFAULTS.requestTimeoutMs),
    remoteImages: input.remoteImages === true,
  }
}

const UNAUTHORIZED: PlugError = {
  status: 401,
  message: "Missing or invalid API key",
  type: "authentication_error",
  code: "invalid_api_key",
}

function same(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

/** D8/D24: no keys -> app `default`; with keys every request needs `Authorization: Bearer <key>`. */
export function authenticate(options: PlugboardOptions, authorization: string | undefined): { app: string } | PlugError {
  const entries = Object.entries(options.keys)
  if (entries.length === 0) return { app: DEFAULT_APP }
  const token = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "")?.[1]
  if (!token) return UNAUTHORIZED
  let app: string | undefined
  for (const [name, key] of entries) if (same(token, key)) app = name
  return app === undefined ? UNAUTHORIZED : { app }
}
