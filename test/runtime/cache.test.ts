/**
 * The process-wide response cache (src/runtime.ts `withResponseCache`): one store shared by every
 * generation, replaced when the cache option or the `apps` policy changes, and counted in the
 * process metrics only when option `metrics` is on. Config parsing for `cache` is here too.
 */
import { describe, expect, test } from "bun:test"
import { parseOptions } from "../../src/config.js"
import { withResponseCache, processMetrics } from "../../src/runtime.js"
import { collect, ev, plugRequest, testOptions } from "../support/fixtures.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { isolateRuntime } from "../support/runtime.js"

isolateRuntime()

const ctx = (app = "default") => ({ app, signal: new AbortController().signal })
const answer = [ev.text("hi"), ev.finish()]
const cache = { ttlSeconds: 60 }

describe("the store", () => {
  test("without option `cache` the caller is returned unchanged", () => {
    const fake = new FakeModelCaller(answer)
    expect(withResponseCache(fake, testOptions())).toBe(fake)
  })

  test("two generations with the same options share one store: the second generation's call is a hit", async () => {
    const fake = new FakeModelCaller(answer)
    const options = testOptions({ cache })
    await collect(withResponseCache(fake, options).stream(plugRequest(), ctx()))
    await collect(withResponseCache(fake, options).stream(plugRequest(), ctx()))
    expect(fake.calls).toHaveLength(1)
  })

  test("#82 an app with serverTools is never answered from the cache, so each request reaches the model", async () => {
    const fake = new FakeModelCaller(answer)
    const options = testOptions({ keys: { bot: "k" }, apps: { bot: { serverTools: ["websearch"] } }, cache })
    await collect(withResponseCache(fake, options).stream(plugRequest(), ctx("bot")))
    await collect(withResponseCache(fake, options).stream(plugRequest(), ctx("bot")))
    expect(fake.calls).toHaveLength(2)
  })

  test("#278 a persona model (a skill alias or an agent) is never answered from the cache; a plain alias is", async () => {
    const options = testOptions({ cache, aliases: { "invoice-parser": "skill:invoice-parser@test/echo", fast: "test/echo" }, agents: [{ name: "reviewer", model: "test/echo" }] })
    for (const model of ["invoice-parser", "agent/reviewer"]) {
      const fake = new FakeModelCaller(answer)
      await collect(withResponseCache(fake, options).stream(plugRequest({ model }), ctx()))
      await collect(withResponseCache(fake, options).stream(plugRequest({ model }), ctx()))
      expect(fake.calls).toHaveLength(2)
    }
    const plain = new FakeModelCaller(answer)
    await collect(withResponseCache(plain, options).stream(plugRequest({ model: "fast" }), ctx()))
    await collect(withResponseCache(plain, options).stream(plugRequest({ model: "fast" }), ctx()))
    expect(plain.calls).toHaveLength(1)
  })

  test("a changed `apps` policy starts a fresh store, because the key does not cover policy", async () => {
    const fake = new FakeModelCaller(answer)
    await collect(withResponseCache(fake, testOptions({ cache })).stream(plugRequest(), ctx()))
    const changed = testOptions({ cache, apps: { default: { system: "Answer in French.", systemMode: "append", tools: true } } })
    await collect(withResponseCache(fake, changed).stream(plugRequest(), ctx()))
    expect(fake.calls).toHaveLength(2)
  })

  test("a changed cache option starts a fresh store", async () => {
    const fake = new FakeModelCaller(answer)
    await collect(withResponseCache(fake, testOptions({ cache })).stream(plugRequest(), ctx()))
    await collect(withResponseCache(fake, testOptions({ cache: { ttlSeconds: 61 } })).stream(plugRequest(), ctx()))
    expect(fake.calls).toHaveLength(2)
  })

  test("a rejected generation's wrapper never replaces the live store: it is resolved on the first call only", async () => {
    const fake = new FakeModelCaller(answer)
    const live = testOptions({ cache })
    await collect(withResponseCache(fake, live).stream(plugRequest(), ctx()))
    // Built with other options but never called: must not reset the store.
    withResponseCache(fake, testOptions({ cache: { ttlSeconds: 5 } }))
    await collect(withResponseCache(fake, live).stream(plugRequest(), ctx()))
    expect(fake.calls).toHaveLength(1)
  })
})

describe("metrics", () => {
  const snapshot = { generations: 1, pumpRunning: false, guards: 0, startedAt: 0 }

  test("with option `metrics`, hits and misses are counted by app and result", async () => {
    const fake = new FakeModelCaller(answer)
    const wrapped = withResponseCache(fake, testOptions({ cache, metrics: true }))
    await collect(wrapped.stream(plugRequest(), ctx("poller")))
    await collect(wrapped.stream(plugRequest(), ctx("poller")))
    const text = await processMetrics().render(snapshot)
    expect(text).toContain('plugboard_cache_requests_total{app="poller",result="miss"} 1')
    expect(text).toContain('plugboard_cache_requests_total{app="poller",result="hit"} 1')
  })

  test("without option `metrics` nothing is counted", async () => {
    const fake = new FakeModelCaller(answer)
    const wrapped = withResponseCache(fake, testOptions({ cache }))
    await collect(wrapped.stream(plugRequest(), ctx("quiet")))
    const text = await processMetrics().render(snapshot)
    expect(text).not.toContain('app="quiet"')
  })
})

describe("option `cache`", () => {
  test("off when absent", () => {
    expect(parseOptions({}).cache).toBeUndefined()
  })

  test("defaults: 1000 entries and 64 MiB", () => {
    expect(parseOptions({ cache: { ttlSeconds: 30 } }).cache).toEqual({ ttlSeconds: 30, maxEntries: 1000, maxBytes: 67_108_864 })
  })

  test("the listed apps are kept, deduplicated", () => {
    expect(parseOptions({ keys: { poller: "k-poller" }, cache: { ttlSeconds: 1, apps: ["poller", "poller"] } }).cache?.apps).toEqual(["poller"])
  })

  test.each([
    ["no ttlSeconds", { cache: {} }, "`cache.ttlSeconds` is required"],
    ["a zero ttl", { cache: { ttlSeconds: 0 } }, "`cache.ttlSeconds` must be an integer between 1 and"],
    ["a fractional ttl", { cache: { ttlSeconds: 1.5 } }, "`cache.ttlSeconds` must be an integer"],
    ["a ttl above a year", { cache: { ttlSeconds: 31_536_001 } }, "`cache.ttlSeconds` must be an integer between 1 and 31536000"],
    ["an unknown field", { cache: { ttlSeconds: 1, nope: 1 } }, "Unknown plugboard option `cache.nope`"],
    ["a non-object", { cache: 5 }, "`cache` must be an object"],
    ["an empty apps list", { cache: { ttlSeconds: 1, apps: [] } }, "`cache.apps` must be a non-empty array"],
    ["an app that is not configured", { cache: { ttlSeconds: 1, apps: ["ghost"] } }, "`cache.apps` entry `ghost` is not an app"],
    ["a zero byte cap", { cache: { ttlSeconds: 1, maxBytes: 0 } }, "`cache.maxBytes` must be an integer"],
  ])("rejects %s", (_, raw, message) => {
    expect(() => parseOptions(raw)).toThrow(message)
  })
})
