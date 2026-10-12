/**
 * HTTP and OpenCode access for the live suite. Every session a call creates is recorded from its
 * `x-plugboard-session` header, so `cleanup()` can delete exactly those (never other sessions).
 */
import { createParser } from "eventsource-parser"
import { LIVE_KEY, LIVE_URL, OC, REAL_HOME } from "./env.js"

export type Endpoint = "chat" | "responses" | "messages" | "gemini" | "completions"

/** Sessions created by this run, for cleanup. */
export const created = new Set<string>()

export interface Sent {
  status: number
  headers: Headers
  text: string
}

/** The auth header each route takes (docs/gemini.md, docs/messages.md). */
export function authHeaders(endpoint: Endpoint): Record<string, string> {
  if (endpoint === "messages") return { "x-api-key": LIVE_KEY, "anthropic-version": "2023-06-01" }
  if (endpoint === "gemini") return { "x-goog-api-key": LIVE_KEY }
  return { authorization: `Bearer ${LIVE_KEY}` }
}

export function recordSessions(headers: Headers): string[] {
  const ids = (headers.get("x-plugboard-session") ?? "").split(",").map((id) => id.trim()).filter(Boolean)
  for (const id of ids) created.add(id)
  return ids
}

/**
 * POST one request. A refused connection (the isolated server is reloading its plugin) is retried
 * once after 10 s, as docs/development.md advises; nothing was sent, so the retry cannot duplicate a call.
 */
export async function send(path: string, headers: Record<string, string>, body: unknown): Promise<Sent> {
  const init = { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) }
  const response = await fetch(new URL(path, LIVE_URL), init).catch(async (error: unknown) => {
    if ((error as { code?: string }).code !== "ConnectionRefused") throw error
    await sleep(10_000)
    return fetch(new URL(path, LIVE_URL), init)
  })
  const text = await response.text()
  recordSessions(response.headers)
  return { status: response.status, headers: response.headers, text }
}

/** `GET /v1/status`, authenticated. */
export async function status(): Promise<{ sessionGuards: number; models?: { available: number } }> {
  const response = await fetch(new URL("/v1/status", LIVE_URL), { headers: { authorization: `Bearer ${LIVE_KEY}` } })
  if (!response.ok) throw new Error(`GET /v1/status: HTTP ${response.status}`)
  return (await response.json()) as never
}

/** The model ids `GET /v1/models` lists. */
export async function listedModels(): Promise<string[]> {
  const response = await fetch(new URL("/v1/models", LIVE_URL), { headers: { authorization: `Bearer ${LIVE_KEY}` } })
  if (!response.ok) throw new Error(`GET /v1/models: HTTP ${response.status}`)
  const body = (await response.json()) as { data: Array<{ id: string }> }
  return body.data.map((model) => model.id)
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface SseFrame {
  event?: string
  data: string
}

/** Parse an SSE body the way clients do (eventsource-parser), keeping the event names. */
export function sse(text: string): SseFrame[] {
  const frames: SseFrame[] = []
  const parser = createParser({
    onEvent: (message) => void frames.push({ ...(message.event === undefined ? {} : { event: message.event }), data: message.data }),
    onError: (error) => {
      throw error
    },
  })
  parser.feed(text)
  return frames
}

/**
 * Run `oc api` through the isolated server's wrapper. `OC_DEV=1` with `OC_REAL_HOME` makes the
 * wrapper keep its own HOME, which is the sandbox HOME when the suite runs under `bun test`.
 */
export async function oc(...args: string[]): Promise<any> {
  const proc = Bun.spawn([OC, "api", ...args], {
    env: { ...process.env, OC_DEV: "1", OC_REAL_HOME: REAL_HOME },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const code = await proc.exited
  if (code !== 0) throw new Error(`oc api ${args.join(" ")} exited ${code}: ${(err || out).slice(0, 300)}`)
  try {
    return out.trim() ? JSON.parse(out) : {}
  } catch {
    return out
  }
}

/** The host's record of one session: `outcome` is `succeeded`, `interrupted`, ... */
export async function sessionOf(id: string): Promise<{ outcome?: string; title?: string }> {
  return (await oc("get", `/api/session/${id}`)).data
}

/**
 * The provider's own error for a failed session. Plugboard answers a provider failure with a generic
 * 502, so the reason (a usage limit, a rejected parameter) is only in the session's assistant message.
 */
export async function sessionError(id: string): Promise<string | undefined> {
  const page = await oc("get", `/api/session/${id}/message`)
  for (const message of page?.data ?? []) {
    if (message.type !== "assistant" || !message.error) continue
    const body = String(message.error.response?.body ?? "")
    const code = /"code":"([^"]+)"/.exec(body)?.[1]
    return [message.error.type, code, message.error.message].filter(Boolean).join(": ")
  }
  return undefined
}

/** Delete every session this run created. Returns how many were deleted. */
export async function cleanup(): Promise<number> {
  const ids = [...created]
  for (const id of ids) await oc("session.remove", "--param", `sessionID=${id}`)
  created.clear()
  return ids.length
}

/** Poll until `check` returns a value (not undefined) or the deadline passes. */
export async function until<T>(check: () => Promise<T | undefined>, ms: number): Promise<T | undefined> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value !== undefined) return value
    if (Date.now() > deadline) return undefined
    await sleep(500)
  }
}
