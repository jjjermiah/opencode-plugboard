/**
 * #78 #51 per-app policy, the pure parts: the `apps` option (src/config.ts), the model scope it
 * puts on lists and fallbacks (src/models.ts) and the policy header writer (src/policy.ts).
 * The caller and the context hook are in test/session/policy.test.ts, the wire in test/http/policy.test.ts.
 */
import { describe, expect, test } from "bun:test"
import type { ServerResponse } from "node:http"
import { appPolicy, authenticate, parseOptions } from "../../src/config.js"
import { checkAppModel, fallbackRefs, listAvailableModels } from "../../src/models.js"
import { POLICY_HEADER, reportPolicy } from "../../src/policy.js"
import { model, testOptions } from "../support/fixtures.js"

const CATALOG = [model("a", "x"), model("a", "y"), model("b", "z", { variants: ["low", "high"] })]
const base = { models: ["a/*", "b/z"], aliases: { fast: "a/x", smart: "b/z#high", chain: ["a/x", "b/z"] } }
const ids = (options: ReturnType<typeof parseOptions>, app?: string) => listAvailableModels(options, CATALOG, app).map((m) => m.id)

describe("apps: parsing", () => {
  test("keys and apps.<name>.key are merged into the one key map", () => {
    const options = parseOptions({ ...base, keys: { bot: "k-bot" }, apps: { bot: { tools: false }, web: { key: "k-web" } } })
    expect(options.keys).toEqual({ bot: "k-bot", web: "k-web" })
    expect((authenticate(options, "Bearer k-web") as { app: string }).app).toBe("web")
  })

  test("a key set in both places is fine when equal", () => {
    expect(parseOptions({ ...base, keys: { a: "same" }, apps: { a: { key: "same", tools: false } } }).keys).toEqual({ a: "same" })
  })

  test("only apps that set a policy field get a policy, with defaults filled in", () => {
    const options = parseOptions({
      ...base,
      apps: { bare: { key: "k1" }, full: { key: "k2", allowedModels: ["fast"], system: "S", systemMode: "append", tools: false, maxTools: 4 }, sys: { key: "k3", system: "S" } },
    })
    expect(Object.keys(options.apps).sort()).toEqual(["full", "sys"])
    expect(options.apps.full).toEqual({ allowedModels: ["fast"], system: "S", systemMode: "append", tools: false, maxTools: 4 })
    expect(options.apps.sys).toEqual({ system: "S", systemMode: "prepend", tools: true })
    expect(appPolicy(options, "bare")).toBeUndefined()
    expect(appPolicy(options, "constructor")).toBeUndefined()
  })

  test('apps.<name>.allowedModels: "all" is no narrowing: the app inherits the global list and gets no policy for it', () => {
    const options = parseOptions({ ...base, apps: { open: { key: "k1", allowedModels: "all" }, sys: { key: "k2", allowedModels: "all", system: "S" } } })
    expect(options.apps.open).toBeUndefined()
    expect(options.apps.sys).toEqual({ system: "S", systemMode: "prepend", tools: true })
    expect(ids(options, "open")).toEqual(ids(options))
  })

  test("the keyless default app can be configured", () => {
    expect(parseOptions({ ...base, apps: { default: { system: "S", maxTools: 2 } } }).apps.default).toMatchObject({ system: "S", maxTools: 2 })
  })

  test("a key in apps counts as a key: a non-loopback listen needs no separate keys entry", () => {
    expect(parseOptions({ ...base, listen: { host: "0.0.0.0" }, apps: { a: { key: "k" } } }).keys).toEqual({ a: "k" })
  })

  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ["apps that are not an object", { apps: [] }, /`apps` must be an object/],
    ["an app that is not an object", { keys: { a: "k" }, apps: { a: "x" } }, /`apps.a` must be an object/],
    ["an unknown app field", { keys: { a: "k" }, apps: { a: { allowTools: false } } }, /Unknown plugboard option `apps.a.allowTools`/],
    ["an app name with capitals", { apps: { MyApp: { key: "k" } } }, /must match/],
    ["an app name longer than 255 characters (#418)", { apps: { ["x".repeat(256)]: { key: "k" } } }, /at most 255 characters/],
    ["a key that differs between keys and apps", { keys: { a: "one" }, apps: { a: { key: "two" } } }, /different key in `keys` and in `apps.a.key`/],
    ["an empty apps key (unset {env:VAR})", { apps: { a: { key: "" } } }, /non-empty string/],
    ["two apps sharing a key value across keys and apps", { keys: { a: "same" }, apps: { b: { key: "same" } } }, /`a` and `b` have the same value/],
    ["an app without a key", { keys: { a: "k" }, apps: { b: { tools: false } } }, /`apps.b` has no key/],
    ["a policy for a non-default app on a keyless setup", { apps: { b: { tools: false } } }, /`apps.b` has no key/],
    ["apps.default next to keys", { keys: { a: "k" }, apps: { default: { tools: false } } }, /cannot be used together with `keys`/],
    ["a key on apps.default", { apps: { default: { key: "k" } } }, /reserved/],
    ["an app allowedModels string other than all", { ...base, keys: { a: "k" }, apps: { a: { allowedModels: "a/*" } } }, /`apps.a`.allowedModels must be a non-empty array or `"all"`/],
    ["empty allowedModels", { ...base, keys: { a: "k" }, apps: { a: { allowedModels: [] } } }, /`apps.a`.allowedModels must be a non-empty array/],
    ["an allowedModels entry that is neither a pattern nor an alias", { ...base, keys: { a: "k" }, apps: { a: { allowedModels: ["nope"] } } }, /allowedModels entry `nope`/],
    ["an allowedModels entry with a wildcard id prefix", { ...base, keys: { a: "k" }, apps: { a: { allowedModels: ["a/x-*"] } } }, /allowedModels entry/],
    ["an empty system", { keys: { a: "k" }, apps: { a: { system: "  " } } }, /system must be a non-empty string/],
    ["a bad systemMode", { keys: { a: "k" }, apps: { a: { system: "S", systemMode: "before" } } }, /systemMode must be `prepend`, `append` or `replace`/],
    ["a systemMode without system", { keys: { a: "k" }, apps: { a: { systemMode: "append" } } }, /systemMode needs `system`/],
    ["tools that is not a boolean", { keys: { a: "k" }, apps: { a: { tools: "no" } } }, /tools must be a boolean/],
    ["a maxTools of 0", { keys: { a: "k" }, apps: { a: { maxTools: 0 } } }, /`apps.a.maxTools` must be an integer between 1 and 64/],
    ["a maxTools above the global cap", { maxTools: 4, keys: { a: "k" }, apps: { a: { maxTools: 5 } } }, /`apps.a.maxTools` must be an integer between 1 and 4/],
  ]
  test.each(cases)("rejects %s", (_name, raw, message) => {
    expect(() => parseOptions(raw)).toThrow(message)
  })
})

