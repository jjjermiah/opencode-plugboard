/**
 * #586 The exchange record over loopback HTTP: `history.storeRequestBody` (on by default) keeps one record per model request, with the
 * request and response as they crossed the wire, the timing, the routing, the usage and the errors; it is read back under the same app's
 * key only. The model caller is a fake that reports the hooks the real one does (record, served, cache, usage), and for the routing a
 * real `withFallbacks` chain.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { parseOptions } from "../../src/config.js"
import type { CallContext, ModelCaller, PlugEvent, PlugRequest } from "../../src/contract.js"
import { withFallbacks } from "../../src/fallback.js"
import { trace } from "../../src/record.js"
import { CATALOG, ev, until } from "../support/fixtures.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

/** A model caller that reports what the session caller and the layers around it do: the session, the served model, the cache and the usage. */
function hooked(events: (request: PlugRequest) => PlugEvent[], cache: "hit" | "miss" = "miss", before?: () => void): ModelCaller {
  let call = 0
  return {
    stream(request: PlugRequest, context: CallContext) {
      const mine = call++
      return (async function* () {
        context.onRecord?.(`ses_${mine}`, "/data/app")
        context.onServed?.({ model: "test/echo", fallbacks: 0 })
        context.onCache?.(cache)
        before?.()
        const out = events(request)
        for (const event of out) {
          if (event.type === "finish") context.onUsage?.({ inputTokens: 11, outputTokens: 5, cacheReadTokens: 2, costUsd: 0.25 })
          yield event
        }
      })()
    },
  }
}

const hello = (): PlugEvent[] => [ev.text("Hello "), ev.text("world"), ev.finish("stop", { inputTokens: 11, outputTokens: 5, cacheReadTokens: 2 })]
const chat = (extra: Record<string, unknown> = {}): SendInit => ({
  method: "POST",
  path: "/v1/chat/completions?trace=1&trace=2",
  headers: { authorization: "Bearer ka", "x-custom": "kept", "x-api-key": "secret-api-key" },
  body: { model: "test/echo", messages: [{ role: "user", content: "hi" }], ...extra },
})
const KEYS = { keys: { a: "ka", b: "kb" } }

async function start(caller: ModelCaller, options: Record<string, unknown> = KEYS): Promise<RouteServer> {
  server = await startRoute({ caller, options })
  return server
}

/** The stored record of the request that answered `reply`, read from storage once the route has written it. */
async function recordOf(srv: RouteServer, reply: { headers: Record<string, unknown> }, app = "a"): Promise<any> {
  const id = String(reply.headers["x-plugboard-request-id"])
  await until(() => srv.storage.values.has(`record/${app}/${id}`), 1_000, "the stored record")
  return JSON.parse(srv.storage.values.get(`record/${app}/${id}`)!)
}

