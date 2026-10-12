/**
 * The response cache wrapper (`src/cache.ts`) with a scripted model: what is served from memory and
 * what is stored, the key, the TTL (an injected clock), the entry and byte caps, and the callbacks a
 * hit replays. The route side (headers, n > 1) is in test/http/cache.test.ts.
 */
import { describe, expect, test } from "bun:test"
import { cachedCaller, cacheKey, createCacheStore, type CacheConfig, type Entry } from "../../src/cache.js"
import type { CallContext, ModelCaller, PlugEvent, PlugRequest, PolicyNote, ServedModel } from "../../src/contract.js"
import { createLimitState, withLimits } from "../../src/limits.js"
import { collect, ev, gate, plugRequest, until } from "../support/fixtures.js"
import { FakeModelCaller, type Script } from "../support/model-caller.js"

const CONFIG: CacheConfig = { ttlSeconds: 60, maxEntries: 100, maxBytes: 10_000_000 }
const store = (overrides: { ttlMs?: number; maxEntries?: number; maxBytes?: number } = {}) =>
  createCacheStore({ ttlMs: 60_000, maxEntries: 100, maxBytes: 10_000_000, ...overrides })

/** A context as the route passes it, with the callbacks recorded. */
function context(app = "default", extra: Partial<CallContext> = {}) {
  const seen = { cache: [] as string[], served: [] as ServedModel[], policy: [] as PolicyNote[][] }
  const ctx: CallContext = {
    app,
    signal: new AbortController().signal,
    onCache: (result) => void seen.cache.push(result),
    onServed: (served) => void seen.served.push(served),
    onPolicy: (notes) => void seen.policy.push([...notes]),
    ...extra,
  }
  return { ctx, seen }
}

const answer: Script = [ev.text("Hel"), ev.text("lo"), ev.finish("stop", { inputTokens: 10, outputTokens: 5 })]

describe("hits and misses", () => {
  test("the second identical request is answered from memory: one model call, the same text", async () => {
    const fake = new FakeModelCaller(answer)
    const cached = cachedCaller(fake, CONFIG, store())
    const { ctx, seen } = context()
    const first = await collect(cached.stream(plugRequest(), ctx))
    const second = await collect(cached.stream(plugRequest(), context().ctx))
    expect(fake.calls).toHaveLength(1)
    expect(first.map((event) => event.type)).toEqual(["text-delta", "text-delta", "finish"])
    expect(second).toEqual([{ type: "text-delta", text: "Hello" }, { type: "finish", reason: "stop", usage: { inputTokens: 0, outputTokens: 0 } }])
    expect(seen.cache).toEqual(["miss"])
  })

  test("onCache reports the result once, before the first event", async () => {
    const cached = cachedCaller(new FakeModelCaller(answer), CONFIG, store())
    const order: string[] = []
    const ctx: CallContext = { app: "default", signal: new AbortController().signal, onCache: (result) => void order.push(`cache:${result}`) }
    for await (const event of cached.stream(plugRequest(), ctx)) order.push(event.type)
    expect(order[0]).toBe("cache:miss")
    expect(order.slice(1)).toEqual(["text-delta", "text-delta", "finish"])
  })

})

