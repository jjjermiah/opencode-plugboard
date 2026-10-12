/**
 * Structured logger on pino: one line per event.
 *
 *   text (default)  `[opencode-plugboard] event key=value ...`
 *   json            `{"level":"info","time":"...","service":"opencode-plugboard","event":"request","id":"...",...}`
 *
 * Callers pass only identifiers and outcomes (event name, request id, app, model, duration, an
 * error message). Never pass API keys, request or response bodies, URLs or raw provider
 * objects. As a backstop pino's `redact` censors the fields `authorization`, `key`, `apiKey`,
 * `x-api-key` and `x-goog-api-key` (also under `headers`); it matches field names, not values,
 * so it does not replace that rule.
 *
 * `json` is pino's own JSON with three settings: the level is its name (`"info"`, `"error"`, not
 * pino's 30 and 50) so lines keep the shape they had before pino, the message key is `event`, and
 * the base object holds only `service` (no `pid` or `hostname`). A field cannot overwrite
 * `level`, `time`, `service` or `event`.
 *
 * There is no pino transport and no worker thread: pino writes synchronously to two small
 * destinations, and the transport machinery (thread-stream) is never started, which keeps it
 * safe inside the OpenCode host. Info lines go to `console.log` (stdout), error lines to
 * `console.error` (stderr), as before. Text lines are made from the JSON line by `toText`;
 * pino-pretty was not used because it prints multi-line, level-prefixed output, adds a dozen
 * packages, and cannot produce the `event key=value` shape that log scrapers already match.
 *
 * The format is process-wide (`setLogFormat`, set by the runtime from the live generation's
 * `logFormat` option). A line logged while a request is being handled also carries that request's
 * id (`id`, the value of the `x-plugboard-request-id` response header): `withRequestId` scopes it
 * to the request's async chain (node:async_hooks) and pino's `mixin` reads it per line, and
 * `outsideRequest` detaches work that merely started from a request but is not about it (the
 * history sweep, the event pump). An explicit `id` field wins over the ambient one.
 *
 * The logger and both settings sit on `globalThis`, because the module can be evaluated once per
 * Location. They are here and not on the process runtime (`src/runtime.ts`) because the runtime
 * imports this module and must still be able to log when a foreign-version runtime owns the process.
 */

import { AsyncLocalStorage } from "node:async_hooks"
import pino, { type Logger } from "pino"

export type LogFields = Readonly<Record<string, string | number | boolean | undefined>>
export type LogFormat = "text" | "json"

const PREFIX = "[opencode-plugboard]"
const SERVICE = "opencode-plugboard"
const KEY = Symbol.for("opencode-plugboard.log.2")
/** Keys of the line itself; a caller's field of the same name is dropped. */
const ENVELOPE = new Set(["level", "time", "service", "event"])

/** Field names whose value is censored, at the top level and under `headers` (pino path syntax). */
const REDACTED = ["authorization", "Authorization", "x-api-key", "x-goog-api-key", "key", "apiKey"]
const REDACT_PATHS = REDACTED.flatMap((name) => {
  const path = /^[A-Za-z_$][\w$]*$/.test(name) ? name : `["${name}"]`
  return [path, `headers${path.startsWith("[") ? "" : "."}${path}`]
})

interface LogState {
  format: LogFormat
  readonly requests: AsyncLocalStorage<{ readonly id: string } | undefined>
  readonly logger: Logger
}

/** A pino line (JSON, newline ended) as one line of the console: raw for `json`, `event key=value` for `text`. */
function toText(line: string): string {
  let record: Record<string, unknown>
  try {
    record = JSON.parse(line) as Record<string, unknown>
  } catch {
    return line
  }
  let text = `${PREFIX} ${String(record.event)}`
  for (const [key, value] of Object.entries(record)) {
    if (ENVELOPE.has(key) || value === undefined) continue
    text += ` ${key}=${formatValue(value)}`
  }
  return text
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return /^[\w.:/#-]+$/.test(value) ? value : JSON.stringify(value)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

function createState(): LogState {
  const requests = new AsyncLocalStorage<{ readonly id: string } | undefined>()
  const state = { format: "text" as LogFormat, requests } as { format: LogFormat; requests: typeof requests; logger: Logger }
  // `console` is read at write time, not captured, so spies and host patches of it keep working.
  const destination = (channel: "log" | "error") => ({
    write(line: string) {
      const text = line.endsWith("\n") ? line.slice(0, -1) : line
      console[channel](state.format === "json" ? text : toText(text))
    },
  })
  state.logger = pino(
    {
      level: "info",
      base: { service: SERVICE },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      mixin: () => {
        const id = requests.getStore()?.id
        return id === undefined ? {} : { id }
      },
      redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    },
    // dedupe: a record goes to the highest-level destination it reaches, so errors only to stderr.
    pino.multistream(
      [
        { level: "info", stream: destination("log") },
        { level: "error", stream: destination("error") },
      ],
      { dedupe: true },
    ),
  )
  return state
}

function state(): LogState {
  const slot = globalThis as Record<symbol, unknown>
  return (slot[KEY] ??= createState()) as LogState
}

/** Set the line format for the whole process. */
export function setLogFormat(format: LogFormat): void {
  state().format = format
}

/** Run `fn` so that every log line emitted from its async chain carries `id`. */
export const withRequestId = <T>(id: string, fn: () => T): T => state().requests.run({ id }, fn)

/** Run `fn` detached from the current request: its log lines carry no request id. */
export const outsideRequest = <T>(fn: () => T): T => state().requests.run(undefined, fn)

/** The fields without the keys of the line envelope (a field cannot overwrite them), with `event` first. */
function record(event: string, fields: LogFields | undefined): Record<string, unknown> {
  const line: Record<string, unknown> = { event }
  for (const [key, value] of Object.entries(fields ?? {})) if (value !== undefined && !ENVELOPE.has(key)) line[key] = value
  return line
}

export const log = (event: string, fields?: LogFields): void => state().logger.info(record(event, fields))

export const logError = (event: string, fields?: LogFields): void => state().logger.error(record(event, fields))

/** A line for something that needs attention but did not fail a request (a budget at 80%). Info-level destination, `warn` in the level field. */
export const logWarn = (event: string, fields?: LogFields): void => state().logger.warn(record(event, fields))

/** The message of a thrown value, without its stack or attached properties. */
export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))
