#!/usr/bin/env bun
/**
 * Runs one example, or all of them, against a target and writes its runs/ directory.
 *
 *   bun examples/_harness/run.ts <example>|all --target scripted|live [--docker]
 *
 * scripted: starts scripted-server.ts in this process. live: attaches to PLUGBOARD_BASE_URL (default
 * http://127.0.0.1:4010/v1) with PLUGBOARD_KEY. Either way a capture proxy sits in front of plugboard, and the
 * example's runner is started with PLUGBOARD_BASE_URL (the proxy, ending in /v1), PLUGBOARD_KEY and
 * PLUGBOARD_CAPTURE_URL. The runner prints JSON lines; this file slices the captured exchanges by scenario mark,
 * normalises, validates and writes. Runners never write files.
 *
 * Exits 1 when a required scenario fails. `all` skips Docker examples (a compose file in the directory) unless --docker.
 * With --docker the capture proxy listens on 0.0.0.0 and the runner gets PLUGBOARD_CONTAINER_URL
 * (http://host.docker.internal:<port>), the address a container uses to reach it.
 */
import { existsSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { startCapture, type Exchange, type Mark } from "./capture.ts"
import { normaliseTranscript } from "./normalise.ts"
import { verdictOf, writeRun, type RunSummary, type ScenarioRow, type Status } from "./render.ts"
import { startScriptedServer } from "./scripted-server.ts"

const EXAMPLES = resolve(import.meta.dir, "..")
/** The repo this harness lives in: the default plugboard checkout for a live run. */
const ROOT = resolve(EXAMPLES, "..")
const LIVE_DEFAULT_URL = "http://127.0.0.1:4010/v1"
const RUNNER_TIMEOUT_MS = 20 * 60_000

interface ScenarioSpec {
  readonly id: string
  readonly required: boolean
  readonly models: ReadonlyArray<string>
  readonly routes: string
}
interface ScenariosFile {
  readonly routes: Readonly<Record<string, ReadonlyArray<string>>>
  readonly scenarios: ReadonlyArray<ScenarioSpec>
}
interface ResultLine {
  readonly kind: "result"
  readonly scenario: string
  readonly model: string
  readonly variant?: string
  readonly status: Status
  readonly checks: ReadonlyArray<{ readonly name: string; readonly ok: boolean }>
  readonly error: string | null
  readonly note: string | null
}
interface ClientLine {
  readonly kind: "client"
  readonly name: string
  readonly version: string
  readonly runtime: { readonly name: string; readonly version: string }
}
interface PlanLine {
  readonly kind: "plan"
  readonly scenarios: ReadonlyArray<string>
}

/** `examples/<name>`, or `examples/_harness/<name>` for the smoke examples. */
export function exampleDir(name: string): string {
  const direct = join(EXAMPLES, name)
  return existsSync(direct) ? direct : join(EXAMPLES, "_harness", name)
}

/** `openai-gpt-5.6-luna-low`; a scenario with no model (`-`, S7) is `none`. */
const slug = (model: string) => (model === "-" ? "none" : model.replace(/[/#]/g, "-"))
const pairKey = (scenario: string, model: string, variant?: string) => `${scenario}\u0000${variant ?? ""}\u0000${model}`
/** `S1.messages.fast.json`, `S1.fast.json`: the transcript a scenario, API and model write. */
const fileName = (scenario: string, model: string, variant?: string) => `${scenario}${variant === undefined ? "" : `.${variant}`}.${slug(model)}.json`

export function hasRunner(dir: string): boolean {
  return ["run.py", "run.ts", "run.sh"].some((file) => existsSync(join(dir, file)))
}

/** The runner command for an example directory, in the order the Contract names them. */
function runnerCommand(dir: string): string[] {
  if (existsSync(join(dir, "run.py"))) return existsSync(join(dir, "pyproject.toml")) ? ["uv", "run", "--frozen", "run.py"] : ["python3", "run.py"]
  if (existsSync(join(dir, "run.ts"))) return ["bun", "run.ts"]
  return ["bash", "run.sh"]
}

/** Parses the runner's stdout: JSON lines are data, anything else is passed through to stderr. */
function parseRunnerOutput(text: string) {
  const plan: string[] = []
  const results: ResultLine[] = []
  let client: ClientLine | undefined
  let done = false
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line.startsWith("{")) {
      if (line) console.error(line)
      continue
    }
    const data = JSON.parse(line) as { kind?: string }
    if (data.kind === "plan") plan.push(...(data as PlanLine).scenarios)
    else if (data.kind === "client") client = data as ClientLine
    else if (data.kind === "result") results.push(data as ResultLine)
    else if (data.kind === "done") done = true
  }
  return { plan, results, client, done }
}

/**
 * The plugboard checkout a live run reads commits from: PLUGBOARD_CHECKOUT, else the harness's own repo (ROOT). `fromEnv` says which,
 * so an error can name it without printing a path.
 */
const checkout = (): { dir: string; fromEnv: boolean } =>
  process.env.PLUGBOARD_CHECKOUT ? { dir: process.env.PLUGBOARD_CHECKOUT, fromEnv: true } : { dir: ROOT, fromEnv: false }

/** The plugboard commit a live run is recorded against: PLUGBOARD_COMMIT, else the checkout's HEAD. */
export async function plugboardCommit(): Promise<string> {
  const named = process.env.PLUGBOARD_COMMIT
  // An option-looking name would be read by git as a flag (`git show -x:package.json`), so it is refused here.
  if (named?.startsWith("-")) throw new Error("PLUGBOARD_COMMIT is a commit name, and must not start with `-`")
  if (named) return named
  const proc = Bun.spawn(["git", "-C", checkout().dir, "rev-parse", "--short=7", "HEAD"], { stdout: "pipe", stderr: "ignore" })
  const sha = (await new Response(proc.stdout).text()).trim()
  return (await proc.exited) === 0 && sha ? sha : "unknown"
}

/**
 * The plugboard version of a commit: its package.json at that commit (`git show <commit>:package.json`), not the checkout's
 * working tree, which may be another branch (#335). This is the fallback when the live server's `/plugboard/status` gives no
 * `packageVersion` (#347). A commit the checkout does not know is an error, raised before the runner starts.
 */
export async function plugboardVersion(commit: string): Promise<string> {
  const { dir, fromEnv } = checkout()
  const proc = Bun.spawn(["git", "-C", dir, "show", `${commit}:package.json`], { stdout: "pipe", stderr: "pipe" })
  const [text, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  if ((await proc.exited) !== 0) {
    const where = fromEnv ? "PLUGBOARD_CHECKOUT" : "the default checkout (the harness's own repo, PLUGBOARD_CHECKOUT is unset)"
    throw new Error(`cannot read package.json at commit ${commit} in ${where}; git said: ${stderr.trim()}`)
  }
  const version = (JSON.parse(text) as { version?: unknown }).version
  if (typeof version !== "string") throw new Error(`package.json at commit ${commit} has no version`)
  return version
}

/**
 * The versions `GET /plugboard/status` reports on the live server, when the key can read it (#347). Anything else (no key, the
 * server unreachable, a refusal, a server without `packageVersion`) is undefined, and the caller falls back to git.
 */
export async function servedVersions(url: string, key: string | undefined): Promise<{ packageVersion: string; opencodeVersion: string | null } | undefined> {
  if (!key) return undefined
  try {
    const reply = await fetch(new URL("/plugboard/status", new URL(url).origin), { headers: { authorization: `Bearer ${key}` } })
    if (!reply.ok) return undefined
    const body = (await reply.json()) as { packageVersion?: unknown; opencodeVersion?: unknown }
    if (typeof body.packageVersion !== "string") return undefined
    return { packageVersion: body.packageVersion, opencodeVersion: typeof body.opencodeVersion === "string" ? body.opencodeVersion : null }
  } catch {
    return undefined
  }
}

/**
 * What a live run records about plugboard: the commit it names, and its version and OpenCode version (#335, #347). The version and
 * OpenCode version come from the server's `/plugboard/status` when the key can read it, else from git (`plugboardVersion`). The commit
 * is still checked against the checkout first, so a commit the checkout does not have stops the run either way.
 */
export async function livePlugboard(server?: { url: string; key: string | undefined }): Promise<{ version: string; commit: string; opencode: string | null }> {
  const commit = await plugboardCommit()
  const gitVersion = await plugboardVersion(commit)
  const served = server ? await servedVersions(server.url, server.key) : undefined
  return { version: served?.packageVersion ?? gitVersion, commit, opencode: served?.opencodeVersion ?? null }
}

/** `<date>-<shortsha>`, `-2` on a collision. Live directories are never rewritten. */
function liveDirectory(base: string, date: string, sha: string): string {
  const first = join(base, `${date}-${sha}`)
  if (!existsSync(first)) return first
  for (let n = 2; ; n++) {
    const next = join(base, `${date}-${sha}-${n}`)
    if (!existsSync(next)) return next
  }
}

async function runExample(name: string, target: "scripted" | "live", docker: boolean): Promise<ScenarioRow[]> {
  const dir = exampleDir(name)
  // Resolved before anything runs: a commit the checkout does not have fails here, not after the runner has spent its time.
  const plugboard = target === "live" ? await livePlugboard({ url: process.env.PLUGBOARD_BASE_URL ?? LIVE_DEFAULT_URL, key: process.env.PLUGBOARD_KEY }) : undefined
  const scenarios = (await Bun.file(join(EXAMPLES, "_shared/scenarios.json")).json()) as ScenariosFile
  if (existsSync(join(dir, "package.json")) && !existsSync(join(dir, "node_modules"))) {
    const install = Bun.spawn(["bun", "install", "--frozen-lockfile"], { cwd: dir, stdout: "inherit", stderr: "inherit" })
    if ((await install.exited) !== 0) throw new Error(`bun install failed in ${name}`)
  }

  let upstream: string
  let key: string
  let stopServer: (() => Promise<void>) | undefined
  if (target === "scripted") {
    const server = await startScriptedServer(0)
    upstream = server.url
    key = server.key
    stopServer = server.close
  } else {
    upstream = process.env.PLUGBOARD_BASE_URL ?? LIVE_DEFAULT_URL
    const envKey = process.env.PLUGBOARD_KEY
    if (!envKey) throw new Error("live runs need PLUGBOARD_KEY (an app key of the isolated server)")
    key = envKey
    const health = await fetch(`${new URL(upstream).origin}/healthz`).catch(() => undefined)
    if (!health?.ok) throw new Error(`no plugboard answers at ${new URL(upstream).origin} (GET /healthz)`)
  }

  const capture = await startCapture(new URL(upstream).origin, docker ? "0.0.0.0" : "127.0.0.1")
  const started = Date.now()
  try {
    const cmd = runnerCommand(dir)
    const proc = Bun.spawn(cmd, {
      cwd: dir,
      env: {
        ...process.env,
        PLUGBOARD_BASE_URL: `${capture.url}/v1`,
        PLUGBOARD_KEY: key,
        PLUGBOARD_CAPTURE_URL: capture.url,
        PLUGBOARD_TARGET: target,
        ...(docker ? { PLUGBOARD_CONTAINER_URL: `http://host.docker.internal:${capture.port}` } : {}),
        PYTHONUNBUFFERED: "1",
      },
      stdout: "pipe",
      stderr: "inherit",
    })
    const timer = setTimeout(() => proc.kill(), RUNNER_TIMEOUT_MS)
    const output = await new Response(proc.stdout).text()
    const exit = await proc.exited
    clearTimeout(timer)
    const endedAt = Date.now()
    await capture.close()
    const { plan, results, client, done } = parseRunnerOutput(output)
    // A runner that exits before its last line writes a partial run: refuse it rather than record a gap as a pass.
    if (!done) throw new Error(`${name}: the runner did not finish (exit ${exit}); nothing was written`)
    return await writeExample(name, target, scenarios, { plan, results, client, capture, key, endedAt, started, plugboard })
  } finally {
    await capture.close()
    await stopServer?.()
  }
}

interface Collected {
  readonly plan: ReadonlyArray<string>
  readonly results: ReadonlyArray<ResultLine>
  readonly client: ClientLine | undefined
  readonly capture: { readonly marks: ReadonlyArray<Mark>; readonly exchanges: ReadonlyArray<Exchange> }
  readonly key: string
  readonly endedAt: number
  readonly started: number
  /** Live runs only: the commit the run names and its version (`livePlugboard`). */
  readonly plugboard: { readonly version: string; readonly commit: string; readonly opencode: string | null } | undefined
}

async function writeExample(name: string, target: "scripted" | "live", scenarios: ScenariosFile, got: Collected): Promise<ScenarioRow[]> {
  const { marks, exchanges } = got.capture
  const planned = scenarios.scenarios.filter((spec) => got.plan.includes(spec.id))
  const markIndexes = new Map<string, number[]>()
  marks.forEach((mark, index) => {
    const key = pairKey(mark.scenario, mark.model, mark.variant)
    markIndexes.set(key, [...(markIndexes.get(key) ?? []), index])
  })

  // Slice exchanges by mark; a route outside the scenario's own list goes to the background transcript.
  const byMark = new Map<number, Exchange[]>()
  for (const exchange of exchanges) byMark.set(exchange.mark, [...(byMark.get(exchange.mark) ?? []), exchange])
  const transcripts: Record<string, ReturnType<typeof normaliseTranscript>> = {}
  const background: Exchange[] = [...(byMark.get(-1) ?? [])]
  const routesOf = (scenario: string) => scenarios.routes[scenarios.scenarios.find((spec) => spec.id === scenario)?.routes ?? ""] ?? []
  const onRoute = (exchange: Exchange, scenario: string) => routesOf(scenario).some((prefix) => exchange.path.split("?")[0]!.startsWith(prefix))

  const rows: ScenarioRow[] = []
  const durations: number[] = []
  marks.forEach((mark, index) => {
    const own = byMark.get(index) ?? []
    background.push(...own.filter((exchange) => !onRoute(exchange, mark.scenario)))
    transcripts[fileName(mark.scenario, mark.model, mark.variant)] = normaliseTranscript(own.filter((exchange) => onRoute(exchange, mark.scenario)))
    durations[index] = (marks[index + 1]?.at ?? got.endedAt) - mark.at
  })
  background.sort((a, b) => a.seq - b.seq)
  transcripts["_background.json"] = normaliseTranscript(background)

  // One row per result the runner printed, in its order; a planned scenario with no result at all is a failure.
  for (const result of got.results) {
    const spec = scenarios.scenarios.find((candidate) => candidate.id === result.scenario)
    const index = markIndexes.get(pairKey(result.scenario, result.model, result.variant))?.shift()
    const transcript = index === undefined || result.status === "n/a" ? null : `transcripts/${fileName(result.scenario, result.model, result.variant)}`
    const duration = index === undefined || target === "scripted" ? {} : { duration_ms: durations[index] ?? 0 }
    rows.push({
      id: result.scenario,
      model: result.model,
      ...(result.variant === undefined ? {} : { variant: result.variant }),
      required: spec?.required ?? false,
      status: result.status,
      checks: result.checks,
      note: result.note,
      error: result.error,
      transcript,
      ...duration,
    })
  }
  for (const spec of planned) {
    if (got.results.some((result) => result.scenario === spec.id)) continue
    rows.push({ id: spec.id, model: spec.models[0] ?? "-", required: spec.required, status: "fail", checks: [], note: null, error: "runner printed no result for this scenario", transcript: null })
  }

  const client = got.client ?? { kind: "client" as const, name: name, version: "unknown", runtime: { name: "unknown", version: "0.0" } }
  // `-` marks a scenario with no model (S7, list models): it is not a model the run used.
  const models = [...new Set(rows.map((row) => row.model))].filter((model) => model !== "-")
  const summary: RunSummary = {
    schema: 1,
    example: name,
    target,
    client: { name: client.name, version: client.version, runtime: client.runtime },
    models,
    verdict: verdictOf(rows),
    scenarios: rows,
    ...(target === "live" && got.plugboard
      ? {
          date: new Date(got.started).toISOString().slice(0, 10),
          plugboard: { version: got.plugboard.version, commit: got.plugboard.commit },
          // From the server's `/plugboard/status` when it reports one, else null (render.ts names that in the markdown).
          opencode: got.plugboard.opencode,
        }
      : {}),
  }

  const base = join(exampleDir(name), "runs")
  const dir = target === "scripted" ? join(base, "scripted") : liveDirectory(join(base, "live"), summary.date!, summary.plugboard!.commit)
  await writeRun({ dir, summary, transcripts, secret: got.key, replaceTranscripts: target === "scripted" })
  console.log(`${name} ${target}: ${summary.verdict} -> ${dir}`)
  return rows
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const flag = args.indexOf("--target")
  const target = (flag === -1 ? "scripted" : args[flag + 1]) as "scripted" | "live"
  if (target !== "scripted" && target !== "live") throw new Error("--target must be scripted or live")
  const names = args.filter((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--target")
  if (names.length !== 1) throw new Error("usage: run.ts <example>|all --target scripted|live [--docker]")
  const docker = args.includes("--docker")
  const selected =
    names[0] === "all"
      ? readdirSync(EXAMPLES)
          .filter((entry) => !entry.startsWith("_") && statSync(join(EXAMPLES, entry)).isDirectory() && hasRunner(join(EXAMPLES, entry)))
          // The smoke examples test the harness itself; `all` leaves them out, run them by name.
          .filter((entry) => !entry.startsWith("smoke-"))
          .filter((entry) => docker || !existsSync(join(EXAMPLES, entry, "docker-compose.yml")) && !existsSync(join(EXAMPLES, entry, "compose.yaml")))
          .sort()
      : [names[0]!]

  let failed = 0
  for (const name of selected) {
    const rows = await runExample(name, target, docker)
    failed += rows.filter((row) => row.required && row.status === "fail").length
  }
  if (failed > 0) {
    console.error(`${failed} required scenario(s) failed`)
    process.exit(1)
  }
}
