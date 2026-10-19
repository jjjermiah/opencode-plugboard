/** Plugin options: type, defaults, validation, caller authentication and the loopback check. */

import { createHash, timingSafeEqual } from "node:crypto"
import type { CacheConfig } from "./cache.js"
import { isPlugError, type PlugError, type PlugGeneration } from "./contract.js"
import { parseTrustProxy } from "./forwarded.js"
import { allowedBy, parseAliasTarget, parseModelRef, SKILL_PREFIX } from "./models.js"
import { parseAllowEntry, type RemoteImages } from "./session/media.js"
import type { HistoryLimits } from "./session/prune.js"
import { SEED_PREFIX } from "./session/seeds.js"

/** How `/v1/models` spells a model id: the canonical `provider/model#variant`, a UI-safe slug, or both. Resolution accepts either. */
export type ModelIds = "canonical" | "slugs" | "both"

/** Option `logLevel` (#262), lowest first. */
export type LogLevel = "debug" | "info" | "warn" | "error"
const LOG_LEVELS: ReadonlySet<string> = new Set(["debug", "info", "warn", "error"])

/** Plugin options, after defaults and validation (see `parseOptions`). */
export interface PlugboardOptions {
  /** `listen.trustProxy` (#266): the proxies whose forwarded headers are read; absent: none (see `src/forwarded.ts`). */
  readonly listen: { readonly host: string; readonly port: number; readonly trustProxy?: ReadonlyArray<string> }
  /** App name -> API key, from `keys` and `apps.<name>.key` merged. App names match APP_NAME_PATTERN; "default" is reserved. */
  readonly keys: Readonly<Record<string, string>>
  /** Per-app policy (`apps`); only apps that set a policy field appear. Look one up with `appPolicy`. */
  readonly apps: Readonly<Record<string, AppPolicy>>
  /**
   * Allowlist: exact `provider/model`, `provider/model#variant`, or `provider/*` patterns. Empty = nothing allowed.
   * Written as the string `"connected"`, it is `[CONNECTED]`: every model the host catalog offers (see `allowedBy`).
   */
  readonly models: ReadonlyArray<string>
  /** Alias -> `provider/model[#variant]`. Targets must also pass the allowlist. */
  readonly aliases: Readonly<Record<string, string>>
  /**
   * Agent name -> `provider/model[#variant]` (option `agents`): each is listed as `agent/<name>` and runs its
   * OpenCode agent's system prompt on that model. The model must pass the allowlist.
   */
  readonly agents: Readonly<Record<string, string>>
  /**
   * Alias -> the targets after the first, in order, for an alias written as an array. `aliases` holds the
   * first target, so everything that resolves an alias keeps working; the model caller retries the rest
   * (`src/fallback.ts`). Absent for an alias with one target. Every target passes the allowlist.
   */
  readonly fallbacks: Readonly<Record<string, ReadonlyArray<string>>>
  /**
   * Option `fallbackAfterMs` (since 0.40.0, #391): when a target of a list alias has produced no model event within
   * this many ms, its attempt is aborted and the next target is tried. The last target is bounded only by the request
   * deadline. Absent (the default): no first-event deadline. Global only: a list entry is a plain string. Must be below
   * `requestTimeoutMs` and below each `apps.<name>.requestTimeoutMs` (refused at load otherwise).
   */
  readonly fallbackAfterMs?: number
  /**
   * Option `fallbackCooldown`: the circuit breaker of list aliases (`src/breaker.ts`). A target that failed `failureThreshold` times in a row
   * within `windowMs` is skipped for `cooldownMs`, then one request is let through; its success closes the breaker. `false` turns it off.
   * Absent (the default): `DEFAULT_FALLBACK_COOLDOWN`. Process-wide, per target model. Global only.
   */
  readonly fallbackCooldown?: FallbackCooldown | false
  readonly maxTools: number
  /** Most model calls one request may fan out to: `n` for chat completions, prompts x `n` for legacy completions. Each is a full call and a kept session. */
  readonly maxN: number
  readonly requestTimeoutMs: number
  /**
   * Option `silenceMs` (#515): how long a request may hear no event from OpenCode before plugboard reads the session's stored messages. A
   * finished answer there settles the request; an unfinished one means the model is still working, and the request waits on. Absent (the
   * default): 30000. Global only.
   */
  readonly silenceMs?: number
  /**
   * Fetch http(s) image URLs server-side. Off by default: it is an SSRF vector into the host's network.
   * `true` fetches public addresses only (loopback, private, link-local, CGNAT and ULA ranges are refused);
   * `{ allow }` is on too, and lists the hosts (`name`, `*.suffix`), addresses or CIDR ranges that may be
   * fetched even when they are not public.
   */
  readonly remoteImages: RemoteImages
  /**
   * Prune old request sessions (see `src/session/prune.ts`). `maxAgeDays` defaults to 30 (#158); `maxAgeDays: 0`
   * turns the age limit off. `maxSessions` is unset (no count limit) by default. Applies per app. Parsed `{}` means keep forever.
   */
  readonly history: HistoryLimits
  /** Drop sampling parameters the target model is known to reject (reported in `x-plugboard-dropped-params`). On by default; off forwards them as sent. */
  readonly dropUnsupportedParams: boolean
  /** Log line format: `text` (`key=value`, the default) or `json` (one object per line). Process-wide: the live generation's value applies. */
  readonly logFormat: "text" | "json"
  /** Option `logLevel` (since 0.27.0, #262): the lowest level written. Process-wide, like `logFormat`. Default `info`. */
  readonly logLevel: LogLevel
  /** Option `logRequests` (since 0.27.0, #262): `false` drops the per-request access lines (`request`, `request.finished`); warnings and errors stay. */
  readonly logRequests: boolean
  /** Serve `GET /plugboard/metrics` (Prometheus text). Off by default; same authentication as the model routes. */
  readonly metrics: boolean
  /** Option `reasoningOutput` (since 0.36.0): return the model's reasoning on Chat Completions (`reasoning_content` and `reasoning`) and Responses (`reasoning` items). Off by default: reasoning is dropped, as before. */
  readonly reasoningOutput: boolean
  /** Ids listed by `/v1/models`: canonical, slugs (`provider--model__variant`) or both. See `toSlug` in `src/models.ts`. */
  readonly modelIds: ModelIds
  /** Concurrency caps and requests per minute per app (see `src/limits.ts`). Absent: unlimited. */
  readonly limits?: Limits
  /** Per-app budgets (see `src/budgets.ts`): ceilings on requests, tokens and cost per UTC day, week or month. Needs `usage`. Absent: no budgets. */
  readonly budgets?: Budgets
  /** Opt-in exact-match response cache (see `src/cache.ts`). Absent: off. */
  readonly cache?: CacheConfig
  /** Provider prompt-cache affinity (see `src/session/affinity.ts`, #80, #81). Absent: off. Per app: `apps.<name>.promptCache`. */
  readonly promptCache?: PromptCache
  /** Per-app usage statistics (see `src/usage.ts`): recorded and served by `GET /plugboard/usage` and the RPC. */
  readonly usage: UsageConfig
  /** A key that may read every app's usage on `GET /plugboard/usage`. Compared like app keys; must differ from every one of them. */
  readonly adminKey?: string
  /**
   * Option `requireKeys` (#271). `true`: `keys` must be set and every request needs a key, loopback included
   * (`/healthz` and `/readyz` stay open). Absent or `false`: keyless loopback works as before.
   */
  readonly requireKeys?: boolean
  /**
   * Option `keepAlive` (since 0.26.0, #310). Default on: the process keeps its OpenCode Location warm with a cheap durable
   * change every 30 minutes, so OpenCode's 60-minute idle eviction does not close the listener. `false` turns it off.
   */
  readonly keepAlive?: boolean
  /** Browser origins that may call plugboard (option `cors`, #256). Absent: no CORS headers and the keyless `Origin` refusal stays. */
  readonly cors?: CorsConfig
  /** A template for the OpenCode session page of each request: `{id}`, and optional `{directory}` (see src/session/link.ts, #77). */
  readonly historyUrl?: string
}

/**
 * The session link template that applies to `app` (#280): its own `apps.<name>.historyUrl` when set, `undefined`
 * when that is `false`, else the global `historyUrl`. Routes call this with the authenticated app.
 */
export function historyTemplate(options: Pick<PlugboardOptions, "apps" | "historyUrl">, app: string): string | undefined {
  const own = appPolicy(options, app)?.historyUrl
  if (own === false) return undefined
  return own ?? options.historyUrl
}

/**
 * Option `cors` (#256): the browser origins that may call plugboard, and Private Network Access. `origins` holds
 * canonical `scheme://host[:port]` values, or the single `*`, which needs keys. Absent: no CORS headers, as before.
 */
export interface CorsConfig {
  readonly origins: ReadonlyArray<string>
  readonly allowPrivateNetwork: boolean
}

/** Option `usage` after defaults: on, and days of history kept. */
export interface UsageConfig {
  readonly enabled: boolean
  readonly retentionDays: number
}

export type SystemMode = "prepend" | "append" | "replace"

/**
 * Provider prompt-cache affinity (option `promptCache`, src/session/affinity.ts). `off`: a fresh top-level session per
 * request. `anchor`: each request session is a child of one long-lived anchor session per scope key, so OpenCode's
 * affinity (the parent id) and the provider's cache key stay stable. `scope`: `app` (one anchor per app) or `user` (one
 * per end user, from the request's `user` field).
 */
export type AffinityMode = "off" | "anchor"
export type AffinityScope = "app" | "user"
export interface PromptCache {
  readonly affinity: AffinityMode
  readonly scope: AffinityScope
  /** Most anchors one app may hold (option `promptCache.maxAnchors`). A key beyond it gets no affinity (header `none`). */
  readonly maxAnchors?: number
}

/** `promptCache.maxAnchors` when absent. */
export const DEFAULT_MAX_ANCHORS = 1000

/**
 * The endpoint families an app may be limited to (`apps.<name>.endpoints`, #268): `chat` (`/v1/chat/completions`),
 * `completions` (`/v1/completions`), `responses`, `messages` (`/v1/messages` and its `count_tokens`), `gemini` (the
 * `/v1beta` routes) and `models` (`/v1/models`, `/v1/models/{id}`). Since next, `files` is every Files route: `/v1/files...`
 * (OpenAI and Anthropic shapes) and Gemini's `upload/v1beta/files` and `/v1beta/files...`; an app without it cannot upload, list,
 * read or delete a file, and a request that names a file it already holds is not refused for it.
 */
