/**
 * The end user over loopback HTTP (#57): OpenAI `user`, Anthropic `metadata.user_id` and the
 * Responses `user` reach the request log line as `user=`; a value that is not kept sets
 * `x-plugboard-user-dropped` and never reaches the log; `GET /plugboard/usage` reports the users and
 * `?user=` narrows them.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createUsageRecorder, createUsageState, withUsage, type UsageRecorder, type UsageReport } from "../../src/usage.js"
import { CATALOG, ev, until } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { FakeStorage } from "../support/usage.js"

const logs = captureLogs()

const chat = (user?: unknown): SendInit => ({
  method: "POST",
  path: "/v1/chat/completions",
  body: { model: "test/echo", messages: [{ role: "user", content: "hi" }], ...(user === undefined ? {} : { user }) },
})
const messages = (userId: string): SendInit => ({
  method: "POST",
  path: "/v1/messages",
  body: { model: "test/echo", max_tokens: 8, messages: [{ role: "user", content: "hi" }], metadata: { user_id: userId } },
})

let server: RouteServer | undefined
let recorder: UsageRecorder | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
  recorder = undefined
})

/** A route answering every call with 10 input and 5 output tokens, and a usage recorder when `usage` is set. */
async function start({ usage = false, options, catalog }: { usage?: boolean; options?: Record<string, unknown>; catalog?: typeof CATALOG } = {}): Promise<RouteServer> {
  recorder = usage ? createUsageRecorder({ state: createUsageState(), storage: new FakeStorage(), loadCatalog: async () => CATALOG, retentionDays: 90 }) : undefined
  const caller = withUsage(new FakeModelCaller(() => [ev.text("hi"), ev.finish("stop", { inputTokens: 10, outputTokens: 5 })]), recorder)
  server = await startRoute({ caller, ...(options ? { options } : {}), ...(catalog ? { catalog } : {}), ...(recorder ? { usage: recorder } : {}) })
  return server
}

describe("#57 the end user reaches the request log", () => {
  test("#57 an OpenAI chat `user` is kept as user= in the request log line", async () => {
    const srv = await start()
    const reply = await srv.send(chat("alice"))
    expect(reply.status).toBe(200)
    expect(reply.headers).not.toHaveProperty("x-plugboard-user-dropped")
    expect(logs.of("request")[0]!.fields).toMatchObject({ app: "default", user: "alice" })
  })

  test("#57 an Anthropic metadata.user_id is kept as user= too", async () => {
    const srv = await start()
    expect((await srv.send(messages("carol"))).status).toBe(200)
    expect(logs.of("request")[0]!.fields).toMatchObject({ route: "POST /v1/messages", user: "carol" })
  })

  test("#57 a Responses `user` is kept as user=", async () => {
    const srv = await start()
    expect((await srv.send({ method: "POST", path: "/v1/responses", body: { model: "test/echo", input: "hi", user: "dave" } })).status).toBe(200)
    expect(logs.of("request")[0]!.fields).toMatchObject({ route: "POST /v1/responses", user: "dave" })
  })

  test("#57 a value that is not kept answers with x-plugboard-user-dropped and never reaches the log", async () => {
    const srv = await start()
    const reply = await srv.send(chat("evil user/../x"))
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-user-dropped"]).toBe("1")
    const line = logs.of("request")[0]!
    expect(line.fields).not.toHaveProperty("user")
    expect(line.raw).not.toContain("evil")
  })

  test("#57 a request without a user carries no user field and no dropped header", async () => {
    const srv = await start()
    const reply = await srv.send(chat())
    expect(reply.headers).not.toHaveProperty("x-plugboard-user-dropped")
    expect(logs.of("request")[0]!.fields).not.toHaveProperty("user")
  })
})

const withUser = (user: string): Array<[string, SendInit]> => [
  ["chat", chat(user)],
  ["completions", { method: "POST", path: "/v1/completions", body: { model: "test/echo", prompt: "hi", user } }],
  ["responses", { method: "POST", path: "/v1/responses", body: { model: "test/echo", input: "hi", user } }],
  ["messages", messages(user)],
]

