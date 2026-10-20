/**
 * The "Full config" tab of the docs site (docs/.vitepress/full-config.ts). A fence tagged `plugboard` or `plugboard-options` is a
 * fragment of an opencode.jsonc; the wrapper builds the whole file around it. The file must parse as JSONC, carry the fragment's
 * keys under plugins[0].options, and work: it has an app key and a models rule, added when the fragment lacks them.
 */
import { describe, expect, test } from "bun:test"
import { parse, type ParseError } from "jsonc-parser"
import { createMarkdownRenderer } from "vitepress"
import { tabsMarkdownPlugin } from "vitepress-plugin-tabs"
import { fullConfig, fullConfigPlugin, TABS_KEY } from "../../docs/.vitepress/full-config.ts"

const VERSION = "9.8.7"

/** The parsed config, failing the test on any JSONC error (trailing commas are allowed, as OpenCode allows them). */
function load(text: string): any {
  const errors: ParseError[] = []
  const value = parse(text, errors, { allowTrailingComma: true })
  expect(errors).toEqual([])
  return value
}

const options = (text: string) => load(text).plugins[0].options

describe("an options fragment", () => {
  test("members of options land inside plugins[0].options, in a file with the schema and the pinned package", () => {
    const file = fullConfig(`"listen": { "host": "127.0.0.1", "port": 4010 },\n"keys": { "bot": "{env:KEY}" },\n"models": ["anthropic/*"]`, "options", VERSION)
    const config = load(file)
    expect(config.$schema).toBe("https://opencode.ai/config.json")
    expect(config.plugins).toHaveLength(1)
    expect(config.plugins[0].package).toBe(`opencode-plugboard@${VERSION}`)
    expect(config.plugins[0].options).toEqual({ listen: { host: "127.0.0.1", port: 4010 }, keys: { bot: "{env:KEY}" }, models: ["anthropic/*"] })
    expect(file).not.toContain("one key per app")
  })

  test("a fragment with no keys and no models gets both, each marked", () => {
    const file = fullConfig(`"aliases": { "fast": "anthropic/claude-haiku-4-5" }`, "options", VERSION)
    expect(options(file)).toEqual({ keys: { "my-app": "{env:PLUGBOARD_KEY}" }, models: "connected", aliases: { fast: "anthropic/claude-haiku-4-5" } })
    expect(file).toContain(`"keys": { "my-app": "{env:PLUGBOARD_KEY}" }, // one key per app; callers send it as their API key`)
    expect(file).toContain(`"models": "connected", // which models apps may use: every model you are logged in to`)
  })

  test("a fragment that has keys only gets models; one that has models only gets keys", () => {
    const keyed = options(fullConfig(`"keys": { "laptop": "{env:K}" }`, "options", VERSION))
    expect(keyed).toEqual({ keys: { laptop: "{env:K}" }, models: "connected" })
    const modelled = options(fullConfig(`"models": ["openai/gpt-5.6-luna#low"]`, "options", VERSION))
    expect(modelled).toEqual({ keys: { "my-app": "{env:PLUGBOARD_KEY}" }, models: ["openai/gpt-5.6-luna#low"] })
  })

  test("comments, a trailing comma and blank lines stay, and the file still parses", () => {
    const fragment = `// the limits\n"history": { "maxSessions": 500 },   // keep 500\n\n/* the key */\n"adminKey": "{env:ADMIN}",\n`
    const file = fullConfig(fragment, "options", VERSION)
    expect(options(file)).toMatchObject({ history: { maxSessions: 500 }, adminKey: "{env:ADMIN}" })
    expect(file).toContain("// the limits")
    expect(file).toContain("// keep 500")
    expect(file).toContain("/* the key */")
  })

  test("a fragment wrapped in braces is the options object itself", () => {
    const file = fullConfig(`{\n  "historyUrl": "http://opencode.example:4096/session/{id}"\n}`, "options", VERSION)
    expect(options(file).historyUrl).toBe("http://opencode.example:4096/session/{id}")
    expect(options(file).keys).toBeDefined()
  })

  test("a single-line fragment and a nested fragment keep their own layout, re-indented", () => {
    const nested = `"listen": {\n  "host": "127.0.0.1",\n  "trustProxy": ["127.0.0.1", "10.0.0.0/8"]\n}`
    const file = fullConfig(nested, "options", VERSION)
    expect(options(file).listen).toEqual({ host: "127.0.0.1", trustProxy: ["127.0.0.1", "10.0.0.0/8"] })
    expect(file).toContain(`        "listen": {\n          "host": "127.0.0.1",\n`)
  })

  test("a fragment that ends in a comment still gets a valid file", () => {
    const file = fullConfig(`"modelIds": "both"   // canonical ids and UI-safe slugs`, "options", VERSION)
    expect(options(file).modelIds).toBe("both")
    expect(file).toContain("// canonical ids and UI-safe slugs\n      }")
  })

  test("apps without a key get a key each, named after the app", () => {
    const file = fullConfig(`"apps": {\n  "discord-bot": { "models": ["fast"] },\n  "coding": { "models": ["anthropic/*"] }\n}`, "options", VERSION)
    expect(options(file).keys).toEqual({ "discord-bot": "{env:PLUGBOARD_KEY_DISCORD_BOT}", coding: "{env:PLUGBOARD_KEY_CODING}" })
    // Several keys are written one to a line, with the marker on the opening line.
    expect(file).toContain(`"keys": { // one key per app; callers send it as their API key\n          "discord-bot": "{env:PLUGBOARD_KEY_DISCORD_BOT}",\n`)
  })

  test("several added keys in an entry fragment are indented and still parse", () => {
    const file = fullConfig(`"options": {\n  "apps": { "a": {}, "b": {} }\n}`, "entry", VERSION)
    expect(options(file).keys).toEqual({ a: "{env:PLUGBOARD_KEY_A}", b: "{env:PLUGBOARD_KEY_B}" })
    expect(file).toContain(`        "keys": { // one key per app; callers send it as their API key\n          "a": "{env:PLUGBOARD_KEY_A}",\n          "b": "{env:PLUGBOARD_KEY_B}"\n        },\n`)
  })

  test("app names in limits, budgets and cache count too", () => {
    const file = fullConfig(
      `"limits": { "apps": { "coding": { "maxConcurrent": 4 } } },\n"budgets": { "apps": { "batch": {} } },\n"cache": { "ttlSeconds": 60, "apps": ["poller"] }`,
      "options",
      VERSION,
    )
    expect(Object.keys(options(file).keys).sort()).toEqual(["batch", "coding", "poller"])
  })

  test("apps that carry their own key need no keys member", () => {
    const file = fullConfig(`"apps": { "bot": { "key": "{env:BOT_KEY}", "tools": false } }`, "options", VERSION)
    expect(options(file).keys).toBeUndefined()
    expect(options(file).models).toBe("connected")
  })

  test("an invalid fragment fails with its location instead of producing a broken file", () => {
    expect(() => fullConfig(`"keys": { "a": }`, "options", VERSION, "docs/x.md:3")).toThrow(/docs\/x\.md:3: the fragment is not valid JSONC/)
    expect(() => fullConfig(`"history": { "hidden": true }\n"apps": { "bot": {} }`, "options", VERSION)).toThrow(/not valid JSONC/)
  })

  test("a fragment with an options member belongs in a plugboard-options fence", () => {
    expect(() => fullConfig(`"options": { "keys": {} }`, "options", VERSION)).toThrow(/plugboard-options/)
  })
})