export const ENDPOINTS = ["chat", "completions", "responses", "messages", "gemini", "models", "files"] as const
export type Endpoint = (typeof ENDPOINTS)[number]

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
  /**
   * This app's history limits (option `apps.<name>.history`, since 0.27.0, #265): a field replaces the global one for this app,
   * an unset field falls back to it. Look the effective limits up with `limitsFor` (src/session/prune.ts).
   */
  readonly history?: HistoryLimits
  /** Lowers the global `maxN` for this app (option `apps.<name>.maxN`, since 0.27.0, #270). Look the effective cap up with `maxNFor`. */
  readonly maxN?: number
  /**
   * Exact OpenCode tool ids this app's sessions may run themselves (option `apps.<name>.serverTools`).
   * Absent: none, the session denies every real tool. Trusted apps only, see docs/configuration.md.
   */
  readonly serverTools?: ReadonlyArray<string>
  /** Model steps that may run server tools in one request before the turn is stopped (option `maxServerToolSteps`). */
  readonly maxServerToolSteps?: number
  /** Server tool calls one request may run across all its steps (option `maxServerToolCalls`). */
  readonly maxServerToolCalls?: number
  /**
   * This app's session link template (option `apps.<name>.historyUrl`), or `false` for none. Absent: the global
   * `historyUrl`. Look the effective template up with `historyTemplate`.
   */
  readonly historyUrl?: string | false
  /** This app's prompt-cache affinity (option `apps.<name>.promptCache`). Absent: the global `promptCache`. */
  readonly promptCache?: PromptCache
  /** Endpoint families this app may call (option `apps.<name>.endpoints`, #268). Absent: every endpoint. Check with `endpointRefusal`. */
  readonly endpoints?: ReadonlyArray<Endpoint>
  /**
   * This app's request deadline in ms (option `apps.<name>.requestTimeoutMs`, since 0.32.0, #257). Absent: the global
   * `requestTimeoutMs`. Look the effective value up with `requestTimeoutFor`.
   */
  readonly requestTimeoutMs?: number
  /**
   * The most output tokens one answer of this app may have (option `apps.<name>.maxOutputTokens`, since 0.32.0, #263). It lowers the
   * caller's limit, or sets one when the caller sent none; it is never raised. Applied by `appGeneration` (src/openai/sampling.ts).
   */
  readonly maxOutputTokens?: number
  /**
   * How long the host may finish its step after a stop sequence matched, or after the client left mid-run, before it is interrupted (option `apps.<name>.settleMs`,
   * since 0.38.0, #390). 0 interrupts at once and the usage of the step is then lost. Absent: 2000 ms.
   */
  readonly settleMs?: number
  /**
   * Option `apps.<name>.reasoningOutput` (since 0.36.0): this app's reasoning switch. Absent: the global `reasoningOutput`. Look the
   * effective value up with `reasoningOutputFor`.
   */
  readonly reasoningOutput?: boolean
  /**
   * Option `apps.<name>.hostedTools`: what the Responses route does with a hosted tool (`web_search`, `file_search`, ...) next to the caller's
   * function tools. `drop` (the default) leaves it out and names it in `x-plugboard-dropped-tools`; `refuse` answers 400. Read it with `hostedToolsFor`.
   */
  readonly hostedTools?: HostedTools
  /**
   * Sampling defaults of this app (option `apps.<name>.sampling`, since 0.32.0, #264): a field fills the request only where the caller
   * sent none. Applied by `appGeneration` (src/openai/sampling.ts), before the model-specific drop.
   */
  readonly sampling?: PlugGeneration
  /**
   * The one model every request of this app runs on (option `apps.<name>.model`, since 0.32.0, #261): a canonical id or an alias.
   * The caller's `model` is ignored when it is set. Checked at load against the global `models` and the app's `models`.
   */
  readonly model?: string
  /**
   * A request header that names the end user (option `apps.<name>.userHeader`, since 0.32.0, #272), read instead of the body's
   * `user` (or `metadata.user_id`) when the request sends it. Lower case. Looked up by `requestUser` (src/user.ts).
   */
  readonly userHeader?: string
}

/** One set of caps. A field that is not set is unlimited. */
export interface LimitCaps {
  /** Model calls in flight at once; each call holds one slot. */
  readonly maxConcurrent?: number
  /** Model calls started per minute (a fixed one-minute window). */
  readonly requestsPerMinute?: number
  /** Largest request body this app may send, in bytes (`limits.apps.<name>` only, since 0.32.0, #258). It can only lower `limits.maxBodyBytes`. */
  readonly maxBodyBytes?: number
}

/**
 * Option `limits`. `maxConcurrent` caps all apps together; `perApp` caps every app; `apps.<name>`
 * overrides `perApp` field by field for that app.
 */
export interface Limits {
  readonly maxConcurrent?: number
  readonly perApp?: LimitCaps
  readonly apps?: Readonly<Record<string, LimitCaps>>
  /**
   * Bytes of request bodies buffered at once, across every request in the process (`readJsonBody` in
   * `src/http.ts`). A body that would go over it is refused with 503 `server_busy` before it is read. One app may hold at most half of it.
   */
  readonly maxBodyBytesInFlight?: number
  /** Milliseconds a request body may take to arrive in full; a slower one is refused with 408. */
  readonly bodyReadTimeoutMs?: number
  readonly bodyReadMaxMs?: number
  /**
   * The largest request body any app may send (since 0.32.0, #258), 1 to 33554432. Absent: 32 MiB. It is the ceiling for
   * `apps.<name>.maxBodyBytes`-style caps in `limits.apps`, and a body over it is refused with 413 before it is read.
   */
  readonly maxBodyBytes?: number
}

/** The bounds `readJsonBody` applies before it buffers a request body (see `bodyLimits`). */
export interface BodyLimits {
  readonly maxBytesInFlight: number
  /** The app this request is of, and the bytes that app may hold of the budget (`bodyLimits`). Absent: no split. */
  readonly app?: string
  readonly appShare?: number
  /** No new bytes for this long (idle), then 408 (`limits.bodyReadTimeoutMs`). */
  readonly readTimeoutMs: number
  /** The whole body must be complete within this long, then 408 (`limits.bodyReadMaxMs`). Absent: `BODY_LIMIT_DEFAULTS.readCeilingMs`. */
  readonly readCeilingMs?: number
  /** The largest body this request may send: `limits.apps.<name>.maxBodyBytes`, else `limits.maxBodyBytes`, else 32 MiB (#258). Absent: 32 MiB. */
  readonly maxBodyBytes?: number
}

/**
 * Defaults of `limits.maxBodyBytesInFlight` (128 MiB), `limits.bodyReadTimeoutMs` (30 s idle) and `limits.bodyReadMaxMs` (5 min
 * in total: 10 MiB on a 2 Mbit/s link takes about 42 s, a full 32 MiB about 2 min).
 */
export const BODY_LIMIT_DEFAULTS: BodyLimits & { readonly maxBodyBytes: number; readonly readCeilingMs: number } = {
  maxBytesInFlight: 128 * 1024 * 1024,
  readTimeoutMs: 30_000,
  readCeilingMs: 300_000,
  maxBodyBytes: 32 * 1024 * 1024,
}

/** What a budget counts: HTTP requests on the model routes (refusals by `limits` or budgets left out), tokens, or cost in USD. */
export type BudgetMetric = "requests" | "tokens" | "costUsd"
/** The windows a budget resets on: a UTC calendar day, an ISO week (Monday start) or a calendar month (UTC). */
export type BudgetWindow = "day" | "week" | "month"

/** Ceilings per window. A window that is not set has no ceiling. */
export interface BudgetWindows {
  readonly day?: number
  readonly week?: number
  readonly month?: number
}

/** One set of ceilings. A metric that is not set is unlimited. `costUsd` is an estimate at list prices. */
export interface Budget {
  readonly requests?: BudgetWindows
  readonly tokens?: BudgetWindows
  readonly costUsd?: BudgetWindows
}

/**
 * Option `budgets`. `perApp` applies to every app; `apps.<name>` replaces `perApp` metric by metric for
 * that app (its `requests` replaces `perApp.requests`, the other metrics still come from `perApp`).
 */
export interface Budgets {
  readonly perApp?: Budget
  readonly apps?: Readonly<Record<string, Budget>>
}

export const APP_NAME_PATTERN = /^[a-z0-9-]+$/
/** The longest app name (#418): the app's directory under the data root is named after it, and a file name takes at most 255 bytes. */
export const APP_NAME_MAX = 255
/** Whether `name` is an app name: APP_NAME_PATTERN and at most APP_NAME_MAX characters (ASCII, so bytes). */
export const isAppName = (name: string): boolean => APP_NAME_PATTERN.test(name) && name.length <= APP_NAME_MAX
export const DEFAULT_APP = "default"
/**
 * The `models` value that allows every enabled model of every connected provider. Stored as the one entry of the parsed
 * list, so the empty-list refusal and the JSON comparison across generations need no special case. It is never a
 * `provider/model` pattern, so a list entry spelled this way is refused.
 */
export const CONNECTED = "connected"
/** Model steps that may run server tools per request when `maxServerToolSteps` is not set. */
export const DEFAULT_SERVER_TOOL_STEPS = 8
/** Server tool calls per request when `maxServerToolCalls` is not set (across all steps). */
export const DEFAULT_SERVER_TOOL_CALLS = 16
/** The listener port when `listen.port` is not set. */
export const DEFAULT_PORT = 4010
const DEFAULTS = {
  host: "127.0.0.1",
  port: DEFAULT_PORT,
  maxTools: 64,
  maxN: 1,
  requestTimeoutMs: 600_000,
} as const

/** Option `fallbackCooldown`, resolved. */
export interface FallbackCooldown {
  /** Consecutive retryable failures of one target that open the breaker. */
  readonly failureThreshold: number
  /** How long an open target is skipped, in ms. */
  readonly cooldownMs: number
  /** The failures must fall within this many ms of the first one; a slower streak starts over. */
  readonly windowMs: number
}

/** Used when option `fallbackCooldown` is not set. */
export const DEFAULT_FALLBACK_COOLDOWN: FallbackCooldown = { failureThreshold: 3, cooldownMs: 60_000, windowMs: 60_000 }
const FALLBACK_COOLDOWN_KNOWN = new Set(["failureThreshold", "cooldownMs", "windowMs"])

