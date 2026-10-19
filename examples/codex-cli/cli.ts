/**
 * Runs Codex CLI headless (`codex exec`) against plugboard. Each runner process gets its own HOME and CODEX_HOME, so nothing is
 * read from or written to the user's ~/.codex, and its own empty workspace, so no AGENTS.md or skill from the machine reaches the
 * prompt. The key comes from the environment (`env_key`), so there is no login and no browser.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const EXAMPLE = fileURLToPath(new URL(".", import.meta.url))
const CLI = join(EXAMPLE, "node_modules/.bin/codex")

// Named by the runner's pid (normalise.ts maps the name away), so two runs on one machine do not delete each other's home.
const HOME = join(tmpdir(), `plugboard-codex-cli-home-${process.pid}`)
const WORKSPACE = join(tmpdir(), `plugboard-codex-cli-workspace-${process.pid}`)
const CODEX_HOME = join(HOME, ".codex")

export interface CodexEvent {
  type: string
  item?: { type: string; text?: string; server?: string; tool?: string; arguments?: unknown; message?: string }
  usage?: Record<string, number>
  error?: { message?: string }
}

/**
 * The config.toml of a run. The plugboard provider is the one in ../config.toml. The rest keeps the request small and the same on
 * every machine: the date, the working directory, the sandbox text, the skills and AGENTS.md otherwise go into the prompt.
 */
function config(baseUrl: string, withTool: boolean): string {
  return [
    'model = "fast"',
    'model_provider = "plugboard"',
    // Plugboard takes function tools only. Codex's built-in web search and its multi-agent tools (a `namespace` tool) are
    // rejected with a 400 (#498), so a run turns both off. Goals and view_image are off only to keep the request small.
    'web_search = "disabled"',
    "include_permissions_instructions = false",
    "include_environment_context = false",
    "include_apps_instructions = false",
    `model_instructions_file = "${join(HOME, "instructions.md")}"`,
    "[skills.bundled]",
    "enabled = false",
    "[features]",
    "multi_agent = false",
    "goals = false",
    "view_image = false",
    ...(withTool ? ["[mcp_servers.weather]", `command = "${process.execPath}"`, `args = ["${join(EXAMPLE, "weather-mcp.ts")}"]`] : []),
    "[model_providers.plugboard]",
    'name = "Plugboard"',
    `base_url = "${baseUrl}"`,
    'env_key = "PLUGBOARD_KEY_CODEX_CLI"',
    'wire_api = "responses"',
    // A failed request surfaces at once instead of being retried.
    "request_max_retries = 0",
    "stream_max_retries = 0",
    "",
  ].join("\n")
}

/** A fresh home and workspace for one run. `withTool` adds the weather MCP server (weather-mcp.ts). */
export function cliHome(): string {
  const clean = () => {
    rmSync(HOME, { recursive: true, force: true })
    rmSync(WORKSPACE, { recursive: true, force: true })
  }
  clean()
  process.once("exit", clean)
  mkdirSync(CODEX_HOME, { recursive: true })
  mkdirSync(WORKSPACE, { recursive: true })
  writeFileSync(join(HOME, "instructions.md"), "You are a coding agent. Answer briefly and use the tools you are given.\n")
  return HOME
}

/** The CLI's environment: the caller's, minus every CODEX_* and OPENAI_* variable, with the run's home and the plugboard key. */
function cliEnv(): Record<string, string | undefined> {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(CODEX_|OPENAI_)/.test(name)))
  return { ...inherited, HOME, CODEX_HOME, TZ: "UTC", PLUGBOARD_KEY_CODEX_CLI: process.env.PLUGBOARD_KEY ?? "", BROWSER: "true" }
}

/**
 * One headless call: `codex exec --json -m <model> "<prompt>"`. Returns the JSONL events. Throws with the CLI's error when the
 * turn failed, so a rejected request is the scenario's error.
 */
export async function codex(model: string, prompt: string, withTool = false): Promise<CodexEvent[]> {
  writeFileSync(join(CODEX_HOME, "config.toml"), config(process.env.PLUGBOARD_BASE_URL ?? "", withTool))
  const proc = Bun.spawn([CLI, "exec", "--json", "--ephemeral", "--strict-config", "--skip-git-repo-check", "-m", model, prompt], {
    cwd: WORKSPACE,
    env: cliEnv(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const status = await proc.exited
  const events = stdout.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line) as CodexEvent)
  const failed = events.find((event) => event.type === "turn.failed")
  if (failed) throw new Error(`codex turn failed: ${failed.error?.message ?? "no message"}`)
  if (status !== 0) throw new Error(`codex exited ${status}: ${stderr.slice(0, 400)}`)
  return events
}

export const cliVersion = async (): Promise<string> =>
  (JSON.parse(await Bun.file(join(EXAMPLE, "node_modules/@openai/codex/package.json")).text()) as { version: string }).version
