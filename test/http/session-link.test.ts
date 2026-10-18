/**
 * `x-plugboard-session-url` and the log field `session_url=` over loopback HTTP (#77): every route that
 * sends `x-plugboard-session` sends the filled link too, Chat Completions with `n` lists the links in
 * choice order, and without option `historyUrl` no link is sent.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { ev } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

const logs = captureLogs()
const BASE = "http://opencode.lan:4096/session/{id}"

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

/** Every call writes one history record, `ses_<call>`, then answers. */
async function start(options: Record<string, unknown>): Promise<RouteServer> {
  server = await startRoute({ caller: new FakeModelCaller((_request, call) => [{ record: `ses_${call}` }, ev.text("hi"), ev.finish()]), options })
  return server
}

const requests: Array<[string, SendInit]> = [
  ["POST /v1/chat/completions", { method: "POST", path: "/v1/chat/completions", body: { model: "test/echo", messages: [{ role: "user", content: "hi" }] } }],
  ["POST /v1/responses", { method: "POST", path: "/v1/responses", body: { model: "test/echo", input: "hi" } }],
  ["POST /v1/messages", { method: "POST", path: "/v1/messages", body: { model: "test/echo", max_tokens: 8, messages: [{ role: "user", content: "hi" }] } }],
]

describe("#77 x-plugboard-session-url", () => {
  test.each(requests)("#77 %s answers with the session link next to the session id", async (_route, init) => {
    const srv = await start({ historyUrl: BASE })
    const reply = await srv.send(init)
    expect(reply.headers["x-plugboard-session"]).toBe("ses_0")
    expect(reply.headers["x-plugboard-session-url"]).toBe("http://opencode.lan:4096/session/ses_0")
  })

  test("#77 the request log line carries session_url= with the same link", async () => {
    const srv = await start({ historyUrl: BASE })
    await srv.send(requests[0]![1])
    expect(logs.of("request")[0]!.fields).toMatchObject({ session_url: "http://opencode.lan:4096/session/ses_0" })
  })

  test("#77 with n above 1 the links are listed in choice order, like the session ids", async () => {
    const srv = await start({ historyUrl: BASE, maxN: 3 })
    const reply = await srv.send({ method: "POST", path: "/v1/chat/completions", body: { model: "test/echo", n: 2, messages: [{ role: "user", content: "hi" }] } })
    const ids = String(reply.headers["x-plugboard-session"]).split(",")
    expect(ids).toHaveLength(2)
    expect(reply.headers["x-plugboard-session-url"]).toBe(ids.map((id: string) => `http://opencode.lan:4096/session/${id}`).join(","))
  })

  test("#280 an app with historyUrl false gets no link, not even in the log line; another app gets its own template", async () => {
    const srv = await start({
      historyUrl: BASE,
      maxN: 3,
      keys: { alpha: "ka", beta: "kb", gamma: "kc" },
      apps: { alpha: { historyUrl: false }, beta: { historyUrl: "http://beta.lan:4096/s/{id}" } },
    })
    const as = (key: string) =>
      ({ method: "POST", path: "/v1/chat/completions", headers: { authorization: `Bearer ${key}` }, body: { model: "test/echo", messages: [{ role: "user", content: "hi" }] } }) as const
    const alpha = await srv.send(as("ka"))
    expect(alpha.headers["x-plugboard-session"]).toBe("ses_0")
    expect(alpha.headers).not.toHaveProperty("x-plugboard-session-url")
    expect(logs.of("request").at(-1)!.fields).not.toHaveProperty("session_url")
    const beta = await srv.send(as("kb"))
    expect(beta.headers["x-plugboard-session-url"]).toBe("http://beta.lan:4096/s/ses_1")
    const gamma = await srv.send(as("kc"))
    expect(gamma.headers["x-plugboard-session-url"]).toBe("http://opencode.lan:4096/session/ses_2")
  })

  test("#280 with n above 1, an app with historyUrl false gets no link header", async () => {
    const srv = await start({ historyUrl: BASE, maxN: 3, keys: { alpha: "ka" }, apps: { alpha: { historyUrl: false } } })
    const reply = await srv.send({
      method: "POST",
      path: "/v1/chat/completions",
      headers: { authorization: "Bearer ka" },
      body: { model: "test/echo", n: 2, messages: [{ role: "user", content: "hi" }] },
    })
    expect(String(reply.headers["x-plugboard-session"]).split(",")).toHaveLength(2)
    expect(reply.headers).not.toHaveProperty("x-plugboard-session-url")
  })

  test("#77 without historyUrl no session link is sent, and the log line has none", async () => {
    const srv = await start({})
    const reply = await srv.send(requests[0]![1])
    expect(reply.headers["x-plugboard-session"]).toBe("ses_0")
    expect(reply.headers).not.toHaveProperty("x-plugboard-session-url")
    expect(logs.of("request")[0]!.fields).not.toHaveProperty("session_url")
  })
})
