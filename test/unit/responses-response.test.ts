import { describe, expect, test } from "bun:test"
import type { PlugEvent } from "../../src/contract.js"
import { runResponse, sseFrame, type ResponsesExchange, type ResponsesStreamEvent } from "../../src/responses/response.js"
import { ev, events } from "../support/fixtures.js"

const plain: ResponsesExchange = { model: "fast", stream: true, envelope: { store: false, tools: [] } }
const structured: ResponsesExchange = { ...plain, structuredTool: "respond" }
const structuredWithTools: ResponsesExchange = { ...structured, callerTools: true }

async function run(exchange: ResponsesExchange, ...list: PlugEvent[]) {
  const emitted: ResponsesStreamEvent[] = []
  const result = await runResponse(events(...list), exchange, (event) => void emitted.push(event))
  return { ...result, response: result.response as any, emitted, types: emitted.map((event) => event.type) }
}

describe("runResponse: event order", () => {
  test("a text answer: created, in_progress, item and part added, deltas, done events, completed", async () => {
    const { types, emitted, response } = await run(plain, ev.text("Hel"), ev.text("lo"), ev.finish("stop"))
    expect(types).toEqual([
      "response.created",
      "response.in_progress",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "response.output_text.delta",
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.completed",
    ])
    expect(emitted.find((event) => event.type === "response.output_text.done")).toMatchObject({ text: "Hello", output_index: 0, content_index: 0 })
    expect(response).toMatchObject({ object: "response", status: "completed", model: "fast", store: false, error: null, output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Hello" }] }] })
    expect(response.id).toMatch(/^resp_[0-9a-f]{32}$/)
  })

  test("sequence numbers start at 0 and increase by one", async () => {
    const { emitted } = await run(plain, ev.text("a"), ev.call("c1", "f"), ev.text("b"), ev.finish())
    expect(emitted.map((event) => event.sequence_number)).toEqual(emitted.map((_, index) => index))
  })

  test("text then a tool call: the message closes before the function_call item, output indexes follow", async () => {
    const { types, response } = await run(plain, ev.text("let me look"), ev.call("c1", "search", { q: "x" }), ev.finish("tool-calls"))
    expect(types.slice(4)).toEqual([
      "response.output_text.delta",
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.output_item.added",
      "response.function_call_arguments.delta",
      "response.function_call_arguments.done",
      "response.output_item.done",
      "response.completed",
    ])
    expect(response.output.map((item: any) => [item.type, item.status])).toEqual([
      ["message", "completed"],
      ["function_call", "completed"],
    ])
    expect(response.output[1]).toMatchObject({ call_id: "c1", name: "search", arguments: '{"q":"x"}' })
    expect(response.output[1].id).toMatch(/^fc_/)
  })

  test("reasoning deltas are dropped", async () => {
    const { emitted } = await run(plain, ev.reasoning("secret"), ev.text("x"), ev.finish())
    expect(JSON.stringify(emitted)).not.toContain("secret")
  })

  test("the envelope fields are echoed into the response object", async () => {
    const { response } = await run({ ...plain, envelope: { instructions: "i", tools: [{ type: "function", name: "f" }] } }, ev.text("x"), ev.finish())
    expect(response).toMatchObject({ instructions: "i", tools: [{ type: "function", name: "f" }] })
  })

  test("usage is inclusive and named the Responses way", async () => {
    const { response } = await run(plain, ev.text("x"), ev.finish("stop", { inputTokens: 5, outputTokens: 4, reasoningTokens: 1, cacheReadTokens: 2 }))
    expect(response.usage).toEqual({ input_tokens: 5, input_tokens_details: { cached_tokens: 2 }, output_tokens: 4, output_tokens_details: { reasoning_tokens: 1 }, total_tokens: 9 })
  })

  test.each([
    ["length", "max_output_tokens"],
    ["content-filter", "content_filter"],
  ] as const)("a %s finish is response.incomplete with reason %s", async (reason, wire) => {
    const { types, response } = await run(plain, ev.text("cut"), ev.finish(reason))
    expect(types.at(-1)).toBe("response.incomplete")
    expect(response).toMatchObject({ status: "incomplete", incomplete_details: { reason: wire } })
  })

  test("an empty answer still opens and completes the response", async () => {
    const { types, response } = await run(plain, ev.finish())
    expect(types).toEqual(["response.created", "response.in_progress", "response.completed"])
    expect(response.output).toEqual([])
  })
})

describe("runResponse: failures", () => {
  test("#38 a failure before any output emits nothing and returns the failure", async () => {
    const { emitted, started, failure } = await run(plain, ev.reasoning("x"), ev.error({ status: 429, kind: "rate_limit", message: "slow" }))
    expect(emitted).toEqual([])
    expect(started).toBe(false)
    expect(failure).toMatchObject({ status: 429 })
  })

  test("#49 a failure before output on a stream the transport already committed opens the response and fails it", async () => {
    const emitted: ResponsesStreamEvent[] = []
    const result = await runResponse(events(ev.reasoning("x"), ev.error({ message: "died" })), plain, (event) => void emitted.push(event), () => true)
    expect(emitted.map((event) => [event.type, event.sequence_number])).toEqual([
      ["response.created", 0],
      ["response.in_progress", 1],
      ["response.failed", 2],
    ])
    expect(result).toMatchObject({ started: true, failure: { message: "died" }, response: { status: "failed", output: [] } })
  })

  test("#38 a failure after output closes the open message and emits response.failed", async () => {
    const { types, response } = await run(plain, ev.text("part"), ev.error({ message: "boom", code: "upstream" }))
    expect(types.slice(-4)).toEqual(["response.output_text.done", "response.content_part.done", "response.output_item.done", "response.failed"])
    expect(response).toMatchObject({ status: "failed", error: { code: "upstream", message: "boom" }, output: [{ type: "message", content: [{ text: "part" }] }] })
  })

  test("the error code falls back to the kind", async () => {
    expect((await run(plain, ev.text("x"), ev.error({ kind: "timeout", message: "late" }))).response.error).toEqual({ code: "timeout", message: "late" })
  })

  test("a finish with reason error fails the run", async () => {
    expect((await run(plain, ev.finish("error"))).failure).toMatchObject({ status: 500, message: "Model run failed" })
  })

  test("a stream without a finish fails the run", async () => {
    expect((await run(plain, ev.text("x"))).failure).toMatchObject({ status: 500, message: "Model stream ended without a finish event" })
  })
})

describe("runResponse: structured output (text.format json_schema)", () => {
  test("the first respond call's arguments are the message text; prose and other calls are dropped", async () => {
    const { response } = await run(structured, ev.text("prose"), ev.call("c0", "other"), ev.call("c1", "respond", { a: 1 }), ev.call("c2", "respond", { a: 2 }), ev.finish("tool-calls"))
    expect(response.output).toHaveLength(1)
    expect(response.output[0].content[0].text).toBe('{"a":1}')
    expect(response.status).toBe("completed")
  })

  test("no respond call is a structured_output_missing failure", async () => {
    expect((await run(structured, ev.finish())).failure).toMatchObject({ status: 502, code: "structured_output_missing" })
  })

  test("with caller tools, a caller call replaces the held answer", async () => {
    const { response } = await run(structuredWithTools, ev.call("c1", "respond", { a: 1 }), ev.call("c2", "search"), ev.finish("tool-calls"))
    expect(response.output.map((item: any) => item.type)).toEqual(["function_call"])
  })

  test("with caller tools and only an answer, the answer is emitted at the finish", async () => {
    const { response } = await run(structuredWithTools, ev.call("c1", "respond", { a: 1 }), ev.finish("tool-calls"))
    expect(response.output[0].content[0].text).toBe('{"a":1}')
  })
})

describe("sseFrame", () => {
  test("names the event and carries it as data", () => {
    expect(sseFrame({ type: "response.created", sequence_number: 0, x: 1 })).toBe('event: response.created\ndata: {"type":"response.created","sequence_number":0,"x":1}\n\n')
  })
})

describe("#173 runResponse: a text answer and the 502 for every finish", () => {
  const schema = { type: "object", required: ["a"], properties: { a: { type: "number" } } }
  const withSchema: ResponsesExchange = { ...structured, structuredSchema: schema }

  test("the final text is the answer when it is the schema's JSON, flagged as a fallback", async () => {
    const { response, failure, emitted, ...rest } = await run(withSchema, ev.text('{"a":3}'), ev.finish("stop"))
    expect(failure).toBeUndefined()
    expect(response).toMatchObject({ status: "completed", output: [{ content: [{ text: '{"a":3}' }] }] })
    expect(rest.structuredFallback).toBe(true)
    expect(emitted.map((event) => event.type)).toContain("response.output_text.delta")
  })

  test("one code fence around the JSON is stripped", async () => {
    const { response } = await run(withSchema, ev.text('```json\n{"a":3}\n```'), ev.finish("stop"))
    expect(response.output[0].content[0].text).toBe('{"a":3}')
  })

  test("a respond call wins over the text and is not flagged", async () => {
    const { response, structuredFallback } = await run(withSchema, ev.text('{"a":9}'), ev.call("c1", "respond", { a: 1 }), ev.finish("tool-calls"))
    expect(response.output[0].content[0].text).toBe('{"a":1}')
    expect(structuredFallback).toBeUndefined()
  })

  test("text that does not match the schema is a 502 before any output", async () => {
    const { failure, started, emitted } = await run(withSchema, ev.text('{"b":1}'), ev.finish("stop"))
    expect(failure).toMatchObject({ status: 502, code: "structured_output_missing" })
    expect(started).toBe(false)
    expect(emitted).toEqual([])
  })

  test.each(["length", "content-filter"] as const)("#173 a %s finish with no answer is a 502, not an incomplete response", async (reason) => {
    expect((await run(withSchema, ev.finish(reason))).failure).toMatchObject({ status: 502, code: "structured_output_missing" })
  })

  test("with caller tools, a caller call is the response and no fallback is taken", async () => {
    const { response, structuredFallback } = await run({ ...withSchema, callerTools: true }, ev.text('{"a":1}'), ev.call("c2", "search"), ev.finish("tool-calls"))
    expect(response.output.map((item: any) => item.type)).toEqual(["function_call"])
    expect(structuredFallback).toBeUndefined()
  })

  test("streamed: a missing answer after committed prose ends as response.failed, not a completed answer", async () => {
    const emitted: ResponsesStreamEvent[] = []
    const result = await runResponse(events(ev.text("prose"), ev.finish("stop")), withSchema, (event) => void emitted.push(event), () => true)
    expect(result.failure).toMatchObject({ code: "structured_output_missing" })
    expect(emitted.at(-1)!.type).toBe("response.failed")
  })
})
