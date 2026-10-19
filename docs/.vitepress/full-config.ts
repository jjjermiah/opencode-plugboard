// "Full config" tabs for the docs. A fence tagged `plugboard` or `plugboard-options` shows the snippet as written and,
// in a second tab, the whole opencode.jsonc with that snippet in place, so a reader sees where each line goes.
//
//   ```jsonc plugboard            members of the plugin's `options` object (a `{ }` around them is fine)
//   ```jsonc plugboard-options    members of the plugin entry: an `"options": { ... }` member (a `{ }` around it is fine)
//
// The wrapping is textual: the fragment keeps its comments, layout and trailing commas. jsonc-parser only reads it, to find out
// what it already sets, and to fail the docs build on a fragment that is not JSONC.
import { createScanner, findNodeAtLocation, parse, parseTree, printParseErrorCode, SyntaxKind, type Node, type ParseError } from "jsonc-parser"
import type { MarkdownOptions } from "vitepress"

export type FenceMode = "options" | "entry"

/** The fence words that turn a block into a tab group, and what the block holds. */
export const FENCE_MODES: Record<string, FenceMode> = { plugboard: "options", "plugboard-options": "entry" }

const ADDED = "// added so the file works"
const SCHEMA = "https://opencode.ai/config.json"

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The text inside one `{ }` that wraps the whole fragment, with comments outside the braces kept. Any other fragment is returned as it is. */
function unwrapBraces(text: string): string {
  const scanner = createScanner(text, true)
  let depth = 0
  let open = -1
  let close = -1
  for (let kind = scanner.scan(); kind !== SyntaxKind.EOF; kind = scanner.scan()) {
    if (close >= 0) return text // more content after the closing brace: not one wrapping object
    if (open < 0 && kind !== SyntaxKind.OpenBraceToken) return text
    if (open < 0) open = scanner.getTokenOffset()
    if (kind === SyntaxKind.OpenBraceToken || kind === SyntaxKind.OpenBracketToken) depth++
    if (kind === SyntaxKind.CloseBraceToken || kind === SyntaxKind.CloseBracketToken) depth--
    if (depth === 0) close = scanner.getTokenOffset()
  }
  if (open < 0 || close < 0) return text
  return [text.slice(0, open), text.slice(open + 1, close), text.slice(close + 1)]
    .map((part, i) => (i === 1 ? part.replace(/^[ \t]*\r?\n/, "").trimEnd() : part.trim()))
    .filter((part) => part.length > 0)
    .join("\n")
}

/** Removes the indentation every line shares, so the fragment can be re-indented to its place in the file. */
function dedent(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const indents = lines.filter((line) => line.trim().length > 0).map((line) => /^[ \t]*/.exec(line)![0].length)
  const cut = indents.length > 0 ? Math.min(...indents) : 0
  return lines.map((line) => line.slice(Math.min(cut, /^[ \t]*/.exec(line)![0].length))).join("\n")
}

const indentBy = (text: string, spaces: number) =>
  text
    .split("\n")
    .map((line) => (line.length > 0 ? " ".repeat(spaces) + line : line))
    .join("\n")

/** `"my-app"` becomes `{env:PLUGBOARD_KEY_MY_APP}`; the plain placeholder key has the bare `{env:PLUGBOARD_KEY}`. */
const keyPlaceholder = (app: string) => (app === "my-app" ? "{env:PLUGBOARD_KEY}" : `{env:PLUGBOARD_KEY_${app.toUpperCase().replace(/[^A-Z0-9]/g, "_")}}`)

/** App names the options mention without a key: `apps`, `limits.apps`, `budgets.apps` and `cache.apps`. */
function referencedApps(options: Record<string, unknown>): string[] {
  const names: string[] = []
  const section = (value: unknown) => isObject(value) && Object.keys(value).forEach((name) => names.push(name))
  section(options.apps)
  if (isObject(options.limits)) section(options.limits.apps)
  if (isObject(options.budgets)) section(options.budgets.apps)
  if (isObject(options.cache) && Array.isArray(options.cache.apps)) options.cache.apps.forEach((name) => typeof name === "string" && names.push(name))
  return [...new Set(names)].filter((name) => name !== "default")
}

/** The members a fragment needs to be a working config, as lines: `keys` when no app has a key, `models` when it is unset. */
function missingMembers(options: Record<string, unknown>): string[] {
  const lines: string[] = []
  if (options.keys === undefined) {
    const own = new Set(isObject(options.apps) ? Object.entries(options.apps).filter(([, app]) => isObject(app) && app.key !== undefined).map(([name]) => name) : [])
    const apps = referencedApps(options).filter((name) => !own.has(name))
    // Keep the placeholder only when nothing else gives the file an app key.
    const names = apps.length > 0 ? apps : own.size > 0 ? [] : ["my-app"]
    const entries = names.map((name) => `"${name}": "${keyPlaceholder(name)}"`)
    if (entries.length === 1) lines.push(`"keys": { ${entries[0]} }`)
    else if (entries.length > 1) lines.push(`"keys": {\n${entries.map((entry) => `  ${entry}`).join(",\n")}\n}`)
  }
  if (options.models === undefined) lines.push(`"models": "connected"`)
  return lines
}