const KNOWN = new Set([
  "listen",
  "keys",
  "adminKey",
  "apps",
  "models",
  "aliases",
  "agents",
  "maxTools",
  "maxN",
  "requestTimeoutMs",
  "silenceMs",
  "fallbackAfterMs",
  "fallbackCooldown",
  "remoteImages",
  "history",
  "dropUnsupportedParams",
  "logFormat",
  "metrics",
  "modelIds",
  "limits",
  "budgets",
  "cache",
  "usage",
  "historyUrl",
  "promptCache",
  "requireKeys",
  "cors",
  "keepAlive",
  "logLevel",
  "logRequests",
  "reasoningOutput",
])
const USAGE_KNOWN = new Set(["enabled", "retentionDays"])
const USAGE_DEFAULTS = { enabled: true, retentionDays: 90 } as const
/** Ten years: keeps a day-keyed store bounded and a range query well inside its limits. */
const MAX_RETENTION_DAYS = 3650
const LIMITS_KNOWN = new Set(["maxConcurrent", "perApp", "apps", "maxBodyBytesInFlight", "bodyReadTimeoutMs", "bodyReadMaxMs", "maxBodyBytes"])
/** The hard cap of one request body (32 MiB). `limits.maxBodyBytes` and `limits.apps.<name>.maxBodyBytes` cannot go above it. */
const BODY_HARD_CAP = 32 * 1024 * 1024
const LIMIT_CAP_KNOWN = new Set(["maxConcurrent", "requestsPerMinute"])
/** Largest cap accepted: far above any provider's limit, and keeps the error messages short. */
const MAX_LIMIT = 1_000_000
const HISTORY_KNOWN = new Set(["maxSessions", "maxAgeDays", "hidden"])
const CACHE_KNOWN = new Set(["ttlSeconds", "maxEntries", "maxBytes", "apps"])
const CACHE_DEFAULTS = { maxEntries: 1000, maxBytes: 64 * 1024 * 1024 } as const
/** One year: a longer TTL is a typo, and keeps the millisecond conversion a safe integer. */
const MAX_CACHE_TTL_SECONDS = 31_536_000
/** About 100 years: keeps `maxAgeDays * 86_400_000` a safe integer. */
const MAX_AGE_DAYS = 36_500
/** Sessions older than this are pruned when `history.maxAgeDays` is not set (#158). */
const DEFAULT_HISTORY_DAYS = 30
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
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) throw new Error(`plugboard option \`${name}\` must be an integer between 1 and ${max}`)
  return value
}

/** Option `fallbackCooldown`: `false`, or `{ failureThreshold, cooldownMs, windowMs }` with any of them left at its default. */
function parseFallbackCooldown(raw: unknown): FallbackCooldown | false | undefined {
  if (raw === undefined || raw === false) return raw
  if (!isRecord(raw)) throw new Error("plugboard option `fallbackCooldown` must be `false` or an object with `failureThreshold`, `cooldownMs` and `windowMs`")
  for (const key of Object.keys(raw)) if (!FALLBACK_COOLDOWN_KNOWN.has(key)) throw new Error(`Unknown plugboard option \`fallbackCooldown.${key}\` (known: ${[...FALLBACK_COOLDOWN_KNOWN].join(", ")})`)
  return {
    failureThreshold: positiveInt(raw.failureThreshold, "fallbackCooldown.failureThreshold", DEFAULT_FALLBACK_COOLDOWN.failureThreshold, 1000),
    cooldownMs: positiveInt(raw.cooldownMs, "fallbackCooldown.cooldownMs", DEFAULT_FALLBACK_COOLDOWN.cooldownMs, MAX_TIMER_MS),
    windowMs: positiveInt(raw.windowMs, "fallbackCooldown.windowMs", DEFAULT_FALLBACK_COOLDOWN.windowMs, MAX_TIMER_MS),
  }
}

const REMOTE_IMAGES_ERROR = "plugboard option `remoteImages` must be a boolean or `{ allow: [...] }` with host names, IP addresses or CIDR ranges that may be fetched even when they are not public"

const CORS_KNOWN = ["origins", "allowPrivateNetwork"]

/** A browser origin as the `Origin` header spells it: `http` or `https`, host and port, no path, query, credentials or trailing slash. */
function parseOrigin(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return undefined
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
  // WHATWG URL accepts `*` in a host name, so a wildcard host is refused here rather than by the parse.
  if (url.hostname.includes("*")) return undefined
  return text === url.origin ? text : undefined
}

/** Option `cors` (#256). `*` must stand alone and needs keys, so a wildcard never sits in front of a keyless endpoint. */
function parseCors(raw: unknown, keyed: boolean): CorsConfig | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) throw new Error("plugboard option `cors` must be an object: { origins, allowPrivateNetwork }")
  for (const key of Object.keys(raw)) if (!CORS_KNOWN.includes(key)) throw new Error(`Unknown plugboard option \`cors.${key}\` (known: ${CORS_KNOWN.join(", ")})`)
  const origins = raw.origins
  if (!Array.isArray(origins) || origins.length === 0) throw new Error('plugboard option `cors.origins` must be a non-empty array of origins such as `https://chat.example.net`, or ["*"]')
  const list: string[] = []
  for (const origin of origins) {
    if (origin === "*") {
      if (origins.length > 1) throw new Error("plugboard option `cors.origins`: `*` must be the only entry")
      if (!keyed) throw new Error("plugboard option `cors.origins` `*` needs `keys`: a wildcard origin must not sit in front of a keyless endpoint")
      list.push("*")
      continue
    }
    const parsed = parseOrigin(origin)
    if (parsed === undefined)
      throw new Error(
        `plugboard option \`cors.origins\` entry \`${String(origin)}\` must be an \`http://\` or \`https://\` origin: scheme, host and port only, no path, query, credentials or wildcard`,
      )
    list.push(parsed)
  }
  if (raw.allowPrivateNetwork !== undefined && typeof raw.allowPrivateNetwork !== "boolean") throw new Error("plugboard option `cors.allowPrivateNetwork` must be a boolean")
  return { origins: list, allowPrivateNetwork: raw.allowPrivateNetwork === true }
}

/** Option `remoteImages` (#259): the object fields are optional and tighten the fetch; an unset field keeps today's bound. */
const REMOTE_IMAGES_KNOWN = ["allow", "schemes", "maxBytes", "maxItems", "maxRedirects", "timeoutMs"]

function remoteImagesInt(value: unknown, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`plugboard option \`remoteImages.${name}\` must be an integer between ${min} and ${max}`)
  return value
}

function parseRemoteImages(value: unknown): RemoteImages {
  if (value === undefined) return false
  if (typeof value === "boolean") return value
  if (!isRecord(value)) throw new Error(REMOTE_IMAGES_ERROR)
  for (const key of Object.keys(value)) if (!REMOTE_IMAGES_KNOWN.includes(key)) throw new Error(`Unknown plugboard option \`remoteImages.${key}\` (known: ${REMOTE_IMAGES_KNOWN.join(", ")})`)
  const allow = value.allow ?? []
  if (!Array.isArray(allow)) throw new Error(REMOTE_IMAGES_ERROR)
  for (const entry of allow)
    if (typeof entry !== "string" || parseAllowEntry(entry) === undefined)
      throw new Error(`plugboard \`remoteImages.allow\` entry \`${String(entry)}\` must be a host name (\`images.internal\`, \`*.internal\`), an IP address or a CIDR range`)
  const schemes = value.schemes
  if (schemes !== undefined && (!Array.isArray(schemes) || schemes.length === 0 || schemes.some((scheme) => scheme !== "http" && scheme !== "https")))
    throw new Error("plugboard option `remoteImages.schemes` must be a non-empty list of `http` and `https`")
  const maxBytes = remoteImagesInt(value.maxBytes, "maxBytes", 1, 104_857_600)
  const maxItems = remoteImagesInt(value.maxItems, "maxItems", 1, 1000)
  const maxRedirects = remoteImagesInt(value.maxRedirects, "maxRedirects", 0, 10)
  const timeoutMs = remoteImagesInt(value.timeoutMs, "timeoutMs", 1, 600_000)
  return {
    allow: allow as string[],
    ...(schemes === undefined ? {} : { schemes: schemes as string[] }),
    ...(maxBytes === undefined ? {} : { maxBytes }),
    ...(maxItems === undefined ? {} : { maxItems }),
    ...(maxRedirects === undefined ? {} : { maxRedirects }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  }
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

export type HostedTools = "drop" | "refuse"

/** What `app` does with hosted tools on the Responses route: `drop` unless the app sets `hostedTools` (#498). */
export function hostedToolsFor(options: Pick<PlugboardOptions, "apps">, app: string): HostedTools {
  return appPolicy(options, app)?.hostedTools ?? "drop"
}

const APP_KNOWN = new Set([
  "hostedTools",
  "key",
  "models",
  "system",
  "systemMode",
  "tools",
  "maxTools",
  "maxN",
  "history",
  "serverTools",
  "maxServerToolSteps",
  "maxServerToolCalls",
  "historyUrl",
  "promptCache",
  "endpoints",
  "requestTimeoutMs",
  "maxOutputTokens",
  "sampling",
  "model",
  "userHeader",
  "reasoningOutput",
  "settleMs",
])

/**
 * Option `apps.<name>.history` (#265): `maxSessions` and `maxAgeDays`, each 1 or more when set, and `hidden` (since 0.29.0, #337).
 * Unset fields fall back to the global `history`.
 */
function parseAppHistory(raw: unknown, at: string): HistoryLimits {
  if (!isRecord(raw)) throw new Error(`plugboard option \`${at}.history\` must be an object: { maxSessions, maxAgeDays, hidden }`)
  for (const key of Object.keys(raw))
    if (key !== "maxSessions" && key !== "maxAgeDays" && key !== "hidden") throw new Error(`Unknown plugboard option \`${at}.history.${key}\` (known: maxSessions, maxAgeDays, hidden)`)
  const maxSessions = raw.maxSessions === undefined ? undefined : positiveInt(raw.maxSessions, `${at}.history.maxSessions`, 0, 1_000_000)
  const maxAgeDays = raw.maxAgeDays === undefined ? undefined : positiveInt(raw.maxAgeDays, `${at}.history.maxAgeDays`, 0, MAX_AGE_DAYS)
  if (raw.hidden !== undefined && typeof raw.hidden !== "boolean") throw new Error(`plugboard option \`${at}.history.hidden\` must be a boolean`)
  const hidden = raw.hidden as boolean | undefined
  return {
    ...(maxSessions === undefined ? {} : { maxSessions }),
    ...(maxAgeDays === undefined ? {} : { maxAgeDays }),
    ...(hidden === undefined ? {} : { hidden }),
  }
}

/** Option `apps.<name>.endpoints` (#268): a non-empty list of endpoint names from `ENDPOINTS`. */
function parseEndpoints(raw: unknown, at: string): Endpoint[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`${at}.endpoints must be a non-empty array of: ${ENDPOINTS.join(", ")} (omit it to allow every endpoint)`)
  for (const entry of raw)
    if (typeof entry !== "string" || !(ENDPOINTS as readonly string[]).includes(entry)) throw new Error(`${at}.endpoints entry \`${String(entry)}\` must be one of: ${ENDPOINTS.join(", ")}`)
  return raw as Endpoint[]
}
const SERVER_TOOL_PATTERN = /^[A-Za-z0-9_.:-]+$/
const MAX_SERVER_TOOLS = 32
const MAX_SERVER_TOOL_STEPS = 100
const MAX_SERVER_TOOL_CALLS = 1000
/** Tools that start a child session. The child runs with its own agent's rules, not the request session's deny-all (#195). */
const SESSION_SPAWNING_TOOLS: ReadonlySet<string> = new Set(["subagent", "task"])

/** `apps.<name>.serverTools`: exact OpenCode tool ids. No wildcards, no duplicates, and not the seeds or CodeMode's `execute`. */
function parseServerTools(value: unknown, at: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SERVER_TOOLS) throw new Error(`${at}.serverTools must be an array of 1 to ${MAX_SERVER_TOOLS} OpenCode tool ids`)
  const tools: string[] = []
  for (const tool of value) {
    if (typeof tool !== "string" || !SERVER_TOOL_PATTERN.test(tool))
      throw new Error(`${at}.serverTools entry \`${String(tool)}\` must be an exact OpenCode tool id (letters, digits, \`_\`, \`.\`, \`:\`, \`-\`; no wildcards)`)
    if (tool === "execute") throw new Error(`${at}.serverTools cannot name \`execute\`: it is OpenCode's CodeMode tool and would run every tool it wraps`)
    if (SESSION_SPAWNING_TOOLS.has(tool)) throw new Error(`${at}.serverTools cannot name \`${tool}\`: it starts a child session with its own agent rules, outside this app's deny-all`)
    if (tool.startsWith(SEED_PREFIX)) throw new Error(`${at}.serverTools cannot name \`${tool}\`: plugboard's own seed tools are reserved`)
    if (tools.includes(tool)) throw new Error(`${at}.serverTools lists \`${tool}\` twice`)
    tools.push(tool)
  }
  return tools
}
const SYSTEM_MODES: ReadonlySet<string> = new Set(["prepend", "append", "replace"])
const MODEL_IDS: ReadonlySet<string> = new Set(["canonical", "slugs", "both"])

