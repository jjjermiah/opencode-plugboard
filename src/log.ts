/**
 * Tiny structured logger: one line per event.
 *
 *   text (default)  `[opencode-plugboard] event key=value ...`
 *   json            `{"time":"...","level":"info","service":"opencode-plugboard","event":"request","id":"...",...}`
 *
 * Callers pass only identifiers and outcomes (event name, request id, app, model, duration, an
 * error message). Never pass API keys, request or response bodies, URLs or raw provider
 * objects: nothing here redacts them.
 *
 * The format is process-wide (`setLogFormat`, set by the runtime from the live generation's
 * `logFormat` option). A line logged while a request is being handled also carries that request's
 * id (`id`, the value of the `x-plugboard-request-id` response header): `withRequestId` scopes it
 * to the request's async chain (node:async_hooks), and `outsideRequest` detaches work that merely
 * started from a request but is not about it (the history sweep, the event pump).
 *
 * Both settings sit on `globalThis`, because the module can be evaluated once per Location.
 */

import { AsyncLocalStorage } from "node:async_hooks"

export type LogFields = Readonly<Record<string, string | number | boolean | undefined>>
export type LogFormat = "text" | "json"

const PREFIX = "[opencode-plugboard]"
const SERVICE = "opencode-plugboard"
const KEY = Symbol.for("opencode-plugboard.log.1")

interface LogState {
  format: LogFormat
  readonly requests: AsyncLocalStorage<{ readonly id: string } | undefined>
}

function state(): LogState {
  const slot = globalThis as Record<symbol, unknown>
  return (slot[KEY] ??= { format: "text", requests: new AsyncLocalStorage() } satisfies LogState) as LogState
}

/** Set the line format for the whole process. */
export function setLogFormat(format: LogFormat): void {
  state().format = format
}

/** Run `fn` so that every log line emitted from its async chain carries `id`. */
export const withRequestId = <T>(id: string, fn: () => T): T => state().requests.run({ id }, fn)

/** Run `fn` detached from the current request: its log lines carry no request id. */
export const outsideRequest = <T>(fn: () => T): T => state().requests.run(undefined, fn)

function formatValue(value: string | number | boolean): string {
  return typeof value === "string" && !/^[\w.:/#-]+$/.test(value) ? JSON.stringify(value) : String(value)
}

/** The fields with the ambient request id added (an explicit `id` field wins). */
function withAmbientId(fields: LogFields | undefined): Array<[string, string | number | boolean | undefined]> {
  const entries = Object.entries(fields ?? {})
  const ambient = state().requests.getStore()?.id
  return ambient !== undefined && !entries.some(([key]) => key === "id") ? [["id", ambient], ...entries] : entries
}

function format(level: "info" | "error", event: string, fields: LogFields | undefined): string {
  const entries = withAmbientId(fields)
  if (state().format === "json") {
    const line: Record<string, unknown> = { time: new Date().toISOString(), level, service: SERVICE, event }
    // The envelope keys cannot be overwritten by a field of the same name.
    for (const [key, value] of entries) if (value !== undefined && !(key in line)) line[key] = value
    return JSON.stringify(line)
  }
  let line = `${PREFIX} ${event}`
  for (const [key, value] of entries) if (value !== undefined) line += ` ${key}=${formatValue(value)}`
  return line
}

export const log = (event: string, fields?: LogFields): void => console.log(format("info", event, fields))

export const logError = (event: string, fields?: LogFields): void => console.error(format("error", event, fields))

/** The message of a thrown value, without its stack or attached properties. */
export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))
