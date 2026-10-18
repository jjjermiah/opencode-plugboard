/**
 * #390 A stop sequence applies to the answer text only. The model quoted the prompt in its reasoning and `END`
 * matched there, so the provider ended the stream before any answer text.
 *
 * Each route runs as the server runs it: parse the request, then the model caller with the stop wrapper
 * (`withStopSequences`), then the route's encoder. The provider is never handed the stop sequences, so it
 * cannot stop inside reasoning; the wrapper reads the answer text only. Usage is reported on every route after
 * a stop match (the probe's case: a finish with 10 in and 500 out).
 */
import { describe, expect, test } from "bun:test"
import { isPlugError, type PlugEvent, type PlugRequest } from "../../src/contract.js"
import { parseChatRequest, type ParsedChat } from "../../src/openai/request.js"
import { collectCompletion, streamCompletion } from "../../src/openai/response.js"
import { parseCompletionsRequest, type ParsedCompletions } from "../../src/completions/request.js"
import { completionsCodec } from "../../src/completions/response.js"
import { parseGeminiRequest, type ParsedGemini } from "../../src/gemini/request.js"
import { runGenerate } from "../../src/gemini/response.js"
import { parseMessagesRequest, type ParsedMessages } from "../../src/anthropic/request.js"
import { runMessage, type MessagesStreamEvent } from "../../src/anthropic/response.js"
import { withStopSequences } from "../../src/stop.js"
import { collect, ev, plugRequest, testOptions } from "../support/fixtures.js"
import { FakeModelCaller } from "../support/model-caller.js"

const options = testOptions({})
const usage = { inputTokens: 10, outputTokens: 500 }

/** The model caller as the server has it, over a scripted provider. */
function modelRun(script: PlugEvent[], request: Omit<PlugRequest, "ref">): AsyncIterable<PlugEvent> {
  return withStopSequences(new FakeModelCaller(script)).stream(request as PlugRequest, { app: "test", signal: new AbortController().signal })
}

const ok = <T>(value: T | { status: number }): T => {
  if (isPlugError(value as never)) throw new Error(`refused: ${JSON.stringify(value)}`)
  return value as T
}

/** Reasoning quotes the stop word; the answer follows, then the finish with usage. */
const quoted: PlugEvent[] = [ev.reasoning('The prompt says: reply "Answer", then END.'), ev.text("Answer"), ev.finish("stop", usage)]
/** The answer itself ends with the stop word; it is not part of the answer. */
const ending: PlugEvent[] = [ev.reasoning("thinking"), ev.text("Answer "), ev.text("END"), ev.text(" trailing"), ev.finish("stop", usage)]

const frameText = (frames: string[], pick: (json: any) => string | undefined): string =>
  frames
    .join("")
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: ") && !frame.includes("[DONE]"))
    .map((frame) => pick(JSON.parse(frame.slice(6))) ?? "")
    .join("")
const frameJson = (frames: string[]): any[] =>
  frames
    .join("")
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: ") && !frame.includes("[DONE]"))
    .map((frame) => JSON.parse(frame.slice(6)))

