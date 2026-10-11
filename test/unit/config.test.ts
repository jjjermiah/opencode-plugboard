import { describe, expect, test } from "bun:test"
import { authenticate, isLoopbackHost, parseOptions } from "../../src/config.js"
import { testOptions } from "../support/fixtures.js"

describe("parseOptions: defaults", () => {
  test("no options is a keyless loopback endpoint on 127.0.0.1:4010 that allows no model", () => {
    expect(parseOptions(undefined)).toEqual({
      listen: { host: "127.0.0.1", port: 4010 },
      keys: {},
      apps: {},
      models: [],
      aliases: {},
      fallbacks: {},
      maxTools: 32,
      maxN: 1,
      requestTimeoutMs: 600_000,
      remoteImages: false,
      history: {},
      dropUnsupportedParams: true,
      logFormat: "text",
      metrics: false,
      modelIds: "canonical",
    })
  })

  test("null is the same as no options", () => {
    expect(parseOptions(null)).toEqual(parseOptions({}))
  })

  test("valid values are kept", () => {
    const options = parseOptions({
      listen: { host: "0.0.0.0", port: 8080 },
      keys: { "my-app": "secret" },
      models: ["openai/*", "anthropic/claude#high"],
      aliases: { fast: "openai/gpt-mini" },
      maxTools: 1024,
      requestTimeoutMs: 2 ** 31 - 1,
      remoteImages: true,
      history: { maxSessions: 5, maxAgeDays: 36_500 },
      dropUnsupportedParams: false,
    })
    expect(options).toMatchObject({
      listen: { host: "0.0.0.0", port: 8080 },
      keys: { "my-app": "secret" },
      maxTools: 1024,
      remoteImages: true,
      history: { maxSessions: 5, maxAgeDays: 36_500 },
      dropUnsupportedParams: false,
    })
  })

  test("limits are kept as given, and are absent when not set", () => {
    const limits = { maxConcurrent: 8, perApp: { maxConcurrent: 2, requestsPerMinute: 60 }, apps: { a: { requestsPerMinute: 10 } } }
    expect(parseOptions({ keys: { a: "k" }, limits }).limits).toEqual(limits)
    expect(parseOptions({ limits: {} }).limits).toEqual({})
    expect(parseOptions({ limits: { apps: { default: { maxConcurrent: 1 } } } }).limits).toEqual({ apps: { default: { maxConcurrent: 1 } } })
    expect(parseOptions({}).limits).toBeUndefined()
  })

  test("history limits that are not set stay absent (keep forever)", () => {
    expect(parseOptions({ history: { maxSessions: 3 } }).history).toEqual({ maxSessions: 3 })
    expect(parseOptions({ history: {} }).history).toEqual({})
  })
})

