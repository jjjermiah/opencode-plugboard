/**
 * #257 `apps.<name>.requestTimeoutMs`: an app's own request deadline replaces the global one for its requests, higher or
 * lower. The deadline is armed from the app named by the credentials (`requestApp`, src/openai/route.ts). Real loopback HTTP.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { ev } from "../support/fixtures.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const KEYS = { chat: "k-chat", batch: "k-batch", anon: "k-anon" }

const chat = (key: string): SendInit => ({
  method: "POST",
  path: "/v1/chat/completions",
  headers: { authorization: `Bearer ${key}` },
  body: { model: "test/echo", messages: [{ role: "user", content: "hi" }] },
})

/** Answers after `ms`: longer than a short deadline, shorter than a long one. */
const slowAnswer = (ms: number) => () => [{ wait: new Promise((resolve) => setTimeout(resolve, ms)) }, ev.text("late"), ev.finish()]

describe("#257 apps.<name>.requestTimeoutMs", () => {
  test("an app with a short deadline times out before the global deadline would", async () => {
    // The global deadline is a minute; the chat app's 20 ms interrupts a call that never answers.
    const caller = new FakeModelCaller(() => ["hang"])
    server = await startRoute({ caller, options: { keys: KEYS, requestTimeoutMs: 60_000, apps: { chat: { requestTimeoutMs: 20 } } } })
    const reply = await server.send(chat(KEYS.chat))
    expect(reply.status).toBe(504)
    expect(reply.json().error).toMatchObject({ code: "timeout", message: "Request timed out after 20 ms (option requestTimeoutMs)" })
  })

  test("an app with a long deadline outlives the global one", async () => {
    // The global deadline is 20 ms and the model answers after 60 ms: only an app deadline above that lets it through.
    const caller = new FakeModelCaller(slowAnswer(60))
    server = await startRoute({ caller, options: { keys: KEYS, requestTimeoutMs: 20, apps: { batch: { requestTimeoutMs: 5_000 } } } })
    const reply = await server.send(chat(KEYS.batch))
    expect(reply.status).toBe(200)
  })

  test("the same slow answer is a 504 for an app that keeps the global deadline", async () => {
    const caller = new FakeModelCaller(slowAnswer(60))
    server = await startRoute({ caller, options: { keys: KEYS, requestTimeoutMs: 20, apps: { batch: { requestTimeoutMs: 5_000 } } } })
    expect((await server.send(chat(KEYS.anon))).status).toBe(504)
  })

  test("two apps with different deadlines run on one server, each on its own", async () => {
    const caller = new FakeModelCaller(() => ["hang"])
    server = await startRoute({ caller, options: { keys: KEYS, requestTimeoutMs: 60_000, apps: { chat: { requestTimeoutMs: 20 }, batch: { requestTimeoutMs: 30 } } } })
    expect((await server.send(chat(KEYS.chat))).json().error.message).toContain("20 ms")
    expect((await server.send(chat(KEYS.batch))).json().error.message).toContain("30 ms")
  })

  test("an app without the option keeps the global deadline (the message names the global option)", async () => {
    const caller = new FakeModelCaller(() => ["hang"])
    server = await startRoute({ caller, options: { keys: KEYS, requestTimeoutMs: 20, apps: { batch: { requestTimeoutMs: 60_000 } } } })
    const reply = await server.send(chat(KEYS.anon))
    expect(reply.status).toBe(504)
    expect(reply.json().error.message).toBe("Request timed out after 20 ms (option requestTimeoutMs)")
  })

  test("a request whose key matches no app gets the global deadline, and the 401 is unchanged", async () => {
    const caller = new FakeModelCaller(() => ["hang"])
    server = await startRoute({ caller, options: { keys: KEYS, requestTimeoutMs: 60_000, apps: { chat: { requestTimeoutMs: 20 } } } })
    const reply = await server.send(chat("k-wrong"))
    expect(reply.status).toBe(401)
    expect(caller.calls).toEqual([])
  })
})
