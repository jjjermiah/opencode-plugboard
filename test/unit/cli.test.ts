/**
 * `opencode-plugboard init` (src/cli.ts, bin/opencode-plugboard.ts) against temp dirs: the config is edited as JSONC
 * (comments and other keys stay), the version is pinned, the key is generated, and an existing entry is never replaced
 * without `--force`.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse } from "jsonc-parser"
import { parseOptions } from "../../src/config.js"
import { lineDiff, runCli, type CliEnv } from "../../src/cli.js"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "plugboard-cli-"))
  dirs.push(dir)
  return dir
}

const KEY = "pb_test-key"
function run(args: string[], extra: Partial<CliEnv> = {}) {
  const out: string[] = []
  const err: string[] = []
  const code = runCli(args, { out: (t) => out.push(t), err: (t) => err.push(t), env: {}, home: tmp(), version: "9.8.7", newKey: () => KEY, ...extra })
  return { code, out: out.join(""), err: err.join("") }
}
const init = (config: string, ...args: string[]) => run(["init", "--config", config, ...args])
const read = (path: string) => readFileSync(path, "utf8")
const entryOf = (path: string) => (parse(read(path)) as { plugins: Array<{ package: string; options: Record<string, unknown> }> }).plugins

const COMMENTED = `{
  // my providers
  "provider": { "anthropic": {} }, // keep me
  /* plugins */
  "plugins": [
    "some-other-plugin@1.0.0", // another one
  ],
  "model": "anthropic/claude-sonnet-4-6",
}
`

describe("init: a new config", () => {
  test("creates the file and its directory, pins the version and allows every connected model", () => {
    const path = join(tmp(), "nested", "opencode.jsonc")
    const result = init(path)
    expect(result.code).toBe(0)
    expect(entryOf(path)).toEqual([{ package: "opencode-plugboard@9.8.7", options: { keys: { "my-app": KEY }, models: "all" } }])
    expect(read(path).endsWith("\n")).toBe(true)
    // The written options are what the plugin itself accepts.
    expect(parseOptions(entryOf(path)[0]!.options)).toMatchObject({ keys: { "my-app": KEY }, models: ["all"] })
  })

  test("prints the key once with a ready curl; without --fast the chat call names no model it could not know", () => {
    const { out } = init(join(tmp(), "c.jsonc"))
    expect(out.split(KEY).length - 1).toBe(3)
    expect(out).toContain(`curl -s http://127.0.0.1:4010/v1/models -H "Authorization: Bearer ${KEY}"`)
    expect(out).toContain("opencode api get /api/agent")
    expect(out).toContain("<model id from step 2>")
  })

  test("the output numbers the steps, says to touch the server after every restart, and links the troubleshooting table", () => {
    const { out } = init(join(tmp(), "c.jsonc"))
    expect(out).toContain("1. Restart OpenCode")
    expect(out).toContain("run this again after every restart")
    expect(out).toContain("2. List the models you can use:")
    expect(out).toContain("3. Call one (replace <model id from step 2> with an id from that list):")
    expect(out).toContain("No answer on 4010? See https://jjjermiah.github.io/opencode-plugboard/install#if-it-does-not-answer")
    expect(out).toContain("it is also saved in that file")
  })

  test("--app names the key and --fast adds the fast alias and a chat curl that uses it", () => {
    const path = join(tmp(), "c.jsonc")
    const { out } = init(path, "--app", "my-bot", "--fast", "anthropic/claude-haiku-4-5")
    expect(entryOf(path)[0]!.options).toEqual({ keys: { "my-bot": KEY }, models: "all", aliases: { fast: "anthropic/claude-haiku-4-5" } })
    expect(out).toContain(`"model": "fast"`)
    expect(out).toContain("3. Call the alias `fast`:")
  })

  test("an empty file is treated as an empty object", () => {
    const path = join(tmp(), "c.jsonc")
    writeFileSync(path, "  \n")
    expect(init(path).code).toBe(0)
    expect(entryOf(path)).toHaveLength(1)
  })

  test("the default key is 32 random bytes, different on every run", () => {
    const keys = [0, 1].map(() => {
      const path = join(tmp(), "c.jsonc")
      run(["init", "--config", path], { newKey: undefined })
      return (entryOf(path)[0]!.options.keys as Record<string, string>)["my-app"]!
    })
    expect(keys[0]).toMatch(/^pb_[A-Za-z0-9_-]{43}$/)
    expect(keys[0]).not.toBe(keys[1])
  })
})