function parseFragment(body: string, where: string): { tree: Node; value: Record<string, unknown> } {
  const text = `{${body}\n}`
  const errors: ParseError[] = []
  const tree = parseTree(text, errors, { allowTrailingComma: true })
  const value = parse(text, errors, { allowTrailingComma: true })
  if (errors.length > 0 || !tree || !isObject(value)) {
    const first = errors[0]
    const at = first ? ` (${printParseErrorCode(first.error)} at line ${text.slice(0, first.offset).split("\n").length}, column ${first.offset - text.lastIndexOf("\n", first.offset - 1)})` : ""
    throw new Error(`${where}: the fragment is not valid JSONC${at}:\n${body}`)
  }
  return { tree, value }
}

/**
 * The whole opencode.jsonc for a fragment. `options` fragments hold members of the plugin's `options`; `entry` fragments hold
 * members of the plugin entry, one of them `options`. The members the file needs to work (`keys`, `models`) are added when the fragment
 * lacks them, each marked with a comment.
 */
export function fullConfig(fragment: string, mode: FenceMode, version: string, where = "fragment"): string {
  const body = dedent(unwrapBraces(fragment)).replace(/^\s*\n/, "").trimEnd()
  const { tree, value } = parseFragment(body, where)
  // The comment goes on the first line of a member, the comma on its last.
  const mark = (members: string[], more: boolean) =>
    members.map((member, i) => {
      const lines = member.split("\n")
      const comma = i < members.length - 1 || more ? "," : ""
      return lines.length === 1 ? `${member}${comma} ${ADDED}` : [`${lines[0]} ${ADDED}`, ...lines.slice(1, -1), `${lines.at(-1)}${comma}`].join("\n")
    })

  let entry: string
  if (mode === "options") {
    if ("options" in value || "package" in value) throw new Error(`${where}: a \`plugboard\` fence holds members of \`options\`; use \`plugboard-options\` for a fragment with an "options" member`)
    const added = mark(missingMembers(value), Object.keys(value).length > 0)
    const options = [...added, ...(body ? [body] : [])].join("\n")
    entry = `"package": "opencode-plugboard@${version}",\n"options": {\n${indentBy(options, 2)}\n}`
  } else {
    const options = value.options
    if (!isObject(options)) throw new Error(`${where}: a \`plugboard-options\` fence needs an "options" object`)
    const node = findNodeAtLocation(tree, ["options"])!
    const members = missingMembers(options)
    entry = body
    if (members.length > 0) {
      // Insert the missing members right after the `{` of options. `offset` counts the `{` this function put in front of the body.
      const open = node.offset - 1
      const leading = (at: number) => /^[ \t]*/.exec(body.slice(body.lastIndexOf("\n", at - 1) + 1))![0]
      const first = node.children?.[0] ? node.children[0].offset - 1 : -1
      const indent = first >= 0 && body.slice(open, first).includes("\n") ? leading(first) : `${leading(open)}  `
      const rest = body.slice(open + 1)
      // Anything after the `{` on its own line moves to its own line, so the comments on the added lines cannot swallow it.
      const sameLine = rest.split("\n")[0]!.trim() !== ""
      const lines = mark(members, (node.children?.length ?? 0) > 0).map((member) => member.split("\n").map((line) => `\n${indent}${line}`).join(""))
      entry = `${body.slice(0, open + 1)}${lines.join("")}${sameLine ? `\n${indent}${rest.trimStart()}` : rest}`
    }
    if (!("package" in value)) entry = `"package": "opencode-plugboard@${version}",\n${entry}`
  }
  return ["{", `  "$schema": "${SCHEMA}",`, `  "plugins": [`, "    {", indentBy(entry, 6), "    }", "  ]", "}", ""].join("\n")
}

type Md = Parameters<NonNullable<MarkdownOptions["config"]>>[0]

/** The markdown-it plugin: each tagged fence becomes a code group of the snippet and its full config. `version` is the latest release. */
export function fullConfigPlugin(version: string) {
  return (md: Md) => {
    md.core.ruler.push("plugboard-full-config", (state) => {
      const out: typeof state.tokens = []
      for (const token of state.tokens) {
        const [lang = "", word = "", ...extra] = token.info.trim().split(/\s+/)
        const mode = token.type === "fence" ? FENCE_MODES[word] : undefined
        if (!mode || (lang !== "json" && lang !== "jsonc")) {
          out.push(token)
          continue
        }
        const where = `${state.env?.relativePath ?? state.env?.path ?? "page"}:${(token.map?.[0] ?? 0) + 1}`
        if (extra.length > 0) throw new Error(`${where}: a \`${word}\` fence takes no other attributes (got ${extra.join(" ")})`)
        const full = fullConfig(token.content, mode, version, where)
        const fence = (info: string, content: string) => {
          const tab = new state.Token("fence", "code", 0)
          Object.assign(tab, { info, content, markup: "```", block: true, level: token.level, map: token.map })
          return tab
        }
        const group = (nesting: 1 | -1) => {
          const edge = new state.Token(`container_code-group_${nesting === 1 ? "open" : "close"}`, "div", nesting)
          Object.assign(edge, { info: nesting === 1 ? "code-group" : "", markup: ":::", block: true, level: token.level })
          return edge
        }
        out.push(group(1), fence(`${lang} [Snippet]`, token.content), fence("jsonc [Full config]", full), group(-1))
      }
      state.tokens = out
    })
  }
}
