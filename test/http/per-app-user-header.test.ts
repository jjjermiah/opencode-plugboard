/**
 * #272 `apps.<name>.userHeader`: an app reads the end user from a request header, falling back to the body's `user` (or
 * `metadata.user_id` on Messages) when the header is absent. The same sanitizer decides: a refused header is dropped, and
 * it does not fall back to the body. Real loopback HTTP, and the load rules without a server.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { parseOptions } from "../../src/config.js"
import { requestUser } from "../../src/user.js"
import { ev } from "../support/fixtures.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const KEYS = { bot: "k-bot", plain: "k-plain" }
const options = { keys: KEYS, apps: { bot: { userHeader: "x-user-id" } } }

const chat = (key: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}): SendInit => ({
  method: "POST",
  path: "/v1/chat/completions",
  headers: { authorization: `Bearer ${key}`, ...headers },
  body: { model: "test/echo", messages: [{ role: "user", content: "hi" }], ...body },
})

async function route(extra: Record<string, unknown> = {}) {
  const caller = new FakeModelCaller(() => [ev.text("answer"), ev.finish()])
  server = await startRoute({ caller, options: { ...options, ...extra } })
  return caller
}

describe("#272 apps.<name>.userHeader on the wire", () => {
  test("the header names the end user, ahead of the body's user", async () => {
    const caller = await route()
    const reply = await server!.send(chat(KEYS.bot, { user: "bob" }, { "x-user-id": "alice" }))
    expect(reply.status).toBe(200)
    expect(caller.call.request.user).toBe("alice")
    expect(reply.headers["x-plugboard-user-dropped"]).toBeUndefined()
  })

  test("with the header absent, the body's user is used", async () => {
    const caller = await route()
    await server!.send(chat(KEYS.bot, { user: "bob" }))
    expect(caller.call.request.user).toBe("bob")
  })

  test("a refused header is dropped and does not fall back to the body's user", async () => {
    const caller = await route()
    const reply = await server!.send(chat(KEYS.bot, { user: "bob" }, { "x-user-id": "not a user!" }))
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-user-dropped"]).toBe("1")
    expect(caller.call.request.user).toBeUndefined()
  })

  test("a reserved name in the header is refused like any other: dropped, and the body's user is not used", async () => {
    const caller = await route()
    const reply = await server!.send(chat(KEYS.bot, { user: "bob" }, { "x-user-id": "__proto__" }))
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-user-dropped"]).toBe("1")
    expect(caller.call.request.user).toBeUndefined()
  })

  test("a blank header is absent: the body's user is used, and nothing is reported dropped", async () => {
    const caller = await route()
    const reply = await server!.send(chat(KEYS.bot, { user: "bob" }, { "x-user-id": "  " }))
    expect(reply.status).toBe(200)
    expect(caller.call.request.user).toBe("bob")
    expect(reply.headers["x-plugboard-user-dropped"]).toBeUndefined()
  })

  test("Responses reads the header ahead of the body's user, and falls back to the body without it", async () => {
    const caller = await route()
    const responses = (headers: Record<string, string>): SendInit => ({
      method: "POST",
      path: "/v1/responses",
      headers: { authorization: `Bearer ${KEYS.bot}`, ...headers },
      body: { model: "test/echo", input: "hi", user: "bob" },
    })
    await server!.send(responses({ "x-user-id": "alice" }))
    expect(caller.call.request.user).toBe("alice")
    await server!.send(responses({}))
    expect(caller.calls[1]!.request.user).toBe("bob")
  })

  test("legacy completions reads the header ahead of the body's user", async () => {
    const caller = await route()
    const reply = await server!.send({
      method: "POST",
      path: "/v1/completions",
      headers: { authorization: `Bearer ${KEYS.bot}`, "x-user-id": "alice" },
      body: { model: "test/echo", prompt: "hi", user: "bob" },
    })
    expect(reply.status).toBe(200)
    expect(caller.call.request.user).toBe("alice")
  })

  test("an app without userHeader ignores the header and reads the body", async () => {
    const caller = await route()
    await server!.send(chat(KEYS.plain, { user: "bob" }, { "x-user-id": "alice" }))
    expect(caller.call.request.user).toBe("bob")
  })

  test("Messages reads the header ahead of metadata.user_id", async () => {
    const caller = await route()
    const reply = await server!.send({
      method: "POST",
      path: "/v1/messages",
      headers: { authorization: `Bearer ${KEYS.bot}`, "x-user-id": "alice" },
      body: { model: "test/echo", max_tokens: 100, messages: [{ role: "user", content: "hi" }], metadata: { user_id: "bob" } },
    })
    expect(reply.status).toBe(200)
    expect(caller.call.request.user).toBe("alice")
  })

  test("Messages with the header absent reads metadata.user_id", async () => {
    const caller = await route()
    await server!.send({
      method: "POST",
      path: "/v1/messages",
      headers: { authorization: `Bearer ${KEYS.bot}` },
      body: { model: "test/echo", max_tokens: 100, messages: [{ role: "user", content: "hi" }], metadata: { user_id: "bob" } },
    })
    expect(caller.call.request.user).toBe("bob")
  })
})

describe("#272 requestUser: the header is looked up as an own property, and a blank value is absent", () => {
  test("a userHeader that names an inherited property is not read as a header", () => {
    expect(requestUser({}, "constructor", "bob")).toBe("bob")
  })

  test("a blank or array-of-blank header falls back; a present value wins", () => {
    expect(requestUser({ "x-user-id": "" }, "x-user-id", "bob")).toBe("bob")
    expect(requestUser({ "x-user-id": [" "] }, "x-user-id", "bob")).toBe("bob")
    expect(requestUser({ "x-user-id": ["alice", "carol"] }, "x-user-id", "bob")).toBe("alice")
  })
})

describe("#272 apps.<name>.userHeader at load", () => {
  const parseWith = (userHeader: unknown) => parseOptions({ keys: KEYS, apps: { bot: { userHeader } } })

  test("a lower case header name is kept on the policy", () => {
    expect(parseWith("x-user-id").apps.bot).toMatchObject({ userHeader: "x-user-id" })
  })

  test.each([
    ["an upper case name", "X-User-Id"],
    ["an empty name", ""],
    ["a name over 64 characters", "x".repeat(65)],
    ["a name with a space", "x user"],
    ["a non-string", 7],
  ])("%s is refused at load and names the option", (_name, value) => {
    expect(() => parseWith(value)).toThrow(/`apps\.bot\.userHeader` must be a lower case header name of 1 to 64 letters, digits or hyphens/)
  })

  test.each(["authorization", "proxy-authorization", "x-api-key", "api-key", "x-goog-api-key", "x-auth-token", "cookie"])(
    "a credential header (%s) is refused: its value would be logged as the user",
    (name) => {
      expect(() => parseWith(name)).toThrow(/`apps\.bot\.userHeader` cannot be .* that header carries a key/)
    },
  )
})
