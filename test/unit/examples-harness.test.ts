/**
 * The examples harness's summary schema (examples/_harness/run.schema.json) accepts the golden fixture and rejects
 * a summary without its verdict. run.ts validates every summary against the same schema before it writes it.
 */
import { beforeEach, afterEach, describe, expect, test } from "bun:test"
import Ajv2020 from "ajv/dist/2020"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { livePlugboard, plugboardVersion, servedVersions } from "../../examples/_harness/run.ts"

const harness = (name: string) => fileURLToPath(new URL(`../../examples/_harness/${name}`, import.meta.url))

const ajv = new Ajv2020({ allErrors: true })
// Compiled once: ajv refuses a second compile of the schema's $id.
const validate = Bun.file(harness("run.schema.json"))
  .json()
  .then((schema) => ajv.compile(schema))

describe("examples summary schema", () => {
  test("the golden summary validates against run.schema.json", async () => {
    const check = await validate
    const golden = await Bun.file(harness("golden/summary.json")).json()
    expect(check(golden), JSON.stringify(check.errors)).toBe(true)
  })

  test("a summary without a verdict is rejected", async () => {
    const check = await validate
    const golden = await Bun.file(harness("golden/summary.json")).json()
    const { verdict: _verdict, ...withoutVerdict } = golden
    expect(check(withoutVerdict)).toBe(false)
  })

  test("a scenario status outside pass, fail, gap and n/a is rejected", async () => {
    const check = await validate
    const golden = await Bun.file(harness("golden/summary.json")).json()
    golden.scenarios[0].status = "skipped"
    expect(check(golden)).toBe(false)
  })

  test("#335 a live summary may record opencode as null (no OpenCode version reported)", async () => {
    const check = await validate
    const golden = await Bun.file(harness("golden/summary.json")).json()
    expect(check({ ...golden, date: "2026-10-13", plugboard: { version: "0.26.0", commit: "abc1234" }, opencode: null }), "null opencode").toBe(true)
  })
})

/**
 * #335: a live run records the version of the commit it names, read from that commit's package.json, not the checkout's working
 * tree. The checkout here is a throwaway repo whose HEAD is a later version than the commit the run names.
 */
describe("#335 live runs record the version of the commit they name", () => {
  let repo: string
  let saved: Record<string, string | undefined>
  let oldCommit: string
  const git = (...args: string[]) =>
    Bun.spawnSync(["git", "-C", repo, "-c", "user.name=test", "-c", "user.email=test@example.invalid", ...args])
      .stdout.toString()
      .trim()

  beforeEach(() => {
    saved = { PLUGBOARD_CHECKOUT: process.env.PLUGBOARD_CHECKOUT, PLUGBOARD_COMMIT: process.env.PLUGBOARD_COMMIT }
    repo = mkdtempSync(join(tmpdir(), "plugboard-version-"))
    git("init", "-q")
    writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "0.25.1" }))
    git("add", "package.json")
    git("commit", "-q", "-m", "release 0.25.1")
    oldCommit = git("rev-parse", "--short=7", "HEAD")
    writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "0.26.0" }))
    git("commit", "-q", "-am", "release 0.26.0")
    process.env.PLUGBOARD_CHECKOUT = repo
    delete process.env.PLUGBOARD_COMMIT
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  test("the version of a named commit is its package.json, not the checkout's HEAD", async () => {
    expect(await plugboardVersion(oldCommit)).toBe("0.25.1")
    expect(await plugboardVersion("HEAD")).toBe("0.26.0")
  })

  test("a live run that names an older commit records that commit's version", async () => {
    process.env.PLUGBOARD_COMMIT = oldCommit
    expect(await livePlugboard()).toEqual({ version: "0.25.1", commit: oldCommit, opencode: null })
  })

  test("a commit the checkout does not have is refused, not recorded as unknown", async () => {
    await expect(plugboardVersion("0000000")).rejects.toThrow("cannot read package.json at commit 0000000")
  })

  test("the error names git's stderr and that PLUGBOARD_CHECKOUT was the checkout", async () => {
    await expect(plugboardVersion("0000000")).rejects.toThrow(/in PLUGBOARD_CHECKOUT; git said: fatal/)
  })

  test("without PLUGBOARD_CHECKOUT, the default checkout is the harness's own repo, and the error says so", async () => {
    delete process.env.PLUGBOARD_CHECKOUT
    const own = JSON.parse(readFileSync(join(import.meta.dir, "../..", "package.json"), "utf8")).version as string
    expect(await plugboardVersion("HEAD")).toBe(own)
    await expect(plugboardVersion("0000000")).rejects.toThrow(/in the default checkout \(the harness's own repo, PLUGBOARD_CHECKOUT is unset\); git said: fatal/)
  })

  test("a PLUGBOARD_COMMIT that starts with a dash is refused, not handed to git as an option", async () => {
    process.env.PLUGBOARD_COMMIT = "--output=/dev/null"
    await expect(livePlugboard()).rejects.toThrow("must not start with `-`")
  })
})

