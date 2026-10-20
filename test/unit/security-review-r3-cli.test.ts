/**
 * Security review round 3 (since 0.37.0), `opencode-plugboard init`: the file it writes holds an app key, so it is a secret.
 *
 * Guarantees: the key is 256 random bits and is printed once; a refusal writes nothing and prints no key; no flag reaches the
 * config or the output as anything but the value it was checked to be. The file's mode is the one the review found open, fixed with it.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse } from "jsonc-parser"
import { runCli, type CliEnv } from "../../src/cli.js"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "plugboard-cli-r3-"))
  dirs.push(dir)
  return dir
}

const KEY = "pb_r3-test-key-0123456789"
function run(args: string[], extra: Partial<CliEnv> = {}) {
  const out: string[] = []
  const err: string[] = []
  const code = runCli(args, { out: (t) => out.push(t), err: (t) => err.push(t), env: {}, home: tmp(), version: "9.8.7", newKey: () => KEY, ...extra })
  return { code, out: out.join(""), err: err.join("") }
}
const mode = (path: string) => statSync(path).mode & 0o777
const posix = process.platform === "win32" ? test.skip : test

/** Runs `body` under a usual umask, so a test does not depend on the machine's. */
function withUmask<T>(mask: number, body: () => T): T {
  const before = process.umask(mask)
  try {
    return body()
  } finally {
    process.umask(before)
  }
}

describe("security regression test: init and the secret it writes", () => {
  posix("a new config that holds the key is readable by its owner alone, and so is a directory init made for it", () => {
    const root = tmp()
    const path = join(root, "nested", "deeper", "opencode.jsonc")
    withUmask(0o022, () => expect(run(["init", "--config", path]).code).toBe(0))
    expect(mode(path)).toBe(0o600)
    expect(mode(join(root, "nested"))).toBe(0o700)
    expect(mode(join(root, "nested", "deeper"))).toBe(0o700)
    // A directory that was already there keeps its mode.
    const existing = join(root, "existing")
    mkdirSync(existing, { mode: 0o755 })
    chmodSync(existing, 0o755)
    withUmask(0o022, () => expect(run(["init", "--config", join(existing, "opencode.jsonc")]).code).toBe(0))
    expect(mode(existing)).toBe(0o755)
  })

  posix("a config that already exists keeps its mode: a replacement never loosens it", () => {
    const path = join(tmp(), "opencode.jsonc")
    writeFileSync(path, '{ "plugins": [] }\n')
    chmodSync(path, 0o600)
    withUmask(0o022, () => expect(run(["init", "--config", path]).code).toBe(0))
    expect(mode(path)).toBe(0o600)
    withUmask(0o022, () => expect(run(["init", "--config", path, "--force"]).code).toBe(0))
    expect(mode(path)).toBe(0o600)
  })

  test("a refusal writes nothing and prints no key: an entry that is there, a config that is not JSONC, and one that is not an object", () => {
    const dir = tmp()
    const cases: Array<[string, string]> = [
      ["has-entry.jsonc", '{ "plugins": ["opencode-plugboard@0.1.0"] }\n'],
      ["broken.jsonc", '{ "plugins": [ \n'],
      ["array.jsonc", "[1, 2]\n"],
      ["bad-plugins.jsonc", '{ "plugins": "x" }\n'],
    ]
    for (const [name, text] of cases) {
      const path = join(dir, name)
      writeFileSync(path, text)
      const result = run(["init", "--config", path])
      expect(result.code, name).toBe(1)
      expect(result.out, name).toBe("")
      expect(result.err, name).not.toContain(KEY)
      expect(readFileSync(path, "utf8"), name).toBe(text)
    }
  })

  test("a path that is a directory, or one under a file, is an error message and writes nothing", () => {
    const dir = tmp()
    const file = join(dir, "plain-file")
    writeFileSync(file, "x")
    for (const path of [dir, join(file, "opencode.jsonc")]) {
      const result = run(["init", "--config", path])
      expect(result.code, path).toBe(1)
      expect(result.out).toBe("")
      expect(result.err).not.toContain(KEY)
    }
    expect(readFileSync(file, "utf8")).toBe("x")
  })

  test("an app name that is a path, a prototype key or has capitals is refused before anything is written", () => {
    const path = join(tmp(), "never", "opencode.jsonc")
    for (const app of ["../x", "a/b", "A", "__proto__", "hasOwnProperty", "a b", "a\nb", "x".repeat(256), ""]) {
      const result = run(["init", "--config", path, "--app", app])
      expect(result.code, JSON.stringify(app)).toBe(1)
      expect(result.out).toBe("")
    }
    expect(existsSync(join(path, ".."))).toBe(false)
  })

  test("a model that is not one provider/model is refused, and one with a quote or a brace is stored as that text and nothing else", () => {
    const path = join(tmp(), "opencode.jsonc")
    for (const fast of ["a/b c", "a/b\nc", "anthropic/*", "nonsense", "a/b\t", ""]) expect(run(["init", "--config", path, "--fast", fast]).code, JSON.stringify(fast)).toBe(1)
    expect(existsSync(path)).toBe(false)
    const odd = 'p/m"},"x":{"y'
    const result = run(["init", "--config", path, "--fast", odd])
    if (result.code === 0) {
      const config = parse(readFileSync(path, "utf8")) as { plugins: Array<{ options: { aliases: Record<string, string>; keys: Record<string, string> } }> }
      expect(config.plugins[0]!.options.aliases).toEqual({ fast: odd })
      expect(Object.keys(config)).toEqual(["plugins"])
      expect(result.out).not.toContain(odd)
    } else expect(existsSync(path)).toBe(false)
  })

  test("the key is in the file once, printed three times in the one message, and never to the error stream", () => {
    const path = join(tmp(), "opencode.jsonc")
    const result = run(["init", "--config", path])
    expect(readFileSync(path, "utf8").split(KEY)).toHaveLength(2)
    expect(result.out.split(KEY)).toHaveLength(4)
    expect(result.err).toBe("")
  })

  test("a dry run, with or without --force, shows no key and creates neither the file nor its directory", () => {
    const root = tmp()
    const path = join(root, "deep", "opencode.jsonc")
    const result = run(["init", "--config", path, "--dry-run"])
    expect(result.code).toBe(0)
    expect(result.out).not.toContain(KEY)
    expect(existsSync(join(root, "deep"))).toBe(false)
    mkdirSync(join(root, "deep"))
    writeFileSync(path, '{ "plugins": ["opencode-plugboard@0.1.0"] }\n')
    const forced = run(["init", "--config", path, "--dry-run", "--force"])
    expect(forced.code).toBe(0)
    expect(forced.out).not.toContain(KEY)
    expect(readFileSync(path, "utf8")).toBe('{ "plugins": ["opencode-plugboard@0.1.0"] }\n')
  })
})
