/**
 * #58 `n` > 1 (src/openai/fanout.ts) and #75 legacy `/v1/completions`, over loopback HTTP: one
 * model call per choice, merged into one answer; any failure fails the request and cancels the
 * other choices.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { RequestAborted } from "../../src/http.js"
import { CATALOG, ev, gate, until } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { sseData, startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller, type Script } from "../support/model-caller.js"

const logs = captureLogs()
let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

async function route(script: Script | ((request: unknown, call: number) => Script), options: Record<string, unknown> = {}) {
  const caller = new FakeModelCaller(script as never)
  server = await startRoute({ caller, options: { maxChoices: 4, ...options } })
  return caller
}

const chat = (body: Record<string, unknown> = {}): SendInit => ({ method: "POST", path: "/v1/chat/completions", body: { model: "test/echo", messages: [{ role: "user", content: "hi" }], ...body } })
const completions = (body: Record<string, unknown> = {}): SendInit => ({ method: "POST", path: "/v1/completions", body: { model: "test/echo", prompt: "Once", ...body } })
const usage = (input: number, output: number) => ({ inputTokens: input, outputTokens: output, cacheReadTokens: 1 })

describe("#58 chat completions with n > 1, non-streaming", () => {
  test("one model call per choice, merged in choice order with summed usage and every session id", async () => {
    const caller = await route((_request, call) => [{ record: `ses_${call}` }, ev.text(`answer ${call}`), ev.finish("stop", usage(10, call + 1))])
    const reply = await server!.send(chat({ n: 3 }))
    expect(caller.calls).toHaveLength(3)
    expect(reply.status).toBe(200)
    const body = reply.json()
    expect(body.choices.map((choice: any) => [choice.index, choice.message.content])).toEqual([
      [0, "answer 0"],
      [1, "answer 1"],
      [2, "answer 2"],
    ])
    expect(body.usage).toEqual({ prompt_tokens: 30, completion_tokens: 6, total_tokens: 36, prompt_tokens_details: { cached_tokens: 3 }, completion_tokens_details: { reasoning_tokens: 0 } })
    expect(reply.headers["x-plugboard-session"]).toBe("ses_0,ses_1,ses_2")
  })

  test("n above maxChoices is a 400 too_many_choices before any model call", async () => {
    const caller = await route([ev.finish()], { maxChoices: 2 })
    const reply = await server!.send(chat({ n: 3 }))
    expect(reply.status).toBe(400)
    expect(reply.json().error).toMatchObject({ code: "too_many_choices", param: "n" })
    expect(caller.calls).toEqual([])
  })

  test("one failing choice fails the request with its status and cancels the others", async () => {
    const caller = await route((_request, call) => (call === 1 ? [ev.error({ status: 429, kind: "rate_limit", message: "slow" })] : ["hang"]))
    const reply = await server!.send(chat({ n: 3 }))
    expect(reply.status).toBe(429)
    expect(reply.json().error.message).toBe("slow")
    for (const index of [0, 2]) expect(await caller.calls[index]!.aborted).toBeInstanceOf(RequestAborted)
  })
})

describe("#58 chat completions with n > 1, streaming", () => {
  test("choices interleave under one stream id, each chunk carrying its index, with one [DONE]", async () => {
    const release = gate()
    await route((_request, call) => (call === 0 ? [ev.text("A1"), { wait: release.promise }, ev.text("A2"), ev.finish()] : [ev.text("B1"), ev.finish()]))
    const stream = await server!.open(chat({ n: 2, stream: true }))
    await stream.waitFor((text) => text.includes('"finish_reason":"stop"'))
    release.open()
    const text = await stream.ended
    const chunks = sseData(text)
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(1)
    const order = chunks.map((chunk) => `${chunk.choices[0].index}:${chunk.choices[0].delta.content ?? chunk.choices[0].finish_reason}`)
    // Choice 1 finished while choice 0 was still waiting.
    expect(order.indexOf("1:stop")).toBeLessThan(order.indexOf("0:A2"))
    expect(order.filter((entry) => entry.startsWith("0:"))).toEqual(["0:", "0:A1", "0:A2", "0:stop"])
    expect(text.match(/\[DONE\]/g)).toHaveLength(1)
  })

  test("#423 every choice opens with its role chunk, in index order, before any content, even when choice 1 answers first", async () => {
    const release = gate()
    await route((_request, call) => (call === 0 ? [{ wait: release.promise }, ev.text("A1"), ev.finish()] : [ev.text("B1"), ev.finish()]))
    const stream = await server!.open(chat({ n: 2, stream: true }))
    await stream.waitFor((text) => text.includes('"B1"'))
    release.open()
    const chunks = sseData(await stream.ended)
    // The openai-python stream helper keeps choices in arrival order and indexes them by `index`: a new index must be the next one.
    const known = new Set<number>()
    for (const chunk of chunks)
      for (const choice of chunk.choices) {
        if (known.has(choice.index)) continue
        expect(choice.index).toBe(known.size)
        known.add(choice.index)
      }
    expect(chunks.slice(0, 2).map((chunk) => [chunk.choices[0].index, chunk.choices[0].delta])).toEqual([
      [0, { role: "assistant", content: "" }],
      [1, { role: "assistant", content: "" }],
    ])
    expect(chunks.findIndex((chunk) => chunk.choices[0].delta.content === "B1")).toBeGreaterThan(1)
  })

  test("include_usage: one final chunk with the summed usage", async () => {
    await route((_request, call) => [ev.text("x"), ev.finish("stop", usage(5, call + 1))])
    const chunks = sseData(await (await server!.open(chat({ n: 2, stream: true, stream_options: { include_usage: true } }))).ended)
    expect(chunks.filter((chunk) => chunk.usage)).toEqual([expect.objectContaining({ choices: [], usage: expect.objectContaining({ prompt_tokens: 10, completion_tokens: 3 }) })])
  })

  test("#390 review: include_usage with n > 1 and no usage from any choice still ends with a usage chunk of zeros", async () => {
    await route(() => [ev.text("x"), ev.finish("stop")])
    const chunks = sseData(await (await server!.open(chat({ n: 2, stream: true, stream_options: { include_usage: true } }))).ended)
    expect(chunks.filter((chunk) => chunk.usage)).toEqual([expect.objectContaining({ choices: [], usage: expect.objectContaining({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }) })])
  })

  test("a failure after the stream committed is one error frame and [DONE]; the other choice is cancelled", async () => {
    const caller = await route((_request, call) => (call === 0 ? [ev.text("A1"), "hang"] : [ev.text("B1"), ev.error({ message: "died", code: "upstream" })]))
    const stream = await server!.open(chat({ n: 2, stream: true }))
    const text = await stream.ended
    expect(stream.status).toBe(200)
    expect(sseData(text).at(-1)).toEqual({ error: { message: "died", type: "server_error", param: null, code: "upstream" } })
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true)
    expect(await caller.calls[0]!.aborted).toBeInstanceOf(RequestAborted)
    expect(logs.of("request.failed")[0]!.fields).toMatchObject({ outcome: "error", error: "upstream" })
  })

  test("a failure before anything was sent keeps its HTTP status", async () => {
    await route((_request, call) => (call === 0 ? ["hang"] : [ev.error({ status: 503, message: "down" })]))
    expect((await server!.send(chat({ n: 2, stream: true }))).status).toBe(503)
  })

  test("a client that hangs up cancels every choice", async () => {
    const caller = await route([ev.text("x"), "hang"])
    const stream = await server!.open(chat({ n: 3, stream: true }))
    await stream.waitFor((text) => text.includes('"x"'))
    stream.destroy()
    for (const call of [0, 1, 2]) expect(((await caller.calls[call]!.aborted) as RequestAborted).kind).toBe("disconnected")
    await until(() => caller.calls.every((call) => call.closed), 1_000, "every choice stream to close")
  })
})

describe("#75 POST /v1/completions", () => {
  test("a prompt is one user message; the answer is a text_completion", async () => {
    const caller = await route([ev.text(" upon a time"), ev.finish("stop", { inputTokens: 2, outputTokens: 4 })])
    const reply = await server!.send(completions({ max_tokens: 8 }))
    expect(caller.call.request).toMatchObject({ system: [], tools: [], messages: [{ role: "user", content: [{ type: "text", text: "Once" }] }], generation: { maxTokens: 8 } })
    expect(reply.json()).toMatchObject({
      object: "text_completion",
      model: "test/echo",
      choices: [{ index: 0, text: " upon a time", finish_reason: "stop", logprobs: null }],
      usage: { total_tokens: 6 },
    })
    expect(logs.of("request")[0]!.fields).toMatchObject({ route: "POST /v1/completions", model: "test/echo" })
  })

  test("a prompt list with n: choice i answers prompt floor(i / n), echo prefixes it", async () => {
    const caller = await route((request: any) => [ev.text(` <${request.messages[0].content[0].text}>`), ev.finish()])
    const reply = await server!.send(completions({ prompt: ["a", "b"], n: 2, echo: true }))
    expect(caller.calls).toHaveLength(4)
    expect(reply.json().choices.map((choice: any) => [choice.index, choice.text])).toEqual([
      [0, "a <a>"],
      [1, "a <a>"],
      [2, "b <b>"],
      [3, "b <b>"],
    ])
  })

  test("a stream: text chunks per choice, finish chunks, one [DONE]", async () => {
    await route([ev.text("x"), ev.finish()])
    const stream = await server!.open(completions({ stream: true }))
    const text = await stream.ended
    expect(sseData(text).map((chunk) => [chunk.object, chunk.choices[0].text, chunk.choices[0].finish_reason])).toEqual([
      ["text_completion", "x", null],
      ["text_completion", "", "stop"],
    ])
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true)
  })

  test("sampling parameters a model rejects are dropped and reported, like chat", async () => {
    const caller = new FakeModelCaller([ev.finish()])
    server = await startRoute({ caller, catalog: [...CATALOG, { providerID: "openai", id: "gpt-5.5", variants: [] }], options: { models: ["openai/*"] } })
    const reply = await server.send(completions({ model: "openai/gpt-5.5", temperature: 0.3 }))
    expect(reply.headers["x-plugboard-dropped-params"]).toBe("temperature")
    expect(caller.call.request.generation).toEqual({})
  })

  test("token-array prompts are a 400 before any model call", async () => {
    const caller = await route([ev.finish()])
    const reply = await server!.send(completions({ prompt: [1, 2] }))
    expect(reply.status).toBe(400)
    expect(reply.json().error.code).toBe("unsupported_parameter")
    expect(caller.calls).toEqual([])
  })
})

describe("#169 POST /v1/completions with response_format", () => {
  const schema = { type: "object", properties: { a: { type: "number" } }, required: ["a"] }
  const jsonSchema = { type: "json_schema", json_schema: { name: "answer", schema } }

  test("json_schema offers the respond tool, forced, and answers with its arguments as text", async () => {
    const caller = await route([ev.call("c1", "respond", { a: 42 }), ev.finish("tool-calls")])
    const reply = await server!.send(completions({ response_format: jsonSchema }))
    expect(caller.call.request).toMatchObject({ tools: [{ name: "respond", parameters: schema }], toolChoice: { type: "tool", name: "respond" } })
    expect(reply.status).toBe(200)
    expect(reply.json()).toMatchObject({ object: "text_completion", choices: [{ text: '{"a":42}', finish_reason: "stop" }] })
  })

  test("a prose answer to json_schema is a 502 structured_output_missing, not a 200 with prose", async () => {
    await route([ev.text("6 × 7 = 42"), ev.finish("stop")])
    const reply = await server!.send(completions({ response_format: jsonSchema }))
    expect(reply.status).toBe(502)
    expect(reply.json().error.code).toBe("structured_output_missing")
  })

  test("json_object: the system instruction is sent and one code fence is stripped", async () => {
    const caller = await route([ev.text('```json\n{"ok":true}\n```'), ev.finish("stop")])
    const reply = await server!.send(completions({ response_format: { type: "json_object" } }))
    expect(caller.call.request.system).toHaveLength(1)
    expect(reply.json().choices[0].text).toBe('{"ok":true}')
  })

  test("streamed json_schema: one text chunk with the answer, then the finish chunk and [DONE]", async () => {
    await route([ev.call("c1", "respond", { a: 1 }), ev.finish("tool-calls")])
    const stream = await server!.open(completions({ response_format: jsonSchema, stream: true }))
    const text = await stream.ended
    const chunks = sseData(text)
    expect(chunks.map((chunk) => chunk.choices[0].text)).toEqual(['{"a":1}', ""])
    expect(chunks.at(-1).choices[0].finish_reason).toBe("stop")
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true)
  })
})

describe("#170 a structured answer in the text, over HTTP", () => {
  const schema = { type: "object", properties: { city: { type: "string" } }, required: ["city"] }
  const jsonSchema = { type: "json_schema", json_schema: { name: "city", schema } }

  test("chat: a text answer that matches the schema is returned with x-plugboard-structured-fallback: text", async () => {
    await route([ev.text('{"city":"Oslo"}'), ev.finish("stop")])
    const reply = await server!.send(chat({ response_format: jsonSchema }))
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-structured-fallback"]).toBe("text")
    expect(reply.json().choices[0].message.content).toBe('{"city":"Oslo"}')
  })

  test("chat: a respond call is answered without the header", async () => {
    await route([ev.call("c1", "respond", { city: "Oslo" }), ev.finish("tool-calls")])
    const reply = await server!.send(chat({ response_format: jsonSchema }))
    expect(reply.headers["x-plugboard-structured-fallback"]).toBeUndefined()
    expect(reply.json().choices[0].message.content).toBe('{"city":"Oslo"}')
  })

  test("completions: the same fallback and header", async () => {
    await route([ev.text('{"city":"Oslo"}'), ev.finish("stop")])
    const reply = await server!.send(completions({ response_format: jsonSchema }))
    expect(reply.headers["x-plugboard-structured-fallback"]).toBe("text")
    expect(reply.json().choices[0].text).toBe('{"city":"Oslo"}')
  })

  test("text that does not match the schema is still a 502 structured_output_missing", async () => {
    await route([ev.text("Oslo"), ev.finish("stop")])
    const reply = await server!.send(chat({ response_format: jsonSchema }))
    expect(reply.status).toBe(502)
    expect(reply.json().error.code).toBe("structured_output_missing")
  })
})

describe("reasoningOutput with n > 1 (since 0.36.0): each choice keeps its own reasoning", () => {
  const thinking = (_request: unknown, call: number) => [ev.reasoning(`think ${call}`), ev.text(`answer ${call}`), ev.finish("stop")]

  test("JSON: each choice carries its own reasoning under both names", async () => {
    await route(thinking, { reasoningOutput: true })
    const reply = await server!.send(chat({ n: 2 }))
    expect(reply.status).toBe(200)
    expect(reply.json().choices.map((choice: any) => [choice.index, choice.message.reasoning_content, choice.message.reasoning, choice.message.content])).toEqual([
      [0, "think 0", "think 0", "answer 0"],
      [1, "think 1", "think 1", "answer 1"],
    ])
  })

  test("SSE: reasoning deltas carry the choice index they belong to", async () => {
    await route(thinking, { reasoningOutput: true })
    const reply = await server!.send(chat({ n: 2, stream: true }))
    const deltasOf = (index: number) =>
      sseData(reply.text)
        .flatMap((frame) => frame.choices ?? [])
        .filter((choice: any) => choice.index === index)
        .map((choice: any) => choice.delta)
    for (const index of [0, 1]) {
      const reasoning = deltasOf(index)
        .filter((delta: any) => delta.reasoning_content !== undefined)
        .map((delta: any) => [delta.reasoning_content, delta.reasoning])
      expect(reasoning).toEqual([[`think ${index}`, `think ${index}`]])
    }
    expect(reply.text.endsWith("data: [DONE]\n\n")).toBe(true)
  })

  test("off (the default): no choice carries reasoning", async () => {
    await route(thinking)
    const reply = await server!.send(chat({ n: 2 }))
    expect(JSON.stringify(reply.json())).not.toContain("think")
  })
})
