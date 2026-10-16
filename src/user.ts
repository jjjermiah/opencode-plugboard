/**
 * The end user of a request (#57): the caller's own id for one of its users, read from the body
 * (OpenAI `user`, Anthropic `metadata.user_id`; Gemini has none). It labels a session title, the
 * request log line and the per-user usage counts. It never names a path: a value is only ever a
 * string key in a record.
 *
 * A value is kept only when it is trimmed and at most 64 characters of `A-Z a-z 0-9 . _ @ : -`.
 * Anything else is dropped, and the response says so with `x-plugboard-user-dropped: 1`. A blank
 * value is no user at all (neither kept nor reported).
 *
 * Pure: no node imports, so the request decoders (`request.ts` files) can use it (I20).
 */

export const USER_DROPPED_HEADER = "x-plugboard-user-dropped"

const END_USER = /^[A-Za-z0-9._@:-]{1,64}$/

/**
 * Names no end user may take: the keys an object inherits (a value like `__proto__` once corrupted the shared usage counters)
 * and `_other`, the overflow slot of the usage store (`src/usage.ts`). Refused like any other invalid value.
 */
const RESERVED_END_USERS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor", "_other"])

/** The user id to keep, or undefined when the value is absent, blank or not allowed. */
export function sanitizeEndUser(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const trimmed = raw.trim()
  if (RESERVED_END_USERS.has(trimmed)) return undefined
  return END_USER.test(trimmed) ? trimmed : undefined
}

/** True when the caller sent a value that is not kept. Absent and blank values are not dropped. */
export function endUserDropped(raw: unknown): boolean {
  if (raw === undefined || raw === null) return false
  if (typeof raw === "string" && raw.trim() === "") return false
  return sanitizeEndUser(raw) === undefined
}

/** `body.user`, the OpenAI-shaped field. */
export const bodyUser = (body: unknown): unknown => (typeof body === "object" && body !== null ? (body as { user?: unknown }).user : undefined)

/** `body.metadata.user_id`, the Anthropic-shaped field. */
export function bodyUserId(body: unknown): unknown {
  const metadata = typeof body === "object" && body !== null ? (body as { metadata?: unknown }).metadata : undefined
  return typeof metadata === "object" && metadata !== null ? (metadata as { user_id?: unknown }).user_id : undefined
}

/**
 * The end user a request names (#272): the app's `userHeader` value when the request sends that header, else `fromBody`. The header
 * is not trusted more than the body: the same sanitizer decides, and a present but refused header is dropped, not replaced.
 */
export function requestUser(headers: Readonly<Record<string, string | ReadonlyArray<string> | undefined>>, userHeader: string | undefined, fromBody: unknown): unknown {
  if (userHeader === undefined || !Object.hasOwn(headers, userHeader)) return fromBody
  const raw = headers[userHeader]
  const value = Array.isArray(raw) ? raw[0] : raw
  // A blank header is absent, so a proxy that always sets it does not hide the body's user (#272).
  return value === undefined || value.trim() === "" ? fromBody : value
}

/**
 * `body` with its end user set to `user`: the `user` member (Chat Completions, Responses, legacy completions) or `metadata.user_id`
 * (Messages). Returns `body` itself when `user` is already its end user, so a request without `userHeader` is not changed.
 */
export function withEndUser(body: unknown, user: unknown, dialect: "user" | "metadata"): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return body
  if (dialect === "user") return user === bodyUser(body) ? body : { ...body, user }
  const metadata = (body as { metadata?: unknown }).metadata
  const kept = typeof metadata === "object" && metadata !== null && !Array.isArray(metadata) ? metadata : {}
  return user === bodyUserId(body) ? body : { ...body, metadata: { ...kept, user_id: user } }
}

/** The `user` member of a `PlugRequest` (spread into it), empty when no user is kept. */
export const userField = (raw: unknown): { user?: string } => {
  const user = sanitizeEndUser(raw)
  return user === undefined ? {} : { user }
}

/**
 * For a route, after the body is read: sets `x-plugboard-user-dropped` when the value is not kept (the
 * headers are still open then), and names the kept user in the request log fields.
 */
export function noteEndUser(response: { setHeader(name: string, value: string): unknown }, info: { user?: string }, raw: unknown): void {
  if (endUserDropped(raw)) response.setHeader(USER_DROPPED_HEADER, "1")
  const user = sanitizeEndUser(raw)
  if (user !== undefined) info.user = user
}
