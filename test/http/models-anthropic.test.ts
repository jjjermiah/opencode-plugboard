/**
 * #399 `GET /v1/models` and `GET /v1/models/{id}` read `x-api-key` as the Messages route does, and answer
 * Anthropic's list shape when the request carries `anthropic-version` (the Anthropic SDKs send both).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { captureLogs } from "../support/logs.js"
import { startRoute, type RouteServer } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"
import { model } from "../support/fixtures.js"

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

/** 45 models, more than the default page of 20, so paging has more than one page to walk. */
const BIG = Array.from({ length: 45 }, (_, i) => model("test", `m${String(i).padStart(2, "0")}`))
const idsOf = (body: Record<string, unknown>) => (body.data as Array<{ id: string }>).map((m) => m.id)

async function bigRoute() {
  server = await startRoute({ caller: new FakeModelCaller([]), catalog: BIG, options: { models: ["test/*"], keys: { app: "secret" } } })
}

const list = (query: string) => server!.send({ method: "GET", path: `/v1/models${query}`, headers: { "x-api-key": "secret", ...ANTHROPIC } })

describe("#457 the Anthropic model list pages with limit, after_id and before_id", () => {
  test("limit defaults to 20, and has_more says whether another page follows", async () => {
    await bigRoute()
    const body = (await list("")).json() as Record<string, unknown>
    expect(idsOf(body)).toHaveLength(20)
    expect(body.has_more).toBe(true)
    expect(body.first_id).toBe("test/m00")
    expect(body.last_id).toBe("test/m19")
  })

  test("after_id walks every page in catalog order, and the last page has has_more false", async () => {
    await bigRoute()
    const seen: string[] = []
    let query = "?limit=10"
    for (;;) {
      const body = (await list(query)).json() as Record<string, unknown>
      seen.push(...idsOf(body))
      if (!body.has_more) break
      query = `?limit=10&after_id=${encodeURIComponent(body.last_id as string)}`
    }
    expect(seen).toEqual(BIG.map((m) => `${m.providerID}/${m.id}`))
  })

  test("before_id returns the page before the cursor, and has_more says whether more lie before it", async () => {
    await bigRoute()
    const middle = (await list("?limit=10&before_id=test%2Fm20")).json() as Record<string, unknown>
    expect(idsOf(middle)).toEqual(Array.from({ length: 10 }, (_, i) => `test/m${String(10 + i).padStart(2, "0")}`))
    expect(middle.has_more).toBe(true)
    const first = (await list("?limit=10&before_id=test%2Fm10")).json() as Record<string, unknown>
    expect(idsOf(first)[0]).toBe("test/m00")
    expect(first.has_more).toBe(false)
  })

  test("limit 1000 is accepted and returns the whole catalog on one page", async () => {
    await bigRoute()
    const body = (await list("?limit=1000")).json() as Record<string, unknown>
    expect(idsOf(body)).toHaveLength(45)
    expect(body.has_more).toBe(false)
  })

  test("a limit outside 1 to 1000, or not a whole number, is a 400", async () => {
    await bigRoute()
    for (const query of ["?limit=0", "?limit=1001", "?limit=abc", "?limit=2.5", "?limit=-1"]) expect((await list(query)).status).toBe(400)
  })

  test("an unknown cursor, or both cursors, is a 400", async () => {
    await bigRoute()
    expect((await list("?after_id=test%2Fnope")).status).toBe(400)
    expect((await list("?before_id=test%2Fnope")).status).toBe(400)
    expect((await list("?after_id=test%2Fm01&before_id=test%2Fm05")).status).toBe(400)
  })

  test("without anthropic-version the OpenAI list has no paging and returns the whole catalog", async () => {
    await bigRoute()
    const body = (await server!.send({ method: "GET", path: "/v1/models?limit=2", headers: { "x-api-key": "secret" } })).json() as Record<string, unknown>
    expect(body.object).toBe("list")
    expect((body.data as unknown[]).length).toBe(45)
  })
})