describe("the key", () => {
  const base = plugRequest()
  const changed: Array<[string, PlugRequest]> = [
    ["a message", plugRequest({ messages: [{ role: "user", content: [{ type: "text", text: "bye" }] }] })],
    ["the system prompt", plugRequest({ system: ["Be brief."] })],
    ["the provider", plugRequest({ ref: { providerID: "other", id: "echo" } })],
    ["the model id", plugRequest({ ref: { providerID: "test", id: "vision" } })],
    ["the variant", plugRequest({ ref: { providerID: "test", id: "echo", variant: "high" } })],
    ["the temperature", plugRequest({ generation: { temperature: 0.7 } })],
    ["max tokens", plugRequest({ generation: { maxTokens: 9 } })],
    ["a tool", plugRequest({ tools: [{ name: "t", description: "", parameters: {} }] })],
    ["the tool choice", plugRequest({ toolChoice: "required" })],
    ["the stop sequences", plugRequest({ generation: { stop: ["END"] } })],
    ["top_p", plugRequest({ generation: { topP: 0.5 } })],
    ["presence_penalty", plugRequest({ generation: { presencePenalty: 0.5 } })],
    ["frequency_penalty", plugRequest({ generation: { frequencyPenalty: 0.5 } })],
    ["an image", plugRequest({ messages: [{ role: "user", content: [{ type: "media", url: "https://example.com/a.png" }] }] })],
  ]

  test.each(changed)("a different %s is a different entry", async (_, other) => {
    const fake = new FakeModelCaller(answer)
    const cached = cachedCaller(fake, CONFIG, store())
    await collect(cached.stream(base, context().ctx))
    await collect(cached.stream(other, context().ctx))
    expect(fake.calls).toHaveLength(2)
  })

  test("#278 an image with a different URL is a different entry", async () => {
    const image = (url: string) => plugRequest({ messages: [{ role: "user", content: [{ type: "media", url }] }] })
    const fake = new FakeModelCaller(answer)
    const cached = cachedCaller(fake, CONFIG, store())
    await collect(cached.stream(image("https://example.com/a.png"), context().ctx))
    await collect(cached.stream(image("https://example.com/b.png"), context().ctx))
    expect(fake.calls).toHaveLength(2)
  })

  test("#278 the end user is not part of the key: two users with identical content share one entry", async () => {
    const fake = new FakeModelCaller(answer)
    const cached = cachedCaller(fake, CONFIG, store())
    await collect(cached.stream(plugRequest({ user: "alice" }), context().ctx))
    const { ctx, seen } = context()
    await collect(cached.stream(plugRequest({ user: "bob" }), ctx))
    expect(fake.calls).toHaveLength(1)
    expect(seen.cache).toEqual(["hit"])
  })

  test("the alias string the caller sent is not part of the key: two names for one model share an entry", async () => {
    const fake = new FakeModelCaller(answer)
    const cached = cachedCaller(fake, CONFIG, store())
    await collect(cached.stream(plugRequest({ model: "fast" }), context().ctx))
    const { ctx, seen } = context()
    await collect(cached.stream(plugRequest({ model: "test/echo" }), ctx))
    expect(fake.calls).toHaveLength(1)
    expect(seen.cache).toEqual(["hit"])
  })

  test("object key order does not change the key", () => {
    const a = plugRequest({ tools: [{ name: "t", description: "d", parameters: { type: "object", properties: { a: { type: "string" } } } }] })
    const b = plugRequest({ tools: [{ parameters: { properties: { a: { type: "string" } }, type: "object" }, description: "d", name: "t" }] })
    expect(cacheKey("default", a)).toBe(cacheKey("default", b))
    expect(cacheKey("default", base)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("#278 maxBytes counts the per-entry overhead", () => {
  test("an entry whose JSON is just under maxBytes is rejected, because the 128-byte overhead is added to its size", () => {
    const entry: Entry = { events: [{ type: "text-delta", text: "x".repeat(1000) }, { type: "finish", reason: "stop" }] }
    const payload = Buffer.byteLength(JSON.stringify(entry))
    const tight = store({ maxBytes: payload + 100 })
    tight.set("k", entry)
    expect(tight.get("k")).toBeUndefined()
    const roomy = store({ maxBytes: payload + 128 })
    roomy.set("k", entry)
    expect(roomy.get("k")).toEqual(entry)
  })
})

describe("apps", () => {
  test("apps never share entries", async () => {
    const fake = new FakeModelCaller(answer)
    const cached = cachedCaller(fake, CONFIG, store())
    await collect(cached.stream(plugRequest(), context("alpha").ctx))
    await collect(cached.stream(plugRequest(), context("beta").ctx))
    expect(fake.calls).toHaveLength(2)
  })

  test("with `apps`, an app outside the list bypasses the cache: no read, no write, no onCache", async () => {
    const fake = new FakeModelCaller(answer)
    const kept = store()
    const cached = cachedCaller(fake, { ...CONFIG, apps: ["alpha"] }, kept)
    const { ctx, seen } = context("beta")
    await collect(cached.stream(plugRequest(), ctx))
    await collect(cached.stream(plugRequest(), ctx))
    expect(fake.calls).toHaveLength(2)
    expect(seen.cache).toEqual([])
    expect(kept.size()).toBe(0)
  })

  test("with `apps`, a listed app is cached", async () => {
    const fake = new FakeModelCaller(answer)
    const cached = cachedCaller(fake, { ...CONFIG, apps: ["alpha"] }, store())
    await collect(cached.stream(plugRequest(), context("alpha").ctx))
    await collect(cached.stream(plugRequest(), context("alpha").ctx))
    expect(fake.calls).toHaveLength(1)
  })
})

describe("noCache", () => {
  test("a call with noCache neither reads nor writes the cache", async () => {
    const fake = new FakeModelCaller(answer)
    const kept = store()
    const cached = cachedCaller(fake, CONFIG, kept)
    const { ctx, seen } = context("default", { noCache: true })
    await collect(cached.stream(plugRequest(), ctx))
    await collect(cached.stream(plugRequest(), ctx))
    expect(fake.calls).toHaveLength(2)
    expect(kept.size()).toBe(0)
    expect(seen.cache).toEqual([])
  })

  test("a normal call after noCache calls is a miss: nothing was stored", async () => {
    const fake = new FakeModelCaller(answer)
    const cached = cachedCaller(fake, CONFIG, store())
    await collect(cached.stream(plugRequest(), context("default", { noCache: true }).ctx))
    await collect(cached.stream(plugRequest(), context().ctx))
    expect(fake.calls).toHaveLength(2)
  })
})

describe("what is stored", () => {
  const notStored: Array<[string, Script]> = [
    ["a tool call", [ev.call("c1", "lookup", { q: 1 }), ev.finish("tool-calls")]],
    ["a tool call that ends with stop", [ev.text("x"), ev.call("c1", "lookup", {}), ev.finish("stop")]],
    ["an error", [ev.error()]],
    ["text followed by an error", [ev.text("partial"), ev.error(), ev.finish("stop")]],
    ["a content filter finish", [ev.text("no"), ev.finish("content-filter")]],
    ["an error finish", [ev.text("no"), ev.finish("error")]],
    ["an empty answer", [ev.finish("stop")]],
    ["a stream that ends without a finish", [ev.text("cut off")]],
    ["a thrown call", [{ throw: new Error("boom") }]],
  ]

  test.each(notStored)("%s is not stored: the next identical request calls the model again", async (_, script) => {
    const fake = new FakeModelCaller(script)
    const kept = store()
    const cached = cachedCaller(fake, CONFIG, kept)
    await collect(cached.stream(plugRequest(), context().ctx)).catch(() => undefined)
    await collect(cached.stream(plugRequest(), context().ctx)).catch(() => undefined)
    expect(fake.calls).toHaveLength(2)
    expect(kept.size()).toBe(0)
  })

  test("a length finish is stored (the answer is complete as far as the model gave one)", async () => {
    const fake = new FakeModelCaller([ev.text("long"), ev.finish("length")])
    const cached = cachedCaller(fake, CONFIG, store())
    await collect(cached.stream(plugRequest(), context().ctx))
    await collect(cached.stream(plugRequest(), context().ctx))
    expect(fake.calls).toHaveLength(1)
  })

  test("reasoning and text are replayed in order, with same-kind deltas merged", async () => {
    const fake = new FakeModelCaller([ev.reasoning("th"), ev.reasoning("ink"), ev.text("A"), ev.reasoning("!"), ev.finish()])
    const cached = cachedCaller(fake, CONFIG, store())
    await collect(cached.stream(plugRequest(), context().ctx))
    const replay = await collect(cached.stream(plugRequest(), context().ctx))
    expect(replay).toEqual([
      { type: "reasoning-delta", text: "think" },
      { type: "text-delta", text: "A" },
      { type: "reasoning-delta", text: "!" },
      { type: "finish", reason: "stop", usage: { inputTokens: 0, outputTokens: 0 } },
    ])
  })

  test("#146 a reasoning signature is replayed as its own event, after the block it closes", async () => {
    const signed: PlugEvent = { type: "reasoning-delta", text: "", signature: "sig" }
    const fake = new FakeModelCaller([ev.reasoning("th"), signed, ev.text("A"), ev.finish()])
    const cached = cachedCaller(fake, CONFIG, store())
    await collect(cached.stream(plugRequest(), context().ctx))
    const replay = await collect(cached.stream(plugRequest(), context().ctx))
    expect(replay).toEqual([
      { type: "reasoning-delta", text: "th" },
      { type: "reasoning-delta", text: "", signature: "sig" },
      { type: "text-delta", text: "A" },
      { type: "finish", reason: "stop", usage: { inputTokens: 0, outputTokens: 0 } },
    ])
  })

  test("an aborted turn is not stored, and a later complete one is", async () => {
    const controller = new AbortController()
    const kept = store()
    const stalled = new FakeModelCaller([ev.text("x"), { wait: new Promise(() => {}) }, ev.finish()])
    const pending = collect(cachedCaller(stalled, CONFIG, kept).stream(plugRequest(), { app: "default", signal: controller.signal }))
    controller.abort()
    await pending.catch(() => undefined)
    expect(kept.size()).toBe(0)
    await collect(cachedCaller(new FakeModelCaller(answer), CONFIG, kept).stream(plugRequest(), context().ctx))
    expect(kept.size()).toBe(1)
  })

  test("a consumer that stops reading before the finish stores nothing", async () => {
    const fake = new FakeModelCaller(answer)
    const kept = store()
    const cached = cachedCaller(fake, CONFIG, kept)
    for await (const event of cached.stream(plugRequest(), context().ctx)) {
      if (event.type === "text-delta") break
    }
    expect(kept.size()).toBe(0)
  })

  test("a hit whose signal is already aborted replays nothing", async () => {
    const fake = new FakeModelCaller(answer)
    const cached = cachedCaller(fake, CONFIG, store())
    await collect(cached.stream(plugRequest(), context().ctx))
    const controller = new AbortController()
    controller.abort()
    expect(await collect(cached.stream(plugRequest(), { app: "default", signal: controller.signal }))).toEqual([])
  })
})

describe("replayed callbacks", () => {
  test("a hit replays onServed (the target that answered) and onPolicy (the notes), before the first event", async () => {
    const served: ServedModel = { model: "test/vision", fallbacks: 1 }
    const fallbackCaller: ModelCaller = {
      stream(_request, context) {
        return (async function* (): AsyncGenerator<PlugEvent> {
          context.onServed?.(served)
          context.onPolicy?.(["tools-stripped"])
          yield ev.text("from the second target")
          yield ev.finish()
        })()
      },
    }
    const cached = cachedCaller(fallbackCaller, CONFIG, store())
    await collect(cached.stream(plugRequest({ model: "fast" }), context().ctx))
    const { ctx, seen } = context()
    const replay = await collect(cached.stream(plugRequest({ model: "fast" }), ctx))
    expect(seen.served).toEqual([served])
    expect(seen.policy).toEqual([["tools-stripped"]])
    expect(replay[0]).toEqual({ type: "text-delta", text: "from the second target" })
  })

  test("the miss still reports onServed and onPolicy to the route", async () => {
    const fake = new FakeModelCaller((_request, call) => (call === 0 ? [{ policy: ["tools-stripped"] }, ev.finish()] : [ev.finish()]))
    const cached = cachedCaller(fake, CONFIG, store())
    const { ctx, seen } = context()
    await collect(cached.stream(plugRequest(), ctx))
    expect(seen.policy).toEqual([["tools-stripped"]])
  })
})

describe("TTL and caps", () => {
  // A short real TTL: lru-cache's injected `perf` clock does not advance its expiry check after the first read.
  test("an entry is served within its TTL and missed after it", async () => {
    const fake = new FakeModelCaller(answer)
    const cached = cachedCaller(fake, CONFIG, store({ ttlMs: 40 }))
    await collect(cached.stream(plugRequest(), context().ctx))
    await collect(cached.stream(plugRequest(), context().ctx))
    expect(fake.calls).toHaveLength(1)
    await Bun.sleep(80)
    await collect(cached.stream(plugRequest(), context().ctx))
    expect(fake.calls).toHaveLength(2)
  })

  test("maxEntries keeps the newest entries and evicts the least recently used", async () => {
    const fake = new FakeModelCaller((request) => [ev.text(request.messages[0]!.content[0]!.type === "text" ? "x" : ""), ev.finish()])
    const kept = store({ maxEntries: 2 })
    const cached = cachedCaller(fake, CONFIG, kept)
    const ask = (text: string) => collect(cached.stream(plugRequest({ messages: [{ role: "user", content: [{ type: "text", text }] }] }), context().ctx))
    await ask("one")
    await ask("two")
    await ask("one") // refresh "one": "two" is now the least recently used
    await ask("three")
    expect(kept.size()).toBe(2)
    expect(fake.calls).toHaveLength(3)
    await ask("one")
    expect(fake.calls).toHaveLength(3)
    await ask("two")
    expect(fake.calls).toHaveLength(4)
  })

  test("maxBytes evicts until the entries fit", async () => {
    const big = (text: string) => [ev.text(text.repeat(400)), ev.finish()] as Script
    const fake = new FakeModelCaller((request) => big(request.messages[0]!.content[0]!.type === "text" ? "a" : ""))
    const kept = store({ maxBytes: 1_500 })
    const cached = cachedCaller(fake, CONFIG, kept)
    for (const text of ["p", "q", "r", "s"]) await collect(cached.stream(plugRequest({ messages: [{ role: "user", content: [{ type: "text", text }] }] }), context().ctx))
    expect(kept.size()).toBeGreaterThan(0)
    expect(kept.size()).toBeLessThan(4)
  })

  test("an answer bigger than maxBytes is served but not stored", async () => {
    const fake = new FakeModelCaller([ev.text("y".repeat(5_000)), ev.finish()])
    const kept = store({ maxBytes: 300 })
    const cached = cachedCaller(fake, CONFIG, kept)
    const { ctx } = context()
    const first = await collect(cached.stream(plugRequest(), ctx))
    expect(first[0]).toEqual({ type: "text-delta", text: "y".repeat(5_000) })
    await collect(cached.stream(plugRequest(), context().ctx))
    expect(fake.calls).toHaveLength(2)
    expect(kept.size()).toBe(0)
  })
  test("#153 capture stops once the answer passes maxBytes, even when the store itself would hold it", async () => {
    // The store's cap is large; only the config's (the capture budget) is over.
    const fake = new FakeModelCaller([ev.text("y".repeat(200)), ev.text("y".repeat(200)), ev.finish()])
    const kept = store()
    const cached = cachedCaller(fake, { ...CONFIG, maxBytes: 300 }, kept)
    const first = await collect(cached.stream(plugRequest(), context().ctx))
    expect(first).toHaveLength(3)
    expect(kept.size()).toBe(0)
    await collect(cached.stream(plugRequest(), context().ctx))
    expect(fake.calls).toHaveLength(2)
  })
})

describe("stored events", () => {
  test("a stored finish drops the usage of the miss", async () => {
    const fake = new FakeModelCaller([ev.text("x"), ev.finish("stop", { inputTokens: 99, outputTokens: 42 })])
    const cached = cachedCaller(fake, CONFIG, store())
    const first = await collect(cached.stream(plugRequest(), context().ctx))
    expect(first.at(-1)).toEqual({ type: "finish", reason: "stop", usage: { inputTokens: 99, outputTokens: 42 } })
    const replay = await collect(cached.stream(plugRequest(), context().ctx))
    expect(replay.at(-1)).toEqual({ type: "finish", reason: "stop", usage: { inputTokens: 0, outputTokens: 0 } })
  })
})

describe("#154 a hit takes no concurrency slot and no rate window count", () => {
  // The order index.ts builds: the cache outside the limiter. A miss is limited; a hit is answered before the limiter.
  const other = plugRequest({ messages: [{ role: "user", content: [{ type: "text", text: "another prompt" }] }] })

  test("a hit is answered while a miss holds the app's only concurrency slot", async () => {
    const fake = new FakeModelCaller(answer)
    const hold = gate()
    let calls = 0
    const gated: ModelCaller = {
      async *stream(request, callContext) {
        calls++
        if (calls === 2) await hold.promise
        yield* fake.stream(request, callContext)
      },
    }
    const cached = cachedCaller(withLimits(gated, () => ({ maxConcurrent: 1 }), createLimitState()), CONFIG, store())
    await collect(cached.stream(plugRequest(), context().ctx))
    const slow = collect(cached.stream(other, context().ctx))
    await until(() => calls === 2, 1_000, "the second miss to take the slot")

    const hit = await collect(cached.stream(plugRequest(), context().ctx))
    expect(hit.map((event) => event.type)).toEqual(["text-delta", "finish"]) // the replay coalesces same-kind deltas
    hold.open()
    expect((await slow).some((event) => event.type === "error")).toBe(false)
    expect(fake.calls).toHaveLength(2)
  })

  test("a rate window counts only misses: repeated hits pass, and the next new prompt is refused", async () => {
    const fake = new FakeModelCaller(answer)
    const cached = cachedCaller(withLimits(fake, () => ({ perApp: { requestsPerMinute: 1 } }), createLimitState()), CONFIG, store())
    await collect(cached.stream(plugRequest(), context().ctx))
    for (let i = 0; i < 3; i++) expect((await collect(cached.stream(plugRequest(), context().ctx))).some((event) => event.type === "error")).toBe(false)
    expect(await collect(cached.stream(other, context().ctx))).toEqual([{ type: "error", error: expect.objectContaining({ status: 429, code: "rate_limit_exceeded" }) }])
    expect(fake.calls).toHaveLength(1) // the refused prompt never reached the model
  })
})
