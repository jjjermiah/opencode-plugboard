/**
 * Runs the Gemini CLI headless against plugboard: the API key and base URL come from the environment, the auth type from a
 * settings file in a home made for each run, so nothing is written to the user's ~/.gemini and no login or browser is used.
 */
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const EXAMPLE = fileURLToPath(new URL(".", import.meta.url))
const CLI = join(EXAMPLE, "node_modules/.bin/gemini")

// The CLI puts its project temp dir (under HOME) and an empty workspace into its <session_context>, which goes on the wire.
// Both are fixed paths here so a scripted run does not change between runs. The date in that context cannot be turned off.
// Each runner process takes its own pair, named by its pid (normalise.ts maps the pid away). A shared pair meant that two runs on one
// machine, say two worktrees validating at once, deleted each other's home while the CLI was using it.
const HOME = join(tmpdir(), `plugboard-gemini-cli-home-${process.pid}`)
const WORKSPACE = join(tmpdir(), `plugboard-gemini-cli-workspace-${process.pid}`)
// The CLI reads its home from GEMINI_CLI_HOME before HOME, and its system settings from GEMINI_CLI_SYSTEM_SETTINGS_PATH, so a
// laptop that sets them would leak its own skills into the prompt (#443). The run clears every GEMINI_CLI_* override and sets these.
const SYSTEM_SETTINGS = join(HOME, "system-settings.json")

/** A fresh home for one run, with the settings that select API-key auth. Trust is passed as a flag (--skip-trust). */
export function cliHome(): string {
  const clean = () => {
    rmSync(HOME, { recursive: true, force: true })
    rmSync(WORKSPACE, { recursive: true, force: true })
  }
  clean()
  process.once("exit", clean)
  mkdirSync(join(HOME, ".gemini"), { recursive: true })
  mkdirSync(WORKSPACE, { recursive: true })
  writeFileSync(
    join(HOME, ".gemini", "settings.json"),
    JSON.stringify({ security: { auth: { selectedType: "gemini-api-key" } }, context: { includeDirectoryTree: false } }),
  )
  writeFileSync(SYSTEM_SETTINGS, "{}")
  return HOME
}

/** Copies a file into the CLI's workspace, so a prompt can refer to it as `@<name>`. */
export function stageFile(source: string, name: string): void {
  copyFileSync(source, join(WORKSPACE, name))
}

/** The CLI's environment: the caller's, minus every GEMINI_CLI_* override, with the run's home and an empty system settings file. */
function cliEnv(home: string): Record<string, string | undefined> {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GEMINI_CLI_")))
  return {
    ...inherited,
    HOME: home,
    GEMINI_CLI_HOME: home,
    GEMINI_CLI_SYSTEM_SETTINGS_PATH: SYSTEM_SETTINGS,
    GEMINI_API_KEY: process.env.PLUGBOARD_KEY ?? "",
    GOOGLE_GEMINI_BASE_URL: (process.env.PLUGBOARD_BASE_URL ?? "").replace(/\/v1\/?$/, ""),
    BROWSER: "true",
  }
}

/** One headless call: the prompt, the model (a `#` goes as %23, as with the other SDKs) and the output flags. Returns stdout. */
export async function gemini(home: string, model: string, prompt: string, output: string): Promise<string> {
  const proc = Bun.spawn([CLI, "-p", prompt, "-m", model.replaceAll("#", "%23"), "--output-format", output, "--skip-trust"], {
    cwd: WORKSPACE,
    env: cliEnv(home),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const status = await proc.exited
  if (status !== 0) throw new Error(`gemini exited ${status}: ${stderr.slice(0, 400)}`)
  return stdout
}

export const cliVersion = async (): Promise<string> =>
  (JSON.parse(await Bun.file(join(EXAMPLE, "node_modules/@google/gemini-cli/package.json")).text()) as { version: string }).version
