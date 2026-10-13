#!/usr/bin/env bun
/**
 * Open WebUI against plugboard, driven over its HTTP API (no browser). Starts the container pinned in
 * docker-compose.yml with its OpenAI connection pointed at the capture proxy, then runs each scenario through Open
 * WebUI's own endpoints. Started by examples/_harness/run.ts with --docker, which sets PLUGBOARD_CONTAINER_URL.
 * This file writes no files: the harness does that from the JSON lines it prints.
 */
import { join } from "node:path"
import { emitClient, runAll } from "../_harness/ts/harness.ts"
import * as chat from "./chat.ts"
import * as image from "./image.ts"
import * as models from "./models.ts"
import type { Owui } from "./owui.ts"
import * as stream from "./stream.ts"
import * as streamTools from "./stream_tools.ts"
import * as structured from "./structured.ts"
import * as tools from "./tools.ts"
import * as wrongKey from "./wrong_key.ts"

const NAME = "plugboard-open-webui-examples"
const KEY = process.env.PLUGBOARD_KEY
const CONTAINER_URL = process.env.PLUGBOARD_CONTAINER_URL
if (!KEY) throw new Error("PLUGBOARD_KEY is not set: run this through examples/_harness/run.ts")
if (!CONTAINER_URL) throw new Error("PLUGBOARD_CONTAINER_URL is not set: run this through examples/_harness/run.ts --docker")

// The image is pinned once, in docker-compose.yml, so the runner and the compose file cannot disagree.
const IMAGE = (await Bun.file(join(import.meta.dir, "docker-compose.yml")).text()).match(/image:\s*(\S+)/)?.[1]
if (!IMAGE) throw new Error("docker-compose.yml has no image line")
const TAG = IMAGE.slice(IMAGE.lastIndexOf(":") + 1)

/** Runs `docker` with the key in its environment, not its arguments, so `ps` never shows it. Output is captured. */
async function docker(...args: string[]): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, OPENAI_API_KEY: KEY } })
  const [stdout] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code: await proc.exited, stdout: stdout.trim() }
}

/** A free loopback port: Docker publishes the UI there, and the runner calls it from the host. */
function freePort(): number {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") })
  const port = probe.port!
  probe.stop(true)
  return port
}

async function waitForHealth(base: string): Promise<void> {
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/health`).catch(() => undefined)
    if (response?.ok) return
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  throw new Error(`Open WebUI did not answer ${base}/health within 4 minutes`)
}

const port = freePort()
const base = `http://127.0.0.1:${port}`
await docker("rm", "-f", NAME)
await docker("volume", "rm", NAME)
try {
  const run = await docker(
    "run", "-d", "--name", NAME,
    "-p", `127.0.0.1:${port}:8080`,
    "--add-host", "host.docker.internal:host-gateway",
    "-v", `${NAME}:/app/backend/data`,
    "-e", "OPENAI_API_KEY",
    "-e", `OPENAI_API_BASE_URL=${CONTAINER_URL}/v1`,
    "-e", "ENABLE_OLLAMA_API=false",
    "-e", "WEBUI_AUTH=False",
    "-e", "WEBUI_SECRET_KEY=examples-scripted",
    // Background generation off: a title, tag or follow-up call would reach the scripted model unasked.
    "-e", "ENABLE_TITLE_GENERATION=False",
    "-e", "ENABLE_TAGS_GENERATION=False",
    "-e", "ENABLE_FOLLOW_UP_GENERATION=False",
    "-e", "ENABLE_AUTOCOMPLETE_GENERATION=False",
    "-e", "ENABLE_SEARCH_QUERY_GENERATION=False",
    IMAGE,
  )
  if (run.code !== 0) throw new Error(`docker run failed (exit ${run.code})`)
  await waitForHealth(base)

  // With WEBUI_AUTH=False the default admin signs in with any password; the token is what the API needs.
  const signin = await fetch(`${base}/api/v1/auths/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@localhost", password: "admin" }),
  })
  const token = ((await signin.json()) as { token?: string }).token
  if (!token) throw new Error(`signin failed: HTTP ${signin.status}`)
  const owui: Owui = { base, token, upstream: `${CONTAINER_URL}/v1` }
  await tools.createWeatherTool(owui)
  emitClient("Open WebUI", TAG)

  await runAll(
    {
      S1: (model) => chat.run(owui, model),
      S2: (model) => tools.run(owui, model),
      S3: (model) => stream.run(owui, model),
      S4: (model) => streamTools.run(owui, model),
      S5: (model) => image.run(owui, model),
      S6: (model) => structured.run(owui, model),
      S7: () => models.run(owui),
      E1: () => wrongKey.run(owui),
    },
    {
      na: {
        E2: "Open WebUI checks the model id against its own list and answers HTTP 400 Model not found, so the request never reaches plugboard",
      },
    },
  )
} finally {
  await docker("rm", "-f", NAME)
  await docker("volume", "rm", NAME)
}
