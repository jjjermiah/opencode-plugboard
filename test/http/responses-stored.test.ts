/**
 * Stored Responses over loopback HTTP: `previous_response_id`, `GET` and `DELETE /v1/responses/{id}` and
 * `GET /v1/responses/{id}/input_items` (src/responses/state.ts). App isolation is the key invariant (I32): an app
 * reads, chains from and deletes only its own responses, and another app's id is the same miss as an unknown one (404 on the id routes, 400 on `previous_response_id`).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createResponseState, createResponseStore, type ResponseStore } from "../../src/responses/state.js"
import { ev } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { parseSse, startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller, type Script } from "../support/model-caller.js"
import { FakeStorage, clock } from "../support/usage.js"

const logs = captureLogs()
const servers: RouteServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
})

const KEYS = { alpha: "key-alpha", beta: "key-beta" }
const as = (app: "alpha" | "beta") => ({ authorization: `Bearer ${KEYS[app]}` })
const post = (body: Record<string, unknown> = {}, app?: "alpha" | "beta"): SendInit => ({
  method: "POST",
  path: "/v1/responses",
  ...(app ? { headers: as(app) } : {}),
  body: { model: "test/echo", input: "hi", ...body },
})
const read = (path: string, app?: "alpha" | "beta", method = "GET"): SendInit => ({ method, path, ...(app ? { headers: as(app) } : {}) })

/** A route whose model answers "answer N" to its Nth call. */
async function route(options: Record<string, unknown> = {}, script: Script | ((n: number) => Script) = (n) => [ev.text(`answer ${n + 1}`), ev.finish()], responses?: ResponseStore) {
  const caller = new FakeModelCaller(typeof script === "function" ? (_request, n) => script(n) : script)
  const server = await startRoute({ caller, options, ...(responses ? { responses } : {}) })
  servers.push(server)
  return { caller, server }
}

const textsOf = (caller: FakeModelCaller, call: number) =>
  caller.calls[call]!.request.messages.map((message) => `${message.role}:${message.content.map((part) => (part.type === "text" ? part.text : part.type)).join("")}`)

