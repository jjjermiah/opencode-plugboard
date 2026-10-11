/**
 * Captures plugboard's log lines (`src/log.ts` writes `[opencode-plugboard] event key=value ...`
 * to console.log / console.error) so tests can assert on them and the run stays quiet.
 *
 * Call `captureLogs()` at the top of a `describe`: it installs the spies before each test and
 * restores them after.
 */
import { afterEach, beforeEach, spyOn } from "bun:test"

export interface LogLine {
  readonly level: "log" | "error"
  readonly event: string
  readonly fields: Readonly<Record<string, string>>
  readonly raw: string
}

const PREFIX = "[opencode-plugboard] "

/** `key=value` and `key="quoted value"` pairs of one line. */
function parse(level: LogLine["level"], raw: string): LogLine {
  const body = raw.startsWith(PREFIX) ? raw.slice(PREFIX.length) : raw
  const [event = "", ...rest] = body.split(" ")
  const fields: Record<string, string> = {}
  for (const match of rest.join(" ").matchAll(/(\w+)=("(?:[^"\\]|\\.)*"|\S+)/g)) fields[match[1]!] = match[2]!.startsWith('"') ? JSON.parse(match[2]!) : match[2]!
  return { level, event, fields, raw }
}

export interface CapturedLogs {
  readonly lines: LogLine[]
  /** Lines of one event, e.g. `logs.of("request")`. */
  of(event: string): LogLine[]
}

export function captureLogs(): CapturedLogs {
  const lines: LogLine[] = []
  const spies: Array<{ mockRestore(): void }> = []
  beforeEach(() => {
    lines.length = 0
    for (const level of ["log", "error"] as const)
      spies.push(spyOn(console, level).mockImplementation((...args: unknown[]) => void lines.push(parse(level, args.map(String).join(" ")))))
  })
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore()
  })
  return { lines, of: (event) => lines.filter((line) => line.event === event) }
}
