import { describe, expect, test } from "bun:test"
import { parseOptions } from "../../src/config.js"

const KEY = "sk-plug-bot-test-key-0123456789"

describe("option history.hidden (since 0.29.0, #337)", () => {
  test("off by default: no hidden flag on the global history or any app", () => {
    const options = parseOptions({ keys: { bot: KEY } })
    expect(options.history.hidden).toBeUndefined()
    expect(options.apps.bot).toBeUndefined()
  })

  test("global true is parsed and keeps the pruning fields", () => {
    const options = parseOptions({ keys: { bot: KEY }, history: { hidden: true, maxSessions: 50 } })
    expect(options.history).toEqual({ maxSessions: 50, maxAgeDays: 30, hidden: true })
  })

  test("global must be a boolean", () => {
    expect(() => parseOptions({ keys: { bot: KEY }, history: { hidden: "yes" } })).toThrow(/`history\.hidden` must be a boolean/)
  })

  test("apps.<name>.history.hidden is parsed, and an app with only it still gets a policy", () => {
    const options = parseOptions({ keys: { bot: KEY }, apps: { bot: { history: { hidden: true } } } })
    expect(options.apps.bot?.history).toEqual({ hidden: true })
  })

  test("an explicit false on the app is kept, so it can override a global true", () => {
    const options = parseOptions({ keys: { bot: KEY }, history: { hidden: true }, apps: { bot: { history: { hidden: false } } } })
    expect(options.apps.bot?.history?.hidden).toBe(false)
    expect(options.history.hidden).toBe(true)
  })

  test("the app's hidden must be a boolean and names the app in the error", () => {
    expect(() => parseOptions({ keys: { bot: KEY }, apps: { bot: { history: { hidden: 1 } } } })).toThrow(/apps\.bot\.history\.hidden` must be a boolean/)
  })

  test("unknown keys under history still fail, and the list names hidden", () => {
    expect(() => parseOptions({ keys: { bot: KEY }, history: { hiden: true } })).toThrow(/known: maxSessions, maxAgeDays, hidden/)
  })

  test("hidden with a per-user promptCache anchor is refused: the parent is one per app", () => {
    expect(() => parseOptions({ keys: { bot: KEY }, history: { hidden: true }, promptCache: { affinity: "anchor", scope: "user" } })).toThrow(/scope `user`/)
    expect(() => parseOptions({ keys: { bot: KEY }, apps: { bot: { history: { hidden: true }, promptCache: { affinity: "anchor", scope: "user" } } } })).toThrow(/scope `user`/)
  })

  test("hidden with an app-scope promptCache anchor is accepted: one parent serves both", () => {
    const options = parseOptions({ keys: { bot: KEY }, history: { hidden: true }, promptCache: { affinity: "anchor", scope: "app" } })
    expect(options.promptCache).toEqual({ affinity: "anchor", scope: "app" })
  })

  test("a per-user promptCache is fine when hidden is off for that app", () => {
    const options = parseOptions({ keys: { bot: KEY }, history: { hidden: true }, apps: { bot: { history: { hidden: false }, promptCache: { affinity: "anchor", scope: "user" } } } })
    expect(options.apps.bot?.promptCache).toEqual({ affinity: "anchor", scope: "user" })
  })
})
