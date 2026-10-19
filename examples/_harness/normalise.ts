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
const ID_KEYS = /^(id|request-id|responseId|.*_id)$/
/** Timestamps: numbered by occurrence, not by value, because two responses in one second share a value and a run that crosses a second does not. */
const TIME_KEYS = /^(created|created_at)$/
const ID_PATTERNS: ReadonlyArray<RegExp> = [
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
  /\b(?:chatcmpl|msg|resp|req|toolu|call|ses)_[A-Za-z0-9_-]+/g,
]
const LOOPBACK_URL = /https?:\/\/127\.0\.0\.1:\d+/g

/** Placeholders for one file: the same value always gets the same `<id-N>`, numbered by first appearance. */
export class IdMap {
  private readonly seen = new Map<string, string>()
  private times = 0
  time(): string {
    this.times++
    return `<time-${this.times}>`
  }
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
      const scalar = typeof child === "string" || typeof child === "number"
      if (idKeys && ID_KEYS.test(key) && scalar) out[key] = ids.place(String(child))
      else if (idKeys && TIME_KEYS.test(key) && scalar) out[key] = ids.time()
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

/**
 * The Gemini CLI puts a `<session_context>` block into its first user turn: today's date, the operating system, its temp
 * dir and the workspace. Those differ by day and by machine, so the values inside that block become fixed placeholders.
 * Nothing outside the block changes.
 */
const SESSION_CONTEXT = /<session_context>[\s\S]*?<\/session_context>/g
const SESSION_FIELDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Today's date is [^\n(]*/g, "Today's date is <date> "],
  [/My operating system is: [^\n]*/g, "My operating system is: <os>"],
  [/The project's temporary directory is: [^\n]*/g, "The project's temporary directory is: <temp-dir>"],
  [/(- \*\*Workspace Directories:\*\*\n  - )[^\n]*/g, "$1<workspace>"],
]

/**
 * The CLI's home and workspace (examples/gemini-cli/cli.ts) under the machine's temp dir, each named with the runner's pid so
 * concurrent runs do not share them. The CLI repeats the home path in its system prompt (memory-file locations), outside the
 * session context, so this rule covers the whole request text. A name without the pid (an older run) matches too.
 */
const CLI_PATHS = /(?:\/[^\s"'`]*)?\/plugboard-gemini-cli-(home|workspace)(?:-\d+)?/g
/** The checkout prefix of the CLI's own install path (its built-in skills are listed by absolute path). Only that prefix changes. */
const CLI_INSTALL = /(?:\/[^\s"'`<>]*)?\/examples\/gemini-cli\//g

/**
 * Codex CLI's `x-codex-turn-metadata` header value (repeated in `client_metadata`) is a JSON string with the turn's start time
 * in Unix milliseconds and the sandbox the OS gave it (`seatbelt` on macOS, another on Linux). Both differ by run and machine. A tool
 * result starts with the wall time of the call, which differs by run too.
 */
const CODEX_TURN_START = /("turn_started_at_unix_ms":)\d+/g
const CODEX_SANDBOX = /("sandbox":)"[a-z0-9_-]+"/g
/** The run's own timing, which Codex CLI puts at the head of a tool result (`Wall time: 0.0003 seconds`, `Wall time 0.0 seconds`). */
const CODEX_WALL_TIME = /(Wall time:? )[0-9.]+( seconds)/g

/**
 * Claude Code (examples/claude-code/cli.ts). Its run home and workspace are named like the Gemini CLI's, with the pid, and its system
 * prompt and its compaction summary repeat them: the workspace as the working directory, and the home as the transcript path, where
 * the project directory name is the workspace path with every `/` and `.` turned into `-`. The same prompt names the machine: the
 * platform, the shell and the OS version. A sub-agent's hand-back to the model carries the agent's random id and how long it ran.
 */
const CLAUDE_PROJECT = /(\/\.claude\/projects\/)-[^\s/]*plugboard-claude-code-workspace(?:-\d+)?/g
const CLAUDE_PATHS = /(?:\/[^\s"'`]*)?\/plugboard-claude-code-(home|workspace)(?:-\d+)?/g
const CLAUDE_MACHINE: ReadonlyArray<readonly [RegExp, string]> = [
  [/(\n - Platform: )[^\n]*/g, "$1<platform>"],
  [/(\n - Shell: )[^\n]*/g, "$1<shell>"],
  [/(\n - OS Version: )[^\n]*/g, "$1<os-version>"],
]
const CLAUDE_AGENT_ID = /(agentId: |to: ')[0-9a-f]{12,}/g
const CLAUDE_AGENT_TIME = /(duration_ms: )\d+/g

/** PR-Agent puts the day it runs in the review prompt (`Today's Date: 2026-10-19`), right after its `--PR Info--` header. */
const PR_AGENT_DATE = /(--PR Info--\n\nToday's Date: )\d{4}-\d{2}-\d{2}/g

/** Aider's diff-format prompt names the host's platform, its shell and the day (`- Platform: macOS-...`, `- Shell: SHELL=...`, `- Current date: ...`). */
const AIDER_HOST = /((?:- )?Platform: )[^\n]*(\n(?:- )?Shell: )[^\n]*(\n(?:- )?Current date: )\d{4}-\d{2}-\d{2}/g

/** The Gemini CLI lists its skills in the order the filesystem returns them, which changes from run to run. */
const AVAILABLE_SKILLS = /<available_skills>[\s\S]*?<\/available_skills>/g
const SKILL_ENTRY = /[ \t]*<skill>[\s\S]*?<\/skill>/g
const SKILL_NAME = /<name>([^<]*)<\/name>/

const skillName = (entry: string): string => SKILL_NAME.exec(entry)?.[1] ?? entry

/** Puts the `<skill>` entries of each `<available_skills>` block in name order. Text outside the entries stays where it is. */
function sortAvailableSkills(text: string): string {
  return text.replace(AVAILABLE_SKILLS, (block) => {
    const sorted = (block.match(SKILL_ENTRY) ?? []).toSorted((a, b) => (skillName(a) < skillName(b) ? -1 : skillName(a) > skillName(b) ? 1 : a < b ? -1 : a > b ? 1 : 0))
    let next = 0
    return block.replace(SKILL_ENTRY, () => sorted[next++] ?? "")
  })
}

/**
 * Replaces the machine- and day-specific values inside each `<session_context>` block of a string, the Gemini CLI's
 * fixed home and workspace paths, Claude Code's paths, machine description and sub-agent id and timing, Codex CLI's turn start
 * time and sandbox, PR-Agent's date and Aider's platform, shell and date, anywhere in it, and puts the Gemini CLI's skill list in name
 * order. Nothing else changes.
 */
export function normaliseSessionContext(text: string): string {
  const inBlocks = sortAvailableSkills(text.replace(SESSION_CONTEXT, (block) => SESSION_FIELDS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), block)))
  const rest = inBlocks
    .replace(CLI_PATHS, (_match, name: string) => `<gemini-cli-${name}>`)
    .replace(CLI_INSTALL, "<checkout>/examples/gemini-cli/")
    .replace(CLAUDE_PROJECT, "$1<claude-code-project>")
    .replace(CLAUDE_PATHS, (_match, name: string) => `<claude-code-${name}>`)
    .replace(CLAUDE_AGENT_ID, "$1<agent-id>")
    .replace(CLAUDE_AGENT_TIME, "$1<ms>")
    .replace(CODEX_TURN_START, "$1<unix-ms>")
    .replace(CODEX_SANDBOX, '$1"<sandbox>"')
    .replace(CODEX_WALL_TIME, "$1<seconds>$2")
    .replace(PR_AGENT_DATE, "$1<date>")
    .replace(AIDER_HOST, "$1<platform>$2<shell>$3<date>")
  return CLAUDE_MACHINE.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), rest)
}

/** The same, applied to every string in a parsed JSON value. */
export function normaliseSessionContextValue(value: unknown): unknown {
  if (typeof value === "string") return normaliseSessionContext(value)
  if (Array.isArray(value)) return value.map(normaliseSessionContextValue)
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normaliseSessionContextValue(child)]))
  return value
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
          body: normaliseValue(normaliseSessionContextValue(normaliseRequestBody(exchange.reqBody)), ids, idKeys),
        },
        response: {
          status: exchange.status,
          headers: normaliseValue(resHeaders, ids, false) as Record<string, string>,
          // The response too: a scripted tool call names a path inside the CLI's workspace (Claude Code's Write).
          body: normaliseValue(normaliseSessionContextValue(normaliseResponseBody(exchange.resBody, contentType)), ids, idKeys),
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
