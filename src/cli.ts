/**
 * The `opencode-plugboard` command line (`bunx opencode-plugboard init`): writes the plugin entry into an OpenCode config
 * so the first request needs no manual steps. Not loaded by the plugin; `bin/opencode-plugboard.ts` is the entry.
 *
 * `init` edits the config as JSONC with `jsonc-parser`, so comments, formatting and every other key stay as they were.
 * It pins the running package version, generates one app key, and never replaces an existing plugboard entry without `--force`.
 */

import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from "jsonc-parser"
import { CONNECTED, DEFAULT_PORT, isAppName } from "./config.js"
import { parseModelRef } from "./models.js"

const PACKAGE = "opencode-plugboard"
const FORMAT = { tabSize: 2, insertSpaces: true, eol: "\n" } as const

/** What the CLI needs from the process, so tests can run it against temp dirs with fixed output and keys. */
export interface CliEnv {
  readonly out: (text: string) => void
  readonly err: (text: string) => void
  readonly env: Readonly<Record<string, string | undefined>>
  readonly home: string
  /** The running package version; `init` pins it. */
  readonly version: string | undefined
  /** A fresh app key. Defaults to 32 random bytes, base64url, with a `pb_` prefix. */
  readonly newKey?: () => string
}

export const USAGE = `Usage: opencode-plugboard init [options]

Adds plugboard to your OpenCode config, with one app key and every connected model allowed.

Options:
  --app <name>       App name for the key (default: my-app)
  --fast <model>     Also add the alias "fast", for example anthropic/claude-haiku-4-5
  --config <path>    Config file to edit (default: ~/.config/opencode/opencode.jsonc)
  --dry-run          Print the change as a diff and write nothing
  --force            Replace an existing plugboard entry (it gets a new key)
  -h, --help         Show this help
`

class CliError extends Error {}

const defaultKey = (): string => `pb_${randomBytes(32).toString("base64url")}`

/** `opencode.jsonc`, or `opencode.json` when only that exists, in the OpenCode config directory. */
function defaultConfigPath(env: CliEnv): string {
  const dir = join(env.env.XDG_CONFIG_HOME || join(env.home, ".config"), "opencode")
  const jsonc = join(dir, "opencode.jsonc")
  const json = join(dir, "opencode.json")
  return !existsSync(jsonc) && existsSync(json) ? json : jsonc
}

/** The file's text, or "" when it does not exist. */
function fileText(path: string): string {
  if (!existsSync(path)) return ""
  try {
    return readFileSync(path, "utf8")
  } catch (error) {
    throw new CliError(`cannot read ${path}: ${(error as Error).message}`)
  }
}

const isPlugboard = (entry: unknown): boolean => {
  const name = typeof entry === "string" ? entry : typeof entry === "object" && entry !== null ? (entry as { package?: unknown }).package : undefined
  return typeof name === "string" && (name === PACKAGE || name.startsWith(`${PACKAGE}@`))
}

/** The lines of `before` and `after` as a unified-style diff (whole-file context is not needed: the files are small). */
export function lineDiff(before: string, after: string, label: string): string {
  const split = (text: string): string[] => (text === "" ? [] : text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n"))
  const a = split(before)
  const b = split(after)
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  const lines = [`--- ${label}`, `+++ ${label}`]
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push(` ${a[i]}`)
      i++
      j++
    } else if (i < a.length && (j === b.length || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) lines.push(`-${a[i++]}`)
    else lines.push(`+${b[j++]}`)
  }
  return `${lines.join("\n")}\n`
}

interface InitFlags {
  readonly app: string
  readonly fast?: string
  readonly config?: string
  readonly dryRun: boolean
  readonly force: boolean
}

function flagsOf(args: string[]): InitFlags | "help" {
  let v: { app?: string; fast?: string; config?: string; "dry-run"?: boolean; force?: boolean; help?: boolean }
  try {
    v = parseArgs({
      args,
      allowPositionals: false,
      options: { app: { type: "string" }, fast: { type: "string" }, config: { type: "string" }, "dry-run": { type: "boolean" }, force: { type: "boolean" }, help: { type: "boolean", short: "h" } },
    }).values
  } catch (error) {
    throw new CliError(`${(error as Error).message}\n\n${USAGE}`)
  }
  if (v.help) return "help"
  const app = v.app ?? "my-app"
  if (!isAppName(app)) throw new CliError(`--app \`${app}\` must be lower case letters, digits and hyphens (at most 255 characters)`)
  const fast = v.fast
  if (fast !== undefined) {
    const ref = parseModelRef(fast)
    if (!ref || fast.includes("*") || /\s/.test(fast)) throw new CliError(`--fast \`${fast}\` must be one model, written provider/model or provider/model#variant`)
  }
  return { app, ...(fast === undefined ? {} : { fast }), ...(v.config === undefined ? {} : { config: v.config }), dryRun: v["dry-run"] === true, force: v.force === true }
}