describe("#586 a non-streamed request", () => {
  test("the record has the request, the response, the timing, the routing, the usage and the session", async () => {
    const srv = await start(hooked(hello))
    const reply = await srv.send(chat())
    const record = await recordOf(srv, reply)

    expect(record).toMatchObject({ version: 1, id: reply.headers["x-plugboard-request-id"], app: "a", outcome: "ok" })
    // request
    expect(record.request).toMatchObject({
      method: "POST",
      path: "/v1/chat/completions",
      query: [
        ["trace", "1"],
        ["trace", "2"],
      ],
    })
    expect(record.request.headers).toMatchObject({ "x-custom": "kept", "content-type": "application/json" })
    expect(JSON.parse(record.request.body.text)).toMatchObject({ model: "test/echo" })
    // response
    expect(record.response.status).toBe(200)
    expect(record.response.headers).toMatchObject({ "x-plugboard-request-id": record.id, "x-plugboard-model": "test/echo" })
    expect(record.response.body.text).toBe(reply.text)
    // timing
    expect(Date.parse(record.timing.receivedAt)).toBeLessThanOrEqual(Date.parse(record.timing.finishedAt))
    expect(record.timing.firstByteAt).not.toBeNull()
    expect(record.timing.totalMs).toBeGreaterThanOrEqual(0)
    // routing
    expect(record.routing).toMatchObject({ app: "a", requestedModel: "test/echo", served: [{ model: "test/echo", fallbacks: 0 }], cache: ["miss"] })
    // the call: assembled answer, usage as reported, cost, session
    expect(record.calls).toHaveLength(1)
    expect(record.calls[0]).toMatchObject({
      response: { text: "Hello world", finish: { reason: "stop" } },
      usage: { inputTokens: 11, outputTokens: 5, cacheReadTokens: 2 },
      cost: { inputTokens: 11, outputTokens: 5, costUsd: 0.25 },
      session: { id: "ses_0", directory: "/data/app" },
    })
    expect(record.sessions).toEqual(["ses_0"])
  })

  test("the request body is stored byte for byte, odd whitespace and non-ASCII text included", async () => {
    const srv = await start(hooked(hello))
    const body = '{ "model" : "test/echo",\n  "messages":[{"role":"user","content":"héllo 🌍  \\u00e9"}]  }\n'
    const reply = await srv.send({ method: "POST", path: "/v1/chat/completions", headers: { authorization: "Bearer ka" }, body })
    const record = await recordOf(srv, reply)
    expect(record.request.body).toEqual({ text: body })
  })

  test("bytes that are not UTF-8 are stored as base64, still exact", async () => {
    const srv = await start(hooked(hello))
    const body = Buffer.concat([Buffer.from('{"model":"test/echo","messages":[{"role":"user","content":"x'), Buffer.from([0xff, 0xfe]), Buffer.from('y"}]}')])
    const reply = await srv.send({ method: "POST", path: "/v1/chat/completions", headers: { authorization: "Bearer ka" }, body })
    const record = await recordOf(srv, reply)
    expect(Buffer.from(record.request.body.base64, "base64").equals(body)).toBe(true)
  })

  test("only the secret header values are redacted: Authorization, x-api-key and x-goog-api-key keep their names", async () => {
    const srv = await start(hooked(hello))
    const reply = await srv.send({ ...chat(), headers: { authorization: "Bearer ka", "x-api-key": "secret-api-key", "x-goog-api-key": "secret-goog", cookie: "session=visible" } })
    const record = await recordOf(srv, reply)
    expect(record.request.headers).toMatchObject({ authorization: "[redacted]", "x-api-key": "[redacted]", "x-goog-api-key": "[redacted]", cookie: "session=visible" })
    expect(JSON.stringify(record)).not.toContain("secret-api-key")
    expect(JSON.stringify(record)).not.toContain("Bearer ka")
  })

  test("a Gemini key in the query string is redacted too", async () => {
    const srv = await start(hooked(hello))
    const reply = await srv.send({ method: "POST", path: "/v1beta/models/test%2Fecho:generateContent?key=ka&alt=json", body: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } })
    const record = await recordOf(srv, reply)
    expect(record.request.query).toEqual([
      ["key", "[redacted]"],
      ["alt", "json"],
    ])
    expect(record.request.headers).not.toHaveProperty("authorization")
  })
})

describe("#586 a streamed request", () => {
  test("the record has the raw SSE bytes as sent, and the final response assembled from the events", async () => {
    const srv = await start(hooked(hello, "hit"))
    const reply = await srv.send(chat({ stream: true }))
    expect(reply.text).toContain("data: [DONE]")
    const record = await recordOf(srv, reply)
    expect(record.response.status).toBe(200)
    expect(record.response.headers["content-type"]).toContain("text/event-stream")
    expect(record.response.body.text).toBe(reply.text)
    expect(record.calls[0].response).toMatchObject({ text: "Hello world", finish: { reason: "stop" } })
    expect(record.calls[0].usage).toMatchObject({ inputTokens: 11 })
    // The cost is recorded for a stream too, though a stream cannot carry it in a header.
    expect(record.calls[0].cost).toMatchObject({ costUsd: 0.25 })
    expect(record.routing.cache).toEqual(["hit"])
    expect(record.timing.firstByteMs).not.toBeNull()
  })

  test("reasoning and tool calls are in the assembled response", async () => {
    const events = (): PlugEvent[] => [
      { type: "reasoning-delta", text: "think " },
      { type: "reasoning-delta", text: "hard", signature: "sig1" },
      { type: "tool-call", id: "call_1", name: "lookup", input: { q: "x" } },
      ev.finish("tool-calls"),
    ]
    const srv = await start(hooked(events))
    const reply = await srv.send(chat({ stream: true, tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }] }))
    const record = await recordOf(srv, reply)
    expect(record.calls[0].response).toMatchObject({
      reasoning: "think hard",
      reasoningSignatures: ["sig1"],
      toolCalls: [{ id: "call_1", name: "lookup", input: { q: "x" } }],
      finish: { reason: "tool-calls" },
    })
  })

  test("a choice of n is one call each", async () => {
    server = await startRoute({ caller: hooked(hello), options: { ...KEYS, maxChoices: 2 } })
    const reply = await server.send(chat({ n: 2 }))
    const record = await recordOf(server, reply)
    expect(record.calls.map((call: { index: number }) => call.index)).toEqual([0, 1])
    expect(record.sessions).toEqual(["ses_0", "ses_1"])
  })
})