describe("apps: model scope", () => {
  const options = parseOptions({
    ...base,
    keys: { bot: "k1", ide: "k2", web: "k3", wide: "k4" },
    apps: { bot: { allowedModels: ["fast"] }, ide: { allowedModels: ["a/*"] }, wide: { allowedModels: ["a/*", "b/z", "c/*"] }, web: { tools: false } },
  })

  test("without a policy or without allowedModels nothing is narrowed", () => {
    const all = ids(options)
    expect(ids(options, "web")).toEqual(all)
    expect(ids(options, "nobody")).toEqual(all)
    expect(ids(options, undefined)).toEqual(all)
  })

  test("an alias entry lists that alias only, not its target", () => {
    expect(ids(options, "bot")).toEqual(["fast"])
  })

  test("a pattern entry lists the models it matches and the aliases that point at them", () => {
    expect(ids(options, "ide")).toEqual(["a/x", "a/y", "fast", "chain"])
  })

  test("an app can only narrow: what the global list refuses stays refused", () => {
    expect(ids(options, "wide")).toEqual(ids(options))
    expect(ids(testOptions({ models: ["a/x"], keys: { n: "k" }, apps: { n: { allowedModels: ["a/*", "b/z"] } } }), "n")).toEqual(["a/x"])
  })

  test("checkAppModel: the same 404 as an unknown model, keyed on what the caller sent and the resolved ref", () => {
    const policy = appPolicy(options, "bot")
    expect(checkAppModel(policy, "fast", { providerID: "a", id: "x" })).toBeUndefined()
    expect(checkAppModel(policy, "a/x", { providerID: "a", id: "x" })).toEqual({
      status: 404,
      kind: "not_found",
      code: "model_not_found",
      param: "model",
      message: "Model a/x is not available. GET /v1/models lists the models you can call.",
    })
    expect(checkAppModel(undefined, "anything", { providerID: "z", id: "z" })).toBeUndefined()
    expect(checkAppModel(appPolicy(options, "ide"), "fast", { providerID: "a", id: "x" })).toBeUndefined()
    expect(checkAppModel(appPolicy(options, "ide"), "smart", { providerID: "b", id: "z", variant: "high" })).toMatchObject({ status: 404, code: "model_not_found" })
  })

  test("a variant pattern admits that variant only, and the aliases that point at it", () => {
    const v = parseOptions({ ...base, keys: { v: "k" }, apps: { v: { allowedModels: ["b/z#high"] } } })
    expect(ids(v, "v")).toEqual(["b/z#high", "smart"])
  })

  test("fallbacks: a target outside the app's patterns is skipped, an app scoped to the alias name keeps them all", () => {
    expect(fallbackRefs(options, "chain", CATALOG)).toEqual([{ providerID: "b", id: "z" }])
    expect(fallbackRefs(options, "chain", CATALOG, "ide")).toEqual([])
    const named = parseOptions({ ...base, keys: { n: "k" }, apps: { n: { allowedModels: ["chain"] } } })
    expect(fallbackRefs(named, "chain", CATALOG, "n")).toEqual([{ providerID: "b", id: "z" }])
    expect(fallbackRefs(options, "chain", CATALOG, "wide")).toEqual([{ providerID: "b", id: "z" }])
  })
})

