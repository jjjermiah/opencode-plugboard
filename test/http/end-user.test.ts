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
async function start({ usage = false }: { usage?: boolean } = {}): Promise<RouteServer> {
  recorder = usage ? createUsageRecorder({ state: createUsageState(), storage: new FakeStorage(), loadCatalog: async () => CATALOG, retentionDays: 90 }) : undefined
  const caller = withUsage(new FakeModelCaller(() => [ev.text("hi"), ev.finish("stop", { inputTokens: 10, outputTokens: 5 })]), recorder)
  server = await startRoute({ caller, ...(recorder ? { usage: recorder } : {}) })
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

  test("#57 a user filter that is not a user is a 400 naming the parameter", async () => {
    const srv = await start({ usage: true })
    const reply = await srv.send({ path: "/plugboard/usage?user=a%20b" })
    expect(reply.status).toBe(400)
    expect(reply.json()).toMatchObject({ code: "invalid_user", param: "user" })
  })
})
