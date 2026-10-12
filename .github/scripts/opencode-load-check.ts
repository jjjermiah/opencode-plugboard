#!/usr/bin/env bun
// Starts a throwaway OpenCode server with plugboard loaded from a checkout as a local plugin, and
// checks that the plugin loads and its listener answers. No provider credentials and no model call,
// so this proves the plugin loads in that host, not that a prompt works (the pong gate in
// docs/development.md still does that by hand). opencode-release.yml runs it daily on the newest
// CLI; run it by hand against any binary.
//
//   bun .github/scripts/opencode-load-check.ts --bin <path/to/opencode> [--checkout <dir>]
//
// The server gets its own HOME and XDG dirs in a temp directory, removed afterwards. Exit 0 when
// /api/plugin lists opencode-plugboard as active and its /healthz answers 200 with {"ok":true}.
// Otherwise prints the reason and the tail of the server log, and exits 1.
import { mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { randomBytes } from "node:crypto"

const PLUGIN_ID = "opencode-plugboard"

type PluginInfo = {
  id: string
  source: { type: string; path?: string; target?: string }
  state: { status: string; error?: string }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const bin = arg("bin")
if (!bin) {
  console.error("usage: opencode-load-check.ts --bin <path/to/opencode> [--checkout <dir>]")
  process.exit(2)
}
const binPath = resolve(bin)
const checkout = resolve(arg("checkout") ?? process.cwd())
const serverPort = Number(arg("server-port") ?? 4610)
const pluginPort = Number(arg("plugin-port") ?? 4596)
const deadline = Date.now() + Number(arg("timeout-ms") ?? 120_000)

const work = mkdtempSync(join(tmpdir(), "plugboard-load-"))
const home = join(work, "home")
const project = join(work, "project")
const logPath = join(work, "server.log")
const password = randomBytes(16).toString("hex")
const key = randomBytes(16).toString("hex")

mkdirSync(join(home, ".config", "opencode"), { recursive: true })
mkdirSync(project)
writeFileSync(
  join(home, ".config", "opencode", "opencode.jsonc"),
  JSON.stringify(
    {
      plugins: [
        {
          package: checkout,
          options: { listen: { host: "127.0.0.1", port: pluginPort }, keys: { ci: key }, models: [] },
        },
      ],
    },
    null,
    2,
  ),
)

// Only what the CLI needs to find itself and its own state. Nothing from the CI runner's environment.
const env: Record<string, string> = {
  PATH: process.env.PATH ?? "",
  HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local", "share"),
  XDG_STATE_HOME: join(home, ".local", "state"),
  XDG_CACHE_HOME: join(home, ".cache"),
  OPENCODE_PASSWORD: password,
}

const log = openSync(logPath, "w")
const server = Bun.spawn([binPath, "serve", "--hostname", "127.0.0.1", "--port", String(serverPort)], {
  cwd: project,
  env,
  stdin: "ignore",
  stdout: log,
  stderr: log,
})

const serverUrl = `http://127.0.0.1:${serverPort}`

function api(...args: string[]): { ok: boolean; out: string; err: string } {
  const run = Bun.spawnSync([binPath, "api", "--server", serverUrl, ...args], {
    cwd: project,
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  return { ok: run.exitCode === 0, out: run.stdout.toString(), err: run.stderr.toString() }
}

async function waitFor<T>(what: string, attempt: () => T | undefined | Promise<T | undefined>): Promise<T> {
  for (;;) {
    if (server.exitCode !== null) throw new Error(`server exited with ${server.exitCode} while waiting for ${what}`)
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    const value = await attempt()
    if (value !== undefined) return value
    await Bun.sleep(1000)
  }
}

async function main(): Promise<void> {
  const version = Bun.spawnSync([binPath, "--version"], { env, stdout: "pipe", stderr: "pipe" })
  console.log(`opencode: ${version.stdout.toString().trim() || "unknown version"}`)

  // The first call loads the project, and with it the plugin (OpenCode loads no plugin until a client
  // touches the server; docs/warm-up.md).
  await waitFor("the server to answer /api/agent", () => api("get", "/api/agent").ok || undefined)
  console.log("ok   server answers /api/agent")

  const plugin = await waitFor(`${PLUGIN_ID} in /api/plugin`, () => {
    const listed = api("get", "/api/plugin", "--param", `location[directory]=${project}`)
    if (!listed.ok) return undefined
    const entry = (JSON.parse(listed.out).data as PluginInfo[]).find((p) => p.id === PLUGIN_ID)
    if (entry?.state.status === "failed") throw new Error(`${PLUGIN_ID} failed to load: ${entry.state.error ?? "no error text"}`)
    return entry?.state.status === "active" ? entry : undefined
  })
  console.log(`ok   ${PLUGIN_ID} active (${plugin.source.type}${plugin.source.path ? `: ${plugin.source.path}` : ""})`)

  const health = await waitFor(`/healthz on port ${pluginPort}`, async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${pluginPort}/healthz`)
      if (!res.ok) return undefined
      const body = (await res.json()) as { ok?: boolean }
      return body.ok === true ? body : undefined
    } catch {
      return undefined
    }
  })
  console.log(`ok   /healthz on port ${pluginPort} answers ${JSON.stringify(health)}`)
}

try {
  await main()
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`)
  const tail = readFileSync(logPath, "utf8").split("\n").slice(-60).join("\n")
  console.error(`--- server log (last 60 lines) ---\n${tail}`)
  process.exitCode = 1
} finally {
  server.kill()
  await server.exited
  rmSync(work, { recursive: true, force: true })
}