/** The text of the config after the plugin entry is added (or replaced, with `replace`), edited in place as JSONC. */
function withEntry(text: string, entry: unknown, force: boolean, path: string): { text: string; replaced: boolean } {
  const source = text.trim() === "" ? "{}\n" : text
  const errors: ParseError[] = []
  const root = parse(source, errors, { allowTrailingComma: true }) as unknown
  if (errors.length > 0) throw new CliError(`${path} is not valid JSONC (${printParseErrorCode(errors[0]!.error)} at offset ${errors[0]!.offset}); fix it, then run init again. Nothing was written.`)
  if (typeof root !== "object" || root === null || Array.isArray(root)) throw new CliError(`${path} must hold a JSON object. Nothing was written.`)
  const plugins = (root as { plugins?: unknown }).plugins
  if (plugins !== undefined && !Array.isArray(plugins)) throw new CliError(`\`plugins\` in ${path} must be an array. Nothing was written.`)
  const existing = (plugins ?? []).findIndex(isPlugboard)
  if (existing >= 0 && !force) throw new CliError(`${path} already has a plugboard entry. Nothing was written; add --force to replace it (the replacement gets a new key), or edit the entry by hand.`)
  const edits =
    plugins === undefined
      ? modify(source, ["plugins"], [entry], { formattingOptions: FORMAT })
      : existing >= 0
        ? modify(source, ["plugins", existing], entry, { formattingOptions: FORMAT })
        : modify(source, ["plugins", plugins.length], entry, { formattingOptions: FORMAT, isArrayInsertion: true })
  return { text: applyEdits(source, edits), replaced: existing >= 0 }
}

/** `init`. Returns the process exit code. */
export function runInit(args: string[], cli: CliEnv): number {
  try {
    const flags = flagsOf(args)
    if (flags === "help") {
      cli.out(USAGE)
      return 0
    }
    if (cli.version === undefined) throw new CliError("cannot read this package's version, so the plugin cannot be pinned")
    const path = resolve(flags.config ?? defaultConfigPath(cli))
    const before = fileText(path)
    // A dry run writes nothing, so it shows a placeholder instead of a key nobody will ever use.
    const key = flags.dryRun ? "<new key, shown when written>" : (cli.newKey ?? defaultKey)()
    const entry = {
      package: `${PACKAGE}@${cli.version}`,
      options: { keys: { [flags.app]: key }, models: CONNECTED, ...(flags.fast === undefined ? {} : { aliases: { fast: flags.fast } }) },
    }
    const { text, replaced } = withEntry(before, entry, flags.force, path)
    if (flags.dryRun) {
      cli.out(lineDiff(before, text, path))
      cli.out(replaced ? "Dry run: the existing plugboard entry would be replaced. Nothing was written.\n" : "Dry run: nothing was written.\n")
      return 0
    }
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, text.endsWith("\n") ? text : `${text}\n`)
    } catch (error) {
      throw new CliError(`cannot write ${path}: ${(error as Error).message}`)
    }
    const base = `http://127.0.0.1:${DEFAULT_PORT}/v1`
    const chatModel = flags.fast === undefined ? "<an id from the list above>" : "fast"
    cli.out(
      [
        `${replaced ? "Replaced" : "Added"} ${PACKAGE}@${cli.version} in ${path}.`,
        "",
        `App key for \`${flags.app}\` (shown once; it is also in the file):`,
        `  ${key}`,
        "",
        "Restart OpenCode, then touch the server once so it loads the plugin:",
        "  opencode api get /api/agent",
        "",
        "List the models you can use:",
        `  curl -s ${base}/models -H "Authorization: Bearer ${key}"`,
        "",
        "Call one:",
        `  curl -s ${base}/chat/completions -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" -d '{"model": "${chatModel}", "messages": [{"role": "user", "content": "reply with exactly: pong"}]}'`,
        "",
      ].join("\n"),
    )
    return 0
  } catch (error) {
    if (!(error instanceof CliError)) throw error
    cli.err(`${error.message}\n`)
    return 1
  }
}

/** The command line: `init` is the only command. Returns the process exit code. */
export function runCli(argv: string[], cli: CliEnv): number {
  const [command, ...rest] = argv
  if (command === "init") return runInit(rest, cli)
  if (command === undefined || command === "-h" || command === "--help" || command === "help") {
    cli.out(USAGE)
    return command === undefined ? 2 : 0
  }
  cli.err(`Unknown command \`${command}\`.\n\n${USAGE}`)
  return 2
}