describe("#390 chat completions: stop applies to answer text, usage is counted", () => {
  const body = (stream: boolean) => ({ model: "fast", stream, messages: [{ role: "user", content: "hi" }], stop: "END", max_completion_tokens: 1024, stream_options: { include_usage: true } })

  test("reasoning that quotes the stop word does not cut the answer (not streamed), usage is reported", async () => {
    const parsed = ok(parseChatRequest(body(false), options)) as ParsedChat
    const collected = await collectCompletion(modelRun(quoted, parsed.request), parsed.exchange)
    expect(collected.body).toMatchObject({ choices: [{ message: { content: "Answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 500 } })
  })

  test("reasoning that quotes the stop word does not cut the answer (streamed), the usage chunk is sent", async () => {
    const parsed = ok(parseChatRequest(body(true), options)) as ParsedChat
    const frames: string[] = []
    await streamCompletion(modelRun(quoted, parsed.request), parsed.exchange, (chunk) => frames.push(chunk))
    expect(frameText(frames, (json) => json.choices?.[0]?.delta?.content)).toBe("Answer")
    expect(frameJson(frames).find((json) => json.usage)?.usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 500 })
  })

  test("answer text that ends on the stop word is cut before it (not streamed)", async () => {
    const parsed = ok(parseChatRequest(body(false), options)) as ParsedChat
    const collected = await collectCompletion(modelRun(ending, parsed.request), parsed.exchange)
    expect(collected.body).toMatchObject({ choices: [{ message: { content: "Answer " }, finish_reason: "stop" }], usage: { completion_tokens: 500 } })
  })

  test("answer text that ends on the stop word is cut before it (streamed)", async () => {
    const parsed = ok(parseChatRequest(body(true), options)) as ParsedChat
    const frames: string[] = []
    await streamCompletion(modelRun(ending, parsed.request), parsed.exchange, (chunk) => frames.push(chunk))
    expect(frameText(frames, (json) => json.choices?.[0]?.delta?.content)).toBe("Answer ")
    expect(frameJson(frames).find((json) => json.choices?.[0]?.finish_reason)?.choices[0].finish_reason).toBe("stop")
  })

  test("json_object: a match found in the last text still ends the answer with finish stop", async () => {
    const parsed = ok(parseChatRequest({ model: "fast", stream: false, messages: [{ role: "user", content: "hi" }], stop: "END", response_format: { type: "json_object" } }, options)) as ParsedChat
    const collected = await collectCompletion(modelRun([ev.text("```json\n{}\n```END"), ev.finish("length", usage)], parsed.request), { ...parsed.exchange, jsonObject: true })
    expect(collected.body).toMatchObject({ choices: [{ finish_reason: "stop" }] })
  })
})

describe("#390 legacy completions: stop applies to answer text, usage is counted", () => {
  const body = (stream: boolean) => ({ model: "fast", stream, prompt: "hi", stop: "END", max_tokens: 1024, stream_options: { include_usage: true } })

  test("reasoning that quotes the stop word does not cut the answer (not streamed), usage is reported", async () => {
    const parsed = ok(parseCompletionsRequest(body(false), options)) as ParsedCompletions
    const collected = await completionsCodec(parsed.exchange).collect(modelRun(quoted, parsed.requests[0]!), 0)
    expect(collected.body).toMatchObject({ choices: [{ text: "Answer", finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 500 } })
  })

  test("reasoning that quotes the stop word does not cut the answer (streamed), usage is reported", async () => {
    const parsed = ok(parseCompletionsRequest(body(true), options)) as ParsedCompletions
    const frames: string[] = []
    const codec = completionsCodec(parsed.exchange)
    await codec.streamChoice(modelRun(quoted, parsed.requests[0]!), (chunk) => frames.push(chunk), { id: "cmpl-1", created: 1, index: 0 })
    expect(frameText(frames, (json) => json.choices?.[0]?.text)).toBe("Answer")
    expect(frames.join("")).toContain('"finish_reason":"stop"')
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

describe("#390 Gemini: stop applies to answer text, usage is counted", () => {
  const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: { stopSequences: ["END"] } }

  test("reasoning that quotes the stop word does not cut the answer, usageMetadata is reported (streamed and not)", async () => {
    for (const stream of [false, true]) {
      const parsed = ok(parseGeminiRequest("fast", stream, body, options)) as ParsedGemini
      const chunks: object[] = []
      const run = await runGenerate(modelRun(quoted, parsed.request), parsed.exchange, (chunk) => chunks.push(chunk))
      const text = stream
        ? chunks.flatMap((chunk: any) => chunk.candidates[0].content.parts.map((part: any) => part.text ?? "")).join("")
        : ((run.response as any).candidates[0].content.parts as Array<{ text?: string }>).map((part) => part.text ?? "").join("")
      expect(text).toBe("Answer")
      const meta = stream ? (chunks.at(-1) as any).usageMetadata : (run.response as any).usageMetadata
      expect(meta).toMatchObject({ promptTokenCount: 10, totalTokenCount: 510 })
    }
  })

  test("answer text that ends on the stop word is cut before it (streamed and not)", async () => {
    for (const stream of [false, true]) {
      const parsed = ok(parseGeminiRequest("fast", stream, body, options)) as ParsedGemini
      const chunks: object[] = []
      const run = await runGenerate(modelRun(ending, parsed.request), parsed.exchange, (chunk) => chunks.push(chunk))
      const text = stream
        ? chunks.flatMap((chunk: any) => chunk.candidates[0].content.parts.map((part: any) => part.text ?? "")).join("")
        : ((run.response as any).candidates[0].content.parts as Array<{ text?: string }>).map((part) => part.text ?? "").join("")
      expect(text).toBe("Answer ")
    }
  })
})

describe("#390 Messages: stop applies to answer text, usage is counted", () => {
  const body = (stream: boolean) => ({ model: "fast", max_tokens: 1024, stream, stop_sequences: ["END"], messages: [{ role: "user", content: "hi" }] })

  test("reasoning that quotes the stop word does not cut the answer (streamed and not), usage is reported", async () => {
    for (const stream of [false, true]) {
      const parsed = ok(parseMessagesRequest(body(stream), options)) as ParsedMessages
      const emitted: MessagesStreamEvent[] = []
      const run = await runMessage(modelRun(quoted, parsed.request), parsed.exchange, (event) => emitted.push(event))
      const streamed = emitted
        .filter((event) => event.type === "content_block_delta")
        .map((event) => (event.delta as { text?: string }).text ?? "")
        .join("")
      expect(streamed).toBe("Answer")
      if (!stream) expect(run.message).toMatchObject({ content: [{ type: "text", text: "Answer" }], usage: { input_tokens: 10, output_tokens: 500 } })
      const final = emitted.find((event) => event.type === "message_delta") as unknown as { usage: Record<string, number> }
      expect(final.usage).toMatchObject({ input_tokens: 10, output_tokens: 500 })
    }
  })

  test("answer text that ends on the stop word is cut before it (streamed and not)", async () => {
    for (const stream of [false, true]) {
      const parsed = ok(parseMessagesRequest(body(stream), options)) as ParsedMessages
      const emitted: MessagesStreamEvent[] = []
      const run = await runMessage(modelRun(ending, parsed.request), parsed.exchange, (event) => emitted.push(event))
      const streamed = emitted
        .filter((event) => event.type === "content_block_delta")
        .map((event) => (event.delta as { text?: string }).text ?? "")
        .join("")
      expect(streamed).toBe("Answer ")
      if (!stream) expect(run.message).toMatchObject({ stop_reason: "stop_sequence", stop_sequence: "END", content: [{ type: "text", text: "Answer " }] })
    }
  })
})

describe("#390 the wrapper keeps the sequences on the request; the host hook drops them (test/session/context.test.ts)", () => {
  test("the caller the wrapper calls gets the request with its sequences", () => {
    const fake = new FakeModelCaller([ev.finish("stop")])
    const request = plugRequest({ generation: { stop: ["END"] } })
    void collect(withStopSequences(fake).stream(request, { app: "test", signal: new AbortController().signal }))
    expect(fake.call.request.generation.stop).toEqual(["END"])
  })
})