describe("reportPolicy", () => {
  const fake = (init: { headersSent?: boolean; destroyed?: boolean } = {}) => {
    const headers: Record<string, string> = {}
    const response = {
      headersSent: init.headersSent ?? false,
      destroyed: init.destroyed ?? false,
      hasHeader: (name: string) => name in headers,
      setHeader: (name: string, value: string) => void (headers[name] = value),
    } as unknown as ServerResponse
    return { response, headers }
  }

  test("sets x-plugboard-policy with the notes, comma separated", () => {
    const { response, headers } = fake()
    reportPolicy(response)(["tools-stripped"])
    expect(headers).toEqual({ [POLICY_HEADER]: "tools-stripped" })
  })

  test("the first writer wins", () => {
    const { response, headers } = fake()
    const report = reportPolicy(response)
    report(["tools-stripped"])
    headers[POLICY_HEADER] = "first"
    report(["tools-stripped"])
    expect(headers[POLICY_HEADER]).toBe("first")
  })

  test("nothing is written once the headers went out, the socket is gone, or there is nothing to say", () => {
    for (const init of [{ headersSent: true }, { destroyed: true }]) {
      const { response, headers } = fake(init)
      reportPolicy(response)(["tools-stripped"])
      expect(headers).toEqual({})
    }
    const { response, headers } = fake()
    reportPolicy(response)([])
    expect(headers).toEqual({})
  })
})