describe("an entry fragment", () => {
  test("an options member is the entry's options, and the package is added", () => {
    const file = fullConfig(`"options": {\n  "keys": { "claude-code": "{env:K}" },\n  "models": ["anthropic/*"]\n}`, "entry", VERSION)
    const config = load(file)
    expect(config.plugins[0].package).toBe(`opencode-plugboard@${VERSION}`)
    expect(config.plugins[0].options).toEqual({ keys: { "claude-code": "{env:K}" }, models: ["anthropic/*"] })
    expect(file).not.toContain("one key per app")
  })

  test("the missing members go at the top of options, marked, and the rest stays as written", () => {
    const file = fullConfig(`"options": {\n  // the proxy\n  "listen": { "host": "0.0.0.0", "port": 4010 },\n  "aliases": { "fast": "a/b" }\n}`, "entry", VERSION)
    expect(options(file)).toEqual({ keys: { "my-app": "{env:PLUGBOARD_KEY}" }, models: "connected", listen: { host: "0.0.0.0", port: 4010 }, aliases: { fast: "a/b" } })
    expect(file).toContain(`"models": "connected", // which models apps may use: every model you are logged in to\n        // the proxy\n        "listen"`)
  })

  test("a wrapped fragment, as the self-hosted pages write it", () => {
    const file = fullConfig(`{\n  "options": {\n    "keys": { "onyx": "{env:K}" },\n    "apps": { "onyx": { "models": ["text"] } }\n  }\n}`, "entry", VERSION)
    expect(options(file)).toMatchObject({ keys: { onyx: "{env:K}" }, apps: { onyx: { models: ["text"] } }, models: "connected" })
  })

  test("a single-line options member is split so the marker comments cannot swallow it", () => {
    const file = fullConfig(`"options": { "maxTools": 128 }`, "entry", VERSION)
    expect(options(file)).toEqual({ keys: { "my-app": "{env:PLUGBOARD_KEY}" }, models: "connected", maxTools: 128 })
  })

  test("an empty options object still gives a working file", () => {
    expect(options(fullConfig(`"options": {}`, "entry", VERSION))).toEqual({ keys: { "my-app": "{env:PLUGBOARD_KEY}" }, models: "connected" })
  })

  test("a fragment with its own package keeps it", () => {
    const config = load(fullConfig(`"package": "/path/to/plugboard",\n"options": { "keys": { "a": "k" }, "models": "connected" }`, "entry", VERSION))
    expect(config.plugins[0].package).toBe("/path/to/plugboard")
  })

  test("no options object is an error", () => {
    expect(() => fullConfig(`"package": "x"`, "entry", VERSION)).toThrow(/needs an "options" object/)
  })
})