describe("#586 a request that fails", () => {
  test("the record has the error body as sent, the plugboard error and the host's own error before it was mapped", async () => {
    const caller = hooked(
      () => [ev.error({ status: 502, kind: "server", code: "provider_unavailable", message: "The model provider failed" })],
      "miss",
      () => trace("error", { source: "upstream", kind: "failed", raw: { type: "provider_unavailable", status: 503, message: "upstream says: overloaded", url: "https://api.example.test/v1" } }),
    )
    const srv = await start(caller)
    const reply = await srv.send(chat())
    expect(reply.status).toBe(502)
    const record = await recordOf(srv, reply)
    expect(record.outcome).toBe("status_502")
    expect(record.response.status).toBe(502)
    expect(record.response.body.text).toBe(reply.text)
    expect(record.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "upstream", raw: { type: "provider_unavailable", status: 503, message: "upstream says: overloaded", url: "https://api.example.test/v1" } }),
        expect.objectContaining({ source: "plugboard", call: 0, error: expect.objectContaining({ status: 502, code: "provider_unavailable", message: "The model provider failed" }) }),
      ]),
    )
  })

  test("a body that is not JSON is recorded with its 400, once the caller is authenticated", async () => {
    const srv = await start(hooked(hello))
    const reply = await srv.send({ method: "POST", path: "/v1/chat/completions", headers: { authorization: "Bearer ka" }, body: "{not json" })
    expect(reply.status).toBe(400)
    const record = await recordOf(srv, reply)
    expect(record.outcome).toBe("body_400")
    expect(record.response.body.text).toBe(reply.text)
    // The error the client was answered with is in `errors` whole, though no model call made it.
    expect(record.errors).toEqual([{ source: "response", status: 400, body: reply.json() }])
    expect(record.request.body).toEqual({ text: "{not json" })
  })

  test("a request without a valid key is not recorded, and neither is a count route", async () => {
    const srv = await start(hooked(hello))
    expect((await srv.send({ ...chat(), headers: { authorization: "Bearer wrong" } })).status).toBe(401)
    await srv.send({ method: "POST", path: "/v1/messages/count_tokens", headers: { authorization: "Bearer ka" }, body: { model: "test/echo", messages: [{ role: "user", content: "hi" }] } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect([...srv.storage.values.keys()].filter((key) => key.startsWith("record"))).toEqual([])
  })
})

describe("#586 the routing of an alias chain", () => {
  const options = parseOptions({ ...KEYS, models: ["test/*", "other/*"], aliases: { chain: ["test/echo", "other/model"] }, circuitBreaker: { failures: 1, cooldownMs: 60_000 } })

  test("the attempts with their error body, the move to the next target, the served model and the breaker's decisions", async () => {
    const fake = new FakeModelCaller((request) =>
      request.ref.id === "echo" ? [ev.error({ status: 429, kind: "rate_limit", code: "rate_limited", message: "slow down" })] : [ev.text("from the second"), ev.finish()],
    )
    const caller = withFallbacks(fake, { options, loadCatalog: async () => CATALOG })
    const srv = await start(caller, { ...KEYS, models: ["test/*", "other/*"], aliases: { chain: ["test/echo", "other/model"] } })
    const first = await srv.send(chat({ model: "chain" }))
    expect(first.status).toBe(200)
    const record = await recordOf(srv, first)
    expect(record.routing.attempts).toEqual([
      expect.objectContaining({ attempt: 1, target: "test/echo", outcome: "rate_limited", error: expect.objectContaining({ code: "rate_limited", message: "slow down" }) }),
      expect.objectContaining({ attempt: 2, target: "other/model", outcome: "answered" }),
    ])
    expect(record.routing.fallbacks).toEqual([expect.objectContaining({ from: "test/echo", to: "other/model", reason: "rate_limited" })])
    expect(record.routing.served).toEqual([{ model: "other/model", fallbacks: 1, chain: true }])
    expect(record.routing.requestedModel).toBe("chain")
    expect(record.routing.breaker).toEqual([expect.objectContaining({ decision: "opened", target: "test/echo" })])

    // The breaker is open now: the next request skips the first target, and says so.
    const second = await srv.send(chat({ model: "chain" }))
    const next = await recordOf(srv, second)
    expect(next.routing.breaker).toEqual([expect.objectContaining({ decision: "skip", target: "test/echo" })])
  })
})