describe("init: an existing config", () => {
  test("keeps comments, other keys and other plugins, and appends the entry", () => {
    const path = join(tmp(), "opencode.jsonc")
    writeFileSync(path, COMMENTED)
    expect(init(path).code).toBe(0)
    const text = read(path)
    for (const kept of ["// my providers", "// keep me", "/* plugins */", "// another one", '"some-other-plugin@1.0.0"', '"model": "anthropic/claude-sonnet-4-6"']) expect(text).toContain(kept)
    const plugins = entryOf(path)
    expect(plugins[0]).toBe("some-other-plugin@1.0.0" as never)
    expect(plugins[1]).toMatchObject({ package: "opencode-plugboard@9.8.7" })
    expect(parse(text)).toMatchObject({ provider: { anthropic: {} }, model: "anthropic/claude-sonnet-4-6" })
  })

  test("adds `plugins` when the config has none", () => {
    const path = join(tmp(), "opencode.jsonc")
    writeFileSync(path, '{\n  // theme\n  "theme": "dark"\n}\n')
    expect(init(path).code).toBe(0)
    expect(read(path)).toContain("// theme")
    expect(entryOf(path)).toHaveLength(1)
  })

  test.each([
    ["a bare string", '{ "plugins": ["opencode-plugboard"] }'],
    ["a pinned string", '{ "plugins": ["opencode-plugboard@0.1.0"] }'],
    ["an object", '{ "plugins": [{ "package": "opencode-plugboard@0.1.0", "options": { "keys": { "a": "old" } } }] }'],
  ])("refuses to replace %s without --force, and leaves the file as it was", (_name, before) => {
    const path = join(tmp(), "opencode.jsonc")
    writeFileSync(path, before)
    const result = init(path)
    expect(result.code).toBe(1)
    expect(result.err).toContain("already has a plugboard entry")
    expect(result.err).toContain("--force")
    expect(read(path)).toBe(before)
  })

  test("--force replaces the plugboard entry in place and keeps the rest", () => {
    const path = join(tmp(), "opencode.jsonc")
    writeFileSync(path, '{\n  // c\n  "plugins": ["a@1", { "package": "opencode-plugboard@0.1.0", "options": { "keys": { "old": "old-key" } } }, "z@2"]\n}\n')
    const result = init(path, "--force")
    expect(result.code).toBe(0)
    expect(result.out).toMatch(/^Replaced /)
    expect(read(path)).toContain("// c")
    expect(entryOf(path)).toEqual(["a@1" as never, { package: "opencode-plugboard@9.8.7", options: { keys: { "my-app": KEY }, models: "all" } }, "z@2" as never])
    expect(read(path)).not.toContain("old-key")
  })

  test("a package whose name only starts like plugboard is not an entry", () => {
    const path = join(tmp(), "opencode.jsonc")
    writeFileSync(path, '{ "plugins": ["opencode-plugboard-extras@1.0.0"] }')
    expect(init(path).code).toBe(0)
    expect(entryOf(path)).toHaveLength(2)
  })

  test.each([
    ["invalid JSONC", '{ "plugins": [ ', /not valid JSONC/],
    ["a root that is not an object", "[1, 2]", /must hold a JSON object/],
    ["plugins that is not an array", '{ "plugins": "x" }', /`plugins` .* must be an array/],
  ])("refuses %s, and writes nothing", (_name, before, message) => {
    const path = join(tmp(), "opencode.jsonc")
    writeFileSync(path, before)
    const result = init(path)
    expect(result.code).toBe(1)
    expect(result.err).toMatch(message)
    expect(read(path)).toBe(before)
  })

  test("a path that cannot be read or written is an error message, not a crash", () => {
    const dir = tmp()
    expect(init(dir).err).toContain("cannot read")
    writeFileSync(join(dir, "file"), "")
    expect(init(join(dir, "file", "opencode.jsonc")).err).toContain("cannot write")
  })
})

