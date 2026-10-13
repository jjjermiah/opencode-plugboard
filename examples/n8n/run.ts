#!/usr/bin/env bun
/**
 * n8n against plugboard, driven headless: a throwaway owner, a public API key, an OpenAI credential pointed at the
 * capture proxy, the workflows in workflows/ imported and activated, and each scenario run through its webhook. The
 * observations come from the webhook answer and the execution's run data. Started by examples/_harness/run.ts with
 * --docker, which sets PLUGBOARD_CONTAINER_URL. This file writes no files; the harness does.
 */
import { join } from "node:path"
import { emitClient, runAll } from "../_harness/ts/harness.ts"
import * as chat from "./chat.ts"
import * as image from "./image.ts"
import * as models from "./models.ts"
import { api, rest, type N8n } from "./n8n.ts"
import * as stream from "./stream.ts"
import * as streamTools from "./stream_tools.ts"
import * as structured from "./structured.ts"
import * as tools from "./tools.ts"

const NAME = "plugboard-n8n-examples"
const KEY = process.env.PLUGBOARD_KEY
const CONTAINER_URL = process.env.PLUGBOARD_CONTAINER_URL
if (!KEY) throw new Error("PLUGBOARD_KEY is not set: run this through examples/_harness/run.ts")
if (!CONTAINER_URL) throw new Error("PLUGBOARD_CONTAINER_URL is not set: run this through examples/_harness/run.ts --docker")

// The image is pinned once, in docker-compose.yml, so the runner and the compose file cannot disagree.
const IMAGE = (await Bun.file(join(import.meta.dir, "docker-compose.yml")).text()).match(/image:\s*(\S+)/)?.[1]
if (!IMAGE) throw new Error("docker-compose.yml has no image line")
const TAG = IMAGE.slice(IMAGE.lastIndexOf(":") + 1)
const OWNER = { email: "examples@example.com", password: "Examples-Test-1234" }
const WORKFLOWS = ["s1-chain", "s1-responses-default", "s2-agent", "s3s4-stream-agent", "s5-image", "s6-structured", "s6b-jsonobject", "s8-options"]

/** Runs `docker`; the key is not in its arguments, so `ps` never shows it. */
async function docker(...args: string[]): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" })
  const [stdout] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code: await proc.exited, stdout: stdout.trim() }
}

/** A free loopback port: Docker publishes n8n there, and the runner calls it from the host. */
function freePort(): number {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") })
  const port = probe.port!
  probe.stop(true)
  return port
}

/** Waits until the REST API answers with JSON. /healthz is up before that, and /rest/* returns a "starting up" page. */
async function waitForRest(base: string): Promise<void> {
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/rest/settings`).catch(() => undefined)
    if (response?.headers.get("content-type")?.includes("application/json")) return
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error("n8n REST API did not answer with JSON within 4 minutes")
}

const port = freePort()
const base = `http://127.0.0.1:${port}`

/** Removes the container and its volume. The volume holds the plugboard key n8n stores in its credential. */
async function cleanup(): Promise<void> {
  await docker("rm", "-f", NAME)
  await docker("volume", "rm", NAME)
}

// `finally` does not run on a signal, so a killed run cleans up here before it exits.
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  process.once(signal, () => void cleanup().finally(() => process.exit(code)))
}

