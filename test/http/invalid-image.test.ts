/**
 * #286 an unusable `data:` image is a 400 on every API's image path, answered by the decoder: the model
 * caller (and so backend preparation, sessions and budgets) is never reached. Never a 500.
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

const BAD_URLS = ["data:text/html;base64,PGgxPng=", "data:image/png;base64,AAAA", "data:image/png;base64,"]

const requests: Array<[string, (url: string) => SendInit]> = [
  [
    "chat",
    (url) => ({ method: "POST", path: "/v1/chat/completions", body: { model: "test/echo", max_tokens: 20, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url } }] }] } }),
  ],
  [
    "responses",
    (url) => ({ method: "POST", path: "/v1/responses", body: { model: "test/echo", input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: url }] }] } }),
  ],
]

describe("#286 an unusable data: image is a 400 before any backend work", () => {
  test.each(requests.flatMap(([name, make]) => BAD_URLS.map((url) => [name, make, url] as const)))(
    "#286 %s with %j is a 400 invalid request",
    async (_name, make, url) => {
      const caller = new FakeModelCaller(() => [ev.text("never"), ev.finish()])
      server = await startRoute({ caller })
      const reply = await server.send(make(url))
      expect(reply.status).toBe(400)
      expect(reply.json().error).toMatchObject({ type: "invalid_request_error" })
      expect(reply.json().error.message).toContain("Image data URL")
      expect(caller.calls).toHaveLength(0)
    },
  )

  test("#286 messages: a base64 image block with junk bytes is a 400, not a 500", async () => {
    const caller = new FakeModelCaller(() => [ev.text("never"), ev.finish()])
    server = await startRoute({ caller })
    const reply = await server.send({
      method: "POST",
      path: "/v1/messages",
      body: { model: "test/echo", max_tokens: 8, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] }] },
    })
    expect(reply.status).toBe(400)
    expect(reply.json()).toMatchObject({ type: "error", error: { type: "invalid_request_error" } })
    expect(reply.json().error.message).toContain("Image data URL")
    expect(caller.calls).toHaveLength(0)
  })

  test("#286 messages: a base64 image block with a non-image media type is a 400", async () => {
    const caller = new FakeModelCaller(() => [ev.text("never"), ev.finish()])
    server = await startRoute({ caller })
    const reply = await server.send({
      method: "POST",
      path: "/v1/messages",
      body: { model: "test/echo", max_tokens: 8, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "text/html", data: "PGgxPng=" } }] }] },
    })
    expect(reply.status).toBe(400)
    expect(caller.calls).toHaveLength(0)
  })

  test("#286 gemini: an inlineData image with junk bytes is a 400 in Google's body", async () => {
    const caller = new FakeModelCaller(() => [ev.text("never"), ev.finish()])
    server = await startRoute({ caller })
    const reply = await server.send({
      method: "POST",
      path: "/v1beta/models/test/echo:generateContent",
      body: { contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }] }] },
    })
    expect(reply.status).toBe(400)
    expect(reply.json().error).toMatchObject({ code: 400, status: "INVALID_ARGUMENT" })
    expect(reply.json().error.message).toContain("Image data URL")
    expect(caller.calls).toHaveLength(0)
  })
})