describe("previous_response_id", () => {
  test("a chain of three: each turn sees the input and output of the turns before it, and instructions do not carry over", async () => {
    const { caller, server } = await route()
    const first = (await server.send(post({ input: "q1", instructions: "be brief" }))).json()
    const second = (await server.send(post({ input: "q2", previous_response_id: first.id }))).json()
    const third = (await server.send(post({ input: "q3", previous_response_id: second.id, instructions: "now rhyme" }))).json()

    expect(second.previous_response_id).toBe(first.id)
    expect(third.previous_response_id).toBe(second.id)
    expect(first.previous_response_id).toBeNull()
    expect(textsOf(caller, 1)).toEqual(["user:q1", "assistant:answer 1", "user:q2"])
    expect(textsOf(caller, 2)).toEqual(["user:q1", "assistant:answer 1", "user:q2", "assistant:answer 2", "user:q3"])
    // OpenAI's rule: the instructions of the first turn are not the next turn's.
    expect(caller.calls[0]!.request.system).toEqual(["be brief"])
    expect(caller.calls[1]!.request.system).toEqual([])
    expect(caller.calls[2]!.request.system).toEqual(["now rhyme"])
  })

  test("a function call and its output chain through a stored response", async () => {
    const { caller, server } = await route({}, (n) => (n === 0 ? [ev.call("call_1", "weather", { city: "Oslo" }), ev.finish("tool-calls")] : [ev.text("sunny in Oslo"), ev.finish()]))
    const tools = [{ type: "function", name: "weather", parameters: { type: "object", properties: {} } }]
    const first = (await server.send(post({ input: "weather?", tools }))).json()
    expect(first.output[0]).toMatchObject({ type: "function_call", call_id: "call_1" })
    const second = await server.send(post({ input: [{ type: "function_call_output", call_id: "call_1", output: "sunny" }], tools, previous_response_id: first.id }))
    expect(second.status).toBe(200)
    expect(caller.calls[1]!.request.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"])
  })

  test("an unknown id is a 400 in OpenAI's shape, before any model call", async () => {
    const { caller, server } = await route()
    const id = `resp_${"0".repeat(32)}`
    const reply = await server.send(post({ previous_response_id: id }))
    expect(reply.status).toBe(400)
    expect(reply.json().error).toMatchObject({
      type: "invalid_request_error",
      code: "previous_response_not_found",
      param: "previous_response_id",
      message: `Previous response with id '${id}' not found.`,
    })
    expect(caller.calls).toEqual([])
    // A value that is no id of ours is the same answer: nothing is looked up for it.
    expect((await server.send(post({ previous_response_id: "../../keys/x" }))).status).toBe(400)
  })

  test("I32 another app's id is the same 404 as an unknown one (a 400 on POST), and the owner's chain is untouched", async () => {
    const { caller, server } = await route({ keys: KEYS })
    const mine = (await server.send(post({ input: "secret" }, "alpha"))).json()
    const theirs = await server.send(post({ previous_response_id: mine.id }, "beta"))
    const unknown = await server.send(post({ previous_response_id: `resp_${"1".repeat(32)}` }, "beta"))
    expect(theirs.status).toBe(400)
    expect(unknown.status).toBe(400)
    expect(theirs.json().error.code).toBe("previous_response_not_found")
    expect(theirs.json().error.message.replace(mine.id, "ID")).toBe(unknown.json().error.message.replace(`resp_${"1".repeat(32)}`, "ID"))
    expect(caller.calls).toHaveLength(1)
    expect((await server.send(post({ previous_response_id: mine.id }, "alpha"))).status).toBe(200)
  })

  test("a streamed turn chains too: the closing event names the previous id and the answer is retrievable at once", async () => {
    const { caller, server } = await route()
    const first = (await server.send(post({ input: "q1" }))).json()
    const streamed = await server.send(post({ input: "q2", stream: true, previous_response_id: first.id }))
    const frames = parseSse(streamed.text).map((frame) => ({ event: frame.event, data: JSON.parse(frame.data!) }))
    const completed = frames.find((frame) => frame.event === "response.completed")!
    expect(frames.at(-1)!.event).toBe("response.completed")
    expect(completed.data.response).toMatchObject({ previous_response_id: first.id, store: true })
    expect(textsOf(caller, 1)).toEqual(["user:q1", "assistant:answer 1", "user:q2"])
    const fetched = await server.send(read(`/v1/responses/${completed.data.response.id}`))
    expect(fetched.status).toBe(200)
    expect(fetched.json()).toEqual(completed.data.response)
    // The streamed answer is a link in a chain as well.
    const third = await server.send(post({ input: "q3", previous_response_id: completed.data.response.id }))
    expect(third.status).toBe(200)
    expect(textsOf(caller, 2)).toHaveLength(5)
  })

  test("a failed answer is not stored", async () => {
    const storage = new FakeStorage()
    const { server } = await route({}, [ev.error({ status: 429, kind: "rate_limit", message: "slow" })], createResponseStore({ storage, state: createResponseState() }))
    expect((await server.send(post())).status).toBe(429)
    expect(storage.puts).toEqual([])
  })
})

describe("store", () => {
  test("store: false is not retrievable, not chainable and writes nothing", async () => {
    const storage = new FakeStorage()
    const { server } = await route({}, undefined, createResponseStore({ storage, state: createResponseState() }))
    const answer = (await server.send(post({ store: false }))).json()
    expect(answer.store).toBe(false)
    expect((await server.send(read(`/v1/responses/${answer.id}`))).status).toBe(404)
    expect((await server.send(post({ previous_response_id: answer.id }))).status).toBe(400)
    expect(storage.puts).toEqual([])
    // The default keeps it, and the response says so.
    expect((await server.send(post())).json().store).toBe(true)
    expect(storage.puts.length).toBeGreaterThan(0)
  })

  test("a streamed store: false answer is not kept either", async () => {
    const storage = new FakeStorage()
    const { server } = await route({}, undefined, createResponseStore({ storage, state: createResponseState() }))
    const frames = parseSse((await server.send(post({ store: false, stream: true }))).text).map((frame) => JSON.parse(frame.data!))
    expect(frames.at(-1).type).toBe("response.completed")
    expect(storage.puts).toEqual([])
  })

  test("GET returns the stored response object exactly as the caller got it", async () => {
    const { server } = await route()
    const answer = (await server.send(post({ input: "hello", metadata: { run: "1" } }))).json()
    const fetched = await server.send(read(`/v1/responses/${answer.id}`))
    expect(fetched.status).toBe(200)
    expect(fetched.json()).toEqual(answer)
  })

  test("GET with stream=true is refused: a stored response is not replayed", async () => {
    const { server } = await route()
    const answer = (await server.send(post())).json()
    const reply = await server.send(read(`/v1/responses/${answer.id}?stream=true`))
    expect(reply.status).toBe(400)
    expect(reply.json().error).toMatchObject({ code: "unsupported_parameter", param: "stream" })
  })

  test("DELETE returns the deleted object, then every id route is a 404 and chaining from it a 400", async () => {
    const { server } = await route()
    const answer = (await server.send(post({ input: "q1" }))).json()
    const deleted = await server.send(read(`/v1/responses/${answer.id}`, undefined, "DELETE"))
    expect(deleted.status).toBe(200)
    expect(deleted.json()).toEqual({ id: answer.id, object: "response.deleted", deleted: true })
    for (const request of [read(`/v1/responses/${answer.id}`), read(`/v1/responses/${answer.id}/input_items`), read(`/v1/responses/${answer.id}`, undefined, "DELETE")]) {
      const reply = await server.send(request)
      expect(reply.status).toBe(404)
      expect(reply.json().error.type).toBe("invalid_request_error")
    }
    const chained = await server.send(post({ previous_response_id: answer.id }))
    expect(chained.status).toBe(400)
    expect(chained.json().error).toMatchObject({ type: "invalid_request_error", code: "previous_response_not_found", param: "previous_response_id" })
  })

  test("deleting a response also drops its items from the item_reference memory", async () => {
    const { server } = await route()
    const answer = (await server.send(post())).json()
    const reference: SendInit = post({
      input: [
        { type: "item_reference", id: answer.output[0].id },
        { role: "user", content: "again" },
      ],
    })
    expect((await server.send(reference)).status).toBe(200)
    await server.send(read(`/v1/responses/${answer.id}`, undefined, "DELETE"))
    expect((await server.send(reference)).json().error.code).toBe("item_not_found")
  })

  test("a deleted response leaves the chain after it intact", async () => {
    const { server } = await route()
    const first = (await server.send(post({ input: "q1" }))).json()
    const second = (await server.send(post({ input: "q2", previous_response_id: first.id }))).json()
    await server.send(read(`/v1/responses/${first.id}`, undefined, "DELETE"))
    // The second response holds its whole input, so it still lists and chains.
    expect((await server.send(read(`/v1/responses/${second.id}/input_items?order=asc`))).json().data).toHaveLength(3)
    expect((await server.send(post({ input: "q3", previous_response_id: second.id }))).status).toBe(200)
  })

  test("I32 another app reads, lists and deletes nothing of mine: every route is a 404 and the response survives", async () => {
    const { server } = await route({ keys: KEYS })
    const mine = (await server.send(post({ input: "secret" }, "alpha"))).json()
    for (const request of [read(`/v1/responses/${mine.id}`, "beta"), read(`/v1/responses/${mine.id}/input_items`, "beta"), read(`/v1/responses/${mine.id}`, "beta", "DELETE")]) {
      const reply = await server.send(request)
      expect(reply.status).toBe(404)
      expect(reply.text).not.toContain("secret")
    }
    expect((await server.send(read(`/v1/responses/${mine.id}`, "alpha"))).json()).toEqual(mine)
    expect((await server.send(read(`/v1/responses/${mine.id}`, "alpha", "DELETE"))).status).toBe(200)
  })

  test("the routes need a key like every other route: no key is a 401 and names nothing", async () => {
    const { server } = await route({ keys: KEYS })
    const mine = (await server.send(post({}, "alpha"))).json()
    for (const method of ["GET", "DELETE"]) expect((await server.send(read(`/v1/responses/${mine.id}`, undefined, method))).status).toBe(401)
    expect((await server.send(read(`/v1/responses/${mine.id}/input_items`))).status).toBe(401)
  })

  test("an app limited to other endpoints is refused on the stored routes: they belong to the responses endpoint", async () => {
    const { server } = await route({ keys: KEYS, apps: { beta: { endpoints: ["chat"] } } })
    const reply = await server.send(read(`/v1/responses/resp_${"2".repeat(32)}`, "beta"))
    expect(reply.status).toBe(403)
    expect(reply.json().error.code).toBe("endpoint_forbidden")
  })

  test("a method the route does not have is an unknown route", async () => {
    const { server } = await route()
    const answer = (await server.send(post())).json()
    expect((await server.send({ method: "POST", path: `/v1/responses/${answer.id}`, body: {} })).status).toBe(404)
    expect((await server.send({ method: "DELETE", path: `/v1/responses/${answer.id}/input_items` })).status).toBe(404)
  })
})

describe("GET /v1/responses/{id}/input_items", () => {
  /** A chain of three turns: six input items, oldest first: q1, a1, q2, a2, q3 and, in a response of its own, nothing more. */
  async function chain() {
    const { server } = await route()
    const first = (await server.send(post({ input: "q1" }))).json()
    const second = (await server.send(post({ input: "q2", previous_response_id: first.id }))).json()
    const third = (await server.send(post({ input: "q3", previous_response_id: second.id }))).json()
    return { server, third, items: `/v1/responses/${third.id}/input_items` }
  }
  const textOf = (item: { content: Array<{ text: string }> }) => item.content[0]!.text

  test("lists every input the model saw, newest first by default, as OpenAI's list object", async () => {
    const { server, items } = await chain()
    const page = (await server.send(read(items))).json()
    expect(page.object).toBe("list")
    expect(page.data.map(textOf)).toEqual(["q3", "answer 2", "q2", "answer 1", "q1"])
    expect(page.has_more).toBe(false)
    expect(page.first_id).toBe(page.data[0].id)
    expect(page.last_id).toBe(page.data.at(-1).id)
    expect(page.data.every((item: { id: string }) => typeof item.id === "string" && item.id.length > 0)).toBe(true)
    expect(page.data[0]).toMatchObject({ type: "message", role: "user" })
    expect(new Set(page.data.map((item: { id: string }) => item.id)).size).toBe(5)
  })

  test("limit, order and after page through the items", async () => {
    const { server, items } = await chain()
    const asc = (await server.send(read(`${items}?order=asc&limit=2`))).json()
    expect(asc.data.map(textOf)).toEqual(["q1", "answer 1"])
    expect(asc.has_more).toBe(true)
    const next = (await server.send(read(`${items}?order=asc&limit=2&after=${asc.last_id}`))).json()
    expect(next.data.map(textOf)).toEqual(["q2", "answer 2"])
    expect(next.has_more).toBe(true)
    const last = (await server.send(read(`${items}?order=asc&limit=2&after=${next.last_id}`))).json()
    expect(last.data.map(textOf)).toEqual(["q3"])
    expect(last.has_more).toBe(false)
    const empty = (await server.send(read(`${items}?order=asc&after=${last.last_id}`))).json()
    expect(empty).toEqual({ object: "list", data: [], first_id: null, last_id: null, has_more: false })
    // Newest first, `after` continues down the list.
    const desc = (await server.send(read(`${items}?limit=2`))).json()
    expect(desc.data.map(textOf)).toEqual(["q3", "answer 2"])
    expect((await server.send(read(`${items}?limit=2&after=${desc.last_id}`))).json().data.map(textOf)).toEqual(["q2", "answer 1"])
  })

  test("a limit outside 1 to 100, a bad order and an unknown cursor are 400s that name the parameter", async () => {
    const { server, items } = await chain()
    for (const [query, param, code] of [
      ["limit=0", "limit", "integer_below_min_value"],
      ["limit=101", "limit", "integer_above_max_value"],
      ["limit=abc", "limit", "invalid_type"],
      ["order=sideways", "order", "invalid_value"],
      ["after=msg_nope", "after", "invalid_cursor"],
    ] as const) {
      const reply = await server.send(read(`${items}?${query}`))
      expect(reply.status).toBe(400)
      expect(reply.json().error).toMatchObject({ type: "invalid_request_error", param, code })
    }
    expect((await server.send(read(`${items}?limit=100`))).status).toBe(200)
  })

  test("an item the caller sent with an id keeps it; a missing or repeated id gets a new one", async () => {
    const { server } = await route()
    const answer = (
      await server.send(
        post({
          input: [
            { id: "msg_mine", type: "message", role: "user", content: [{ type: "input_text", text: "a" }] },
            { id: "msg_mine", type: "message", role: "user", content: [{ type: "input_text", text: "b" }] },
            { type: "message", role: "user", content: [{ type: "input_text", text: "c" }] },
          ],
        }),
      )
    ).json()
    const ids = (await server.send(read(`/v1/responses/${answer.id}/input_items?order=asc`))).json().data.map((item: { id: string }) => item.id)
    expect(ids[0]).toBe("msg_mine")
    expect(new Set(ids).size).toBe(3)
  })

  test("an item_reference is stored as the item it names", async () => {
    const { server } = await route()
    const first = (await server.send(post())).json()
    const second = (
      await server.send(
        post({
          input: [
            { type: "item_reference", id: first.output[0].id },
            { role: "user", content: "again" },
          ],
        }),
      )
    ).json()
    const page = (await server.send(read(`/v1/responses/${second.id}/input_items?order=asc`))).json()
    expect(page.data[0]).toMatchObject({ id: first.output[0].id, type: "message", role: "assistant" })
  })

  test("#546 shorthand messages are listed in OpenAI's full shape: type message, role, and content as parts", async () => {
    const { server } = await route()
    const answer = (
      await server.send(
        post({
          input: [
            { role: "system", content: "be brief" },
            { role: "user", content: [{ type: "input_text", text: "parts" }] },
            { role: "assistant", content: "earlier answer" },
            { type: "message", role: "user", content: "typed string" },
          ],
        }),
      )
    ).json()
    const page = (await server.send(read(`/v1/responses/${answer.id}/input_items?order=asc`))).json()
    expect(page.data).toEqual([
      { type: "message", role: "system", content: [{ type: "input_text", text: "be brief" }], id: expect.stringMatching(/^msg_/) },
      { type: "message", role: "user", content: [{ type: "input_text", text: "parts" }], id: expect.stringMatching(/^msg_/) },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "earlier answer" }], id: expect.stringMatching(/^msg_/) },
      { type: "message", role: "user", content: [{ type: "input_text", text: "typed string" }], id: expect.stringMatching(/^msg_/) },
    ])
  })

  test("#546 a shorthand turn chains: the next turn replays it and lists it with its type", async () => {
    const { caller, server } = await route()
    const first = (await server.send(post({ input: [{ role: "user", content: [{ type: "input_text", text: "Say ok" }] }] }))).json()
    const second = (await server.send(post({ input: "again", previous_response_id: first.id }))).json()
    expect(textsOf(caller, 1)).toEqual(["user:Say ok", "assistant:answer 1", "user:again"])
    const page = (await server.send(read(`/v1/responses/${second.id}/input_items?order=asc`))).json()
    expect(page.data.map((item: { type: string }) => item.type)).toEqual(["message", "message", "message"])
  })

  test("#546 a response stored before items were normalised is listed with a type too", async () => {
    const storage = new FakeStorage()
    const id = `resp_${"2".repeat(32)}`
    const legacy = { v: 1, createdAt: Date.now(), bytes: 0, input: [{ role: "user", content: [{ type: "input_text", text: "old" }], id: "msg_old" }], response: { id } }
    await storage.put(`responses/default/id/${id}`, JSON.stringify(legacy))
    const { server } = await route({}, undefined, createResponseStore({ storage, state: createResponseState() }))
    const page = (await server.send(read(`/v1/responses/${id}/input_items`))).json()
    expect(page.data).toEqual([{ type: "message", role: "user", content: [{ type: "input_text", text: "old" }], id: "msg_old" }])
  })
})