describe("end user names an object inherits: the shared counters and the routes survive", () => {
  // A name like `__proto__` once wrote the counters onto Object.prototype of the whole process, and every later request failed.
  afterEach(() => {
    for (const key of ["requests", "tokens", "costUsd"]) delete (Object.prototype as Record<string, unknown>)[key]
  })

  test.each([
    ["__proto__", true],
    ["constructor", true],
    ["prototype", true],
    ["_other", true],
    ["toString", false],
  ])("#57 %j on every route that takes a user: 200 each time, metrics and usage keep working", async (name, dropped) => {
    const srv = await start({ usage: true, options: { metrics: true } })
    for (const [route, send] of withUser(name)) {
      const reply = await srv.send(send)
      expect({ route, status: reply.status }).toEqual({ route, status: 200 })
      expect(reply.headers["x-plugboard-user-dropped"]).toBe(dropped ? "1" : undefined)
    }
    expect(({} as Record<string, unknown>).requests).toBeUndefined()
    expect(({} as Record<string, unknown>).tokens).toBeUndefined()
    expect(({} as Record<string, unknown>).costUsd).toBeUndefined()

    expect((await srv.send({ path: "/plugboard/metrics" })).status).toBe(200)
    expect((await srv.send(chat("alice"))).status).toBe(200)
    await until(async () => ((await recorder!.query({ app: "default" })) as UsageReport).apps.default?.users?.alice?.requests === 1, 1_000, "alice counted")
    const report = ((await recorder!.query({ app: "default" })) as UsageReport).apps.default!
    expect(report.totals.requests).toBe(withUser(name).length + 1)
    expect(Object.hasOwn(report.users!, "alice")).toBe(true)
  })

  test("#57 a metrics or usage write that throws neither changes the answer nor stops the access log", async () => {
    const srv = await start({
      usage: true,
      options: { metrics: true, models: ["test/*", "openai/*"] },
      catalog: [...CATALOG, { providerID: "openai", id: "gpt-5.5", variants: [] }] as typeof CATALOG,
    })
    const boom = () => {
      throw new Error("metrics down")
    }
    Object.assign(srv.metrics, { requestStarted: boom, requestFinished: boom, tokens: boom, dropped: boom })
    const reply = await srv.send(chat("alice"))
    expect(reply.status).toBe(200)
    expect(logs.of("request")[0]!.fields).toMatchObject({ status: "200", user: "alice", outcome: "ok" })
    // A request that drops a parameter also reaches the `dropped` write, which throws here too.
    const dropping = await srv.send({
      method: "POST",
      path: "/v1/chat/completions",
      body: { model: "openai/gpt-5.5", messages: [{ role: "user", content: "hi" }], user: "alice", temperature: 0.2, top_p: 0.5, max_tokens: 9 },
    })
    expect(dropping.status).toBe(200)
    expect(dropping.headers["x-plugboard-dropped-params"]).toBeDefined()
    expect(logs.of("metrics.record_failed").length).toBeGreaterThan(0)
    expect(logs.of("metrics.record_failed")[0]!.level).toBe("error")
    await until(async () => ((await recorder!.query({ app: "default" })) as UsageReport).totals.requests === 2, 1_000, "usage still recorded")
  })
})

describe("#57 GET /plugboard/usage: users", () => {
  test("#57 each user's requests and tokens are reported, and ?user= narrows them to one user", async () => {
    const srv = await start({ usage: true })
    await srv.send(chat("alice"))
    await srv.send(chat("alice"))
    await srv.send(chat("bob"))
    await until(async () => ((await recorder!.query({ app: "default" })) as UsageReport).apps.default!.users!.bob?.tokens === 15, 1_000, "bob counted")
    const all = (await srv.send({ path: "/plugboard/usage" })).json()
    expect(all.apps.default.users).toEqual({
      alice: { requests: 2, tokens: 30, costUsd: 0 },
      bob: { requests: 1, tokens: 15, costUsd: 0 },
    })
    expect(all.apps.default.totals.requests).toBe(3)

    const alice = (await srv.send({ path: "/plugboard/usage?user=alice" })).json()
    expect(Object.keys(alice.apps.default.users)).toEqual(["alice"])
    expect(alice.apps.default.totals.requests).toBe(3)
  })

  test("#57 ?user= takes a stored or reserved name by charset and length: _other, prototype, constructor and __proto__ answer 200", async () => {
    const srv = await start({ usage: true })
    for (const user of ["_other", "prototype", "constructor", "__proto__"]) {
      const reply = await srv.send({ path: `/plugboard/usage?user=${user}` })
      expect({ user, status: reply.status }).toEqual({ user, status: 200 })
    }
    expect((await srv.send({ path: "/plugboard/usage?user=a%20b" })).status).toBe(400)
  })

  test("#57 a user filter that is not a user is a 400 naming the parameter", async () => {
    const srv = await start({ usage: true })
    const reply = await srv.send({ path: "/plugboard/usage?user=a%20b" })
    expect(reply.status).toBe(400)
    expect(reply.json()).toMatchObject({ code: "invalid_user", param: "user" })
  })
})
