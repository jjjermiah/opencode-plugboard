import { describe, expect, test } from "bun:test"
import { parseOptions } from "../../src/config.js"

const KEY = "sk-plug-bot-test-key-0123456789"

describe("option sessions.hideFromList (#337)", () => {
  test("off by default: no hideFromList flag on the global sessions or any app", () => {
    const options = parseOptions({ keys: { bot: KEY } })
    expect(options.sessions.hideFromList).toBeUndefined()
    expect(options.apps.bot).toBeUndefined()
  })

  test("global true is parsed and keeps the pruning fields", () => {
    const options = parseOptions({ keys: { bot: KEY }, sessions: { hideFromList: true, maxSessions: 50 } })
    expect(options.sessions).toEqual({ maxSessions: 50, maxAgeDays: 30, hideFromList: true })
  })

  test("global must be a boolean", () => {
    expect(() => parseOptions({ keys: { bot: KEY }, sessions: { hideFromList: "yes" } })).toThrow(/`sessions\.hideFromList` must be a boolean/)
  })

  test("apps.<name>.sessions.hideFromList is parsed, and an app with only it still gets a policy", () => {
    const options = parseOptions({ keys: { bot: KEY }, apps: { bot: { sessions: { hideFromList: true } } } })
    expect(options.apps.bot?.sessions).toEqual({ hideFromList: true })
  })

  test("an explicit false on the app is kept, so it can override a global true", () => {
    const options = parseOptions({ keys: { bot: KEY }, sessions: { hideFromList: true }, apps: { bot: { sessions: { hideFromList: false } } } })
    expect(options.apps.bot?.sessions?.hideFromList).toBe(false)
    expect(options.sessions.hideFromList).toBe(true)
  })

  test("the app's hideFromList must be a boolean and names the app in the error", () => {
    expect(() => parseOptions({ keys: { bot: KEY }, apps: { bot: { sessions: { hideFromList: 1 } } } })).toThrow(/apps\.bot\.sessions\.hideFromList` must be a boolean/)
  })

  test("unknown keys under sessions still fail, and the list names hideFromList", () => {
    expect(() => parseOptions({ keys: { bot: KEY }, sessions: { hiden: true } })).toThrow(/known: maxSessions, maxAgeDays, hideFromList/)
  })

  test("hideFromList with a per-user promptCache anchor is refused: the parent is one per app", () => {
    expect(() => parseOptions({ keys: { bot: KEY }, sessions: { hideFromList: true }, promptCache: { affinity: "anchor", scope: "user" } })).toThrow(/scope `user`/)
    expect(() => parseOptions({ keys: { bot: KEY }, apps: { bot: { sessions: { hideFromList: true }, promptCache: { affinity: "anchor", scope: "user" } } } })).toThrow(/scope `user`/)
  })

  test("hideFromList with an app-scope promptCache anchor is accepted: one parent serves both", () => {
    const options = parseOptions({ keys: { bot: KEY }, sessions: { hideFromList: true }, promptCache: { affinity: "anchor", scope: "app" } })
    expect(options.promptCache).toEqual({ affinity: "anchor", scope: "app" })
  })

  test("with keys, the keyless `default` app is not checked: a global hideFromList + user-scope pair does not refuse when every real app opts out", () => {
    const options = parseOptions({
      keys: { a: KEY, b: "sk-plug-b-test-key-0123456789" },
      sessions: { hideFromList: true },
      promptCache: { affinity: "anchor", scope: "user" },
      apps: { a: { sessions: { hideFromList: false } }, b: { sessions: { hideFromList: false } } },
    })
    expect(options.apps.a?.sessions?.hideFromList).toBe(false)
    expect(options.apps.b?.sessions?.hideFromList).toBe(false)
  })

  test("without keys, the keyless `default` app is the one checked", () => {
    expect(() => parseOptions({ sessions: { hideFromList: true }, promptCache: { affinity: "anchor", scope: "user" } })).toThrow(/app `default` sets `sessions.hideFromList`/)
  })

  test("a per-user promptCache is fine when hideFromList is off for that app", () => {
    const options = parseOptions({
      keys: { bot: KEY },
      sessions: { hideFromList: true },
      apps: { bot: { sessions: { hideFromList: false }, promptCache: { affinity: "anchor", scope: "user" } } },
    })
    expect(options.apps.bot?.promptCache).toEqual({ affinity: "anchor", scope: "user" })
  })
})