describe("retention and size", () => {
  const DAY = 86_400_000
  const fixture = async (options: Record<string, unknown> = {}) => {
    const storage = new FakeStorage()
    const time = clock("2026-10-17T00:00:00Z")
    const state = createResponseState()
    const store = createResponseStore({ storage, state, now: () => time.at })
    const { server, caller } = await route(options, undefined, store)
    return { storage, time, store, server, caller }
  }

  test("a response is kept for the app's history retention (30 days by default) and is then a 404, and gone from storage", async () => {
    const { server, time, storage } = await fixture()
    const answer = (await server.send(post())).json()
    time.at += 29 * DAY
    expect((await server.send(read(`/v1/responses/${answer.id}`))).status).toBe(200)
    time.at += 2 * DAY
    expect((await server.send(read(`/v1/responses/${answer.id}`))).status).toBe(404)
    expect((await server.send(post({ previous_response_id: answer.id }))).status).toBe(400)
    expect([...storage.values.keys()].filter((key) => key.startsWith("responses/"))).toEqual([])
  })

  test("sessions.maxAgeDays and the app's own sessions.maxAgeDays set the retention; 0 keeps the 30-day default", async () => {
    const own = await fixture({ keys: KEYS, sessions: { maxAgeDays: 7 }, apps: { beta: { sessions: { maxAgeDays: 2 } } } })
    const a = (await own.server.send(post({}, "alpha"))).json()
    const b = (await own.server.send(post({}, "beta"))).json()
    own.time.at += 3 * DAY
    expect((await own.server.send(read(`/v1/responses/${a.id}`, "alpha"))).status).toBe(200)
    expect((await own.server.send(read(`/v1/responses/${b.id}`, "beta"))).status).toBe(404)
    own.time.at += 5 * DAY
    expect((await own.server.send(read(`/v1/responses/${a.id}`, "alpha"))).status).toBe(404)

    const forever = await fixture({ sessions: { maxAgeDays: 0 } })
    const kept = (await forever.server.send(post())).json()
    forever.time.at += 29 * DAY
    expect((await forever.server.send(read(`/v1/responses/${kept.id}`))).status).toBe(200)
    forever.time.at += 2 * DAY
    expect((await forever.server.send(read(`/v1/responses/${kept.id}`))).status).toBe(404)
  })

  test("an answer too large to keep is still answered; retrieving it is a 404, and the log says it was skipped without the size of anything else", async () => {
    const { server, storage } = await fixture()
    const big = "x".repeat(9 * 1024 * 1024)
    const reply = await server.send(post({ input: big }))
    expect(reply.status).toBe(200)
    expect((await server.send(read(`/v1/responses/${reply.json().id}`))).status).toBe(404)
    expect(storage.puts).toEqual([])
    expect(logs.of("responses.store_skipped")[0]!.fields).toMatchObject({ reason: "too_large" })
  })

  test("a storage failure is logged and the answer is still given", async () => {
    const { server, storage } = await fixture()
    storage.failPuts = true
    const reply = await server.send(post())
    expect(reply.status).toBe(200)
    expect(logs.of("responses.store_failed")[0]!.fields).toMatchObject({ op: "save" })
  })
})

