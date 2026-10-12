import { describe, expect, test } from "bun:test"
import { parseOptions, parsePromptCache } from "../../src/config.js"

describe("option promptCache (src/session/affinity.ts)", () => {
  test("absent is undefined: no affinity configured", () => {
    expect(parsePromptCache(undefined, "promptCache")).toBeUndefined()
  })

  test("both fields are required and checked", () => {
    expect(parsePromptCache({ affinity: "anchor", scope: "user" }, "promptCache")).toEqual({ affinity: "anchor", scope: "user" })
    expect(() => parsePromptCache("anchor", "promptCache")).toThrow(/must be an object/)
    expect(() => parsePromptCache({ scope: "app" }, "promptCache")).toThrow(/`promptCache\.affinity` must be `off` or `anchor`/)
    expect(() => parsePromptCache({ affinity: "session", scope: "app" }, "promptCache")).toThrow(/promptCache\.affinity/)
    expect(() => parsePromptCache({ affinity: "anchor" }, "promptCache")).toThrow(/`promptCache\.scope` must be `app` or `user`/)
    expect(() => parsePromptCache({ affinity: "anchor", scope: "conversation" }, "promptCache")).toThrow(/promptCache\.scope/)
    expect(() => parsePromptCache({ affinity: "anchor", scope: "app", ttl: 1 }, "promptCache")).toThrow(/Unknown plugboard option `promptCache\.ttl`/)
  })

  test("maxAnchors is a positive integer; absent keeps the default (no field)", () => {
    expect(parsePromptCache({ affinity: "anchor", scope: "user", maxAnchors: 250 }, "promptCache")).toEqual({ affinity: "anchor", scope: "user", maxAnchors: 250 })
    expect(parsePromptCache({ affinity: "anchor", scope: "app" }, "promptCache")).not.toHaveProperty("maxAnchors")
    expect(() => parsePromptCache({ affinity: "anchor", scope: "app", maxAnchors: 0 }, "promptCache")).toThrow(/maxAnchors/)
    expect(() => parsePromptCache({ affinity: "anchor", scope: "app", maxAnchors: "many" }, "promptCache")).toThrow(/maxAnchors/)
  })

  test("the global option and an app's own option both reach the parsed options", () => {
    const options = parseOptions({
      keys: { bot: "sk-plug-bot-test-key-0123456789" },
      promptCache: { affinity: "anchor", scope: "user" },
      apps: { bot: { promptCache: { affinity: "off", scope: "app" } } },
    })
    expect(options.promptCache).toEqual({ affinity: "anchor", scope: "user" })
    expect(options.apps.bot?.promptCache).toEqual({ affinity: "off", scope: "app" })
  })

  test("absent from the options: the parsed options carry no promptCache", () => {
    expect(parseOptions({ keys: { bot: "sk-plug-bot-test-key-0123456789" } }).promptCache).toBeUndefined()
  })
})
