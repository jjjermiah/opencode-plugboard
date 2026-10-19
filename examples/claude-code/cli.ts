/**
 * Runs Claude Code headless (`claude -p`) against plugboard's Messages route. Each runner process gets its own HOME and
 * CLAUDE_CONFIG_DIR, so nothing is read from or written to the user's ~/.claude, and its own empty workspace, so no CLAUDE.md,
 * skill or git status from the machine reaches the prompt. The key comes from the environment, so there is no login and no browser.
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const EXAMPLE = fileURLToPath(new URL(".", import.meta.url))
const CLI = join(EXAMPLE, "node_modules/.bin/claude")

// Named by the runner's pid (normalise.ts maps the name away), so two runs on one machine do not delete each other's home.
const HOME = join(tmpdir(), `plugboard-claude-code-home-${process.pid}`)
const WORKSPACE = join(tmpdir(), `plugboard-claude-code-workspace-${process.pid}`)

export interface ClaudeEvent {
  type: string
  subtype?: string
  session_id?: string
  parent_tool_use_id?: string | null
  message?: { role?: string; content?: string | Array<{ type: string; text?: string; name?: string; id?: string; content?: unknown; is_error?: boolean }> }
  is_error?: boolean
  result?: string
  local_command?: string
  tool_use_result?: { agentType?: string; content?: Array<{ type: string; text?: string }> }
  num_turns?: number
  stop_reason?: string | null
  usage?: Usage
}

export interface ClaudeRun {
  events: ClaudeEvent[]
  /** The closing `result` event: the final text, the session id and whether the run failed. */
  result: ClaudeEvent
  sessionId: string
}

export interface Usage {
  input_tokens?: number
  output_tokens?: number
}

// #region snippet
/**
 * The variables a plugboard setup needs, plus the ones that keep a scripted run quiet: no telemetry, error reports, updates or
 * other traffic that is not a model call. ANTHROPIC_BASE_URL has no /v1, because Claude Code adds `/v1/messages`.
 */
const connect = (baseUrl: string, key: string) => ({
  ANTHROPIC_BASE_URL: baseUrl,
  ANTHROPIC_AUTH_TOKEN: key,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "fast",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "fast",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "fast",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DISABLE_TELEMETRY: "1",
  DISABLE_ERROR_REPORTING: "1",
  DISABLE_AUTOUPDATER: "1",
})

/** `claude -p`: one prompt, no questions. `--allowedTools` answers the permission prompts a headless run cannot. */
const headless = (prompt: string, model = "fast") => ["-p", prompt, "--model", model, "--allowedTools", "Write,Read,Agent", "--output-format", "stream-json", "--verbose"]
// #endregion snippet

/**
 * The variables that keep the request the same on every machine: no CLAUDE.md, auto memory, git status, bundled skills or
 * attribution fingerprint, no terminal title call, a fixed time zone. A real run sends all of that.
 */
const REPRODUCIBLE = {
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: "1",
  CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
  CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
  CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1",
  CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
  TZ: "UTC",
  BROWSER: "true",
}

/** A fresh home and workspace for one run. */
export function cliHome(): string {
  const clean = () => {
    rmSync(HOME, { recursive: true, force: true })
    rmSync(WORKSPACE, { recursive: true, force: true })
  }
  clean()
  process.once("exit", clean)
  mkdirSync(join(HOME, ".claude"), { recursive: true })
  mkdirSync(WORKSPACE, { recursive: true })
  return HOME
}

/** What the model wrote into the workspace, or null when the file is not there. */
export function workspaceFile(name: string): string | null {
  try {
    return readFileSync(join(WORKSPACE, name), "utf8")
  } catch {
    return null
  }
}

/** The CLI's environment: the caller's, minus every ANTHROPIC_*, CLAUDE_* and DISABLE_* variable, with the run's home and the plugboard key. */
function cliEnv(): Record<string, string | undefined> {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(ANTHROPIC_|CLAUDE|DISABLE_|API_TIMEOUT_MS|MAX_THINKING_TOKENS|ENABLE_)/.test(name)))
  const baseUrl = (process.env.PLUGBOARD_BASE_URL ?? "").replace(/\/v1\/?$/, "")
  return { ...inherited, ...REPRODUCIBLE, ...connect(baseUrl, process.env.PLUGBOARD_KEY ?? ""), HOME, CLAUDE_CONFIG_DIR: join(HOME, ".claude") }
}

/**
 * One headless call: `claude -p "<prompt>" ...`, with `extra` flags after the standard ones (`--resume <id>`). Returns the stream-json
 * events and the closing result. Throws with the CLI's text when the process failed or printed no result.
 */
export async function claude(prompt: string, extra: string[] = [], model = "fast"): Promise<ClaudeRun> {
  const proc = Bun.spawn([CLI, ...headless(prompt, model), ...extra], { cwd: WORKSPACE, env: cliEnv(), stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const status = await proc.exited
  const events = stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as ClaudeEvent)
  const result = events.findLast((event) => event.type === "result")
  if (!result) throw new Error(`claude exited ${status} with no result: ${stderr.slice(0, 400)}`)
  if (status !== 0 && !result.is_error) throw new Error(`claude exited ${status}: ${stderr.slice(0, 400)}`)
  return { events, result, sessionId: result.session_id ?? "" }
}

/** The text blocks of one event's message, joined. */
export function textOf(event: ClaudeEvent): string {
  const content = event.message?.content
  if (typeof content === "string") return content
  return (content ?? []).flatMap((block) => (block.type === "text" && block.text ? [block.text] : [])).join("\n")
}

/** The names of the tools the model called, in order. `Task` is the older name of `Agent`. */
export function toolsUsed(events: ReadonlyArray<ClaudeEvent>): string[] {
  const blocks = events.flatMap((event) => (event.type === "assistant" && Array.isArray(event.message?.content) ? event.message.content : []))
  return blocks.flatMap((block) => (block.type === "tool_use" && block.name ? [block.name] : []))
}

export const cliVersion = async (): Promise<string> =>
  (JSON.parse(await Bun.file(join(EXAMPLE, "node_modules/@anthropic-ai/claude-code/package.json")).text()) as { version: string }).version