describe("restart", () => {
  test("a stored response survives a restart: a new server on the same storage reads, lists and chains from it", async () => {
    const storage = new FakeStorage()
    const first = await route({}, undefined, createResponseStore({ storage, state: createResponseState() }))
    const answer = (await first.server.send(post({ input: "before" }))).json()
    await first.server.close()
    servers.splice(servers.indexOf(first.server), 1)

    const second = await route({}, undefined, createResponseStore({ storage, state: createResponseState() }))
    expect((await second.server.send(read(`/v1/responses/${answer.id}`))).json()).toEqual(answer)
    const next = await second.server.send(post({ input: "after", previous_response_id: answer.id }))
    expect(next.status).toBe(200)
    expect(textsOf(second.caller, 0)).toEqual(["user:before", "assistant:answer 1", "user:after"])
  })
})

describe("logs", () => {
  test("I32 no response id and no body text reaches a log line, on a hit, a miss, a delete or a failed store", async () => {
    const storage = new FakeStorage()
    const { server } = await route({ keys: KEYS }, undefined, createResponseStore({ storage, state: createResponseState() }))
    const mine = (await server.send(post({ input: "private words" }, "alpha"))).json()
    const missing = `resp_${"3".repeat(32)}`
    await server.send(read(`/v1/responses/${mine.id}`, "alpha"))
    await server.send(read(`/v1/responses/${mine.id}/input_items`, "alpha"))
    await server.send(read(`/v1/responses/${mine.id}`, "beta"))
    await server.send(read(`/v1/responses/${missing}`, "beta"))
    await server.send(post({ previous_response_id: mine.id }, "beta"))
    storage.failPuts = true
    await server.send(post({ input: "more private words" }, "alpha"))
    await server.send(read(`/v1/responses/${mine.id}`, "alpha", "DELETE"))
    const text = logs.lines.map((line) => line.raw).join("\n")
    expect(logs.of("request").length).toBeGreaterThan(5)
    expect(text).not.toContain(mine.id)
    expect(text).not.toContain(missing)
    expect(text).not.toContain("private words")
    expect(logs.of("request").map((line) => line.fields.route)).toEqual(expect.arrayContaining(["GET /v1/responses/{id}", "GET /v1/responses/{id}/input_items", "DELETE /v1/responses/{id}"]))
  })
})

describe("ids", () => {
  test("response ids are resp_ plus 128 random bits, and differ on every response", async () => {
    const { server } = await route()
    const ids = new Set<string>()
    for (let i = 0; i < 20; i++) ids.add((await server.send(post())).json().id)
    expect(ids.size).toBe(20)
    for (const id of ids) expect(id).toMatch(/^resp_[0-9a-f]{32}$/)
  })
})
