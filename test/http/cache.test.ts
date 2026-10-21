/**
 * The response cache over the real routes (loopback HTTP, scripted model): `x-plugboard-cache` on
 * every front-end, a second identical request answered from memory with zero usage and no new
 * session, the replayed policy header, and `n > 1` never cached. The wrapper is `cachedCaller`
 * directly (the runtime wiring is in test/runtime/).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cachedCaller, createCacheStore, type CacheConfig } from "../../src/cache.js"
import { withUsage, type UsageRecorder } from "../../src/usage.js"
import { ev } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { sseData, startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller, type Script } from "../support/model-caller.js"

captureLogs()
let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const CONFIG: CacheConfig = { ttlSeconds: 60, maxEntries: 100, maxBytes: 10_000_000 }

/** A route whose model caller is wrapped by the cache, as `index.ts` wires it. */
async function cachedRoute(script: Script | ((call: number) => Script), options: Record<string, unknown> = {}, config: CacheConfig = CONFIG) {
  const fake = new FakeModelCaller(typeof script === "function" ? (_request, call) => script(call) : script)
  const caller = cachedCaller(fake, config, createCacheStore({ ttlMs: config.ttlSeconds * 1000, maxEntries: config.maxEntries, maxBytes: config.maxBytes }))
  server = await startRoute({ caller, options: { maxChoices: 2, aliases: { fast: "test/echo" }, ...options } })
  return fake
}

const chat = (body: Record<string, unknown> = {}): SendInit => ({
  method: "POST",
  path: "/v1/chat/completions",
  body: { model: "test/echo", messages: [{ role: "user", content: "hi" }], ...body },
})
const responses = (body: Record<string, unknown> = {}): SendInit => ({ method: "POST", path: "/v1/responses", body: { model: "test/echo", input: "hi", ...body } })
const messages = (body: Record<string, unknown> = {}): SendInit => ({
  method: "POST",
  path: "/v1/messages",
  body: { model: "test/echo", max_tokens: 64, messages: [{ role: "user", content: "hi" }], ...body },
})
const gemini = (body: Record<string, unknown> = {}, path = "/v1beta/models/fast:generateContent"): SendInit => ({
  method: "POST",
  path,
  body: { contents: [{ role: "user", parts: [{ text: "hi" }] }], ...body },
})

const answer: Script = [ev.text("Hello"), ev.finish("stop", { inputTokens: 3, outputTokens: 2 })]