describe("init --dry-run", () => {
  test("prints the diff, shows no real key and writes nothing", () => {
    const path = join(tmp(), "opencode.jsonc")
    writeFileSync(path, COMMENTED)
    const result = init(path, "--dry-run")
    expect(result.code).toBe(0)
    expect(read(path)).toBe(COMMENTED)
    expect(result.out).toContain(`--- ${path}`)
    expect(result.out).toMatch(/^\+ {4}\{$/m)
    expect(result.out).toContain('+      "package": "opencode-plugboard@9.8.7"')
    expect(result.out).not.toContain(KEY)
    expect(result.out).toContain("Dry run: nothing was written.")
  })

  test("on a missing file it creates nothing, not even the directory", () => {
    const dir = join(tmp(), "nested")
    const result = init(join(dir, "opencode.jsonc"), "--dry-run")
    expect(result.code).toBe(0)
    expect(existsSync(dir)).toBe(false)
    expect(result.out).toContain('+  "plugins"')
  })

  test("with --force it says the existing entry would be replaced", () => {
    const path = join(tmp(), "opencode.jsonc")
    writeFileSync(path, '{ "plugins": ["opencode-plugboard@0.1.0"] }')
    expect(init(path, "--dry-run", "--force").out).toContain("would be replaced")
    expect(read(path)).toBe('{ "plugins": ["opencode-plugboard@0.1.0"] }')
  })
})

describe("init: the default config path", () => {
  test("is opencode.jsonc under XDG_CONFIG_HOME, else ~/.config", () => {
    const xdg = tmp()
    run(["init"], { env: { XDG_CONFIG_HOME: xdg } })
    expect(existsSync(join(xdg, "opencode", "opencode.jsonc"))).toBe(true)
    const home = tmp()
    run(["init"], { home })
    expect(existsSync(join(home, ".config", "opencode", "opencode.jsonc"))).toBe(true)
  })

  test("falls back to an existing opencode.json when there is no opencode.jsonc", () => {
    const home = tmp()
    const dir = join(home, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "opencode.json"), '{ "theme": "dark" }')
    run(["init"], { home })
    expect(existsSync(join(dir, "opencode.jsonc"))).toBe(false)
    expect(entryOf(join(dir, "opencode.json"))).toHaveLength(1)
  })
})

describe("the command line", () => {
  test.each([
    ["a bad app name", ["init", "--app", "My App"], /--app `My App`/],
    ["a wildcard --fast", ["init", "--fast", "openai/*"], /--fast `openai\/\*` must be one model/],
    ["a --fast without a provider", ["init", "--fast", "gpt"], /--fast `gpt`/],
    ["an unknown flag", ["init", "--nope"], /Usage: opencode-plugboard init/],
    ["a stray argument", ["init", "extra"], /Usage: opencode-plugboard init/],
  ])("%s is refused with exit 1 and nothing written", (_name, args, message) => {
    const home = tmp()
    const result = run(args, { home })
    expect(result.code).toBe(1)
    expect(result.err).toMatch(message)
    expect(existsSync(join(home, ".config"))).toBe(false)
  })

  test("an unreadable package version stops init before anything is written", () => {
    const home = tmp()
    const result = run(["init"], { home, version: undefined })
    expect(result.code).toBe(1)
    expect(result.err).toContain("cannot read this package's version")
    expect(existsSync(join(home, ".config"))).toBe(false)
  })

  test("help prints the usage and exits 0; no command exits 2; an unknown command exits 2", () => {
    expect(run(["init", "--help"])).toMatchObject({ code: 0, out: expect.stringContaining("--dry-run") })
    expect(run(["--help"]).code).toBe(0)
    expect(run([]).code).toBe(2)
    expect(run(["frobnicate"])).toMatchObject({ code: 2, err: expect.stringContaining("Unknown command `frobnicate`") })
  })

  test("the bin entry runs under bun, with the package's own version", () => {
    const path = join(tmp(), "opencode.jsonc")
    const proc = Bun.spawnSync(["bun", "bin/opencode-plugboard.ts", "init", "--config", path], { stdout: "pipe", stderr: "pipe" })
    expect(proc.exitCode).toBe(0)
    const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version
    expect(entryOf(path)[0]!.package).toBe(`opencode-plugboard@${version}`)
    expect(proc.stdout.toString()).toContain((entryOf(path)[0]!.options.keys as Record<string, string>)["my-app"]!)
  })
})

describe("lineDiff", () => {
  test("marks added and removed lines and keeps unchanged ones as context", () => {
    expect(lineDiff("a\nb\nc\n", "a\nx\nc\n", "f")).toBe("--- f\n+++ f\n a\n-b\n+x\n c\n")
    expect(lineDiff("", "a\n", "f")).toBe("--- f\n+++ f\n+a\n")
  })
})
