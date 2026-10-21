/**
 * The usage tag of a request: a free-form label the caller puts on a call so one app's usage splits by purpose
 * (a bot's cron jobs against its interactive chat) without a second key. It labels the per-tag usage counts and
 * the request log line. It never names a path: a value is only ever a string key in a record.
 *
 * It comes from the `x-plugboard-tag` request header on any model route, one tag per request. A repeated header
 * reaches the server as one comma-joined value, which is not a tag and is ignored.
 *
 * A value is kept only when it is trimmed and 1 to 64 characters of `A-Z a-z 0-9 . _ : -`, and it is not a reserved
 * name: `__proto__`, `prototype`, `constructor` or `_other` (the usage store's overflow slot). Anything else is
 * ignored with a debug log line, never an error: a bad tag must not break a call. A blank value is no tag at all.
 * The `?tag=` filter of the usage query checks the charset and length only (`validTag`), so a stored name stays queryable.
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

/** The tag a request names in its `x-plugboard-tag` header, or undefined when it has none or the value is not kept (a debug line says so, without the value). */
export function requestTag(headers: Readonly<Record<string, string | ReadonlyArray<string> | undefined>>): string | undefined {
  const raw = Object.hasOwn(headers, TAG_HEADER) ? headers[TAG_HEADER] : undefined
  if (typeof raw !== "string" || raw.trim() === "") return undefined
  const tag = sanitizeTag(raw)
  if (tag === undefined) logDebug("request.tag_ignored")
  return tag
}

/** The `tag` member of a `PlugRequest` (spread into it), empty when no tag is kept. */
export const tagField = (tag: string | undefined): { tag?: string } => (tag === undefined ? {} : { tag })

/** For a route: names the kept tag in the request info (the request log and the usage counts read it). */
export function noteTag(info: { tag?: string }, headers: Readonly<Record<string, string | ReadonlyArray<string> | undefined>>): void {
  const tag = requestTag(headers)
  if (tag !== undefined) info.tag = tag
}
