/**
 * Tiny structured logger: one line per event, `[opencode-plugboard] event key=value ...`.
 *
 * Callers pass only identifiers and outcomes (event name, request id, app, model, duration, an
 * error message). Never pass API keys, request or response bodies, URLs or raw provider
 * objects: nothing here redacts them.
 */

export type LogFields = Readonly<Record<string, string | number | boolean | undefined>>

const PREFIX = "[opencode-plugboard]"

function formatValue(value: string | number | boolean): string {
  return typeof value === "string" && !/^[\w.:/#-]+$/.test(value) ? JSON.stringify(value) : String(value)
}

function format(event: string, fields: LogFields | undefined): string {
  let line = `${PREFIX} ${event}`
  for (const [key, value] of Object.entries(fields ?? {})) if (value !== undefined) line += ` ${key}=${formatValue(value)}`
  return line
}

export const log = (event: string, fields?: LogFields): void => console.log(format(event, fields))

export const logError = (event: string, fields?: LogFields): void => console.error(format(event, fields))

/** The message of a thrown value, without its stack or attached properties. */
export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))
