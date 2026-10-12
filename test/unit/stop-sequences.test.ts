/**
 * #149 A caller stop sequence that ends a plain stop is removed from the answer on Chat
 * Completions, legacy completions and Gemini, as Anthropic Messages does (#145). The held-back
 * tail keeps a streamed sequence from reaching the client. A tool call, a length finish or
 * structured output keeps its text as it is.
 */
import { describe, expect, test } from "bun:test"
import { completionsCodec } from "../../src/completions/response.js"
import { runGenerate, type GeminiExchange } from "../../src/gemini/response.js"
import { collectCompletion, streamCompletion, type OpenAiExchange } from "../../src/openai/response.js"
import { StopHoldback, stopTail, stripStopTail } from "../../src/stop.js"
import { ev, events } from "../support/fixtures.js"

/** The `data:` payloads of a stream, parsed; `[DONE]` is dropped. */
function frames(chunks: string[]): Array<Record<string, any>> {
  return chunks
    .join("")
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: ") && frame !== "data: [DONE]")
    .map((frame) => JSON.parse(frame.slice("data: ".length)))
}

const chatExchange = (stop?: string[], extra: Partial<OpenAiExchange> = {}): OpenAiExchange => ({ model: "test/echo", stream: false, includeUsage: false, ...(stop ? { stop } : {}), ...extra })

describe("#149 the shared stop helper", () => {
  test("stopTail: the longest sequence the text ends with, if any", () => {
    expect(stopTail("Answer: 4 ###", ["#", "###"])).toBe("###")
    expect(stopTail("END of it", ["END"])).toBeUndefined()
    expect(stripStopTail("Hello END", ["END"])).toEqual({ text: "Hello ", matched: "END" })
  })

  test("StopHoldback: a sequence split across pushes is held back, then removed at the finish", () => {
    const holdback = new StopHoldback(["END"])
    const sent = [holdback.push("Hel"), holdback.push("lo EN"), holdback.push("D")]
    expect(sent.join("")).toBe("Hello ")
    expect(holdback.finish(true)).toEqual({ text: "", matched: "END" })
  })

  test("StopHoldback: without stop sequences every chunk passes through at once", () => {
    const holdback = new StopHoldback([])
    expect(holdback.push("abc")).toBe("abc")
    expect(holdback.finish(true)).toEqual({ text: "" })
  })

  test("StopHoldback: a finish that is not a plain stop releases the held text unchanged", () => {
    const holdback = new StopHoldback(["END"])
    expect(holdback.push("Hello END")).toBe("Hello ")
    expect(holdback.finish(false)).toEqual({ text: "END" })
  })
})

describe("#149 Chat Completions removes a caller stop sequence", () => {
  test("a JSON answer that ends on the sequence: the text without it, finish_reason stop", async () => {
    const { body } = await collectCompletion(events(ev.text("Hello END"), ev.finish("stop")), chatExchange(["END"]))
    expect((body as any).choices[0]).toMatchObject({ message: { content: "Hello " }, finish_reason: "stop" })
  })

  test("a streamed answer: the sequence split across deltas never reaches the client", async () => {
    const chunks: string[] = []
    await streamCompletion(events(ev.text("Hel"), ev.text("lo EN"), ev.text("D"), ev.finish("stop")), chatExchange(["END"], { stream: true }), (chunk) => chunks.push(chunk))
    const content = frames(chunks).map((frame) => frame.choices[0].delta.content ?? "").join("")
    expect(content).toBe("Hello ")
    expect(frames(chunks).at(-1)!.choices[0].finish_reason).toBe("stop")
  })

  test("a sequence in the middle of the answer is not removed", async () => {
    const { body } = await collectCompletion(events(ev.text("END of it"), ev.finish("stop")), chatExchange(["END"]))
    expect((body as any).choices[0].message.content).toBe("END of it")
  })

  test("a length finish that ends on the sequence keeps it", async () => {
    const { body } = await collectCompletion(events(ev.text("Hello END"), ev.finish("length")), chatExchange(["END"]))
    expect((body as any).choices[0]).toMatchObject({ message: { content: "Hello END" }, finish_reason: "length" })
  })

  test("a tool call in the same step keeps the text: the stop was not the end of the answer", async () => {
    const { body } = await collectCompletion(events(ev.text("Hello END"), ev.call("c1", "lookup", { q: 1 }), ev.finish("stop")), chatExchange(["END"]))
    expect((body as any).choices[0].message.content).toBe("Hello END")
  })

  test("streamed text before a tool call is released in full, not held", async () => {
    const chunks: string[] = []
    await streamCompletion(events(ev.text("Hi EN"), ev.call("c1", "lookup", { q: 1 }), ev.finish("stop")), chatExchange(["END"], { stream: true }), (chunk) => chunks.push(chunk))
    const content = frames(chunks).map((frame) => frame.choices[0].delta.content ?? "").join("")
    expect(content).toBe("Hi EN")
  })
})

describe("#149 legacy completions removes a caller stop sequence", () => {
  const codec = (stop: string[]) => completionsCodec({ model: "test/echo", stream: false, includeUsage: false, perPrompt: 1, stop })

  test("a JSON answer: the text without the sequence", async () => {
    const result = await codec(["END"]).collect(events(ev.text("Hello END"), ev.finish("stop")), 0)
    expect((result.body as any).choices[0]).toMatchObject({ text: "Hello ", finish_reason: "stop" })
  })

  test("a streamed answer: the sequence is held back and removed", async () => {
    const chunks: string[] = []
    await codec(["END"]).streamChoice(events(ev.text("Hello E"), ev.text("ND"), ev.finish("stop")), (chunk) => chunks.push(chunk), { id: "cmpl-x", created: 1, index: 0 })
    const text = frames(chunks).map((frame) => frame.choices[0].text).join("")
    expect(text).toBe("Hello ")
  })
})

describe("#149 Gemini removes a caller stop sequence", () => {
  const gemini = (stop?: string[], extra: Partial<GeminiExchange> = {}): GeminiExchange => ({ model: "test/echo", stream: false, ...(stop ? { stop } : {}), ...extra })
  const textOf = (response: object | undefined) => ((response as any).candidates[0].content.parts as Array<{ text?: string }>).map((part) => part.text ?? "").join("")

  test("a plain stop: the text without the sequence, finishReason STOP", async () => {
    const run = await runGenerate(events(ev.text("Hello END"), ev.finish("stop")), gemini(["END"]), () => {})
    expect(textOf(run.response)).toBe("Hello ")
    expect((run.response as any).candidates[0].finishReason).toBe("STOP")
  })

  test("a streamed answer: the sequence split across chunks never reaches the client", async () => {
    const emitted: Array<{ candidates: Array<{ content: { parts: Array<{ text?: string }> } }> }> = []
    await runGenerate(events(ev.text("Hel"), ev.text("lo EN"), ev.text("D"), ev.finish("stop")), gemini(["END"], { stream: true }), (chunk) => emitted.push(JSON.parse(JSON.stringify(chunk))))
    const streamed = emitted.flatMap((chunk) => chunk.candidates[0]!.content.parts.map((part) => part.text ?? "")).join("")
    expect(streamed).toBe("Hello ")
  })

  test("a length finish keeps the text", async () => {
    const run = await runGenerate(events(ev.text("Hello END"), ev.finish("length")), gemini(["END"]), () => {})
    expect(textOf(run.response)).toBe("Hello END")
  })
})