describe("#347 a live run reads the versions from the server's /plugboard/status when its key can read it", () => {
  const own = (JSON.parse(readFileSync(join(import.meta.dir, "../..", "package.json"), "utf8")) as { version: string }).version
  let saved: { PLUGBOARD_CHECKOUT?: string; PLUGBOARD_COMMIT?: string }
  let server: ReturnType<typeof Bun.serve> | undefined

  beforeEach(() => {
    saved = { PLUGBOARD_CHECKOUT: process.env.PLUGBOARD_CHECKOUT, PLUGBOARD_COMMIT: process.env.PLUGBOARD_COMMIT }
    delete process.env.PLUGBOARD_CHECKOUT
    delete process.env.PLUGBOARD_COMMIT
  })

  afterEach(() => {
    server?.stop(true)
    server = undefined
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  /** A loopback server that answers `/plugboard/status` with `body` to the good key, and 401 to any other. */
  function serve(body: Record<string, unknown>): string {
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request) => (request.headers.get("authorization") === "Bearer k-good" ? Response.json(body) : Response.json({ error: "unauthorised" }, { status: 401 })),
    })
    return `http://127.0.0.1:${server.port}/v1`
  }

  test("the served package and OpenCode versions win over the checkout's package.json", async () => {
    const url = serve({ ok: true, packageVersion: "9.9.9", opencodeVersion: "2.0.27" })
    expect(await livePlugboard({ url, key: "k-good" })).toMatchObject({ version: "9.9.9", opencode: "2.0.27" })
    expect(await servedVersions(url, "k-good")).toEqual({ packageVersion: "9.9.9", opencodeVersion: "2.0.27" })
  })

  test("a key the server refuses falls back to the checkout's package.json, and OpenCode is null", async () => {
    const url = serve({ ok: true, packageVersion: "9.9.9", opencodeVersion: "2.0.27" })
    expect(await livePlugboard({ url, key: "k-bad" })).toEqual({ version: own, commit: expect.any(String), opencode: null })
  })

  test("no key, or a server that is not there, falls back to git", async () => {
    expect((await livePlugboard({ url: serve({ packageVersion: "9.9.9" }), key: undefined })).version).toBe(own)
    expect((await livePlugboard({ url: "http://127.0.0.1:1/v1", key: "k-good" })).version).toBe(own)
  })

  test("a server that does not report packageVersion (an older plugboard) falls back to git; a missing opencodeVersion is null", async () => {
    expect((await livePlugboard({ url: serve({ ok: true }), key: "k-good" })).version).toBe(own)
    expect(await livePlugboard({ url: serve({ ok: true, packageVersion: "9.9.9" }), key: "k-good" })).toMatchObject({ version: "9.9.9", opencode: null })
  })

  test("a server that never answers is given up after the timeout, so the run falls back to git", async () => {
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Promise<Response>(() => {}) })
    expect(await servedVersions(`http://127.0.0.1:${server.port}/v1`, "k-good", 100)).toBeUndefined()
  })

  test("a commit the checkout does not have still stops the run, even when the server answers", async () => {
    process.env.PLUGBOARD_COMMIT = "0000000"
    await expect(livePlugboard({ url: serve({ ok: true, packageVersion: "9.9.9" }), key: "k-good" })).rejects.toThrow("cannot read package.json at commit 0000000")
  })
})