describe("the markdown plugin", () => {
  const render = async (markdown: string) => {
    const md = await createMarkdownRenderer(process.cwd(), { config: (instance) => instance.use(tabsMarkdownPlugin as never).use(fullConfigPlugin(VERSION)) }, "/")
    return md.render(markdown, { path: "docs/page.md", relativePath: "page.md" })
  }

  test("a tagged fence becomes a shared tab group with a Snippet and a Full config tab", async () => {
    const html = await render('# T\n\n```jsonc plugboard\n"maxTools": 128\n```\n')
    expect(html).toContain(`<PluginTabs sharedStateKey="${TABS_KEY}">`)
    expect(html).toContain('<PluginTabsTab label="Snippet">')
    expect(html).toContain('<PluginTabsTab label="Full config">')
    expect(html.indexOf("Snippet")).toBeLessThan(html.indexOf("Full config"))
    expect(html).toContain(`opencode-plugboard@${VERSION}`)
    expect(html).toContain("PLUGBOARD_KEY")
  })

  test("a plugboard-options fence works too, and other fences are left alone", async () => {
    const html = await render('```jsonc plugboard-options\n"options": { "maxTools": 128 }\n```\n\n```jsonc\n"x": 1\n```\n\n```sh\necho hi\n```\n')
    expect(html.match(/<PluginTabs /g)?.length).toBe(1)
    expect(html).toContain("echo")
  })

  test("a bad fragment fails the build and names the page and the line", async () => {
    await expect(render('text\n\n```jsonc plugboard\n"keys": {\n```\n')).rejects.toThrow(/page\.md:3: the fragment is not valid JSONC/)
  })
})
