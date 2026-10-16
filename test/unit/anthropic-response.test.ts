import { describe, expect, test } from "bun:test"
import { encodeError, messagesStatus, runMessage, sseFrame, type MessagesExchange, type MessagesStreamEvent } from "../../src/anthropic/response.js"
import type { PlugErrorKind, PlugEvent } from "../../src/contract.js"
import { ev, events } from "../support/fixtures.js"

// Non-streamed: the tests below read the aggregated message body, which a stream does not build (#153).
const plain: MessagesExchange = { model: "fast", stream: false, thinking: false }
const thinking: MessagesExchange = { ...plain, thinking: true }

async function run(exchange: MessagesExchange, ...list: PlugEvent[]) {
  const emitted: MessagesStreamEvent[] = []
  const result = await runMessage(events(...list), exchange, (event) => void emitted.push(event))
  return { ...result, message: result.message as any, emitted, types: emitted.map((event) => event.type) }
}

describe("#4 runMessage: Anthropic's event sequence", () => {
  test("a text answer: message_start, block start, ping, deltas, block stop, message_delta, message_stop", async () => {
    const { types, message, emitted } = await run(plain, ev.text("Hel"), ev.text("lo"), ev.finish("stop", { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 1 }))
    expect(types).toEqual(["message_start", "content_block_start", "ping", "content_block_delta", "content_block_delta", "content_block_stop", "message_delta", "message_stop"])
    expect(emitted[0]).toMatchObject({ message: { type: "message", role: "assistant", model: "fast", content: [], stop_reason: null } })
    expect(emitted[3]).toEqual({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } })
    expect(message).toMatchObject({ content: [{ type: "text", text: "Hello" }], stop_reason: "end_turn", stop_sequence: null })
    expect(message.id).toMatch(/^msg_[0-9a-f]{32}$/)
    // input_tokens excludes the cached parts, which are reported on their own.
    expect(message.usage).toEqual({ input_tokens: 6, output_tokens: 2, cache_creation_input_tokens: 1, cache_read_input_tokens: 3 })
    expect(emitted.at(-2)).toMatchObject({ delta: { stop_reason: "end_turn" }, usage: message.usage })
  })

  test("#203 message_start carries zero usage, because the host reports counts at the end; message_delta carries the real ones", async () => {
    const { emitted } = await run(plain, ev.text("hi"), ev.finish("stop", { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 1 }))
    expect(emitted[0]).toMatchObject({ type: "message_start", message: { usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } })
    // The Anthropic SDK accumulator (MessageStream) takes input and cache counts from message_delta when they are non-null.
    expect(emitted.find((event) => event.type === "message_delta")).toMatchObject({ usage: { input_tokens: 6, output_tokens: 2, cache_creation_input_tokens: 1, cache_read_input_tokens: 3 } })
  })

  test("#146 a thinking block carries the provider signature the host reported, as a signature_delta before it stops", async () => {
    const signed: PlugEvent = { type: "reasoning-delta", text: "", signature: "sig_abc" }
    const { emitted, message } = await run(thinking, ev.reasoning("hmm"), signed, ev.text("answer"), ev.finish())
    const signature = emitted.find((event) => event.type === "content_block_delta" && (event as { delta?: { type?: string } }).delta?.type === "signature_delta")
    expect(signature).toEqual({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig_abc" } })
    expect(message.content[0]).toEqual({ type: "thinking", thinking: "hmm", signature: "sig_abc" })
  })

  test("#146 a signature is ignored when the caller did not ask for thinking", async () => {
    const signed: PlugEvent = { type: "reasoning-delta", text: "", signature: "sig_abc" }
    const { types, message } = await run(plain, ev.reasoning("hmm"), signed, ev.text("answer"), ev.finish())
    expect(types).not.toContain("signature_delta")
    expect(message.content).toEqual([{ type: "text", text: "answer", citations: null }])
  })

  test("a tool call is one tool_use block with the whole input as one input_json_delta; stop_reason tool_use", async () => {
    const { emitted, message } = await run(plain, ev.text("let me"), ev.call("call_1", "read", { path: "a" }), ev.finish("stop"))
    expect(emitted.filter((event) => event.type.startsWith("content_block")).map((event) => [event.type, event.index])).toEqual([
      ["content_block_start", 0],
      ["content_block_delta", 0],
      ["content_block_stop", 0],
      ["content_block_start", 1],
      ["content_block_delta", 1],
      ["content_block_stop", 1],
    ])
    expect(emitted.find((event) => event.type === "content_block_delta" && event.index === 1)).toMatchObject({ delta: { type: "input_json_delta", partial_json: '{"path":"a"}' } })
    expect(message.content[1]).toEqual({ type: "tool_use", id: "toolu_call_1", name: "read", caller: { type: "direct" }, input: { path: "a" } })
    expect(message.stop_reason).toBe("tool_use")
  })

  test.each([
    ["toolu_abc", "toolu_abc"],
    ["call:1/x", "toolu_call_1_x"],
  ])("tool id %p is reported as %p", async (id, wire) => {
    expect((await run(plain, ev.call(id, "f"), ev.finish())).message.content[0].id).toBe(wire)
  })

  test.each([
    ["a JSON object string", '{"a":1}', { a: 1 }],
    ["text that is not JSON", "not json", {}],
    ["an array", [1, 2], {}],
  ])("tool input given as %s becomes an object", async (_name, input, expected) => {
    expect((await run(plain, ev.call("t", "f", input), ev.finish())).message.content[0].input).toEqual(expected)
  })

  test("reasoning becomes a thinking block only when thinking was asked for", async () => {
    const on = await run(thinking, ev.reasoning("hmm"), ev.text("answer"), ev.finish())
    expect(on.message.content).toEqual([{ type: "thinking", thinking: "hmm", signature: "" }, { type: "text", text: "answer", citations: null }])
    expect(on.emitted.find((event) => event.type === "content_block_delta")).toMatchObject({ delta: { type: "thinking_delta", thinking: "hmm" } })
    const off = await run(plain, ev.reasoning("hmm"), ev.text("answer"), ev.finish())
    expect(off.message.content).toEqual([{ type: "text", text: "answer", citations: null }])
  })

  test.each([
    ["length", "max_tokens"],
    ["content-filter", "refusal"],
    ["tool-calls", "tool_use"],
  ] as const)("finish %s -> stop_reason %s", async (reason, wire) => {
    expect((await run(plain, ev.text("x"), ev.finish(reason))).message.stop_reason).toBe(wire)
  })

  test("an empty answer still starts and stops the message, with one ping", async () => {
    expect((await run(plain, ev.finish())).types).toEqual(["message_start", "ping", "message_delta", "message_stop"])
  })
})

describe("#4 runMessage: failures", () => {
  test("a failure before output emits nothing, so the route answers with its HTTP status", async () => {
    const result = await run(plain, ev.reasoning("x"), ev.error({ status: 429, kind: "rate_limit", message: "slow" }))
    expect(result.emitted).toEqual([])
    expect(result).toMatchObject({ started: false, failure: { status: 429 } })
  })

  test("a failure after output closes the open block and ends with an error event, no message_stop", async () => {
    const { types, emitted } = await run(plain, ev.text("part"), ev.error({ status: 502, message: "died" }))
    expect(types.slice(-2)).toEqual(["content_block_stop", "error"])
    expect(emitted.at(-1)).toEqual({ type: "error", error: { type: "api_error", message: "died" } })
  })

  test("a stream without a finish fails", async () => {
    expect((await run(plain, ev.text("x"))).failure).toMatchObject({ message: "Model stream ended without a finish event" })
  })
})

describe("#4 encodeError: Anthropic's error body", () => {
  const kinds: Array<[PlugErrorKind, number, string]> = [
    ["invalid_request", 400, "invalid_request_error"],
    ["authentication", 401, "authentication_error"],
    ["permission", 403, "permission_error"],
    ["not_found", 404, "not_found_error"],
    ["rate_limit", 429, "rate_limit_error"],
    ["timeout", 504, "timeout_error"],
    ["server", 500, "api_error"],
    ["invalid_request", 413, "request_too_large"],
    ["server", 529, "overloaded_error"],
  ]
  test.each(kinds)("%s with status %d -> %s", (kind, status, type) => {
    expect(encodeError({ status, kind, message: "m", code: "c" })).toEqual({ type: "error", error: { type, message: "m" } })
  })

  test("#204 a provider overload is overloaded_error on HTTP 529; other 503s stay api_error on 503", () => {
    const overloaded = { status: 503, kind: "server" as const, code: "provider_overloaded", message: "m" }
    expect(encodeError(overloaded)).toEqual({ type: "error", error: { type: "overloaded_error", message: "m" } })
    expect(messagesStatus(overloaded)).toBe(529)
    const unavailable = { status: 503, kind: "server" as const, code: "provider_unavailable", message: "m" }
    expect(encodeError(unavailable)).toEqual({ type: "error", error: { type: "api_error", message: "m" } })
    expect(messagesStatus(unavailable)).toBe(503)
  })

  test("sseFrame names the event", () => {
    expect(sseFrame({ type: "ping" })).toBe('event: ping\ndata: {"type":"ping"}\n\n')
  })
})

describe("#153 a stream keeps no aggregate", () => {
  test("a long streamed answer leaves the message content empty, while every delta still goes out", async () => {
    const list = Array.from({ length: 2_000 }, (_, index) => ev.text(`chunk ${index} `))
    const { message, types } = await run({ ...plain, stream: true }, ...list, ev.finish("stop"))
    expect(message.content).toEqual([])
    expect(types.filter((type) => type === "content_block_delta")).toHaveLength(2_000)
  })

  test("a non-streamed answer keeps its content for the JSON body", async () => {
    const { message } = await run({ ...plain, stream: false }, ev.text("Hi"), ev.finish("stop"))
    expect(message.content).toEqual([{ type: "text", text: "Hi", citations: null }])
  })
})