/** Headers that carry a credential: their value is a key, which must never become an end-user label (the log and the usage counts). */
const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set(["authorization", "proxy-authorization", "x-api-key", "api-key", "x-goog-api-key", "x-auth-token", "cookie"])

/** Option `apps.<name>.userHeader` (#272): a lower case header name of 1 to 64 letters, digits or hyphens, and not a credential header. */
function parseUserHeader(raw: unknown, at: string): string {
  if (typeof raw !== "string" || !/^[a-z0-9-]{1,64}$/.test(raw))
    throw new Error(`plugboard option \`${at}\` must be a lower case header name of 1 to 64 letters, digits or hyphens, such as \`x-user-id\``)
  if (CREDENTIAL_HEADERS.has(raw)) throw new Error(`plugboard option \`${at}\` cannot be \`${raw}\`: that header carries a key, and the end user is logged`)
  return raw
}

/**
 * Option `apps.<name>.model` (#261): one canonical id (`provider/model[#variant]`) or an alias name, never a `provider/*` pattern.
 * A canonical id must pass the global `models` and, when the app has `models`, the app's own list (an alias must be listed there by name).
 */
function parsePinnedModel(raw: unknown, at: string, appModels: ReadonlyArray<string> | undefined, context: { aliases: Readonly<Record<string, string>>; models: ReadonlyArray<string> }): string {
  if (typeof raw !== "string" || raw.includes("*") || !(MODEL_PATTERN.test(raw) || Object.hasOwn(context.aliases, raw)))
    throw new Error(`plugboard option \`${at}.model\` must be \`provider/model\`, \`provider/model#variant\` or an alias name (a \`provider/*\` pattern cannot pin one model)`)
  if (Object.hasOwn(context.aliases, raw)) {
    // Runtime (`inAppScope`, src/models.ts) admits an alias that the app lists by name, or whose target an app `models` pattern matches.
    const target = parseModelRef(context.aliases[raw]!)
    if (appModels !== undefined && !appModels.includes(raw) && !(target !== undefined && allowedBy(appModels, target)))
      throw new Error(`plugboard option \`${at}.model\` alias \`${raw}\` must be listed in \`${at}.models\`, or its target must match one of them`)
    return raw
  }
  const ref = parseModelRef(raw)!
  if (!allowedBy(context.models, ref)) throw new Error(`plugboard option \`${at}.model\` \`${raw}\` is not allowed by the \`models\` option`)
  if (appModels !== undefined && !appModels.includes(raw) && !allowedBy(appModels, ref)) throw new Error(`plugboard option \`${at}.model\` \`${raw}\` must be listed in \`${at}.models\``)
  return raw
}

const SAMPLING_KNOWN = ["temperature", "topP", "topK", "maxTokens", "stop", "presencePenalty", "frequencyPenalty"] as const

/**
 * Option `apps.<name>.sampling` (#264): the sampling defaults of one app. Each field is checked like the same field of a request
 * (`temperature` 0 to 2, `topP` 0 to 1, `topK` a positive integer, the penalties -2 to 2, `maxTokens` a positive integer, `stop` 1 to 4 strings).
 */
function parseSampling(raw: unknown, at: string): PlugGeneration {
  if (!isRecord(raw)) throw new Error(`plugboard option \`${at}.sampling\` must be an object`)
  for (const key of Object.keys(raw))
    if (!(SAMPLING_KNOWN as readonly string[]).includes(key)) throw new Error(`Unknown plugboard option \`${at}.sampling.${key}\` (known: ${SAMPLING_KNOWN.join(", ")})`)
  const number = (key: "temperature" | "topP" | "presencePenalty" | "frequencyPenalty", min: number, max: number): number | undefined => {
    const value = raw[key]
    if (value === undefined) return undefined
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`plugboard option \`${at}.sampling.${key}\` must be a number from ${min} to ${max}`)
    return value
  }
  const stop = raw.stop === undefined ? undefined : raw.stop
  if (stop !== undefined && (!Array.isArray(stop) || stop.length === 0 || stop.length > 4 || stop.some((entry) => typeof entry !== "string")))
    throw new Error(`plugboard option \`${at}.sampling.stop\` must be an array of 1 to 4 strings`)
  const temperature = number("temperature", 0, 2)
  const topP = number("topP", 0, 1)
  const topK = raw.topK === undefined ? undefined : positiveInt(raw.topK, `${at}.sampling.topK`, 0)
  const presencePenalty = number("presencePenalty", -2, 2)
  const frequencyPenalty = number("frequencyPenalty", -2, 2)
  const maxTokens = raw.maxTokens === undefined ? undefined : positiveInt(raw.maxTokens, `${at}.sampling.maxTokens`, 0, MAX_TIMER_MS)
  return {
    ...(temperature === undefined ? {} : { temperature }),
    ...(topP === undefined ? {} : { topP }),
    ...(topK === undefined ? {} : { topK }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(stop === undefined ? {} : { stop: stop as string[] }),
    ...(presencePenalty === undefined ? {} : { presencePenalty }),
    ...(frequencyPenalty === undefined ? {} : { frequencyPenalty }),
  }
}

