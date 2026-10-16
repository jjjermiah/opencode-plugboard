/**
 * Runs the Gemini CLI headless against plugboard: the API key and base URL come from the environment, the auth type from a
 * settings file in a home made for each run, so nothing is written to the user's ~/.gemini and no login or browser is used.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const EXAMPLE = fileURLToPath(new URL(".", import.meta.url))
const CLI = join(EXAMPLE, "node_modules/.bin/gemini")

// The CLI puts its project temp dir (under HOME) and an empty workspace into its <session_context>, which goes on the wire.
// Both are fixed paths here so a scripted run does not change between runs. The date in that context cannot be turned off.
const HOME = join(tmpdir(), "plugboard-gemini-cli-home")
const WORKSPACE = join(tmpdir(), "plugboard-gemini-cli-workspace")

/** A fresh home for one run, with the settings that select API-key auth. Trust is passed as a flag (--skip-trust). */
export function cliHome(): string {
  rmSync(HOME, { recursive: true, force: true })
  rmSync(WORKSPACE, { recursive: true, force: true })
  mkdirSync(join(HOME, ".gemini"), { recursive: true })
  mkdirSync(WORKSPACE, { recursive: true })
  writeFileSync(
    join(HOME, ".gemini", "settings.json"),
    JSON.stringify({ security: { auth: { selectedType: "gemini-api-key" } }, context: { includeDirectoryTree: false } }),
  )
  return HOME
}

/** One headless call: the prompt, the model (a `#` goes as %23, as with the other SDKs) and the output flags. Returns stdout. */
export async function gemini(home: string, model: string, prompt: string, output: string): Promise<string> {
  const origin = (process.env.PLUGBOARD_BASE_URL ?? "").replace(/\/v1\/?$/, "")
  const proc = Bun.spawn([CLI, "-p", prompt, "-m", model.replaceAll("#", "%23"), "--output-format", output, "--skip-trust"], {
    cwd: WORKSPACE,
    env: { ...process.env, HOME: home, GEMINI_API_KEY: process.env.PLUGBOARD_KEY ?? "", GOOGLE_GEMINI_BASE_URL: origin, BROWSER: "true" },
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
