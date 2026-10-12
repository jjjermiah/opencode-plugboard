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

/** The user id to keep, or undefined when the value is absent, blank or not allowed. */
export function sanitizeEndUser(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const trimmed = raw.trim()
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