/** Validates `apps` (the `key` field was merged into `keys` already) into per-app policies. */
function parseApps(
  raw: unknown,
  context: { keys: Readonly<Record<string, string>>; aliases: Readonly<Record<string, string>>; models: ReadonlyArray<string>; maxTools: number; maxN: number },
): Record<string, AppPolicy> {
  const entries: Array<[string, AppPolicy]> = []
  for (const [app, value] of Object.entries(isRecord(raw) ? raw : {})) {
    const at = `plugboard \`apps.${app}\``
    if (app !== DEFAULT_APP && !isAppName(app)) throw new Error(`plugboard app name \`${app}\` must match ${APP_NAME_PATTERN} and be at most ${APP_NAME_MAX} characters (or be \`${DEFAULT_APP}\`)`)
    if (!isRecord(value)) throw new Error(`${at} must be an object`)
    for (const field of Object.keys(value)) if (!APP_KNOWN.has(field)) throw new Error(`Unknown plugboard option \`apps.${app}.${field}\` (known: ${[...APP_KNOWN].join(", ")})`)
    const keyed = Object.keys(context.keys).length > 0
    if (app === DEFAULT_APP && (keyed || value.key !== undefined)) throw new Error(`${at} configures the keyless app and cannot be used together with \`keys\`; name the app and give it a key instead`)
    if (app !== DEFAULT_APP && !Object.hasOwn(context.keys, app)) throw new Error(`${at} has no key: add \`key\` there or an entry in \`keys\``)

    // `"connected"` names no narrowing: the app gets whatever the global `models` allows, the same as omitting it.
    const appModels = value.models === CONNECTED ? undefined : value.models
    if (appModels !== undefined) {
      if (!Array.isArray(appModels) || appModels.length === 0) throw new Error(`${at}.models must be a non-empty array or \`"connected"\` (omit it to inherit the global \`models\`)`)
      for (const entry of appModels)
        if (typeof entry !== "string" || !(MODEL_PATTERN.test(entry) || Object.hasOwn(context.aliases, entry)))
          throw new Error(`${at}.models entry \`${String(entry)}\` must be \`provider/model\`, \`provider/model#variant\`, \`provider/*\` or an alias name`)
    }
    if (value.system !== undefined && (typeof value.system !== "string" || value.system.trim().length === 0)) throw new Error(`${at}.system must be a non-empty string`)
    if (value.systemMode !== undefined && (typeof value.systemMode !== "string" || !SYSTEM_MODES.has(value.systemMode)))
      throw new Error(`${at}.systemMode must be \`prepend\`, \`append\` or \`replace\``)
    if (value.systemMode !== undefined && value.system === undefined) throw new Error(`${at}.systemMode needs \`system\``)
    if (value.tools !== undefined && typeof value.tools !== "boolean") throw new Error(`${at}.tools must be a boolean`)
    const maxTools = value.maxTools === undefined ? undefined : positiveInt(value.maxTools, `apps.${app}.maxTools`, 0, context.maxTools)
    // Only lowers the global `maxN` (#270), like `maxTools`: a higher value would be a second, unchecked global.
    const maxN = value.maxN === undefined ? undefined : positiveInt(value.maxN, `apps.${app}.maxN`, 0, context.maxN)
    if (value.serverTools !== undefined && app === DEFAULT_APP) throw new Error(`${at}.serverTools needs a key: the keyless app cannot run OpenCode tools; name the app and give it a key`)
    const serverTools = value.serverTools === undefined ? undefined : parseServerTools(value.serverTools, at)
    if (value.maxServerToolSteps !== undefined && serverTools === undefined) throw new Error(`${at}.maxServerToolSteps needs \`serverTools\``)
    const maxServerToolSteps =
      value.maxServerToolSteps === undefined ? undefined : positiveInt(value.maxServerToolSteps, `apps.${app}.maxServerToolSteps`, DEFAULT_SERVER_TOOL_STEPS, MAX_SERVER_TOOL_STEPS)
    if (value.maxServerToolCalls !== undefined && serverTools === undefined) throw new Error(`${at}.maxServerToolCalls needs \`serverTools\``)
    const maxServerToolCalls =
      value.maxServerToolCalls === undefined ? undefined : positiveInt(value.maxServerToolCalls, `apps.${app}.maxServerToolCalls`, DEFAULT_SERVER_TOOL_CALLS, MAX_SERVER_TOOL_CALLS)

    // `false` turns the link off for this app; a string is its own template (validated like the global one).
    const historyUrl = value.historyUrl === false ? false : parseHistoryUrl(value.historyUrl, `plugboard option \`apps.${app}.historyUrl\``)
    const promptCache = parsePromptCache(value.promptCache, `apps.${app}.promptCache`)
    const endpoints = value.endpoints === undefined ? undefined : parseEndpoints(value.endpoints, at)
    const history = value.history === undefined ? undefined : parseAppHistory(value.history, `apps.${app}`)
    // A deadline may be longer or shorter than the global one (#257); it is checked against the same ceiling as the global option.
    const requestTimeoutMs = value.requestTimeoutMs === undefined ? undefined : positiveInt(value.requestTimeoutMs, `apps.${app}.requestTimeoutMs`, 0, MAX_TIMER_MS)
    const maxOutputTokens = value.maxOutputTokens === undefined ? undefined : positiveInt(value.maxOutputTokens, `apps.${app}.maxOutputTokens`, 0, MAX_TIMER_MS)
    const settleMs = value.settleMs === undefined ? undefined : positiveInt(value.settleMs, `apps.${app}.settleMs`, 0, MAX_TIMER_MS)
    const sampling = value.sampling === undefined ? undefined : parseSampling(value.sampling, `apps.${app}`)
    const model = value.model === undefined ? undefined : parsePinnedModel(value.model, `apps.${app}`, appModels as string[] | undefined, context)
    const userHeader = value.userHeader === undefined ? undefined : parseUserHeader(value.userHeader, `apps.${app}.userHeader`)
    if (value.reasoningOutput !== undefined && typeof value.reasoningOutput !== "boolean") throw new Error(`plugboard option \`apps.${app}.reasoningOutput\` must be a boolean`)
    const reasoningOutput = value.reasoningOutput as boolean | undefined
    if (value.hostedTools !== undefined && value.hostedTools !== "drop" && value.hostedTools !== "refuse")
      throw new Error(`plugboard option \`apps.${app}.hostedTools\` must be \`drop\` or \`refuse\``)
    const hostedTools = value.hostedTools as HostedTools | undefined
    const policy: AppPolicy = {
      ...(appModels === undefined ? {} : { models: appModels as string[] }),
      ...(value.system === undefined ? {} : { system: value.system as string }),
      systemMode: (value.systemMode as SystemMode | undefined) ?? "prepend",
      tools: value.tools !== false,
      ...(maxTools === undefined ? {} : { maxTools }),
      ...(maxN === undefined ? {} : { maxN }),
      ...(history === undefined ? {} : { history }),
      ...(serverTools === undefined ? {} : { serverTools }),
      ...(maxServerToolSteps === undefined ? {} : { maxServerToolSteps }),
      ...(maxServerToolCalls === undefined ? {} : { maxServerToolCalls }),
      ...(historyUrl === undefined ? {} : { historyUrl }),
      ...(promptCache === undefined ? {} : { promptCache }),
      ...(endpoints === undefined ? {} : { endpoints }),
      ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      ...(settleMs === undefined ? {} : { settleMs }),
      ...(sampling === undefined ? {} : { sampling }),
      ...(model === undefined ? {} : { model }),
      ...(userHeader === undefined ? {} : { userHeader }),
      ...(reasoningOutput === undefined ? {} : { reasoningOutput }),
      ...(hostedTools === undefined ? {} : { hostedTools }),
    }
    // An app that only carries a key has no policy to look up.
    if (
      appModels !== undefined ||
      value.system !== undefined ||
      value.tools !== undefined ||
      maxTools !== undefined ||
      maxN !== undefined ||
      history !== undefined ||
      serverTools !== undefined ||
      historyUrl !== undefined ||
      promptCache !== undefined ||
      endpoints !== undefined ||
      requestTimeoutMs !== undefined ||
      maxOutputTokens !== undefined ||
      sampling !== undefined ||
      model !== undefined ||
      userHeader !== undefined ||
      reasoningOutput !== undefined ||
      hostedTools !== undefined ||
      settleMs !== undefined
    )
      entries.push([app, policy])
  }
  return Object.fromEntries(entries)
}

const AFFINITY_MODES = new Set(["off", "anchor"])
const AFFINITY_SCOPES = new Set(["app", "user"])
const PROMPT_CACHE_KNOWN = new Set(["affinity", "scope", "maxAnchors"])

/** Option `promptCache` (global or per app): `undefined` when absent. Both fields are required once the object is given. */
export function parsePromptCache(raw: unknown, at: string): PromptCache | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) throw new Error(`plugboard option \`${at}\` must be an object: { affinity, scope }`)
  for (const key of Object.keys(raw)) if (!PROMPT_CACHE_KNOWN.has(key)) throw new Error(`Unknown plugboard option \`${at}.${key}\` (known: affinity, scope, maxAnchors)`)
  if (typeof raw.affinity !== "string" || !AFFINITY_MODES.has(raw.affinity)) throw new Error(`plugboard option \`${at}.affinity\` must be \`off\` or \`anchor\``)
  if (typeof raw.scope !== "string" || !AFFINITY_SCOPES.has(raw.scope)) throw new Error(`plugboard option \`${at}.scope\` must be \`app\` or \`user\``)
  const maxAnchors = raw.maxAnchors === undefined ? undefined : positiveInt(raw.maxAnchors, `${at}.maxAnchors`, DEFAULT_MAX_ANCHORS, 1_000_000)
  return {
    affinity: raw.affinity as AffinityMode,
    scope: raw.scope as AffinityScope,
    ...(maxAnchors === undefined ? {} : { maxAnchors }),
  }
}

/** Validates one set of caps (`limits.perApp`, or one `limits.apps` entry): each cap is a positive integer. */
function parseCaps(raw: unknown, at: string, allowBodyCap = false): LimitCaps {
  if (!isRecord(raw)) throw new Error(`plugboard option \`${at}\` must be an object`)
  // `maxBodyBytes` is a cap only for an app (`limits.apps`), never for `limits.perApp`, which would apply it to every app.
  const known = allowBodyCap ? [...LIMIT_CAP_KNOWN, "maxBodyBytes"] : [...LIMIT_CAP_KNOWN]
  for (const key of Object.keys(raw)) if (!known.includes(key)) throw new Error(`Unknown plugboard option \`${at}.${key}\` (known: ${known.join(", ")})`)
  return {
    ...(raw.maxConcurrent === undefined ? {} : { maxConcurrent: positiveInt(raw.maxConcurrent, `${at}.maxConcurrent`, 0, MAX_LIMIT) }),
    ...(raw.requestsPerMinute === undefined ? {} : { requestsPerMinute: positiveInt(raw.requestsPerMinute, `${at}.requestsPerMinute`, 0, MAX_LIMIT) }),
    ...(raw.maxBodyBytes === undefined ? {} : { maxBodyBytes: positiveInt(raw.maxBodyBytes, `${at}.maxBodyBytes`, 0, BODY_HARD_CAP) }),
  }
}

/** Validates `limits`. An `apps` entry must name a configured app: a key in `keys` (or `default`, only when there are no keys). */
function parseLimits(raw: unknown, keys: Readonly<Record<string, string>>): Limits | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) throw new Error("plugboard option `limits` must be an object")
  for (const key of Object.keys(raw)) if (!LIMITS_KNOWN.has(key)) throw new Error(`Unknown plugboard option \`limits.${key}\` (known: ${[...LIMITS_KNOWN].join(", ")})`)
  const appsRaw = raw.apps
  if (appsRaw !== undefined && !isRecord(appsRaw)) throw new Error("plugboard option `limits.apps` must be an object of app name -> caps")
  const apps: Record<string, LimitCaps> = {}
  for (const [app, value] of Object.entries(appsRaw ?? {})) {
    const at = `limits.apps.${app}`
    const configured = app === DEFAULT_APP ? Object.keys(keys).length === 0 : Object.hasOwn(keys, app)
    if (!configured) throw new Error(`plugboard option \`${at}\` must name a configured app (a key in \`keys\`; \`${DEFAULT_APP}\` only without keys)`)
    apps[app] = parseCaps(value, at, true)
  }
  const maxBodyBytes = raw.maxBodyBytes === undefined ? undefined : positiveInt(raw.maxBodyBytes, "limits.maxBodyBytes", 0, BODY_HARD_CAP)
  // An app's body cap only lowers the global one (or the hard cap when there is none), like `maxTools` and `maxN` (#258).
  for (const [app, caps] of Object.entries(apps))
    if (caps.maxBodyBytes !== undefined && caps.maxBodyBytes > (maxBodyBytes ?? BODY_HARD_CAP))
      throw new Error(`plugboard option \`limits.apps.${app}.maxBodyBytes\` cannot be above \`limits.maxBodyBytes\` (or ${BODY_HARD_CAP} when that is unset)`)
  // An explicit budget must hold one body of its largest size per configured app (`bodyRequirement`). Unset, it grows with the apps.
  if (raw.maxBodyBytesInFlight !== undefined && Object.keys(keys).length > 1) {
    const cap = positiveInt(raw.maxBodyBytesInFlight, "limits.maxBodyBytesInFlight", 0, Number.MAX_SAFE_INTEGER)
    const globalMax = maxBodyBytes ?? BODY_LIMIT_DEFAULTS.maxBodyBytes
    const need = Object.keys(keys).reduce((sum, app) => sum + (apps[app]?.maxBodyBytes ?? globalMax), 0)
    if (cap < need)
      throw new Error(
        `plugboard option \`limits.maxBodyBytesInFlight\` (${cap}) must be at least ${need}: each of the ${Object.keys(keys).length} apps needs room for one body of its largest size (\`limits.maxBodyBytes\`, or \`limits.apps.<name>.maxBodyBytes\`). Unset it to let it grow with the apps`,
      )
  }
  return {
    ...(maxBodyBytes === undefined ? {} : { maxBodyBytes }),
    ...(raw.maxConcurrent === undefined ? {} : { maxConcurrent: positiveInt(raw.maxConcurrent, "limits.maxConcurrent", 0, MAX_LIMIT) }),
    ...(raw.perApp === undefined ? {} : { perApp: parseCaps(raw.perApp, "limits.perApp") }),
    ...(appsRaw === undefined ? {} : { apps }),
    ...(raw.maxBodyBytesInFlight === undefined ? {} : { maxBodyBytesInFlight: positiveInt(raw.maxBodyBytesInFlight, "limits.maxBodyBytesInFlight", 0, Number.MAX_SAFE_INTEGER) }),
    ...(raw.bodyReadTimeoutMs === undefined ? {} : { bodyReadTimeoutMs: positiveInt(raw.bodyReadTimeoutMs, "limits.bodyReadTimeoutMs", 0, MAX_TIMER_MS) }),
    ...(raw.bodyReadMaxMs === undefined ? {} : { bodyReadMaxMs: positiveInt(raw.bodyReadMaxMs, "limits.bodyReadMaxMs", 0, MAX_TIMER_MS) }),
  }
}

