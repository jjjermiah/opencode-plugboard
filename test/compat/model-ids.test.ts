/**
 * #103 Model ids in the URL and the body. A catalog id is `provider/model`, and a variant follows
 * `#` (`test/echo#high`). In a Gemini URL the id is a path segment: a `/` is literal, and a `#`
 * must be sent as `%23` (a `#` starts a fragment, which URL builders cut). The body form has no
 * such rule.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { GoogleGenAI } from "@google/genai"
import { ev } from "../support/fixtures.js"
import { startRoute, type RouteServer } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { TEXT, USAGE, tag } from "./scenarios.js"

const KEY = "model-id-key"
let server: RouteServer

beforeAll(async () => {
  server = await startRoute({
    caller: new FakeModelCaller(() => [ev.text(TEXT), ev.finish("stop", USAGE)]),
    options: { keys: { ids: KEY }, aliases: { fast: "test/echo" } },
  })
})
afterAll(async () => {
  await server.close()
})

const generate = (path: string) => ({
  method: "POST",
  path,
  headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
  body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: tag("model-id") }] }] }),
})

describe("#103 model ids in Gemini URLs", () => {
  test("a slash is literal in the path: /v1beta/models/test/echo:generateContent answers", async () => {
    expect((await server.send(generate("/v1beta/models/test/echo:generateContent"))).status).toBe(200)
  })

  test("a variant in the path: the # sent as %23 selects the variant and answers", async () => {
    expect((await server.send(generate("/v1beta/models/test%2Fecho%23high:generateContent"))).status).toBe(200)
  })

  test.failing("#103 gap: the @google/genai SDK sends a variant id as is, so the URL is cut at the # and the route misses", async () => {
    // Known gap: the SDK builds the URL as a string; plugboard expects %23 (src/gemini/route.ts). Use an alias for a variant.
    const client = new GoogleGenAI({ apiKey: KEY, httpOptions: { baseUrl: server.url } })
    const error = await client.models.generateContent({ model: "test/echo#high", contents: tag("model-id") }).then(
      () => undefined,
      (caught: unknown) => caught,
    )
    expect(error).toBeUndefined()
  })
})

describe("#103 model ids in the body", () => {
  test("the Chat Completions body takes a variant id as is", async () => {
    const reply = await server.send({
      method: "POST",
      path: "/v1/chat/completions",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "test/echo#high", messages: [{ role: "user", content: tag("model-id") }] }),
    })
    expect(reply.status).toBe(200)
    expect(reply.json().choices[0].message.content).toBe(TEXT)
  })
})
