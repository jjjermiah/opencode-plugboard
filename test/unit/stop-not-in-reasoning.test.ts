/**
 * #390 A stop sequence applies to the answer text only. The model quoted the prompt in its reasoning and
 * `END` matched there, so the provider ended the stream before any answer text.
 *
 * The fake provider below behaves like the host did on aihub: it ends the stream at the first stop
 * sequence in reasoning or answer text, for whatever stops the request handed it. Each route is run as
 * the server runs it: parse the request, take what the model gets (`appGeneration`), run the provider,
 * then the route's response encoder. A route must answer the text after the reasoning.
 */
import { describe, expect, test } from "bun:test"
import { isPlugError, type PlugEvent } from "../../src/contract.js"
import { appGeneration } from "../../src/openai/sampling.js"
import { parseChatRequest, type ParsedChat } from "../../src/openai/request.js"
import { collectCompletion, streamCompletion } from "../../src/openai/response.js"
import { parseCompletionsRequest, type ParsedCompletions } from "../../src/completions/request.js"
import { completionsCodec } from "../../src/completions/response.js"
import { parseGeminiRequest, type ParsedGemini } from "../../src/gemini/request.js"
import { runGenerate } from "../../src/gemini/response.js"
import { parseMessagesRequest, type ParsedMessages } from "../../src/anthropic/request.js"
import { runMessage, type MessagesStreamEvent } from "../../src/anthropic/response.js"
import { ev, events, testOptions } from "../support/fixtures.js"

const options = testOptions({})

/** The provider: the stream ends at the first sequence in reasoning or answer text, and reports `stop`. */
function providerStop(list: PlugEvent[], stops: ReadonlyArray<string>): PlugEvent[] {
  if (stops.length === 0) return list
  const out: PlugEvent[] = []
  let seen = ""
  for (const event of list) {
    if (event.type === "reasoning-delta" || event.type === "text-delta") {
      seen += event.text
      if (stops.some((stop) => seen.includes(stop))) return [...out, { type: "finish", reason: "stop" }]
    }
    out.push(event)
  }
  return out
}

/** What the model gets (the request's generation after `appGeneration`) run through the fake provider. */
function modelRun(script: PlugEvent[], request: { generation: { stop?: ReadonlyArray<string> } }): AsyncIterable<PlugEvent> {
  return events(...providerStop(script, appGeneration(undefined, request.generation as never).stop ?? []))
}

const ok = <T>(value: T | { status: number }): T => {
  if (isPlugError(value as never)) throw new Error(`refused: ${JSON.stringify(value)}`)
  return value as T
}

/** Reasoning quotes the stop word; the answer follows. */
const quoted: PlugEvent[] = [ev.reasoning('The prompt says: reply "Answer", then END.'), ev.text("Answer"), ev.finish("stop")]
/** The answer itself ends with the stop word; it is not part of the answer. */
const ending: PlugEvent[] = [ev.reasoning("thinking"), ev.text("Answer "), ev.text("END"), ev.finish("stop")]

const frameText = (frames: string[], pick: (json: any) => string | undefined): string =>
  frames
    .join("")
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: ") && !frame.includes("[DONE]"))
    .map((frame) => pick(JSON.parse(frame.slice(6))) ?? "")
    .join("")

