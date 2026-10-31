/**
 * The size of a model request, for the request log line: how big the body was, how many system prompts, messages and tools it
 * carried, and how many bytes each part is. A request that answers slowly or costs many cached tokens is usually a large tool list
 * or a long history, and this is where that shows (`body_bytes`, `tool_bytes`, ...).
 *
 * The raw body is kept per request (`readJsonBody` calls `rememberBody`), so the byte count is the body as it arrived, before the
 * file references of a stored request are inlined. The parts are counted on the decoded request (`PlugRequest`): the JSON size of
 * `system`, `messages` and `tools` as the caller sent them, before the session remaps the tools. Only numbers reach the log.
 */

import type { IncomingMessage } from "node:http"
import type { PlugRequest } from "./contract.js"

/** The request log fields this module adds. All are counts or byte sizes. */
export interface RequestSizes {
  readonly body_bytes: number
  readonly system_count: number
  readonly system_bytes: number
  readonly message_count: number
  readonly message_bytes: number
  readonly tool_count: number
  readonly tool_bytes: number
}

/** What a route's request info holds for the log: the raw body, and the sizes once the request is decoded. */
export interface SizeInfo {
  body?: Buffer
  sizes?: RequestSizes
}

/** The parts of a decoded request that are counted. */
type Sized = Pick<PlugRequest, "system" | "messages" | "tools">

const bodies = new WeakMap<IncomingMessage, Buffer>()

/** Keeps the raw body of a request, as read from the socket. Called by `readJsonBody`. */
export function rememberBody(request: IncomingMessage, raw: Buffer): void {
  bodies.set(request, raw)
}

/** For a route: puts the raw body of the request in its info (the sizes are read from it). */
export function noteBody(info: SizeInfo, request: IncomingMessage): void {
  const raw = bodies.get(request)
  if (raw !== undefined) info.body = raw
}

/** The UTF-8 size of the JSON text of a list, 0 for an empty one (nothing was sent). */
const jsonBytes = (list: ReadonlyArray<unknown>): number => (list.length === 0 ? 0 : Buffer.byteLength(JSON.stringify(list)))

/**
 * The sizes of a body and of the request decoded from it. Several requests (one `prompt` array of `/v1/completions` is several
 * calls) add up, so the line reports everything the body asked for.
 */
export function requestSizes(bodyBytes: number, requests: ReadonlyArray<Sized>): RequestSizes {
  let system_count = 0
  let system_bytes = 0
  let message_count = 0
  let message_bytes = 0
  let tool_count = 0
  let tool_bytes = 0
  for (const request of requests) {
    system_count += request.system.length
    system_bytes += jsonBytes(request.system)
    message_count += request.messages.length
    message_bytes += jsonBytes(request.messages)
    tool_count += request.tools.length
    tool_bytes += jsonBytes(request.tools)
  }
  return { body_bytes: bodyBytes, system_count, system_bytes, message_count, message_bytes, tool_count, tool_bytes }
}

/** For a route: records the sizes of the decoded request in its info, once the body and the request are known. Without a body nothing is recorded. */
export function noteSizes(info: SizeInfo, request: Sized | ReadonlyArray<Sized>): void {
  if (info.body === undefined) return
  info.sizes = requestSizes(info.body.length, Array.isArray(request) ? request : [request as Sized])
}