await cleanup()
try {
  const run = await docker(
    "run", "-d", "--name", NAME,
    "-p", `127.0.0.1:${port}:5678`,
    "--add-host", "host.docker.internal:host-gateway",
    "-v", `${NAME}:/home/node/.n8n`,
    "-e", "N8N_SECURE_COOKIE=false",
    "-e", "GENERIC_TIMEZONE=UTC",
    "-e", "N8N_DIAGNOSTICS_ENABLED=false",
    "-e", "N8N_PERSONALIZATION_ENABLED=false",
    IMAGE,
  )
  if (run.code !== 0) throw new Error(`docker run failed (exit ${run.code})`)
  await waitForRest(base)

  // The owner, a session for the internal routes, and a public API key for workflows and executions.
  const setup = await fetch(`${base}/rest/owner/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...OWNER, firstName: "Examples", lastName: "Test" }),
  })
  if (!setup.ok) throw new Error(`owner setup failed: HTTP ${setup.status}`)
  const login = await fetch(`${base}/rest/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ emailOrLdapLoginId: OWNER.email, password: OWNER.password }),
  })
  const cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0] ?? ""
  if (!cookie) throw new Error(`n8n login failed: HTTP ${login.status}`)
  const scopes = ["workflow:create", "workflow:read", "workflow:list", "workflow:update", "workflow:delete", "workflow:activate", "workflow:deactivate", "credential:create", "credential:list", "credential:read", "credential:update", "credential:delete", "execution:list", "execution:read", "execution:delete", "execution:stop"]
  const keyed = await rest({ base, apiKey: "", cookie, credentialId: "" }, "POST", "/rest/api-keys", { label: "examples", scopes, expiresAt: null })
  const apiKey = (keyed.json as { data?: { rawApiKey?: string } } | null)?.data?.rawApiKey
  if (!apiKey) throw new Error(`creating the API key failed: HTTP ${keyed.status}`)

  // The OpenAI credential, pointed at the capture proxy as the container sees it.
  const created = await api({ base, apiKey, cookie, credentialId: "" }, "POST", "/api/v1/credentials", {
    name: "Plugboard",
    type: "openAiApi",
    data: { apiKey: KEY, url: `${CONTAINER_URL}/v1`, header: false, allowedHttpRequestDomains: "all" },
  })
  const credentialId = (created.json as { id?: string } | null)?.id
  if (!credentialId) throw new Error(`creating the credential failed: HTTP ${created.status}`)
  const n8n: N8n = { base, apiKey, cookie, credentialId }

  // Each workflow, with the credential's id in place of the placeholder, imported and activated.
  for (const file of WORKFLOWS) {
    const text = (await Bun.file(join(import.meta.dir, "workflows", `${file}.json`)).text()).replaceAll("__CRED_ID__", credentialId)
    const imported = await api(n8n, "POST", "/api/v1/workflows", JSON.parse(text))
    const id = (imported.json as { id?: string } | null)?.id
    if (!id) throw new Error(`importing ${file} failed: HTTP ${imported.status}`)
    await api(n8n, "POST", `/api/v1/workflows/${id}/activate`)
  }

  emitClient("n8n", TAG)
  await runAll(
    {
      S1: (model, variant) => chat.run(n8n, model, variant),
      S2: (model) => tools.run(n8n, model),
      S3: (model) => stream.run(n8n, model),
      S4: (model) => streamTools.run(n8n, model),
      S5: (model) => image.run(n8n, model),
      S6: (model) => structured.run(n8n, model),
      S7: () => models.run(n8n),
    },
    {
      variants: { S1: ["chat", "responses"] },
      // n8n's Responses node records no finish_reason, and only its own estimate of usage (tokenUsageEstimate), not
      // plugboard's usage. Neither check is read on this variant (#343). Any other failure on the row is a fail, not a gap.
      unobserved: {
        "S1|responses": {
          "finish_reason is stop": "n8n's Responses node records no finish_reason (#343)",
          "usage present": "n8n's Responses node records only its own estimate (tokenUsageEstimate), not plugboard's usage (#343)",
        },
      },
      na: {
        E1: "n8n shows plugboard's message (Missing or invalid API key) and LangChain's error class (MODEL_AUTHENTICATION), not the error code, so invalid_api_key cannot be read here",
        E2: "n8n shows plugboard's 404 text and LangChain's error class (MODEL_NOT_FOUND), not the error code model_not_found",
      },
    },
  )
} finally {
  await cleanup()
}