/**
 * The apps that hold shares of the body budget: the apps of the configured keys and of the runtime keys, each app once however
 * many keys it has (the default app when there are none, which is keyless).
 */
export function bodyApps(options: Pick<PlugboardOptions, "keys">, runtimeApps: ReadonlyArray<string> = []): string[] {
  const names = new Set([...Object.keys(options.keys ?? {}), ...runtimeApps])
  return names.size === 0 ? [DEFAULT_APP] : [...names]
}

/** The largest body an app may send: `limits.apps.<name>.maxBodyBytes`, else `limits.maxBodyBytes`, else 32 MiB. */
export function bodyCapOf(options: Pick<PlugboardOptions, "limits">, app: string): number {
  return options.limits?.apps?.[app]?.maxBodyBytes ?? options.limits?.maxBodyBytes ?? BODY_LIMIT_DEFAULTS.maxBodyBytes
}

/** The budget the apps need for one body each, at their largest sizes: the sum of `bodyCapOf` over `apps`. */
export function bodyRequirement(options: Pick<PlugboardOptions, "limits">, apps: ReadonlyArray<string>): number {
  return apps.reduce((sum, app) => sum + bodyCapOf(options, app), 0)
}

/**
 * The body budget in force (`limits.maxBodyBytesInFlight`). Set, it is kept as it is (and `parseOptions` and the admin key API
 * refuse a set value below `bodyRequirement`). Unset, it is max(128 MiB, `bodyRequirement`), so every app can always send one
 * body of its largest size: an upgrade with several apps and no setting keeps working.
 */
export function bodyBudget(options: Pick<PlugboardOptions, "limits">, apps: ReadonlyArray<string>): number {
  return options.limits?.maxBodyBytesInFlight ?? Math.max(BODY_LIMIT_DEFAULTS.maxBytesInFlight, bodyRequirement(options, apps))
}

/**
 * The body limits in force for a request of `app` (`limits.maxBodyBytesInFlight`, `limits.bodyReadTimeoutMs`, `limits.bodyReadMaxMs`,
 * and the largest body, #258). With several apps the budget is split in proportion to each app's largest body, so every app's share
 * holds one body of its largest size (`bodyRequirement` fits the budget). `runtimeApps` are the apps of the runtime keys. One app has
 * the whole budget.
 */
export function bodyLimits(options: Pick<PlugboardOptions, "limits" | "keys">, app?: string, runtimeApps: ReadonlyArray<string> = []): BodyLimits {
  const apps = bodyApps(options, runtimeApps)
  const budget = bodyBudget(options, apps)
  const split = apps.length > 1 && app !== undefined
  const own = app !== undefined && options.limits?.apps && Object.hasOwn(options.limits.apps, app) ? options.limits.apps[app] : undefined
  return {
    maxBytesInFlight: budget,
    ...(split ? { app, appShare: Math.floor((budget * bodyCapOf(options, app)) / bodyRequirement(options, apps)) } : {}),
    readTimeoutMs: options.limits?.bodyReadTimeoutMs ?? BODY_LIMIT_DEFAULTS.readTimeoutMs,
    readCeilingMs: options.limits?.bodyReadMaxMs ?? BODY_LIMIT_DEFAULTS.readCeilingMs,
    maxBodyBytes: own?.maxBodyBytes ?? options.limits?.maxBodyBytes ?? BODY_LIMIT_DEFAULTS.maxBodyBytes,
  }
}

/**
 * The refusal for `app` calling `endpoint` (#268): 403 `endpoint_forbidden` when `apps.<app>.endpoints` is set and does not
 * list it; `undefined` when the app may call it. Callers run this after authentication (I15).
 */
export function endpointRefusal(options: Pick<PlugboardOptions, "apps">, app: string, endpoint: Endpoint): PlugError | undefined {
  const allowed = appPolicy(options, app)?.endpoints
  if (allowed === undefined || allowed.includes(endpoint)) return undefined
  return { status: 403, kind: "permission", code: "endpoint_forbidden", message: `This app may not call the ${endpoint} endpoint: \`apps.${app}.endpoints\` does not list it` }
}

/**
 * The most choices (`n`) one request of `app` may ask for (#270): its `apps.<name>.maxN` when set, else the global `maxN`. The app's
 * value only lowers the global one (checked at load), so this is never more than `options.maxN`.
 */
export function maxNFor(options: Pick<PlugboardOptions, "apps" | "maxN">, app: string): number {
  return appPolicy(options, app)?.maxN ?? options.maxN
}

/** The option that set the cap of `app` (#319): `apps.<app>.maxN` when the app has its own, else `maxN`. Named in the 400 message. */
export function maxNOption(options: Pick<PlugboardOptions, "apps">, app: string): string {
  return appPolicy(options, app)?.maxN === undefined ? "maxN" : `apps.${app}.maxN`
}

/** Each app's own history limits (`apps.<name>.history`, #265), keyed by app name. Apps without the option are absent. */
export function appHistoryLimits(options: Pick<PlugboardOptions, "apps">): Record<string, HistoryLimits> {
  return Object.fromEntries(Object.entries(options.apps).flatMap(([app, policy]) => (policy.history === undefined ? [] : [[app, policy.history] as const])))
}

/** The policy configured for `app` (`default` for the keyless app), if any. Own-property lookup: an app name never reaches the prototype. */
export function appPolicy(options: Pick<PlugboardOptions, "apps">, app: string): AppPolicy | undefined {
  return Object.hasOwn(options.apps, app) ? options.apps[app] : undefined
}

/** Whether reasoning is returned for `app` (option `reasoningOutput`, per app or global, since 0.36.0). A per-app `false` beats a global `true`. */
export function reasoningOutputFor(options: Pick<PlugboardOptions, "apps" | "reasoningOutput">, app: string): boolean {
  return appPolicy(options, app)?.reasoningOutput ?? options.reasoningOutput
}

/**
 * The request deadline (ms) of a request of `app`: `apps.<name>.requestTimeoutMs` when the app sets one (#257), else the
 * global `requestTimeoutMs`. `app` is `undefined` when no credential matched yet; the global value applies then.
 */
export function requestTimeoutFor(options: Pick<PlugboardOptions, "apps" | "requestTimeoutMs">, app: string | undefined): number {
  return (app === undefined ? undefined : appPolicy(options, app)?.requestTimeoutMs) ?? options.requestTimeoutMs
}

/**
 * The model and effort a request of `app` resolves (#261): the app's pinned `model` with no caller effort (the pin names the variant),
 * else the caller's `model` and `reasoning_effort`.
 */
export function requestedModel(options: Pick<PlugboardOptions, "apps">, app: string, model: string, effort: string | undefined): { model: string; effort: string | undefined } {
  const pinned = appPolicy(options, app)?.model
  return pinned === undefined ? { model, effort } : { model: pinned, effort: undefined }
}

/** The option that set `requestTimeoutFor` for `app`, named in the 504 message (#257): the app's own, else the global one. */
export function requestTimeoutOption(options: Pick<PlugboardOptions, "apps">, app: string | undefined): string {
  return app !== undefined && appPolicy(options, app)?.requestTimeoutMs !== undefined ? `apps.${app}.requestTimeoutMs` : "requestTimeoutMs"
}

function parseUsage(value: unknown): UsageConfig {
  if (value === undefined) return { ...USAGE_DEFAULTS }
  if (!isRecord(value)) throw new Error("plugboard option `usage` must be an object")
  for (const key of Object.keys(value)) if (!USAGE_KNOWN.has(key)) throw new Error(`Unknown plugboard option \`usage.${key}\` (known: ${[...USAGE_KNOWN].join(", ")})`)
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") throw new Error("plugboard option `usage.enabled` must be a boolean")
  return {
    enabled: value.enabled !== false,
    retentionDays: positiveInt(value.retentionDays, "usage.retentionDays", USAGE_DEFAULTS.retentionDays, MAX_RETENTION_DAYS),
  }
}

function parseCache(value: unknown, keys: Readonly<Record<string, string>>): CacheConfig | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("plugboard option `cache` must be an object with `ttlSeconds`")
  for (const key of Object.keys(value)) if (!CACHE_KNOWN.has(key)) throw new Error(`Unknown plugboard option \`cache.${key}\` (known: ${[...CACHE_KNOWN].join(", ")})`)
  if (value.ttlSeconds === undefined) throw new Error("plugboard option `cache.ttlSeconds` is required (how long an answer is served, in seconds)")
  const ttlSeconds = positiveInt(value.ttlSeconds, "cache.ttlSeconds", 0, MAX_CACHE_TTL_SECONDS)
  const maxEntries = positiveInt(value.maxEntries, "cache.maxEntries", CACHE_DEFAULTS.maxEntries)
  const maxBytes = positiveInt(value.maxBytes, "cache.maxBytes", CACHE_DEFAULTS.maxBytes)
  if (value.apps === undefined) return { ttlSeconds, maxEntries, maxBytes }
  if (!Array.isArray(value.apps) || value.apps.length === 0) throw new Error("plugboard option `cache.apps` must be a non-empty array of app names")
  // A name that can never authenticate would silently leave the cache off for the app the user meant.
  const known = Object.keys(keys).length === 0 ? [DEFAULT_APP] : Object.keys(keys)
  for (const app of value.apps) if (typeof app !== "string" || !known.includes(app)) throw new Error(`plugboard \`cache.apps\` entry \`${String(app)}\` is not an app (known: ${known.join(", ")})`)
  return { ttlSeconds, maxEntries, maxBytes, apps: [...new Set(value.apps as string[])] }
}

const BUDGET_METRICS: ReadonlyArray<BudgetMetric> = ["requests", "tokens", "costUsd"]
const BUDGET_WINDOWS: ReadonlyArray<BudgetWindow> = ["day", "week", "month"]
/** The most days a window can span: a month is up to 31. Retention must keep at least that many, or a budget would count from pruned records. */
const WINDOW_DAYS: Readonly<Record<BudgetWindow, number>> = { day: 1, week: 7, month: 31 }

/** The longest window any ceiling of `budgets` uses, in days (0 without budgets). */
function widestWindowDays(budgets: Budgets | undefined): number {
  let most = 0
  for (const budget of [budgets?.perApp, ...Object.values(budgets?.apps ?? {})])
    for (const metric of [budget?.requests, budget?.tokens, budget?.costUsd]) for (const window of Object.keys(metric ?? {}) as BudgetWindow[]) most = Math.max(most, WINDOW_DAYS[window])
  return most
}