describe("#390 chat completions: stop applies to answer text", () => {
  const body = (stream: boolean) => ({ model: "fast", stream, messages: [{ role: "user", content: "hi" }], stop: "END", max_completion_tokens: 1024 })

  test("reasoning that quotes the stop word does not cut the answer (not streamed)", async () => {
    const parsed = ok(parseChatRequest(body(false), options)) as ParsedChat
    const collected = await collectCompletion(modelRun(quoted, parsed.request), parsed.exchange)
    expect(collected.body).toMatchObject({ choices: [{ message: { content: "Answer" }, finish_reason: "stop" }] })
  })

  test("reasoning that quotes the stop word does not cut the answer (streamed)", async () => {
    const parsed = ok(parseChatRequest(body(true), options)) as ParsedChat
    const frames: string[] = []
    await streamCompletion(modelRun(quoted, parsed.request), parsed.exchange, (chunk) => frames.push(chunk))
    expect(frameText(frames, (json) => json.choices?.[0]?.delta?.content)).toBe("Answer")
  })

  test("answer text that ends on the stop word is cut before it (not streamed)", async () => {
    const parsed = ok(parseChatRequest(body(false), options)) as ParsedChat
    const collected = await collectCompletion(modelRun(ending, parsed.request), parsed.exchange)
    expect(collected.body).toMatchObject({ choices: [{ message: { content: "Answer " }, finish_reason: "stop" }] })
  })

  test("answer text that ends on the stop word is cut before it (streamed)", async () => {
    const parsed = ok(parseChatRequest(body(true), options)) as ParsedChat
    const frames: string[] = []
    await streamCompletion(modelRun(ending, parsed.request), parsed.exchange, (chunk) => frames.push(chunk))
    expect(frameText(frames, (json) => json.choices?.[0]?.delta?.content)).toBe("Answer ")
  })
})

describe("#390 json_object answers: the text is held until its fence is ruled out, and the stop still ends it", () => {
  test("chat stream: the sequence ends the answer, and no later event is sent", async () => {
    const parsed = ok(parseChatRequest({ model: "fast", stream: true, messages: [{ role: "user", content: "hi" }], stop: "END" }, options)) as ParsedChat
    const frames: string[] = []
    await streamCompletion(modelRun([ev.text("Answer END more"), ev.call("c1", "lookup", { q: 1 }), ev.finish("stop")], parsed.request), { ...parsed.exchange, jsonObject: true }, (chunk) => frames.push(chunk))
    expect(frameText(frames, (json) => json.choices?.[0]?.delta?.content)).toBe("Answer ")
    expect(frames.join("")).not.toContain("lookup")
  })

  test("Gemini stream: a fenced-looking answer that holds back the text does not get a tool call after the stop", async () => {
    const parsed = ok(parseGeminiRequest("fast", true, { contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: { stopSequences: ["END"] } }, options)) as ParsedGemini
    const chunks: object[] = []
    await runGenerate(modelRun([ev.text("`Answer END"), ev.call("c1", "lookup", { q: 1 }), ev.finish("stop")], parsed.request), { ...parsed.exchange, jsonObject: true }, (chunk) => chunks.push(chunk))
    const parts = chunks.flatMap((chunk: any) => chunk.candidates?.[0]?.content?.parts ?? [])
    expect(parts.some((part: any) => part.functionCall !== undefined)).toBe(false)
    expect(parts.map((part: any) => part.text ?? "").join("")).toBe("`Answer ")
  })
})

describe("#390 legacy completions: stop applies to answer text", () => {
  const body = (stream: boolean) => ({ model: "fast", stream, prompt: "hi", stop: "END", max_tokens: 1024 })

  test("reasoning that quotes the stop word does not cut the answer (not streamed)", async () => {
    const parsed = ok(parseCompletionsRequest(body(false), options)) as ParsedCompletions
    const collected = await completionsCodec(parsed.exchange).collect(modelRun(quoted, parsed.requests[0]!), 0)
    expect(collected.body).toMatchObject({ choices: [{ text: "Answer", finish_reason: "stop" }] })
  })

  test("reasoning that quotes the stop word does not cut the answer (streamed)", async () => {
    const parsed = ok(parseCompletionsRequest(body(true), options)) as ParsedCompletions
    const frames: string[] = []
    const codec = completionsCodec(parsed.exchange)
    await codec.streamChoice(modelRun(quoted, parsed.requests[0]!), (chunk) => frames.push(chunk), { id: "cmpl-1", created: 1, index: 0 })
    expect(frameText(frames, (json) => json.choices?.[0]?.text)).toBe("Answer")
  })

  test("answer text that ends on the stop word is cut before it (not streamed)", async () => {
    const parsed = ok(parseCompletionsRequest(body(false), options)) as ParsedCompletions
    const collected = await completionsCodec(parsed.exchange).collect(modelRun(ending, parsed.requests[0]!), 0)
    expect(collected.body).toMatchObject({ choices: [{ text: "Answer " }] })
  })

  test("answer text that ends on the stop word is cut before it (streamed)", async () => {
    const parsed = ok(parseCompletionsRequest(body(true), options)) as ParsedCompletions
    const frames: string[] = []
    await completionsCodec(parsed.exchange).streamChoice(modelRun(ending, parsed.requests[0]!), (chunk) => frames.push(chunk), { id: "cmpl-1", created: 1, index: 0 })
    expect(frameText(frames, (json) => json.choices?.[0]?.text)).toBe("Answer ")
  })
})

