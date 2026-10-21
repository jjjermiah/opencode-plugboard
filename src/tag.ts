/**
 * The usage tag of a request: a free-form label the caller puts on a call so one app's usage splits by purpose
 * (a bot's cron jobs against its interactive chat) without a second key. It labels the per-tag usage counts and
 * the request log line. It never names a path: a value is only ever a string key in a record.
 *
 * Where it comes from: the `x-plugboard-tag` request header on any model route, else the `metadata.tag` string of an
 * OpenAI-shaped body (Chat Completions, Responses, legacy completions). A request names one tag; a repeated header
 * reaches the server as one comma-joined value, which is not a tag and is ignored.
 *
 * A value is kept only when it is trimmed and 1 to 64 characters of `A-Z a-z 0-9 . _ : -`, and it is not a reserved
 * name: `__proto__`, `prototype`, `constructor` or `_other` (the usage store's overflow slot). Anything else is
 * ignored with a debug log line, never an error: a bad tag must not break a call. A blank value is no tag at all.
 * The `?tag=` filter of the usage query checks the charset and length only (`validTag`).
 *
 * Pure apart from the log line: no node imports, so the request decoders and routes can use it (I20).
 */

import { logDebug } from "./log.js"

export const TAG_HEADER = "x-plugboard-tag"

const TAG = /^[A-Za-z0-9._:-]{1,64}$/

/** Names no tag may take: the keys an object inherits, and `_other`, the overflow slot of the usage store (`src/usage.ts`). */
const RESERVED_TAGS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor", "_other"])

/** The trimmed value when it matches the charset and length rule, else undefined. Reserved names pass: see `sanitizeTag`. */
export function validTag(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const trimmed = raw.trim()
  return TAG.test(trimmed) ? trimmed : undefined
}

/** The tag to keep, or undefined when the value is absent, blank, reserved or not allowed. */
export function sanitizeTag(raw: unknown): string | undefined {
  const tag = validTag(raw)
  return tag === undefined || RESERVED_TAGS.has(tag) ? undefined : tag
}

/** `body.metadata.tag`, the OpenAI-shaped field. */
export function bodyTag(body: unknown): unknown {
  const metadata = typeof body === "object" && body !== null ? (body as { metadata?: unknown }).metadata : undefined
  return typeof metadata === "object" && metadata !== null ? (metadata as { tag?: unknown }).tag : undefined
}

/**
 * The tag a request names: the `x-plugboard-tag` header when it is present and not blank, else `fromBody` (`bodyTag`, or
 * undefined for a route with no such field). The same sanitizer decides for both; a present but refused header is
 * ignored, not replaced by the body's value. Undefined when there is no usable tag.
 */
export function requestTag(headers: Readonly<Record<string, string | ReadonlyArray<string> | undefined>>, fromBody?: unknown): string | undefined {
  const header = Object.hasOwn(headers, TAG_HEADER) ? headers[TAG_HEADER] : undefined
  const value = Array.isArray(header) ? header[0] : header
  const fromHeader = typeof value === "string" && value.trim() !== ""
  const raw = fromHeader ? value : fromBody
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) return undefined
  const tag = sanitizeTag(raw)
  // The value itself is not logged: it is caller text that failed the charset rule.
  if (tag === undefined) logDebug("request.tag_ignored", { source: fromHeader ? "header" : "body" })
  return tag
}

/** The `tag` member of a `PlugRequest` (spread into it), empty when no tag is kept. */
export const tagField = (tag: string | undefined): { tag?: string } => (tag === undefined ? {} : { tag })

/** For a route, after the body is read: names the kept tag in the request info (the request log and the usage counts read it). */
export function noteTag(info: { tag?: string }, headers: Readonly<Record<string, string | ReadonlyArray<string> | undefined>>, fromBody?: unknown): void {
  const tag = requestTag(headers, fromBody)
  if (tag !== undefined) info.tag = tag
}