describe("x-plugboard-cache on every front-end", () => {
  const cases: Array<[string, (body?: Record<string, unknown>) => SendInit]> = [
    ["Chat Completions", chat],
    ["Responses", responses],
    ["Anthropic Messages", messages],
    ["Gemini", (body) => gemini(body)],
  ]

  test.each(cases)("%s: miss, then hit with the same body and no new model call", async (_, request) => {
    const fake = await cachedRoute(answer)
    const first = await server!.send(request())
    const second = await server!.send(request())
    expect(first.status).toBe(200)
    expect(first.headers["x-plugboard-cache"]).toBe("miss")
    expect(second.status).toBe(200)
    expect(second.headers["x-plugboard-cache"]).toBe("hit")
    expect(fake.calls).toHaveLength(1)
  })

  test("Chat Completions: the hit's usage is zero and the text is the stored one", async () => {
    await cachedRoute(answer)
    const first = await server!.send(chat())
    const second = await server!.send(chat())
    expect(first.json()).toMatchObject({ choices: [{ message: { content: "Hello" }, finish_reason: "stop" }], usage: { total_tokens: 5 } })
    expect(second.json()).toMatchObject({ choices: [{ message: { content: "Hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } })
  })

  test("Responses: the hit reports zero usage", async () => {
    await cachedRoute(answer)
    await server!.send(responses())
    const second = await server!.send(responses())
    expect(second.headers["x-plugboard-cache"]).toBe("hit")
    expect(second.json()).toMatchObject({ output: [{ content: [{ text: "Hello" }] }], usage: { total_tokens: 0 } })
  })

  test("Gemini: the hit reports zero token usage", async () => {
    await cachedRoute(answer)
    await server!.send(gemini())
    const second = await server!.send(gemini())
    expect(second.headers["x-plugboard-cache"]).toBe("hit")
    expect(second.json()).toMatchObject({ candidates: [{ content: { parts: [{ text: "Hello" }] } }], usageMetadata: { totalTokenCount: 0 } })
  })

  test("Anthropic Messages: the hit reports zero output tokens", async () => {
    await cachedRoute(answer)
    await server!.send(messages())
    const second = await server!.send(messages())
    expect(second.headers["x-plugboard-cache"]).toBe("hit")
    expect(second.json()).toMatchObject({ content: [{ type: "text", text: "Hello" }], usage: { output_tokens: 0 } })
  })
})

describe("streams", () => {
  test.each([
    ["Responses", (body: Record<string, unknown>) => responses({ ...body, stream: true }), "Hello"],
    ["Anthropic Messages", (body: Record<string, unknown>) => messages({ ...body, stream: true }), "Hello"],
    ["Gemini", (body: Record<string, unknown>) => gemini(body, "/v1beta/models/fast:streamGenerateContent?alt=sse"), "Hello"],
  ])("#278 %s: a streamed hit replays the stored text with no new model call", async (_, request, text) => {
    const fake = await cachedRoute([ev.text("Hel"), ev.text("lo"), ev.finish()])
    await server!.send(request({}))
    const hit = await server!.send(request({}))
    expect(hit.status).toBe(200)
    expect(hit.headers["x-plugboard-cache"]).toBe("hit")
    expect(hit.text).toContain(text)
    expect(fake.calls).toHaveLength(1)
  })

  test("a streamed hit replays the same text as one delta, then the finish, and [DONE]", async () => {
    const fake = await cachedRoute([ev.text("Hel"), ev.text("lo"), ev.finish()])
    await server!.send(chat({ stream: true, stream_options: { include_usage: true } }))
    const hit = await server!.send(chat({ stream: true, stream_options: { include_usage: true } }))
    expect(hit.headers["x-plugboard-cache"]).toBe("hit")
    const text = sseData(hit.text)
    const content = text.map((chunk) => chunk.choices?.[0]?.delta?.content).filter((piece) => typeof piece === "string" && piece !== "")
    expect(content).toEqual(["Hello"])
    expect(text.at(-1)).toMatchObject({ usage: { total_tokens: 0 } })
    expect(fake.calls).toHaveLength(1)
  })
})

describe("#278 keys across routes and wire options", () => {
  test("the same app and resolved request on Chat Completions, then Messages, share one entry", async () => {
    const fake = await cachedRoute(answer)
    const first = await server!.send(chat({ max_tokens: 64 }))
    const second = await server!.send(messages())
    expect(first.headers["x-plugboard-cache"]).toBe("miss")
    expect(second.headers["x-plugboard-cache"]).toBe("hit")
    expect(fake.calls).toHaveLength(1)
  })

  test("response_format json_object and json_schema are different entries", async () => {
    const fake = await cachedRoute(answer)
    await server!.send(chat({ response_format: { type: "json_object" } }))
    await server!.send(chat({ response_format: { type: "json_schema", json_schema: { name: "reply", schema: { type: "object" } } } }))
    expect(fake.calls).toHaveLength(2)
  })

  test("a non-streaming hit carries x-plugboard-usage with zero tokens (usage recording on)", async () => {
    const fake = new FakeModelCaller(answer)
    const cached = cachedCaller(fake, CONFIG, createCacheStore({ ttlMs: 60_000, maxEntries: 100, maxBytes: 10_000_000 }))
    const priced = { call: () => {}, price: async () => 0 } as unknown as UsageRecorder
    server = await startRoute({ caller: withUsage(cached, priced), options: { aliases: { fast: "test/echo" } } })
    await server!.send(chat())
    const hit = await server!.send(chat())
    expect(hit.headers["x-plugboard-cache"]).toBe("hit")
    expect(hit.headers["x-plugboard-usage"]).toBe("input=0; output=0; cache_read=0; cache_write=0; cost_usd=0.000000")
    expect(fake.calls).toHaveLength(1)
  })
})

describe("what a hit does not do", () => {
  test("a hit writes no history record: no x-plugboard-session header, while the miss has one", async () => {
    await cachedRoute([{ record: "ses_cached" }, ev.text("x"), ev.finish()])
    const miss = await server!.send(chat())
    const hit = await server!.send(chat())
    expect(miss.headers["x-plugboard-session"]).toBe("ses_cached")
    expect(hit.headers["x-plugboard-session"]).toBeUndefined()
  })

  test("the policy header of the miss is replayed on the hit", async () => {
    await cachedRoute([{ policy: ["tools-stripped"] }, ev.text("x"), ev.finish()])
    const miss = await server!.send(chat())
    const hit = await server!.send(chat())
    expect(miss.headers["x-plugboard-policy"]).toBe("tools-stripped")
    expect(hit.headers["x-plugboard-policy"]).toBe("tools-stripped")
  })

  test("a tool-call answer is a miss every time and carries no hit", async () => {
    const fake = await cachedRoute([ev.call("c1", "lookup", { q: 1 }), ev.finish("tool-calls")])
    const first = await server!.send(chat({ tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }] }))
    const second = await server!.send(chat({ tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }] }))
    expect(first.headers["x-plugboard-cache"]).toBe("miss")
    expect(second.headers["x-plugboard-cache"]).toBe("miss")
    expect(fake.calls).toHaveLength(2)
  })

  test("a provider error is not stored: the retry calls the model", async () => {
    const fake = await cachedRoute((call) => (call === 0 ? [ev.error({ status: 503, kind: "server", message: "down" })] : answer))
    const failed = await server!.send(chat())
    expect(failed.status).toBe(503)
    const ok = await server!.send(chat())
    expect(ok.status).toBe(200)
    expect(ok.headers["x-plugboard-cache"]).toBe("miss")
    expect(fake.calls).toHaveLength(2)
  })
})

describe("n above 1", () => {
  test("every choice is a fresh call, the response has no cache header, and nothing is stored", async () => {
    const fake = await cachedRoute(answer)
    const first = await server!.send(chat({ n: 2 }))
    const second = await server!.send(chat({ n: 2 }))
    expect(first.status).toBe(200)
    expect(first.headers["x-plugboard-cache"]).toBeUndefined()
    expect(second.headers["x-plugboard-cache"]).toBeUndefined()
    expect(fake.calls).toHaveLength(4)
  })

  test("a single choice after an n > 1 call is a miss (the choices were not stored)", async () => {
    const fake = await cachedRoute(answer)
    await server!.send(chat({ n: 2 }))
    const single = await server!.send(chat())
    expect(single.headers["x-plugboard-cache"]).toBe("miss")
    expect(fake.calls).toHaveLength(3)
  })

  test("Gemini candidateCount 2 is the same: every candidate is a fresh call and nothing is stored", async () => {
    const fake = await cachedRoute(answer)
    const body = { generationConfig: { candidateCount: 2 } }
    const first = await server!.send(gemini(body))
    const second = await server!.send(gemini(body))
    expect(first.status).toBe(200)
    expect(first.headers["x-plugboard-cache"]).toBeUndefined()
    expect(second.headers["x-plugboard-cache"]).toBeUndefined()
    expect(fake.calls).toHaveLength(4)
    expect((await server!.send(gemini())).headers["x-plugboard-cache"]).toBe("miss")
  })
})

describe("the header", () => {
  test("without the cache wrapper there is no header at all", async () => {
    const fake = new FakeModelCaller(answer)
    server = await startRoute({ caller: fake })
    const reply = await server!.send(chat())
    expect(reply.headers["x-plugboard-cache"]).toBeUndefined()
  })
})

// ---------------------------------------------------------------- per-request cache headers

/** `request` with extra headers. */
const withHeaders = (init: SendInit, headers: Record<string, string>): SendInit => ({ ...init, headers: { ...init.headers, ...headers } })

/** Each call answers `answer <n>`, so a reply shows which model call produced it. */
const numbered = (call: number): Script => [ev.text(`answer ${call}`), ev.finish("stop")]

const FRONT_ENDS: Array<[string, (body?: Record<string, unknown>) => SendInit]> = [
  ["Chat Completions", chat],
  ["Responses", responses],
  ["Anthropic Messages", messages],
  ["Gemini", (body) => gemini(body)],
]

describe("x-plugboard-cache request header: bypass and refresh", () => {
  test.each(FRONT_ENDS)("%s: bypass skips the lookup and the store", async (_, request) => {
    const fake = await cachedRoute(numbered)
    expect((await server!.send(request())).headers["x-plugboard-cache"]).toBe("miss")
    const bypassed = await server!.send(withHeaders(request(), { "x-plugboard-cache": "bypass" }))
    expect(bypassed.status).toBe(200)
    expect(bypassed.headers["x-plugboard-cache"]).toBe("bypass")
    expect(bypassed.text).toContain("answer 1")
    // The stored answer is still the first one: the bypass did not replace it.
    const hit = await server!.send(request())
    expect(hit.headers["x-plugboard-cache"]).toBe("hit")
    expect(hit.text).toContain("answer 0")
    expect(fake.calls).toHaveLength(2)
  })

  test.each(FRONT_ENDS)("%s: a bypass with nothing stored stores nothing", async (_, request) => {
    const fake = await cachedRoute(numbered)
    expect((await server!.send(withHeaders(request(), { "x-plugboard-cache": "bypass" }))).headers["x-plugboard-cache"]).toBe("bypass")
    expect((await server!.send(request())).headers["x-plugboard-cache"]).toBe("miss")
    expect(fake.calls).toHaveLength(2)
  })

  test.each(FRONT_ENDS)("%s: refresh skips the lookup and stores the new answer", async (_, request) => {
    const fake = await cachedRoute(numbered)
    await server!.send(request())
    const refreshed = await server!.send(withHeaders(request(), { "x-plugboard-cache": "refresh" }))
    expect(refreshed.status).toBe(200)
    expect(refreshed.headers["x-plugboard-cache"]).toBe("refresh")
    expect(refreshed.text).toContain("answer 1")
    const hit = await server!.send(request())
    expect(hit.headers["x-plugboard-cache"]).toBe("hit")
    expect(hit.text).toContain("answer 1")
    expect(fake.calls).toHaveLength(2)
  })

  test("a streamed request reports bypass and refresh before the first byte", async () => {
    const fake = await cachedRoute(numbered)
    await server!.send(chat({ stream: true }))
    const bypassed = await server!.send(withHeaders(chat({ stream: true }), { "x-plugboard-cache": "bypass" }))
    expect(bypassed.headers["x-plugboard-cache"]).toBe("bypass")
    expect(bypassed.text).toContain("answer 1")
    const refreshed = await server!.send(withHeaders(chat({ stream: true }), { "x-plugboard-cache": "refresh" }))
    expect(refreshed.headers["x-plugboard-cache"]).toBe("refresh")
    expect(refreshed.text).toContain("answer 2")
    expect((await server!.send(chat({ stream: true }))).text).toContain("answer 2")
    expect(fake.calls).toHaveLength(3)
  })

  test("the legacy completions route honours the header too", async () => {
    const fake = await cachedRoute(numbered)
    const completion = (headers: Record<string, string> = {}): SendInit => ({ method: "POST", path: "/v1/completions", headers, body: { model: "test/echo", prompt: "hi" } })
    await server!.send(completion())
    expect((await server!.send(completion({ "x-plugboard-cache": "bypass" }))).headers["x-plugboard-cache"]).toBe("bypass")
    expect((await server!.send(completion())).headers["x-plugboard-cache"]).toBe("hit")
    expect(fake.calls).toHaveLength(2)
  })
})

describe("Cache-Control and the other gateways' names", () => {
  test.each([
    ["Cache-Control: no-store", { "cache-control": "no-store" }, "bypass"],
    ["Cache-Control: no-cache", { "cache-control": "no-cache" }, "refresh"],
    ["Cache-Control: max-age=0, no-cache", { "cache-control": "max-age=0, no-cache" }, "refresh"],
    ["x-portkey-cache-force-refresh: true", { "x-portkey-cache-force-refresh": "true" }, "refresh"],
    ["x-plugboard-cache wins over Cache-Control", { "x-plugboard-cache": "bypass", "cache-control": "no-cache" }, "bypass"],
  ] as const)("%s", async (_, headers, outcome) => {
    const fake = await cachedRoute(numbered)
    await server!.send(chat())
    const reply = await server!.send(withHeaders(chat(), headers))
    expect(reply.headers["x-plugboard-cache"]).toBe(outcome)
    expect(fake.calls).toHaveLength(2)
  })

  test.each([[{ "cache-control": "max-age=60" }], [{ "cache-control": "private" }], [{ "x-portkey-cache-force-refresh": "false" }]] as const)(
    "%j changes nothing: the answer is a hit",
    async (headers) => {
      const fake = await cachedRoute(numbered)
      await server!.send(chat())
      const reply = await server!.send(withHeaders(chat(), headers))
      expect(reply.headers["x-plugboard-cache"]).toBe("hit")
      expect(fake.calls).toHaveLength(1)
    },
  )
})

describe("x-plugboard-cache-namespace", () => {
  test.each(FRONT_ENDS)("%s: a namespace is a separate set of entries", async (_, request) => {
    const fake = await cachedRoute(numbered)
    const inNamespace = (name: string) => withHeaders(request(), { "x-plugboard-cache-namespace": name })
    expect((await server!.send(inNamespace("team-a"))).headers["x-plugboard-cache"]).toBe("miss")
    expect((await server!.send(inNamespace("team-b"))).headers["x-plugboard-cache"]).toBe("miss")
    expect((await server!.send(request())).headers["x-plugboard-cache"]).toBe("miss")
    expect(fake.calls).toHaveLength(3)
    const hit = await server!.send(inNamespace("team-a"))
    expect(hit.headers["x-plugboard-cache"]).toBe("hit")
    expect(hit.text).toContain("answer 0")
    expect((await server!.send(request())).text).toContain("answer 2")
    expect(fake.calls).toHaveLength(3)
  })

  test("bypass and refresh act inside their namespace only", async () => {
    const fake = await cachedRoute(numbered)
    const inNamespace = (name: string, extra: Record<string, string> = {}) => withHeaders(chat(), { "x-plugboard-cache-namespace": name, ...extra })
    await server!.send(inNamespace("a"))
    await server!.send(inNamespace("b"))
    expect((await server!.send(inNamespace("a", { "x-plugboard-cache": "refresh" }))).text).toContain("answer 2")
    expect((await server!.send(inNamespace("a"))).text).toContain("answer 2")
    // b keeps its own entry.
    expect((await server!.send(inNamespace("b"))).text).toContain("answer 1")
    expect(fake.calls).toHaveLength(3)
  })

  test("Portkey's and Helicone's names reach the same namespace", async () => {
    const fake = await cachedRoute(numbered)
    await server!.send(withHeaders(chat(), { "x-plugboard-cache-namespace": "shared" }))
    expect((await server!.send(withHeaders(chat(), { "x-portkey-cache-namespace": "shared" }))).headers["x-plugboard-cache"]).toBe("hit")
    expect((await server!.send(withHeaders(chat(), { "helicone-cache-seed": "shared" }))).headers["x-plugboard-cache"]).toBe("hit")
    expect(fake.calls).toHaveLength(1)
  })

  test("a namespace never reaches another app's entries", async () => {
    const fake = await cachedRoute(numbered, { keys: { one: "key-one", two: "key-two" } })
    const as = (key: string, namespace?: string) => withHeaders(chat(), { authorization: `Bearer ${key}`, ...(namespace ? { "x-plugboard-cache-namespace": namespace } : {}) })
    expect((await server!.send(as("key-one", "shared"))).headers["x-plugboard-cache"]).toBe("miss")
    // The same namespace and the same request under another app: its own entry.
    expect((await server!.send(as("key-two", "shared"))).headers["x-plugboard-cache"]).toBe("miss")
    // An app's namespace string equal to the other app's name is still only that app's.
    expect((await server!.send(as("key-two", "one"))).headers["x-plugboard-cache"]).toBe("miss")
    expect((await server!.send(as("key-one", "shared"))).headers["x-plugboard-cache"]).toBe("hit")
    expect((await server!.send(as("key-two", "shared"))).text).toContain("answer 1")
    expect(fake.calls).toHaveLength(3)
  })

  test("a refresh or a bypass by one app leaves another app's entry alone", async () => {
    const fake = await cachedRoute(numbered, { keys: { one: "key-one", two: "key-two" } })
    const as = (key: string, headers: Record<string, string> = {}) => withHeaders(chat(), { authorization: `Bearer ${key}`, ...headers })
    await server!.send(as("key-one"))
    await server!.send(as("key-two"))
    await server!.send(as("key-two", { "x-plugboard-cache": "refresh" }))
    expect((await server!.send(as("key-one"))).text).toContain("answer 0")
    expect((await server!.send(as("key-two"))).text).toContain("answer 2")
    expect(fake.calls).toHaveLength(3)
  })
})

describe("the headers apply only where the cache does", () => {
  test("an app outside `responseCache.apps` runs the model and reports nothing", async () => {
    const fake = await cachedRoute(numbered, { keys: { one: "key-one", two: "key-two" } }, { ...CONFIG, apps: ["one"] })
    const as = (key: string, headers: Record<string, string>) => withHeaders(chat(), { authorization: `Bearer ${key}`, ...headers })
    const sent: Array<Record<string, string>> = [{ "x-plugboard-cache": "bypass" }, { "x-plugboard-cache": "refresh" }, { "x-plugboard-cache-namespace": "n" }]
    for (const headers of sent) {
      const reply = await server!.send(as("key-two", headers))
      expect(reply.status).toBe(200)
      expect(reply.headers["x-plugboard-cache"]).toBeUndefined()
    }
    expect(fake.calls).toHaveLength(3)
    expect((await server!.send(as("key-one", { "x-plugboard-cache": "bypass" }))).headers["x-plugboard-cache"]).toBe("bypass")
  })

  test("without the cache wrapper the headers change nothing and the response has no cache header", async () => {
    const fake = new FakeModelCaller(answer)
    server = await startRoute({ caller: fake })
    const reply = await server!.send(withHeaders(chat(), { "x-plugboard-cache": "refresh", "x-plugboard-cache-namespace": "n", "cache-control": "no-cache" }))
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-cache"]).toBeUndefined()
  })

  test("n above 1 never uses the cache, headers or not", async () => {
    const fake = await cachedRoute(numbered)
    const reply = await server!.send(withHeaders(chat({ n: 2 }), { "x-plugboard-cache": "refresh" }))
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-cache"]).toBeUndefined()
    expect(fake.calls).toHaveLength(2)
  })
})

describe("a bad cache header is a 400 in the API's own error shape", () => {
  const BAD: Array<[string, Record<string, string>, string]> = [
    ["an unknown x-plugboard-cache value", { "x-plugboard-cache": "sometimes" }, "x-plugboard-cache"],
    ["an empty x-plugboard-cache value", { "x-plugboard-cache": "" }, "x-plugboard-cache"],
    ["a namespace with a space", { "x-plugboard-cache-namespace": "has space" }, "x-plugboard-cache-namespace"],
    ["a namespace over 64 characters", { "x-plugboard-cache-namespace": "x".repeat(65) }, "x-plugboard-cache-namespace"],
    ["an invalid Portkey namespace", { "x-portkey-cache-namespace": "a;b" }, "x-portkey-cache-namespace"],
  ]
  const shapes: Array<[string, (body?: Record<string, unknown>) => SendInit, (json: any, param: string) => void]> = [
    ["Chat Completions", chat, (json, param) => expect(json.error).toMatchObject({ type: "invalid_request_error", code: "invalid_cache_header", param })],
    ["Responses", responses, (json, param) => expect(json.error).toMatchObject({ type: "invalid_request_error", code: "invalid_cache_header", param })],
    ["Anthropic Messages", messages, (json) => expect(json).toMatchObject({ type: "error", error: { type: "invalid_request_error", message: expect.stringContaining("x-") } })],
    ["Gemini", (body) => gemini(body), (json, param) => expect(json.error).toMatchObject({ code: 400, status: "INVALID_ARGUMENT", details: [{ fieldViolations: [{ field: param }] }] })],
  ]

  for (const [api, request, shape] of shapes)
    test.each(BAD)(`${api}: %s`, async (_, headers, param) => {
      const fake = await cachedRoute(numbered)
      const reply = await server!.send(withHeaders(request(), headers))
      expect(reply.status).toBe(400)
      shape(reply.json(), param)
      expect(fake.calls).toHaveLength(0)
    })

  test("a bad value is a 400 even when the app does not use the cache", async () => {
    const fake = new FakeModelCaller(answer)
    server = await startRoute({ caller: fake })
    const reply = await server!.send(withHeaders(chat(), { "x-plugboard-cache": "sometimes" }))
    expect(reply.status).toBe(400)
    expect(fake.calls).toHaveLength(0)
  })

  test("an unknown Cache-Control directive is not an error", async () => {
    await cachedRoute(numbered)
    const reply = await server!.send(withHeaders(chat(), { "cache-control": "max-stale=5, whatever" }))
    expect(reply.status).toBe(200)
  })
})
