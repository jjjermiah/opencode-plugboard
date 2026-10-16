/**
 * #399 `GET /v1/models` and `GET /v1/models/{id}` read `x-api-key` as the Messages route does, and answer
 * Anthropic's list shape when the request carries `anthropic-version` (the Anthropic SDKs send both).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

captureLogs()
let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const ANTHROPIC = { "anthropic-version": "2023-06-01" }

async function route() {
  server = await startRoute({ caller: new FakeModelCaller([]), options: { models: ["test/*"], keys: { app: "secret" } } })
}

describe("#399 the model list takes x-api-key", () => {
  test("x-api-key authenticates GET /v1/models and GET /v1/models/{id}, as on the Messages route", async () => {
    await route()
    const key = { "x-api-key": "secret" }
    expect((await server!.send({ method: "GET", path: "/v1/models", headers: key })).status).toBe(200)
    expect((await server!.send({ method: "GET", path: "/v1/models/test%2Fecho", headers: key })).status).toBe(200)
    expect((await server!.send({ method: "GET", path: "/v1/models", headers: { "x-api-key": "nope" } })).status).toBe(401)
    expect((await server!.send({ method: "GET", path: "/v1/models" })).status).toBe(401)
  })

  test("a right Bearer next to a wrong x-api-key still authenticates", async () => {
    await route()
    expect((await server!.send({ method: "GET", path: "/v1/models", headers: { authorization: "Bearer secret", "x-api-key": "nope" } })).status).toBe(200)
  })

  test("with anthropic-version the list is Anthropic's shape: data, has_more, first_id, last_id; each model type, id, display_name, created_at", async () => {
    await route()
    const body = (await server!.send({ method: "GET", path: "/v1/models?limit=100", headers: { "x-api-key": "secret", ...ANTHROPIC } })).json() as Record<string, unknown>
    expect(body.object).toBeUndefined()
    expect(body.has_more).toBe(false)
    const data = body.data as Array<Record<string, unknown>>
    expect(data.length).toBeGreaterThan(0)
    expect(body.first_id).toBe(data[0]!.id)
    expect(body.last_id).toBe(data.at(-1)!.id)
    expect(data[0]).toEqual({ type: "model", id: expect.any(String), display_name: expect.any(String), created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) })
  })

  test("with anthropic-version one model is Anthropic's model object", async () => {
    await route()
    const reply = await server!.send({ method: "GET", path: "/v1/models/test%2Fecho", headers: { "x-api-key": "secret", ...ANTHROPIC } })
    expect(reply.json()).toEqual({ type: "model", id: "test/echo", display_name: expect.any(String), created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) })
  })

  test("without anthropic-version the list keeps the OpenAI shape", async () => {
    await route()
    const body = (await server!.send({ method: "GET", path: "/v1/models", headers: { "x-api-key": "secret" } })).json() as Record<string, unknown>
    expect(body.object).toBe("list")
    expect(body.has_more).toBeUndefined()
  })
})