/**
 * Validates `budgets`: `{ perApp?, apps? }`, each a budget of `requests`, `tokens` and `costUsd`, each of
 * those a map of window (`day`, `week`, `month`) to a positive limit. Counts are integers, costs any positive
 * number of USD. An `apps` entry must name a configured app, as in `limits`.
 */
function parseBudgets(raw: unknown, keys: Readonly<Record<string, string>>): Budgets | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) throw new Error("plugboard option `budgets` must be an object")
  for (const key of Object.keys(raw)) if (key !== "perApp" && key !== "apps") throw new Error(`Unknown plugboard option \`budgets.${key}\` (known: perApp, apps)`)

  const budget = (value: unknown, at: string): Budget => {
    if (!isRecord(value)) throw new Error(`plugboard option \`${at}\` must be an object`)
    for (const key of Object.keys(value)) if (!BUDGET_METRICS.includes(key as BudgetMetric)) throw new Error(`Unknown plugboard option \`${at}.${key}\` (known: ${BUDGET_METRICS.join(", ")})`)
    const parsed: Record<string, Record<string, number>> = {}
    for (const metric of BUDGET_METRICS) {
      const windows = value[metric]
      if (windows === undefined) continue
      const field = `${at}.${metric}`
      if (!isRecord(windows)) throw new Error(`plugboard option \`${field}\` must be an object of window (${BUDGET_WINDOWS.join(", ")}) to limit`)
      const limits: Record<string, number> = {}
      for (const window of Object.keys(windows)) {
        if (!BUDGET_WINDOWS.includes(window as BudgetWindow)) throw new Error(`Unknown plugboard option \`${field}.${window}\` (known: ${BUDGET_WINDOWS.join(", ")})`)
        const limit = windows[window]
        if (limit === undefined) continue
        if (metric === "costUsd") {
          if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) throw new Error(`plugboard option \`${field}.${window}\` must be a positive number of USD`)
          limits[window] = limit
        } else limits[window] = positiveInt(limit, `${field}.${window}`, 0, Number.MAX_SAFE_INTEGER)
      }
      parsed[metric] = limits
    }
    return parsed as Budget
  }

  const perApp = raw.perApp === undefined ? undefined : budget(raw.perApp, "budgets.perApp")
  if (raw.apps !== undefined && !isRecord(raw.apps)) throw new Error("plugboard option `budgets.apps` must be an object of app name -> budget")
  const apps: Record<string, Budget> = {}
  for (const [app, value] of Object.entries(isRecord(raw.apps) ? raw.apps : {})) {
    const at = `budgets.apps.${app}`
    const configured = app === DEFAULT_APP ? Object.keys(keys).length === 0 : Object.hasOwn(keys, app)
    if (!configured) throw new Error(`plugboard option \`${at}\` must name a configured app (a key in \`keys\`; \`${DEFAULT_APP}\` only without keys)`)
    apps[app] = budget(value, at)
  }
  return { ...(perApp === undefined ? {} : { perApp }), ...(raw.apps === undefined ? {} : { apps }) }
}

const AGENT_KNOWN = new Set(["name", "model"])
/** An OpenCode agent name: letters, digits, `_` and `-`, starting with a letter or digit. */
const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/**
 * Option `agents`: `{ name, model }` per OpenCode agent to expose. `model` is required and must pass the
 * allowlist, so an agent's own configured model never runs outside `models` (the agent's model setting is
 * not read). Names must be unique.
 */
function parseAgents(raw: unknown, models: ReadonlyArray<string>): Record<string, string> {
  if (raw === undefined) return {}
  if (!Array.isArray(raw)) throw new Error("plugboard option `agents` must be an array of { name, model } objects")
  const entries: Array<[string, string]> = []
  for (const item of raw) {
    if (!isRecord(item)) throw new Error("plugboard option `agents` entries must be objects of the form { name, model }")
    for (const key of Object.keys(item)) if (!AGENT_KNOWN.has(key)) throw new Error(`Unknown plugboard option \`agents.${key}\` (known: ${[...AGENT_KNOWN].join(", ")})`)
    const { name, model } = item
    if (typeof name !== "string" || !AGENT_NAME.test(name)) throw new Error(`plugboard agent name \`${String(name)}\` must match ${AGENT_NAME} (an OpenCode agent name)`)
    if (entries.some(([known]) => known === name)) throw new Error(`plugboard agent \`${name}\` is listed more than once in \`agents\``)
    if (typeof model !== "string" || !ALIAS_TARGET.test(model)) throw new Error(`plugboard agent \`${name}\` must set \`model\` to \`provider/model\` or \`provider/model#variant\``)
    if (!allowedBy(models as string[], parseModelRef(model)!)) throw new Error(`plugboard agent \`${name}\` model \`${model}\` is not allowed by the \`models\` option`)
    entries.push([name, model])
  }
  return Object.fromEntries(entries)
}

/**
 * Option `historyUrl` (#77): an http(s) URL template that must contain `{id}`. Its only other placeholder is
 * `{directory}`, so a typo such as `{sesion}` fails at load instead of producing a link that is wrong.
 */
function parseHistoryUrl(value: unknown, at = "plugboard option `historyUrl`"): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !value.includes("{id}")) throw new Error(`${at} must be a URL template with {id} (for example http://host:4096/session/{id})`)
  const unknown = (value.match(/\{[^{}]*\}/g) ?? []).find((placeholder) => placeholder !== "{id}" && placeholder !== "{directory}")
  if (unknown !== undefined) throw new Error(`${at} has the unknown placeholder ${unknown} (known: {id}, {directory})`)
  let url: URL
  try {
    url = new URL(value.replaceAll("{id}", "x").replaceAll("{directory}", "x"))
  } catch {
    throw new Error(`${at} must be an http(s) URL template`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${at} must be http or https`)
  return value
}

/** Option `models`: an array of patterns, or the string `"connected"` (every model of every connected provider). Unset is the empty list. */
function parseModels(raw: unknown): string[] {
  if (raw === undefined || raw === null) return []
  if (raw === CONNECTED) return [CONNECTED]
  if (!Array.isArray(raw)) throw new Error("plugboard option `models` must be an array of strings")
  for (const pattern of raw) {
    if (pattern === CONNECTED) throw new Error(`plugboard option \`models\` takes \`"${CONNECTED}"\` as the whole value (\`"models": "${CONNECTED}"\`), not as a list entry`)
    if (typeof pattern !== "string" || !MODEL_PATTERN.test(pattern)) throw new Error(`plugboard model \`${String(pattern)}\` must be \`provider/model\`, \`provider/model#variant\` or \`provider/*\``)
  }
  return raw as string[]
}