describe("#586 option history.storeRequestBody", () => {
  test("off, nothing is stored", async () => {
    const srv = await start(hooked(hello), { ...KEYS, history: { storeRequestBody: false } })
    const reply = await srv.send(chat())
    expect(reply.status).toBe(200)
    await srv.send(chat({ stream: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(srv.storage.puts).toEqual([])
    expect((await srv.send({ method: "GET", path: `/plugboard/requests/${reply.headers["x-plugboard-request-id"]}`, headers: { authorization: "Bearer ka" } })).status).toBe(404)
  })

  test("an app's own setting beats the global one, either way", async () => {
    const srv = await start(hooked(hello), { ...KEYS, history: { storeRequestBody: false }, apps: { a: { history: { storeRequestBody: true } } } })
    const kept = await srv.send(chat())
    await recordOf(srv, kept, "a")
    await srv.send({ ...chat(), headers: { authorization: "Bearer kb" } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect([...srv.storage.values.keys()].filter((key) => key.startsWith("record/b/"))).toEqual([])
  })

  test.each([
    ["a non-object", { history: true }, "`history` must be an object"],
    ["a non-boolean", { history: { storeRequestBody: "yes" } }, "`history.storeRequestBody` must be a boolean"],
    ["an unknown field", { history: { storeBodies: true } }, "Unknown plugboard option `history.storeBodies`"],
  ])("%s is refused", (_name, options, message) => {
    expect(() => parseOptions(options)).toThrow(message)
  })

  test("it defaults to on", () => {
    expect(parseOptions({}).history).toEqual({ storeRequestBody: true })
    expect(parseOptions({ history: {} }).history).toEqual({ storeRequestBody: true })
  })
})

describe("#586 reading a record back is scoped to the caller's app", () => {
  const read = (srv: RouteServer, key: string, as: string) => srv.send({ method: "GET", path: `/plugboard/requests/${encodeURIComponent(key)}`, headers: { authorization: `Bearer ${as}` } })

  test("the app that made the request reads it by request id and by session id; another app gets a 404, and so does an unknown id", async () => {
    const srv = await start(hooked(hello))
    const reply = await srv.send(chat())
    const record = await recordOf(srv, reply)
    const own = await read(srv, record.id, "ka")
    expect(own.status).toBe(200)
    expect(own.json()).toEqual(record)
    expect((await read(srv, "ses_0", "ka")).json()).toEqual(record)

    for (const key of [record.id, "ses_0"]) {
      const other = await read(srv, key, "kb")
      expect(other.status).toBe(404)
      expect(other.json()).toMatchObject({ code: "record_not_found" })
      expect(other.text).not.toContain("Hello world")
    }
    expect((await read(srv, "0000000000", "ka")).status).toBe(404)
    expect((await read(srv, record.id, "wrong")).status).toBe(401)
    // The keys carry the app, so no lookup input reaches another app's record.
    expect([...srv.storage.values.keys()].filter((key) => key.startsWith("record")).every((key) => key.startsWith("record/a/") || key.startsWith("record-session/a/"))).toBe(true)
  })

  test("a key that tries to leave the app's prefix finds nothing", async () => {
    const srv = await start(hooked(hello))
    const reply = await srv.send(chat())
    const record = await recordOf(srv, reply)
    expect((await read(srv, `../a/${record.id}`, "kb")).status).toBe(404)
    expect((await read(srv, `a/${record.id}`, "kb")).status).toBe(404)
  })
})
