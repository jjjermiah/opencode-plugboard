import { describe, expect, test } from "bun:test"
import { appHistoryLimits, authenticate, authenticateUsage, bodyLimits, isLoopbackHost, maxNFor, parseOptions, reasoningOutputFor } from "../../src/config.js"
import { testOptions } from "../support/fixtures.js"

describe("parseOptions: defaults", () => {
  test("no options is a keyless loopback endpoint on 127.0.0.1:4010 that allows no model", () => {
    expect(parseOptions(undefined)).toEqual({
      listen: { host: "127.0.0.1", port: 4010 },
      keys: {},
      apps: {},
      models: [],
      aliases: {},
      agents: {},
      fallbacks: {},
      maxTools: 64,
      maxN: 1,
      requestTimeoutMs: 600_000,
      remoteImages: false,
      history: { maxAgeDays: 30 },
      dropUnsupportedParams: true,
      logFormat: "text",
      logLevel: "info",
      logRequests: true,
      metrics: false,
      reasoningOutput: false,
      modelIds: "canonical",
      usage: { enabled: true, retentionDays: 90 },
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

  test("#156 the body limits are kept when set, and default to 128 MiB in flight and 30 s when not", () => {
    expect(parseOptions({ limits: { maxBodyBytesInFlight: 1024, bodyReadTimeoutMs: 500 } }).limits).toEqual({ maxBodyBytesInFlight: 1024, bodyReadTimeoutMs: 500 })
    // `maxBodyBytes` (#258) is the largest body, 32 MiB unless `limits.maxBodyBytes` or the app's own cap lowers it.
    expect(bodyLimits(parseOptions({ limits: { maxBodyBytesInFlight: 1024, bodyReadTimeoutMs: 500 } }))).toEqual({ maxBytesInFlight: 1024, readTimeoutMs: 500, maxBodyBytes: 33_554_432 })
    expect(bodyLimits(parseOptions({ limits: { maxConcurrent: 2 } }))).toEqual({ maxBytesInFlight: 128 * 1024 * 1024, readTimeoutMs: 30_000, maxBodyBytes: 33_554_432 })
    expect(bodyLimits(parseOptions(undefined))).toEqual({ maxBytesInFlight: 134_217_728, readTimeoutMs: 30_000, maxBodyBytes: 33_554_432 })
  })

  test("#158 history keeps 30 days by default; maxAgeDays 0 is the explicit opt-out to no age limit", () => {
    expect(parseOptions({ history: { maxSessions: 3 } }).history).toEqual({ maxSessions: 3, maxAgeDays: 30 })
    expect(parseOptions({}).history).toEqual({ maxAgeDays: 30 })
    expect(parseOptions({ history: { maxAgeDays: 0 } }).history).toEqual({})
    expect(parseOptions({ history: { maxAgeDays: 0, maxSessions: 3 } }).history).toEqual({ maxSessions: 3 })
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
    ["a fallbackAfterMs past the timer limit", { fallbackAfterMs: 2 ** 31 }, /`fallbackAfterMs`/],
    ["a string fallbackAfterMs", { fallbackAfterMs: "500" }, /`fallbackAfterMs`/],
    ["a remoteImages that is not a boolean", { remoteImages: "yes" }, /`remoteImages` must be a boolean/],
    ["a dropUnsupportedParams that is not a boolean", { dropUnsupportedParams: 1 }, /`dropUnsupportedParams` must be a boolean/],
    ["a history that is not an object", { history: 5 }, /`history` must be an object/],
    ["an unknown history key", { history: { maxCount: 1 } }, /Unknown plugboard option `history.maxCount`/],
    ["a history.maxSessions of 0", { history: { maxSessions: 0 } }, /`history.maxSessions`/],
    ["an unknown modelIds mode", { modelIds: "all" }, /`modelIds` must be `canonical`, `slugs` or `both`/],
    ["a modelIds that is not a string", { modelIds: ["slugs"] }, /`modelIds` must be/],
    ["a history.maxAgeDays past 100 years", { history: { maxAgeDays: 36_501 } }, /`history.maxAgeDays` must be an integer between 0 and 36500/],
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
    ["a limits.maxBodyBytesInFlight of 0", { limits: { maxBodyBytesInFlight: 0 } }, /`limits.maxBodyBytesInFlight` must be an integer between 1 and/],
    ["a fractional limits.maxBodyBytesInFlight", { limits: { maxBodyBytesInFlight: 1.5 } }, /`limits.maxBodyBytesInFlight`/],
    ["a string limits.bodyReadTimeoutMs", { limits: { bodyReadTimeoutMs: "30000" } }, /`limits.bodyReadTimeoutMs` must be an integer/],
    ["a limits.bodyReadTimeoutMs past the timer limit", { limits: { bodyReadTimeoutMs: 2 ** 31 } }, /`limits.bodyReadTimeoutMs` must be an integer between 1 and 2147483647/],
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

describe("#266 listen.trustProxy in parseOptions", () => {
  test("is absent from listen by default, and carries the list when set", () => {
    expect(parseOptions({}).listen).not.toHaveProperty("trustProxy")
    expect(parseOptions({ keys: { app: "secret" }, listen: { trustProxy: ["127.0.0.1", "10.0.0.0/8"] } }).listen.trustProxy).toEqual(["127.0.0.1", "10.0.0.0/8"])
    expect(parseOptions({ keys: { app: "secret" }, listen: { trustProxy: true } }).listen.trustProxy).toEqual(["127.0.0.0/8", "::1/128"])
  })

  test("an invalid entry is refused at load and names the option", () => {
    expect(() => parseOptions({ listen: { trustProxy: ["proxy.internal"] } })).toThrow("`listen.trustProxy`")
  })
})

describe("#256 cors option", () => {
  test("is absent by default, and parses origins and allowPrivateNetwork", () => {
    expect(parseOptions({})).not.toHaveProperty("cors")
    expect(parseOptions({ cors: { origins: ["https://chat.example.net", "http://localhost:3000"] } }).cors).toEqual({
      origins: ["https://chat.example.net", "http://localhost:3000"],
      allowPrivateNetwork: false,
    })
    expect(parseOptions({ keys: { app: "secret" }, cors: { origins: ["*"], allowPrivateNetwork: true } }).cors).toEqual({ origins: ["*"], allowPrivateNetwork: true })
  })

  test.each([
    ["a trailing slash", { origins: ["https://a.example/"] }, /entry `https:\/\/a\.example\/` must be an `http:\/\/` or `https:\/\/` origin/],
    ["a path", { origins: ["https://a.example/app"] }, /must be an `http:\/\/` or `https:\/\/` origin/],
    ["a wildcard host", { origins: ["https://*.example"] }, /must be an `http:\/\/` or `https:\/\/` origin/],
    ["credentials", { origins: ["https://user:pw@a.example"] }, /must be an `http:\/\/` or `https:\/\/` origin/],
    ["another scheme", { origins: ["ftp://a.example"] }, /must be an `http:\/\/` or `https:\/\/` origin/],
    ["an empty list", { origins: [] }, /`cors.origins` must be a non-empty array/],
    ["* with another entry", { origins: ["*", "https://a.example"] }, /`\*` must be the only entry/],
    ["an unknown field", { origins: ["https://a.example"], methods: ["GET"] }, /Unknown plugboard option `cors.methods`/],
    ["allowPrivateNetwork that is not a boolean", { origins: ["https://a.example"], allowPrivateNetwork: "yes" }, /`cors.allowPrivateNetwork` must be a boolean/],
  ])("%s is refused at load and names the option", (_name, cors, message) => {
    expect(() => parseOptions({ keys: { app: "secret" }, cors })).toThrow(message)
  })

  test("* without keys is refused: a wildcard never sits in front of a keyless endpoint", () => {
    expect(() => parseOptions({ cors: { origins: ["*"] } })).toThrow("`*` needs `keys`")
  })
})

describe("#259 remoteImages object fields", () => {
  test("each field is optional and parses as given; an unset field is absent", () => {
    expect(parseOptions({ remoteImages: { allow: ["images.internal"] } }).remoteImages).toEqual({ allow: ["images.internal"] })
    expect(parseOptions({ remoteImages: { allow: [], schemes: ["https"], maxBytes: 5242880, maxItems: 4, maxRedirects: 0, timeoutMs: 10000 } }).remoteImages).toEqual({
      allow: [],
      schemes: ["https"],
      maxBytes: 5242880,
      maxItems: 4,
      maxRedirects: 0,
      timeoutMs: 10000,
    })
    expect(parseOptions({ remoteImages: true }).remoteImages).toBe(true)
  })

  test.each([
    ["schemes with a scheme other than http or https", { schemes: ["ftp"] }, /`remoteImages.schemes` must be a non-empty list of `http` and `https`/],
    ["schemes empty", { schemes: [] }, /`remoteImages.schemes` must be a non-empty list/],
    ["maxBytes of zero", { maxBytes: 0 }, /`remoteImages.maxBytes` must be an integer between 1 and 104857600/],
    ["maxBytes above 100 MiB", { maxBytes: 104857601 }, /`remoteImages.maxBytes` must be an integer between 1 and 104857600/],
    ["maxItems of zero", { maxItems: 0 }, /`remoteImages.maxItems` must be an integer between 1 and 1000/],
    ["maxRedirects above 10", { maxRedirects: 11 }, /`remoteImages.maxRedirects` must be an integer between 0 and 10/],
    ["maxRedirects that is not an integer", { maxRedirects: 1.5 }, /`remoteImages.maxRedirects` must be an integer between 0 and 10/],
    ["timeoutMs of zero", { timeoutMs: 0 }, /`remoteImages.timeoutMs` must be an integer between 1 and 600000/],
    ["an unknown field", { cache: true }, /Unknown plugboard option `remoteImages.cache` \(known: allow, schemes, maxBytes, maxItems, maxRedirects, timeoutMs\)/],
  ])("%s is refused at load and names the option", (_name, remoteImages, message) => {
    expect(() => parseOptions({ remoteImages })).toThrow(message)
  })
})

describe("#268 apps.<name>.endpoints", () => {
  test("parses a non-empty list of endpoint names, and is absent when unset", () => {
    const options = parseOptions({ keys: { bot: "k-bot" }, apps: { bot: { endpoints: ["chat", "models"] } } })
    expect(options.apps.bot).toEqual({ systemMode: "prepend", tools: true, endpoints: ["chat", "models"] })
    expect(parseOptions({ keys: { bot: "k-bot" }, apps: { bot: { tools: false } } }).apps.bot).not.toHaveProperty("endpoints")
  })

  test.each([
    ["an unknown name", { endpoints: ["images"] }, /endpoints entry `images` must be one of: chat, completions, responses, messages, gemini, models/],
    ["an empty list", { endpoints: [] }, /endpoints must be a non-empty array/],
    ["a string instead of a list", { endpoints: "chat" }, /endpoints must be a non-empty array/],
  ])("%s is refused at load and names the option", (_name, policy, message) => {
    expect(() => parseOptions({ keys: { bot: "k-bot" }, apps: { bot: policy } })).toThrow(message)
  })
})

describe("#257 apps.<name>.requestTimeoutMs", () => {
  test("parses an integer deadline, and is absent when unset", () => {
    expect(parseOptions({ keys: { bot: "k-bot" }, apps: { bot: { requestTimeoutMs: 30000 } } }).apps.bot).toEqual({ systemMode: "prepend", tools: true, requestTimeoutMs: 30000 })
    expect(parseOptions({ keys: { bot: "k-bot" }, apps: { bot: { tools: false } } }).apps.bot).not.toHaveProperty("requestTimeoutMs")
  })

  test("accepts 1 and the timer ceiling 2147483647, and may be higher than the global deadline", () => {
    expect(parseOptions({ keys: { bot: "k-bot" }, apps: { bot: { requestTimeoutMs: 1 } } }).apps.bot?.requestTimeoutMs).toBe(1)
    expect(parseOptions({ keys: { bot: "k-bot" }, requestTimeoutMs: 5000, apps: { bot: { requestTimeoutMs: 2147483647 } } }).apps.bot?.requestTimeoutMs).toBe(2147483647)
  })

  test.each([
    ["zero", 0],
    ["a fraction", 1.5],
    ["a string", "30000"],
    ["above the timer ceiling", 2147483648],
  ])("%s is refused at load and names the option", (_name, value) => {
    expect(() => parseOptions({ keys: { bot: "k-bot" }, apps: { bot: { requestTimeoutMs: value } } })).toThrow(/apps\.bot\.requestTimeoutMs` must be an integer between 1 and 2147483647/)
  })
})

describe("#258 limits.maxBodyBytes and limits.apps.<name>.maxBodyBytes", () => {
  const MIB = 1024 * 1024

  test("bodyLimits resolves the app's cap, else the global one, else 32 MiB", () => {
    const options = parseOptions({ keys: { widget: "k-widget", bot: "k-bot" }, limits: { maxBodyBytes: 4096, apps: { widget: { maxBodyBytes: 256 } } } })
    expect(bodyLimits(options, "widget").maxBodyBytes).toBe(256)
    expect(bodyLimits(options, "bot").maxBodyBytes).toBe(4096)
    expect(bodyLimits(options).maxBodyBytes).toBe(4096)
    expect(bodyLimits(parseOptions({ keys: { bot: "k-bot" } }), "bot").maxBodyBytes).toBe(32 * MIB)
  })

  test("the app cap is kept in limits.apps and does not change the other app limits", () => {
    const limits = bodyLimits(parseOptions({ keys: { widget: "k-widget" }, limits: { apps: { widget: { maxBodyBytes: 1000, maxConcurrent: 2 } } } }), "widget")
    expect(limits).toEqual({ maxBytesInFlight: 128 * MIB, readTimeoutMs: 30_000, maxBodyBytes: 1000 })
  })

  test.each([
    ["an app cap above the global cap", { maxBodyBytes: 1000, apps: { widget: { maxBodyBytes: 2000 } } }, /limits\.apps\.widget\.maxBodyBytes` cannot be above `limits\.maxBodyBytes`/],
    ["an app cap above the hard cap when no global one is set", { apps: { widget: { maxBodyBytes: 33 * MIB } } }, /`limits\.apps\.widget\.maxBodyBytes` must be an integer between 1 and 33554432/],
    ["a global cap above the hard cap", { maxBodyBytes: 33 * MIB }, /`limits\.maxBodyBytes` must be an integer between 1 and 33554432/],
    ["a zero app cap", { apps: { widget: { maxBodyBytes: 0 } } }, /`limits\.apps\.widget\.maxBodyBytes` must be an integer between 1 and 33554432/],
  ])("%s is refused at load", (_name, limits, message) => {
    expect(() => parseOptions({ keys: { widget: "k-widget" }, limits })).toThrow(message)
  })

  test("maxBodyBytes under limits.perApp is an unknown option, since it is a per-app cap only", () => {
    expect(() => parseOptions({ keys: { widget: "k-widget" }, limits: { perApp: { maxBodyBytes: 1000 } } })).toThrow(/Unknown plugboard option `limits\.perApp\.maxBodyBytes`/)
  })
})

describe("#271 requireKeys", () => {
  test("is absent by default, and true when set with keys", () => {
    expect(parseOptions({})).not.toHaveProperty("requireKeys")
    expect(parseOptions({ keys: { app: "secret" }, requireKeys: false })).not.toHaveProperty("requireKeys")
    expect(parseOptions({ keys: { app: "secret" }, requireKeys: true }).requireKeys).toBe(true)
  })

  test("a keyless server with requireKeys refuses to load, so it never runs keyless by drift (I16)", () => {
    expect(() => parseOptions({ requireKeys: true })).toThrow("`requireKeys` needs `keys`")
    expect(() => parseOptions({ apps: { bot: { key: "k-bot" } }, requireKeys: true })).not.toThrow()
  })

  test("must be a boolean", () => {
    expect(() => parseOptions({ keys: { app: "secret" }, requireKeys: "yes" })).toThrow("`requireKeys` must be a boolean")
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

describe("usage and adminKey options", () => {
  test("usage defaults to on with 90 days, and takes its own keys only", () => {
    expect(parseOptions({ usage: {} }).usage).toEqual({ enabled: true, retentionDays: 90 })
    expect(parseOptions({ usage: { enabled: false, retentionDays: 3650 } }).usage).toEqual({ enabled: false, retentionDays: 3650 })
    expect(() => parseOptions({ usage: { retentionDays: 0 } })).toThrow("usage.retentionDays")
    expect(() => parseOptions({ usage: { retentionDays: 3651 } })).toThrow("usage.retentionDays")
    expect(() => parseOptions({ usage: { enabled: "yes" } })).toThrow("usage.enabled")
    expect(() => parseOptions({ usage: { keep: 1 } })).toThrow("usage.keep")
  })

  test("adminKey must be a non-empty string that differs from every app key", () => {
    expect(parseOptions({ keys: { a: "one" }, adminKey: "two" }).adminKey).toBe("two")
    expect(() => parseOptions({ keys: { a: "one" }, adminKey: "one" })).toThrow("must differ from every app key")
    expect(() => parseOptions({ keys: { a: "one" }, apps: { b: { key: "two" } }, adminKey: "two" })).toThrow("must differ from every app key")
    expect(() => parseOptions({ adminKey: "" })).toThrow("adminKey")
    expect(() => parseOptions({ adminKey: 5 })).toThrow("adminKey")
  })

  test("authenticateUsage: the admin key sees every app, an app key only its own, keyless is `default`", () => {
    const keyed = parseOptions({ keys: { a: "one", b: "two" }, adminKey: "root" })
    expect(authenticateUsage(keyed, "Bearer root")).toEqual({ admin: true })
    expect(authenticateUsage(keyed, "Bearer one")).toEqual({ admin: false, app: "a" })
    expect(authenticateUsage(keyed, "Bearer nope")).toMatchObject({ status: 401 })
    expect(authenticateUsage(keyed, undefined)).toMatchObject({ status: 401 })
    expect(authenticateUsage(parseOptions({}), undefined)).toEqual({ admin: false, app: "default" })
    expect(authenticateUsage(parseOptions({ adminKey: "root" }), "Bearer root")).toEqual({ admin: true })
  })
})

describe("#60 budgets option", () => {
  test("budgets are kept as given per app, and absent when not set", () => {
    const budgets = {
      perApp: { requests: { day: 100 }, tokens: { week: 10_000 }, costUsd: { month: 2.5 } },
      apps: { a: { requests: { day: 5, month: 50 } } },
    }
    expect(parseOptions({ keys: { a: "k" }, budgets }).budgets).toEqual(budgets)
    expect(parseOptions({ budgets: {} }).budgets).toEqual({})
    expect(parseOptions({}).budgets).toBeUndefined()
  })

  test("the retention keeps every day a window in use can span", () => {
    expect(parseOptions({ budgets: { perApp: { requests: { month: 5 } } }, usage: { retentionDays: 31 } }).budgets).toEqual({ perApp: { requests: { month: 5 } } })
    expect(parseOptions({ budgets: { perApp: { requests: { day: 5 } } }, usage: { retentionDays: 1 } }).budgets).toEqual({ perApp: { requests: { day: 5 } } })
  })

  test("budgets need usage recording: they are refused when usage is off", () => {
    expect(() => parseOptions({ budgets: { perApp: { requests: { day: 1 } } }, usage: { enabled: false } })).toThrow("needs `usage` enabled")
  })

  test.each([
    ["a budgets that is not an object", { budgets: 5 }, /`budgets` must be an object/],
    ["an unknown budgets key", { budgets: { global: {} } }, /Unknown plugboard option `budgets.global`/],
    ["an unknown budget metric", { budgets: { perApp: { rate: { day: 1 } } } }, /Unknown plugboard option `budgets.perApp.rate`/],
    ["an unknown window", { budgets: { perApp: { requests: { hour: 1 } } } }, /Unknown plugboard option `budgets.perApp.requests.hour`/],
    ["a metric that is a number, not windows", { budgets: { perApp: { requests: 5 } } }, /`budgets.perApp.requests` must be an object of window/],
    ["a request ceiling of 0", { budgets: { perApp: { requests: { day: 0 } } } }, /`budgets.perApp.requests.day` must be an integer between 1/],
    ["a fractional token ceiling", { budgets: { perApp: { tokens: { day: 1.5 } } } }, /`budgets.perApp.tokens.day` must be an integer/],
    ["a cost ceiling of 0", { budgets: { perApp: { costUsd: { day: 0 } } } }, /`budgets.perApp.costUsd.day` must be a positive number of USD/],
    ["a cost ceiling given as a string", { budgets: { perApp: { costUsd: { day: "1" } } } }, /must be a positive number of USD/],
    ["an apps entry for an app with no key", { keys: { a: "k" }, budgets: { apps: { b: { requests: { day: 1 } } } } }, /`budgets.apps.b` must name a configured app/],
    ["an apps entry for default when keys exist", { keys: { a: "k" }, budgets: { apps: { default: { requests: { day: 1 } } } } }, /`budgets.apps.default` must name a configured app/],
    ["a monthly ceiling with retention under 31 days", { budgets: { perApp: { requests: { month: 5 } } }, usage: { retentionDays: 30 } }, /`usage.retentionDays` must be at least 31/],
    ["a weekly ceiling with retention under 7 days", { budgets: { perApp: { tokens: { week: 5 } } }, usage: { retentionDays: 6 } }, /`usage.retentionDays` must be at least 7/],
  ])("%s is refused at load", (_name, input, message) => {
    expect(() => parseOptions({ usage: {}, ...input })).toThrow(message)
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

const MODELS = ["anthropic/*", "openai/gpt-mini"]

describe("parseOptions: skill aliases (#79)", () => {
  test("#79 a skill target is kept as written and its model is checked against the allowlist", () => {
    const options = parseOptions({ models: MODELS, aliases: { "invoice-parser": "skill:invoice-parser@anthropic/claude-sonnet-4-6" } })
    expect(options.aliases).toEqual({ "invoice-parser": "skill:invoice-parser@anthropic/claude-sonnet-4-6" })
    expect(options.fallbacks).toEqual({})
  })

  test.each([
    ["no model after the skill id", "skill:invoice-parser", /must be `skill:<id>@provider\/model`/],
    ["an empty skill id", "skill:@anthropic/claude-sonnet-4-6", /must be `skill:<id>@provider\/model`/],
    ["a skill id with a slash", "skill:a/b@anthropic/claude-sonnet-4-6", /must be `skill:<id>@provider\/model`/],
    ["a model the allowlist refuses", "skill:invoice-parser@openai/gpt-4", /target `skill:invoice-parser@openai\/gpt-4` is not allowed/],
  ])("#79 a skill alias with %s is rejected at load", (_name, target, message) => {
    expect(() => parseOptions({ models: MODELS, aliases: { "invoice-parser": target } })).toThrow(message)
  })

  test("#79 a skill target cannot be part of a list of fallbacks", () => {
    expect(() =>
      parseOptions({ models: MODELS, aliases: { "invoice-parser": ["skill:invoice-parser@anthropic/claude-sonnet-4-6", "openai/gpt-mini"] } }),
    ).toThrow(/binds a skill, so it takes one target and no list of fallbacks/)
  })
})

describe("parseOptions: agents (#6)", () => {
  test("#6 an agent is kept as { name: model }", () => {
    const options = parseOptions({ models: MODELS, agents: [{ name: "review", model: "anthropic/claude-sonnet-4-6#high" }] })
    expect(options.agents).toEqual({ review: "anthropic/claude-sonnet-4-6#high" })
  })

  test("#6 no agents option means no agents", () => {
    expect(parseOptions({ models: MODELS }).agents).toEqual({})
  })

  test.each([
    ["a string instead of an object", { agents: ["review"] }, /entries must be objects of the form \{ name, model \}/],
    ["a missing model", { agents: [{ name: "review" }] }, /must set `model` to `provider\/model`/],
    ["a model that is not a model reference", { agents: [{ name: "review", model: "claude" }] }, /must set `model` to `provider\/model`/],
    ["a model the allowlist refuses", { agents: [{ name: "review", model: "openai/gpt-4" }] }, /model `openai\/gpt-4` is not allowed by the `models` option/],
    ["a name with a slash", { agents: [{ name: "a/b", model: "anthropic/claude-sonnet-4-6" }] }, /must match/],
    ["a name starting with an underscore", { agents: [{ name: "__proto__", model: "anthropic/claude-sonnet-4-6" }] }, /must match/],
    ["an unknown field", { agents: [{ name: "review", model: "anthropic/claude-sonnet-4-6", tools: true }] }, /Unknown plugboard option `agents.tools`/],
    [
      "the same name twice",
      { agents: [{ name: "review", model: "anthropic/claude-sonnet-4-6" }, { name: "review", model: "openai/gpt-mini" }] },
      /listed more than once/,
    ],
  ])("#6 an agent option with %s is rejected at load", (_name, extra, message) => {
    expect(() => parseOptions({ models: MODELS, ...extra })).toThrow(message)
  })
})

describe("#82 apps.<name>.serverTools and maxServerToolSteps", () => {
  const bot = (policy: Record<string, unknown>) => parseOptions({ keys: { bot: "k" }, apps: { bot: policy } }).apps.bot

  test("absent by default: the policy carries no server tools", () => {
    expect(bot({ tools: false })).toEqual({ systemMode: "prepend", tools: false })
  })

  test("#198 keeps the call limit when set; the default (16) is applied when the request runs", () => {
    expect(bot({ serverTools: ["websearch"], maxServerToolCalls: 5 })).toEqual({ systemMode: "prepend", tools: true, serverTools: ["websearch"], maxServerToolCalls: 5 })
  })

  test("accepts exact OpenCode tool ids and keeps the step limit when set", () => {
    expect(bot({ serverTools: ["websearch", "mcp.lookup:v2", "my_tool-1"], maxServerToolSteps: 3 })).toEqual({
      systemMode: "prepend",
      tools: true,
      serverTools: ["websearch", "mcp.lookup:v2", "my_tool-1"],
      maxServerToolSteps: 3,
    })
  })

  test.each([
    ["an empty list", { serverTools: [] }, "serverTools must be an array of 1 to 32 OpenCode tool ids"],
    ["a string instead of a list", { serverTools: "websearch" }, "serverTools must be an array of 1 to 32 OpenCode tool ids"],
    ["more than 32 entries", { serverTools: Array.from({ length: 33 }, (_, i) => `tool${i}`) }, "must be an array of 1 to 32 OpenCode tool ids"],
    ["a wildcard", { serverTools: ["web*"] }, "must be an exact OpenCode tool id"],
    ["a space in the id", { serverTools: ["web search"] }, "must be an exact OpenCode tool id"],
    ["an empty id", { serverTools: [""] }, "must be an exact OpenCode tool id"],
    ["a duplicate id", { serverTools: ["websearch", "websearch"] }, "lists `websearch` twice"],
    ["CodeMode's execute tool", { serverTools: ["execute"] }, "cannot name `execute`"],
    ["a seed tool", { serverTools: ["plugboard_seed_0"] }, "plugboard's own seed tools are reserved"],
    ["a call limit without server tools (#198)", { maxServerToolCalls: 3 }, "maxServerToolCalls needs `serverTools`"],
    ["a call limit of zero (#198)", { serverTools: ["websearch"], maxServerToolCalls: 0 }, "`apps.bot.maxServerToolCalls` must be an integer between 1 and 1000"],
    ["the subagent tool (#195)", { serverTools: ["subagent"] }, "cannot name `subagent`: it starts a child session"],
    ["the task tool, subagent's old name (#195)", { serverTools: ["task"] }, "cannot name `task`: it starts a child session"],
    ["a step limit without server tools", { maxServerToolSteps: 3 }, "maxServerToolSteps needs `serverTools`"],
    ["a step limit of zero", { serverTools: ["websearch"], maxServerToolSteps: 0 }, "`apps.bot.maxServerToolSteps` must be an integer between 1 and 100"],
    ["a step limit above 100", { serverTools: ["websearch"], maxServerToolSteps: 101 }, "`apps.bot.maxServerToolSteps` must be an integer between 1 and 100"],
  ])("rejects %s", (_name, policy, message) => {
    expect(() => bot(policy)).toThrow(message)
  })

  test("the keyless default app cannot run server tools", () => {
    expect(() => parseOptions({ apps: { default: { serverTools: ["websearch"] } } })).toThrow("needs a key")
  })
})

describe("#262 logLevel and logRequests", () => {
  test("default to info and on, so the log is as before", () => {
    const options = parseOptions({})
    expect(options.logLevel).toBe("info")
    expect(options.logRequests).toBe(true)
  })

  test("accept each level and logRequests false", () => {
    for (const logLevel of ["debug", "info", "warn", "error"] as const) expect(parseOptions({ logLevel }).logLevel).toBe(logLevel)
    expect(parseOptions({ logRequests: false }).logRequests).toBe(false)
  })

  test("an unknown level is rejected at load and the message names the option", () => {
    expect(() => parseOptions({ logLevel: "verbose" })).toThrow("plugboard option `logLevel` must be `debug`, `info`, `warn` or `error`")
    expect(() => parseOptions({ logLevel: 3 })).toThrow("`logLevel`")
  })

  test("logRequests must be a boolean", () => {
    expect(() => parseOptions({ logRequests: "no" })).toThrow("plugboard option `logRequests` must be a boolean")
  })
})

describe("#270 apps.<name>.maxN", () => {
  test("only lowers: a value above the global maxN is rejected at load and the message names the app option", () => {
    expect(() => parseOptions({ keys: { chat: "k" }, maxN: 2, apps: { chat: { maxN: 3 } } })).toThrow("`apps.chat.maxN` must be an integer between 1 and 2")
  })

  test("an in-range value is kept, and an app with only a maxN has a policy", () => {
    const options = parseOptions({ keys: { chat: "k" }, maxN: 4, apps: { chat: { maxN: 1 } } })
    expect(options.apps.chat).toMatchObject({ maxN: 1 })
    expect(maxNFor(options, "chat")).toBe(1)
  })

  test("without it, the app's cap is the global one", () => {
    const options = parseOptions({ keys: { chat: "k" }, maxN: 4 })
    expect(maxNFor(options, "chat")).toBe(4)
  })

  test("rejects a non-integer and zero", () => {
    expect(() => parseOptions({ keys: { chat: "k" }, apps: { chat: { maxN: 0 } } })).toThrow("`apps.chat.maxN`")
    expect(() => parseOptions({ keys: { chat: "k" }, apps: { chat: { maxN: 1.5 } } })).toThrow("`apps.chat.maxN`")
  })
})

describe("#265 apps.<name>.history", () => {
  test("parses its own fields and exposes the per-app map", () => {
    const options = parseOptions({ keys: { bot: "k1", coding: "k2" }, apps: { bot: { history: { maxSessions: 20 } }, coding: { history: { maxSessions: 5000, maxAgeDays: 180 } } } })
    expect(options.apps.bot).toMatchObject({ history: { maxSessions: 20 } })
    expect(appHistoryLimits(options)).toEqual({ bot: { maxSessions: 20 }, coding: { maxSessions: 5000, maxAgeDays: 180 } })
  })

  test("an app without the option is absent from the per-app map", () => {
    expect(appHistoryLimits(parseOptions({ keys: { bot: "k1" } }))).toEqual({})
  })

  test("rejects a zero, an out-of-range value, and an unknown field, each naming the app", () => {
    expect(() => parseOptions({ keys: { bot: "k" }, apps: { bot: { history: { maxSessions: 0 } } } })).toThrow("`apps.bot.history.maxSessions`")
    expect(() => parseOptions({ keys: { bot: "k" }, apps: { bot: { history: { maxAgeDays: 40_000 } } } })).toThrow("`apps.bot.history.maxAgeDays`")
    expect(() => parseOptions({ keys: { bot: "k" }, apps: { bot: { history: { keep: 1 } } } })).toThrow("`apps.bot.history.keep`")
  })
})

describe("#270 review NIT 8: maxN edge cases", () => {
  test("an app maxN equal to the global one is accepted, and 4 passes while 5 would not", () => {
    const options = parseOptions({ keys: { chat: "k" }, maxN: 4, apps: { chat: { maxN: 4 } } })
    expect(maxNFor(options, "chat")).toBe(4)
  })

  test("apps.default.maxN caps the keyless app (no keys)", () => {
    const options = parseOptions({ maxN: 3, apps: { default: { maxN: 2 } } })
    expect(maxNFor(options, "default")).toBe(2)
  })

  test("an unknown app, and an inherited name such as constructor, get the global cap", () => {
    const options = parseOptions({ keys: { chat: "k" }, maxN: 3, apps: { chat: { maxN: 1 } } })
    expect(maxNFor(options, "nobody")).toBe(3)
    expect(maxNFor(options, "constructor")).toBe(3)
  })
})

describe("reasoningOutput (since 0.36.0)", () => {
  test("defaults to off, so reasoning stays dropped", () => {
    expect(parseOptions({}).reasoningOutput).toBe(false)
  })

  test("true is kept, false is kept", () => {
    expect(parseOptions({ reasoningOutput: true }).reasoningOutput).toBe(true)
    expect(parseOptions({ reasoningOutput: false }).reasoningOutput).toBe(false)
  })

  test("must be a boolean, and the message names the option", () => {
    expect(() => parseOptions({ reasoningOutput: "yes" })).toThrow("plugboard option `reasoningOutput` must be a boolean")
  })

  test("per app: apps.<name>.reasoningOutput is kept, and must be a boolean", () => {
    expect(parseOptions({ keys: { a: "k" }, apps: { a: { reasoningOutput: false } } }).apps.a).toMatchObject({ reasoningOutput: false })
    expect(() => parseOptions({ keys: { a: "k" }, apps: { a: { reasoningOutput: 1 } } })).toThrow("plugboard option `apps.a.reasoningOutput` must be a boolean")
  })

  test("the effective value: the app's own value wins over the global one, both ways, and the global one applies when the app has none", () => {
    const options = parseOptions({
      keys: { off: "k1", on: "k2", none: "k3" },
      reasoningOutput: true,
      apps: { off: { reasoningOutput: false }, on: { reasoningOutput: true } },
    })
    expect(reasoningOutputFor(options, "off")).toBe(false)
    expect(reasoningOutputFor(options, "none")).toBe(true)
    expect(reasoningOutputFor(parseOptions({ keys: { on: "k2" }, apps: { on: { reasoningOutput: true } } }), "on")).toBe(true)
    expect(reasoningOutputFor(parseOptions({ keys: { none: "k3" } }), "none")).toBe(false)
    expect(reasoningOutputFor(options, "on")).toBe(true)
  })
})

describe("#391 fallbackAfterMs", () => {
  test("absent by default; set, it is the global first-event deadline", () => {
    expect(parseOptions({ models: ["a/*"] })).not.toHaveProperty("fallbackAfterMs")
    expect(() => parseOptions({ models: ["a/*"], fallbackAfterMs: 0 })).toThrow(/`fallbackAfterMs` must be an integer between 1/)
    expect(parseOptions({ models: ["a/*"], fallbackAfterMs: 1500 }).fallbackAfterMs).toBe(1500)
  })

  test("refused at load when it is not below requestTimeoutMs, which would never let it fire", () => {
    expect(() => parseOptions({ models: ["a/*"], requestTimeoutMs: 5000, fallbackAfterMs: 5000 })).toThrow(/must be below `requestTimeoutMs` \(5000\)/)
    expect(() => parseOptions({ models: ["a/*"], fallbackAfterMs: 600_000 })).toThrow(/must be below `requestTimeoutMs` \(600000\)/)
    expect(parseOptions({ models: ["a/*"], requestTimeoutMs: 5000, fallbackAfterMs: 4999 }).fallbackAfterMs).toBe(4999)
  })

  test("refused at load when an app's own requestTimeoutMs is not above it; the global deadline is checked against the app's too", () => {
    const base = { models: ["a/*"], keys: { bot: "k-bot" } }
    expect(() => parseOptions({ ...base, fallbackAfterMs: 1000, apps: { bot: { requestTimeoutMs: 1000 } } })).toThrow(/must be below `apps\.bot\.requestTimeoutMs` \(1000\)/)
    expect(parseOptions({ ...base, fallbackAfterMs: 1000, apps: { bot: { requestTimeoutMs: 5000 } } }).fallbackAfterMs).toBe(1000)
  })
})