/** Validates raw plugin options and applies defaults. Throws `Error` with an actionable message. */
export function parseOptions(raw: unknown): PlugboardOptions {
  if (raw !== undefined && raw !== null && !isRecord(raw)) throw new Error("plugboard options must be an object")
  const input: Record<string, unknown> = raw ?? {}
  for (const key of Object.keys(input)) if (!KNOWN.has(key)) throw new Error(`Unknown plugboard option \`${key}\` (known: ${[...KNOWN].join(", ")})`)

  const listenInput = input.listen
  if (listenInput !== undefined && !isRecord(listenInput)) throw new Error("plugboard option `listen` must be an object")
  const host = listenInput?.host ?? DEFAULTS.host
  if (typeof host !== "string" || host.length === 0) throw new Error("plugboard option `listen.host` must be a non-empty string")
  const port = listenInput?.port
  if (port !== undefined && (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error("plugboard option `listen.port` must be an integer between 1 and 65535")
  const trustProxy = parseTrustProxy(listenInput?.trustProxy)

  const keyEntries: Array<[string, string]> = []
  if (input.keys !== undefined && !isRecord(input.keys)) throw new Error("plugboard option `keys` must be an object of app name -> key")
  if (input.apps !== undefined && !isRecord(input.apps)) throw new Error("plugboard option `apps` must be an object of app name -> policy")
  const appOfKey = new Map<string, string>()
  for (const [app, key] of mergedKeys(input.keys, input.apps)) {
    if (app === DEFAULT_APP) throw new Error(`plugboard key name \`${DEFAULT_APP}\` is reserved for keyless loopback use`)
    if (!isAppName(app)) throw new Error(`plugboard key name \`${app}\` must match ${APP_NAME_PATTERN} and be at most ${APP_NAME_MAX} characters`)
    if (typeof key !== "string" || key.length === 0) throw new Error(`plugboard key \`${app}\` must be a non-empty string (is its {env:VAR} set?)`)
    // Two apps sharing a key value would be indistinguishable: the last one would win silently.
    const other = appOfKey.get(key)
    if (other !== undefined) throw new Error(`plugboard keys \`${other}\` and \`${app}\` have the same value; every app needs its own key`)
    appOfKey.set(key, app)
    keyEntries.push([app, key])
  }
  // Own-property construction: a key such as `__proto__` must stay a key, never reach the prototype.
  const keys: Record<string, string> = Object.fromEntries(keyEntries)
  digestsOf(keys)
  if (keyEntries.length === 0 && !isLoopbackHost(host)) throw new Error(`plugboard refuses to listen on non-loopback host \`${host}\` without \`keys\``)
  if (input.requireKeys !== undefined && typeof input.requireKeys !== "boolean") throw new Error("plugboard option `requireKeys` must be a boolean")
  if (input.requireKeys === true && keyEntries.length === 0)
    throw new Error("plugboard option `requireKeys` needs `keys`: without them every local caller would be served as the keyless app; add `keys` or remove `requireKeys`")
  if (input.keepAlive !== undefined && typeof input.keepAlive !== "boolean") throw new Error("plugboard option `keepAlive` must be a boolean")
  if (input.adminKey !== undefined) {
    if (typeof input.adminKey !== "string" || input.adminKey.length === 0) throw new Error("plugboard option `adminKey` must be a non-empty string (is its {env:VAR} set?)")
    if (keyEntries.some(([, key]) => key === input.adminKey)) throw new Error("plugboard option `adminKey` must differ from every app key")
  }

  const models = parseModels(input.models)

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
      // A skill target binds one model and takes no fallbacks; like a list entry it must pass the allowlist at load.
      if (typeof entry === "string" && entry.startsWith(SKILL_PREFIX)) {
        const parsed = parseAliasTarget(entry)
        if (parsed?.skill === undefined) throw new Error(`plugboard alias \`${alias}\` skill target \`${entry}\` must be \`skill:<id>@provider/model\` or \`skill:<id>@provider/model#variant\``)
        if (Array.isArray(target)) throw new Error(`plugboard alias \`${alias}\` binds a skill, so it takes one target and no list of fallbacks`)
        if (!allowedBy(models as string[], parsed.ref)) throw new Error(`plugboard alias \`${alias}\` target \`${entry}\` is not allowed by the \`models\` option`)
        continue
      }
      if (typeof entry !== "string" || !ALIAS_TARGET.test(entry)) throw new Error(`plugboard alias \`${alias}\` must target \`provider/model\` or \`provider/model#variant\` (or a list of them)`)
      // A list is new, so it is strict: a target the allowlist would refuse can never serve, so fail at load.
      if (Array.isArray(target) && !allowedBy(models as string[], parseModelRef(entry)!)) throw new Error(`plugboard alias \`${alias}\` target \`${entry}\` is not allowed by the \`models\` option`)
    }
    if (CANONICAL_SHAPE.test(alias)) throw new Error(`plugboard alias \`${alias}\` is written like a \`provider/model\` id; aliases must not contain \`/\` (use a short name such as \`fast\`)`)
    aliasEntries.push([alias, chain[0] as string])
    if (chain.length > 1) fallbackEntries.push([alias, chain.slice(1) as string[]])
  }
  const aliases: Record<string, string> = Object.fromEntries(aliasEntries)
  const fallbacks: Record<string, string[]> = Object.fromEntries(fallbackEntries)
  const fallbackAfterMs = input.fallbackAfterMs === undefined ? undefined : positiveInt(input.fallbackAfterMs, "fallbackAfterMs", 0, MAX_TIMER_MS)
  const fallbackCooldown = parseFallbackCooldown(input.fallbackCooldown)
  const requestTimeoutMs = positiveInt(input.requestTimeoutMs, "requestTimeoutMs", DEFAULTS.requestTimeoutMs, MAX_TIMER_MS)
  const silenceMs = input.silenceMs === undefined ? undefined : positiveInt(input.silenceMs, "silenceMs", 0, MAX_TIMER_MS)
  const agents = parseAgents(input.agents, models as string[])

  const maxTools = positiveInt(input.maxTools, "maxTools", DEFAULTS.maxTools, 1024)
  const maxN = positiveInt(input.maxN, "maxN", DEFAULTS.maxN, 64)
  const apps = parseApps(input.apps, { keys, aliases, models: models as string[], maxTools, maxN })

  const remoteImages = parseRemoteImages(input.remoteImages)
  if (input.dropUnsupportedParams !== undefined && typeof input.dropUnsupportedParams !== "boolean") throw new Error("plugboard option `dropUnsupportedParams` must be a boolean")

  if (input.logFormat !== undefined && input.logFormat !== "text" && input.logFormat !== "json") throw new Error("plugboard option `logFormat` must be `text` or `json`")
  if (input.logLevel !== undefined && (typeof input.logLevel !== "string" || !LOG_LEVELS.has(input.logLevel))) throw new Error("plugboard option `logLevel` must be `debug`, `info`, `warn` or `error`")
  if (input.logRequests !== undefined && typeof input.logRequests !== "boolean") throw new Error("plugboard option `logRequests` must be a boolean")
  if (input.metrics !== undefined && typeof input.metrics !== "boolean") throw new Error("plugboard option `metrics` must be a boolean")
  if (input.reasoningOutput !== undefined && typeof input.reasoningOutput !== "boolean") throw new Error("plugboard option `reasoningOutput` must be a boolean")
  if (input.modelIds !== undefined && (typeof input.modelIds !== "string" || !MODEL_IDS.has(input.modelIds))) throw new Error("plugboard option `modelIds` must be `canonical`, `slugs` or `both`")

  const historyInput = input.history
  if (historyInput !== undefined && !isRecord(historyInput)) throw new Error("plugboard option `history` must be an object")
  for (const key of Object.keys(historyInput ?? {})) if (!HISTORY_KNOWN.has(key)) throw new Error(`Unknown plugboard option \`history.${key}\` (known: ${[...HISTORY_KNOWN].join(", ")})`)
  const maxSessions = historyInput?.maxSessions === undefined ? undefined : positiveInt(historyInput.maxSessions, "history.maxSessions", 0)
  // Unset: 30 days (#158). `0` is the explicit opt-out: no age limit, so the parsed value is absent.
  const rawAge = historyInput?.maxAgeDays
  if (rawAge !== undefined && (typeof rawAge !== "number" || !Number.isInteger(rawAge) || rawAge < 0 || rawAge > MAX_AGE_DAYS))
    throw new Error(`plugboard option \`history.maxAgeDays\` must be an integer between 0 and ${MAX_AGE_DAYS} (0 keeps sessions of any age)`)
  const ageDays = rawAge ?? DEFAULT_HISTORY_DAYS
  const maxAgeDays = ageDays === 0 ? undefined : ageDays
  if (historyInput?.hidden !== undefined && typeof historyInput.hidden !== "boolean") throw new Error("plugboard option `history.hidden` must be a boolean")
  const hidden = historyInput?.hidden as boolean | undefined

  const limits = parseLimits(input.limits, keys)
  const cache = parseCache(input.cache, keys)
  const usage = parseUsage(input.usage)
  const budgets = parseBudgets(input.budgets, keys)
  if (budgets !== undefined && !usage.enabled) throw new Error("plugboard option `budgets` needs `usage` enabled: budgets are counted from the usage records")
  if (budgets !== undefined && usage.retentionDays < widestWindowDays(budgets))
    throw new Error(
      `plugboard option \`usage.retentionDays\` must be at least ${widestWindowDays(budgets)} for the budget windows in use (a month is 31 days, a week 7): older days are deleted and would stop counting`,
    )
  const historyUrl = parseHistoryUrl(input.historyUrl)
  const promptCache = parsePromptCache(input.promptCache, "promptCache")
  // `history.hidden` parents an app's request sessions under one app-scope parent (#337). A per-user anchor cannot be that parent too.
  // With keys, `default` is not a usable app (line ~582): only the named apps are checked.
  const checkedApps = Object.keys(keys).length === 0 ? [DEFAULT_APP] : Object.keys(keys)
  for (const app of checkedApps) {
    const hiddenHere = (apps[app]?.history?.hidden ?? hidden) === true
    const cacheHere = apps[app]?.promptCache ?? promptCache
    if (hiddenHere && cacheHere?.affinity === "anchor" && cacheHere.scope === "user")
      throw new Error(
        `plugboard app \`${app}\` sets \`history.hidden\` with \`promptCache\` scope \`user\`: the hidden parent is one per app, so it cannot also be the per-user anchor. Use scope \`app\`, or turn one of them off`,
      )
  }
  const cors = parseCors(input.cors, keyEntries.length > 0)
  // A first-event deadline at or past a request deadline never fires, so the chain would silently do nothing (#391).
  if (fallbackAfterMs !== undefined && fallbackAfterMs >= requestTimeoutMs)
    throw new Error(
      `plugboard option \`fallbackAfterMs\` (${fallbackAfterMs}) must be below \`requestTimeoutMs\` (${requestTimeoutMs}): a first-event deadline at or past the request deadline never fires`,
    )
  for (const [app, policy] of Object.entries(apps))
    if (fallbackAfterMs !== undefined && policy.requestTimeoutMs !== undefined && fallbackAfterMs >= policy.requestTimeoutMs)
      throw new Error(`plugboard option \`fallbackAfterMs\` (${fallbackAfterMs}) must be below \`apps.${app}.requestTimeoutMs\` (${policy.requestTimeoutMs}): the app's requests have that deadline`)

  return {
    ...(promptCache === undefined ? {} : { promptCache }),
    listen: { host, port: port ?? DEFAULTS.port, ...(trustProxy === undefined ? {} : { trustProxy }) },
    keys,
    apps,
    models: models as string[],
    aliases,
    agents,
    fallbacks,
    ...(fallbackAfterMs === undefined ? {} : { fallbackAfterMs }),
    ...(fallbackCooldown === undefined ? {} : { fallbackCooldown }),
    maxTools,
    maxN,
    requestTimeoutMs,
    ...(silenceMs === undefined ? {} : { silenceMs }),
    remoteImages,
    history: { ...(maxSessions === undefined ? {} : { maxSessions }), ...(maxAgeDays === undefined ? {} : { maxAgeDays }), ...(hidden === undefined ? {} : { hidden }) },
    dropUnsupportedParams: input.dropUnsupportedParams !== false,
    logFormat: input.logFormat === "json" ? "json" : "text",
    logLevel: (input.logLevel as LogLevel | undefined) ?? "info",
    logRequests: input.logRequests !== false,
    metrics: input.metrics === true,
    reasoningOutput: input.reasoningOutput === true,
    modelIds: (input.modelIds as ModelIds | undefined) ?? "canonical",
    ...(limits === undefined ? {} : { limits }),
    ...(cache ? { cache } : {}),
    usage,
    ...(budgets === undefined ? {} : { budgets }),
    ...(typeof input.adminKey === "string" ? { adminKey: input.adminKey } : {}),
    ...(input.requireKeys === true ? { requireKeys: true } : {}),
    ...(input.keepAlive === false ? { keepAlive: false } : {}),
    ...(cors === undefined ? {} : { cors }),
    ...(historyUrl === undefined ? {} : { historyUrl }),
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

/** Who may read `GET /plugboard/usage`: the admin key (every app), or one app (`default` when keyless). */
export type UsageScope = { readonly admin: true } | { readonly admin: false; readonly app: string }

/** The digest of a runtime key (src/keys.ts), with its app: checked like a config key (#55). */
export type RuntimeDigest = readonly [app: string, digest: Buffer]

/** The admin key is checked first; any other valid key (or keyless mode) is an app, as `authenticate` decides. */
export function authenticateUsage(options: PlugboardOptions, authorization: string | undefined, runtime: ReadonlyArray<RuntimeDigest> = []): UsageScope | PlugError {
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "")?.[1]
  if (options.adminKey !== undefined && bearer !== undefined && timingSafeEqual(sha256(bearer), sha256(options.adminKey))) return { admin: true }
  const auth = authenticate(options, authorization, runtime)
  if (isPlugError(auth)) return auth
  return { admin: false, app: auth.app }
}

/**
 * No config keys -> app `default` (keyless), as before. With config keys every request needs
 * `Authorization: Bearer <key>`. A runtime key (#55) matches like a config key, so it names its app
 * whenever it is presented. It never makes a keyless server require a key, so deleting the last
 * runtime key cannot open or close access by itself.
 */
export function authenticate(options: PlugboardOptions, authorization: string | undefined, runtime: ReadonlyArray<RuntimeDigest> = []): { app: string } | PlugError {
  const entries = digestsOf(options.keys)
  const token = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "")?.[1]
  if (token === undefined) return entries.length === 0 ? { app: DEFAULT_APP } : UNAUTHORIZED
  const digest = sha256(token)
  let app: string | undefined
  // Every key is compared, no early exit.
  for (const [name, expected] of [...entries, ...runtime]) if (timingSafeEqual(digest, expected)) app = name
  if (app !== undefined) return { app }
  return entries.length === 0 ? { app: DEFAULT_APP } : UNAUTHORIZED
}