describe("parseOptions: every rejection names the option", () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ["options that are not an object", [], /options must be an object/],
    ["an unknown option", { port: 1 }, /Unknown plugboard option `port`/],
    ["a listen that is not an object", { listen: "x" }, /`listen` must be an object/],
    ["an empty listen.host", { listen: { host: "" } }, /`listen.host`/],
    ["a listen.port of 0", { listen: { port: 0 } }, /`listen.port`/],
    ["a listen.port above 65535", { listen: { port: 65536 } }, /`listen.port`/],
    ["a fractional listen.port", { listen: { port: 80.5 } }, /`listen.port`/],
    ["keys that are not an object", { keys: ["k"] }, /`keys` must be an object/],
    ["the reserved app name default", { keys: { default: "k" } }, /reserved/],
    ["an app name with capitals", { keys: { MyApp: "k" } }, /must match/],
    ["an empty key (unset {env:VAR})", { keys: { app: "" } }, /non-empty string/],
    ["a key that is not a string", { keys: { app: 1 } }, /non-empty string/],
    ["two apps sharing one key", { keys: { a: "same", b: "same" } }, /`a` and `b` have the same value/],
    ["a non-loopback host without keys", { listen: { host: "0.0.0.0" } }, /refuses to listen on non-loopback host/],
    ["127.0.0.2 without keys (not in the Host check's loopback set)", { listen: { host: "127.0.0.2" } }, /non-loopback/],
    ["models that are not an array", { models: "openai/*" }, /`models` must be an array/],
    ["a model without a provider", { models: ["gpt"] }, /must be `provider\/model`/],
    ["a model pattern with a wildcard id prefix", { models: ["openai/gpt-*"] }, /must be `provider\/model`/],
    ["a model with two variants", { models: ["a/b#c#d"] }, /must be `provider\/model`/],
    ["aliases that are not an object", { aliases: [] }, /`aliases` must be an object/],
    ["an alias with whitespace", { aliases: { "my alias": "a/b" } }, /without whitespace/],
    ["an alias targeting a wildcard", { aliases: { fast: "openai/*" } }, /must target/],
    ["an alias shaped like provider/model", { aliases: { "openai/fast": "openai/gpt" } }, /written like a `provider\/model` id/],
    ["a maxTools of 0", { maxTools: 0 }, /`maxTools` must be an integer between 1 and 1024/],
    ["a maxTools above 1024", { maxTools: 1025 }, /`maxTools`/],
    ["a requestTimeoutMs past the timer limit", { requestTimeoutMs: 2 ** 31 }, /`requestTimeoutMs`/],
    ["a string requestTimeoutMs", { requestTimeoutMs: "1000" }, /`requestTimeoutMs`/],
    ["a remoteImages that is not a boolean", { remoteImages: "yes" }, /`remoteImages` must be a boolean/],
    ["a dropUnsupportedParams that is not a boolean", { dropUnsupportedParams: 1 }, /`dropUnsupportedParams` must be a boolean/],
    ["a history that is not an object", { history: 5 }, /`history` must be an object/],
    ["an unknown history key", { history: { maxCount: 1 } }, /Unknown plugboard option `history.maxCount`/],
    ["a history.maxSessions of 0", { history: { maxSessions: 0 } }, /`history.maxSessions`/],
    ["an unknown modelIds mode", { modelIds: "all" }, /`modelIds` must be `canonical`, `slugs` or `both`/],
    ["a modelIds that is not a string", { modelIds: ["slugs"] }, /`modelIds` must be/],
    ["a history.maxAgeDays past 100 years", { history: { maxAgeDays: 36_501 } }, /`history.maxAgeDays` must be an integer between 1 and 36500/],
    ["a limits that is not an object", { limits: 5 }, /`limits` must be an object/],
    ["an unknown limits key", { limits: { rate: 1 } }, /Unknown plugboard option `limits.rate`/],
    ["a limits.maxConcurrent of 0", { limits: { maxConcurrent: 0 } }, /`limits.maxConcurrent` must be an integer between 1 and 1000000/],
    ["a fractional limits.maxConcurrent", { limits: { maxConcurrent: 2.5 } }, /`limits.maxConcurrent`/],
    ["a string limits.maxConcurrent", { limits: { maxConcurrent: "4" } }, /`limits.maxConcurrent`/],
    ["requestsPerMinute at the top level", { limits: { requestsPerMinute: 5 } }, /Unknown plugboard option `limits.requestsPerMinute`/],
    ["a perApp that is not an object", { limits: { perApp: 3 } }, /`limits.perApp` must be an object/],
    ["an unknown perApp key", { limits: { perApp: { maxTools: 1 } } }, /Unknown plugboard option `limits.perApp.maxTools` \(known: maxConcurrent, requestsPerMinute\)/],
    ["a perApp requestsPerMinute of 0", { limits: { perApp: { requestsPerMinute: 0 } } }, /`limits.perApp.requestsPerMinute`/],
    ["an apps that is not an object", { limits: { apps: [] } }, /`limits.apps` must be an object/],
    ["an apps entry for an app with no key", { keys: { a: "k" }, limits: { apps: { b: { maxConcurrent: 1 } } } }, /`limits.apps.b` must name a configured app/],
    ["an apps entry for default when keys exist", { keys: { a: "k" }, limits: { apps: { default: { maxConcurrent: 1 } } } }, /`limits.apps.default` must name a configured app/],
    ["an apps entry that is not an object", { keys: { a: "k" }, limits: { apps: { a: 2 } } }, /`limits.apps.a` must be an object/],
    ["an unknown key in an apps entry", { keys: { a: "k" }, limits: { apps: { a: { perApp: 1 } } } }, /Unknown plugboard option `limits.apps.a.perApp`/],
  ]
  test.each(cases)("rejects %s", (_name, raw, message) => {
    expect(() => parseOptions(raw)).toThrow(message)
  })

  test("an alias named __proto__ is rejected instead of reaching the prototype", () => {
    expect(() => parseOptions(JSON.parse('{"aliases":{"__proto__":"a/b"}}'))).toThrow(/`__proto__` is not allowed/)
  })

  test("a key named __proto__ is refused by the app name pattern", () => {
    expect(() => parseOptions(JSON.parse('{"keys":{"__proto__":"k"}}'))).toThrow(/must match/)
  })
})

describe("parseOptions: modelIds", () => {
  test.each(["canonical", "slugs", "both"] as const)("accepts %p", (modelIds) => {
    expect(parseOptions({ modelIds }).modelIds).toBe(modelIds)
  })

  test("defaults to canonical", () => {
    expect(parseOptions({}).modelIds).toBe("canonical")
  })
})

describe("isLoopbackHost: exactly the Host check's set", () => {
  test.each([
    ["localhost", true],
    ["LOCALHOST", true],
    ["127.0.0.1", true],
    ["::1", true],
    ["[::1]", true],
    ["127.0.0.2", false],
    ["0.0.0.0", false],
    ["example.com", false],
  ])("%s -> %p", (host, loopback) => {
    expect(isLoopbackHost(host)).toBe(loopback)
  })
})

describe("authenticate", () => {
  const keyed = testOptions({ keys: { alpha: "key-alpha", beta: "key-beta" } })

  test("without keys every caller is the app `default`", () => {
    expect(authenticate(testOptions(), undefined)).toEqual({ app: "default" })
    expect(authenticate(testOptions(), "Bearer anything")).toEqual({ app: "default" })
  })

  test.each([
    ["Bearer key-alpha", "alpha"],
    ["bearer key-beta", "beta"],
    ["Bearer   key-alpha  ", "alpha"],
  ])("%p authenticates as %p", (header, app) => {
    expect(authenticate(keyed, header)).toEqual({ app })
  })

  test.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["a Basic scheme", "Basic key-alpha"],
    ["a wrong key", "Bearer key-gamma"],
    ["a prefix of a key", "Bearer key-alph"],
    ["a key with a suffix", "Bearer key-alphaa"],
    ["two tokens", "Bearer key-alpha extra"],
  ])("%s is a 401 invalid_api_key", (_name, header) => {
    expect(authenticate(keyed, header)).toEqual({ status: 401, kind: "authentication", code: "invalid_api_key", message: "Missing or invalid API key" })
  })
})