describe("#390 Gemini generateContent: stop applies to answer text", () => {
  const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: { stopSequences: ["END"], maxOutputTokens: 1024 } }
  const text = (chunks: object[]) => chunks.map((chunk: any) => (chunk.candidates?.[0]?.content?.parts ?? []).map((part: any) => part.text ?? "").join("")).join("")

  // Not streamed, the answer is read from the aggregate: the emitted parts are not a copy of it.
  const answer = (stream: boolean, chunks: object[], response: object | undefined) => text(stream ? chunks : [response!])

  test("reasoning that quotes the stop word does not cut the answer (streamed and not)", async () => {
    for (const stream of [false, true]) {
      const parsed = ok(parseGeminiRequest("fast", stream, body, options)) as ParsedGemini
      const chunks: object[] = []
      const run = await runGenerate(modelRun(quoted, parsed.request), parsed.exchange, (chunk) => chunks.push(chunk))
      expect(answer(stream, chunks, run.response)).toBe("Answer")
      expect(run.failure).toBeUndefined()
    }
  })

  test("answer text that ends on the stop word is cut before it (streamed and not)", async () => {
    for (const stream of [false, true]) {
      const parsed = ok(parseGeminiRequest("fast", stream, body, options)) as ParsedGemini
      const chunks: object[] = []
      const run = await runGenerate(modelRun(ending, parsed.request), parsed.exchange, (chunk) => chunks.push(chunk))
      expect(answer(stream, chunks, run.response)).toBe("Answer ")
    }
  })
})

describe("#390 Messages: stop applies to answer text", () => {
  const body = (stream: boolean) => ({ model: "fast", stream, max_tokens: 1024, messages: [{ role: "user", content: "hi" }], stop_sequences: ["END"] })
  const streamed = (emitted: MessagesStreamEvent[]) => emitted.filter((event) => event.type === "content_block_delta").map((event) => (event.delta as { text?: string }).text ?? "").join("")

  test("reasoning that quotes the stop word does not cut the answer (streamed and not)", async () => {
    for (const stream of [false, true]) {
      const parsed = ok(parseMessagesRequest(body(stream), options)) as ParsedMessages
      const emitted: MessagesStreamEvent[] = []
      const run = await runMessage(modelRun(quoted, parsed.request), parsed.exchange, (event) => emitted.push(event))
      expect(streamed(emitted)).toBe("Answer")
      // The aggregate is built for a body that is not streamed.
      if (!stream) expect(run.message).toMatchObject({ stop_reason: "end_turn", content: [{ type: "text", text: "Answer" }] })
    }
  })

  test("answer text that ends on the stop word is cut before it (streamed and not)", async () => {
    for (const stream of [false, true]) {
      const parsed = ok(parseMessagesRequest(body(stream), options)) as ParsedMessages
      const emitted: MessagesStreamEvent[] = []
      const run = await runMessage(modelRun(ending, parsed.request), parsed.exchange, (event) => emitted.push(event))
      expect(streamed(emitted)).toBe("Answer ")
      expect(run.message).toMatchObject({ stop_reason: "stop_sequence", stop_sequence: "END" })
      if (!stream) expect(run.message).toMatchObject({ content: [{ type: "text", text: "Answer " }] })
    }
  })
})

describe("#390 the stop sequence is not sent to the model", () => {
  test("every route: the generation the model gets carries no stop, the route keeps it for matching", () => {
    const chat = ok(parseChatRequest({ model: "fast", messages: [{ role: "user", content: "hi" }], stop: "END" }, options)) as ParsedChat
    expect(appGeneration(undefined, chat.request.generation).stop).toBeUndefined()
    expect(chat.exchange.stop).toEqual(["END"])
  })
})
