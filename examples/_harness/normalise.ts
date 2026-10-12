/**
 * Turns captured exchanges into the committed transcript shape: allow-listed headers, ids replaced by
 * per-file placeholders, the plugboard URL replaced, secrets removed, SSE parsed into frames. Pure functions,
 * so the rules are unit-tested (test/unit/examples-normalise.test.ts). The Contract's "Normalising and redaction"
 * section is the spec; change it there first.
 */
import { createParser } from "eventsource-parser"
import type { Exchange } from "./capture.ts"

const REQUEST_HEADERS = ["accept", "anthropic-version", "content-type", "openai-beta"]
const RESPONSE_HEADERS = ["content-type"]
const PLUGBOARD_HEADER = /^x-plugboard-/
const NEVER_HEADER = /^(date|host|user-agent|x-stainless-.*|content-length|x-plugboard-request-id)$/
/** Keys whose value is an id, replaced by placeholder (except on a GET of a models route, where `id` is a model name). */
const ID_KEYS = /^(id|created|created_at|request-id|.*_id)$/
const ID_PATTERNS: ReadonlyArray<RegExp> = [
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
  /\b(?:chatcmpl|msg|resp|req|toolu|call|ses)_[A-Za-z0-9_-]+/g,
]
const LOOPBACK_URL = /https?:\/\/127\.0\.0\.1:\d+/g

/** Placeholders for one file: the same value always gets the same `<id-N>`, numbered by first appearance. */
export class IdMap {
  private readonly seen = new Map<string, string>()
  place(value: string): string {
    let placeholder = this.seen.get(value)
    if (placeholder === undefined) {
      placeholder = `<id-${this.seen.size + 1}>`
      this.seen.set(value, placeholder)
    }
    return placeholder
  }
}

function replaceIdsInString(text: string, ids: IdMap): string {
  const withoutUrl = text.replace(LOOPBACK_URL, "<plugboard>")
  return ID_PATTERNS.reduce((out, pattern) => out.replace(pattern, (match) => ids.place(match)), withoutUrl)
}

/** Walks a JSON value with keys in sorted order, so placeholder numbering does not depend on insertion order. */
export function normaliseValue(value: unknown, ids: IdMap, idKeys: boolean): unknown {
  if (typeof value === "string") return replaceIdsInString(value, ids)
  if (Array.isArray(value)) return value.map((item) => normaliseValue(item, ids, idKeys))
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key]
      if (idKeys && ID_KEYS.test(key) && (typeof child === "string" || typeof child === "number")) out[key] = ids.place(String(child))
      else out[key] = normaliseValue(child, ids, idKeys)
    }
    return out
  }
  return value
}

/** Only `content-type`, `x-plugboard-*` (not the request id) and the request allow-list; lowercase, sorted. */
export function pickHeaders(headers: Readonly<Record<string, string>>, request: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of Object.keys(headers).sort()) {
    const lower = name.toLowerCase()
    if (NEVER_HEADER.test(lower)) continue
    const keep = request ? REQUEST_HEADERS.includes(lower) : RESPONSE_HEADERS.includes(lower) || (PLUGBOARD_HEADER.test(lower) && lower !== "x-plugboard-request-id")
    if (keep) out[lower] = headers[name]!
  }
  return out
}

/** Removes the `key` query parameter (Gemini's `?key=`), keeps the rest of the target as sent. */
export function redactPath(path: string): string {
  const [base, query] = path.split("?", 2) as [string, string | undefined]
  if (query === undefined) return base
  const kept = query.split("&").filter((part) => part.split("=", 1)[0]!.toLowerCase() !== "key")
  return kept.length === 0 ? base : `${base}?${kept.join("&")}`
}

const parseJson = (text: string): unknown | undefined => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Parsed SSE frames, in order, with comments (keepalives) dropped. `[DONE]` stays as the string it is. */
export function parseFrames(text: string): Array<{ event?: string; data: unknown }> {
  const frames: Array<{ event?: string; data: unknown }> = []
  const parser = createParser({
    onEvent: (message) => {
      const data = message.data === "[DONE]" ? message.data : (parseJson(message.data) ?? message.data)
      frames.push({ ...(message.event === undefined ? {} : { event: message.event }), data })
    },
  })
  parser.feed(text)
  return frames
}

/** One exchange, normalised. The body is parsed JSON, SSE frames, or the text as it was. */
export function normaliseRequestBody(text: string): unknown {
  return parseJson(text) ?? text
}

export function normaliseResponseBody(text: string, contentType: string | undefined): unknown {
  if (contentType?.includes("text/event-stream")) return { sse: parseFrames(text) }
  return parseJson(text) ?? text
}

export interface Transcript {
  readonly exchanges: ReadonlyArray<{
    readonly request: { readonly method: string; readonly path: string; readonly headers: Record<string, string>; readonly body: unknown }
    readonly response: { readonly status: number; readonly headers: Record<string, string>; readonly body: unknown }
  }>
}

/** A file's transcript. One IdMap per file, so an id in turn 1 and turn 2 of the same scenario get the same placeholder. */
export function normaliseTranscript(exchanges: ReadonlyArray<Exchange>): Transcript {
  const ids = new IdMap()
  return {
    exchanges: exchanges.map((exchange) => {
      // A GET of a models route lists model ids; those are names, not ids to replace.
      const idKeys = !(exchange.method === "GET" && /\/models(\/|$|\?)/.test(exchange.path))
      const contentType = exchange.resHeaders["content-type"] ?? exchange.resHeaders["Content-Type"]
      const reqHeaders = pickHeaders(exchange.reqHeaders, true)
      const resHeaders = pickHeaders(exchange.resHeaders, false)
      return {
        request: {
          method: exchange.method,
          path: normaliseValue(redactPath(exchange.path), ids, false) as string,
          headers: normaliseValue(reqHeaders, ids, false) as Record<string, string>,
          body: normaliseValue(normaliseRequestBody(exchange.reqBody), ids, idKeys),
        },
        response: {
          status: exchange.status,
          headers: normaliseValue(resHeaders, ids, false) as Record<string, string>,
          body: normaliseValue(normaliseResponseBody(exchange.resBody, contentType), ids, idKeys),
        },
      }
    }),
  }
}

/** Sorted keys, two-space indent, trailing newline: the one file format. */
export function canonicalJson(value: unknown): string {
  const sort = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(sort)
    if (node !== null && typeof node === "object") {
      return Object.fromEntries(Object.keys(node).sort().map((key) => [key, sort((node as Record<string, unknown>)[key])]))
    }
    return node
  }
  return `${JSON.stringify(sort(value), null, 2)}\n`
}
