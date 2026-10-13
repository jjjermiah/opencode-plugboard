/**
 * The examples harness's summary schema (examples/_harness/run.schema.json) accepts the golden fixture and rejects
 * a summary without its verdict. run.ts validates every summary against the same schema before it writes it.
 */
import { beforeEach, afterEach, describe, expect, test } from "bun:test"
import Ajv2020 from "ajv/dist/2020"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { livePlugboard, plugboardVersion } from "../../examples/_harness/run.ts"

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

  test("#335 a live summary may record opencode as null (the server exposes no version)", async () => {
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
  const git = (...args: string[]) => Bun.spawnSync(["git", "-C", repo, "-c", "user.name=test", "-c", "user.email=test@example.invalid", ...args]).stdout.toString().trim()

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
    expect(await livePlugboard()).toEqual({ version: "0.25.1", commit: oldCommit })
  })

  test("a commit the checkout does not have is refused, not recorded as unknown", async () => {
    await expect(plugboardVersion("0000000")).rejects.toThrow("cannot read package.json at commit 0000000")
  })
})
