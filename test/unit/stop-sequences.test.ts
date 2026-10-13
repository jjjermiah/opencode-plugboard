/**
 * #149 A caller stop sequence in the answer ends it, and is removed from it, on Chat Completions,
 * legacy completions and Gemini, as Anthropic Messages does (#145). The held-back tail keeps a
 * streamed sequence from reaching the client. Structured output keeps its text as it is.
 *
 * #390 The sequence ends the answer wherever it occurs in the answer text (not only at the end),
 * whatever the finish reason, and a tool call after it is not read: the model was stopped there.
 */
import { describe, expect, test } from "bun:test"
import { completionsCodec } from "../../src/completions/response.js"
import { runGenerate, type GeminiExchange } from "../../src/gemini/response.js"
import { collectCompletion, streamCompletion, type OpenAiExchange } from "../../src/openai/response.js"
import { StopScan, stopAt } from "../../src/stop.js"
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
  test("stopAt: the earliest sequence in the text; the longer one where two start together", () => {
    expect(stopAt("Answer: 4 ###", ["#", "###"])).toEqual({ index: 10, stop: "###" })
    expect(stopAt("Hello END and END", ["END"])).toEqual({ index: 6, stop: "END" })
    expect(stopAt("nothing here", ["END"])).toBeUndefined()
  })

  test("StopScan: a sequence split across pushes is held back, then cut", () => {
    const scan = new StopScan(["END"])
    const sent = [scan.push("Hel"), scan.push("lo EN"), scan.push("D"), scan.push("ignored")]
    expect(sent.join("")).toBe("Hello ")
    expect(scan.matched).toBe("END")
    expect(scan.finish()).toBe("")
  })

  test("StopScan: a sequence in the middle of the text ends it there", () => {
    const scan = new StopScan(["END"])
    expect(scan.push("END of it")).toBe("")
    expect(scan.matched).toBe("END")
  })

  test("StopScan: text that only looks like the start of a sequence is sent at the finish", () => {
    const scan = new StopScan(["END"])
    expect(scan.push("EN")).toBe("")
    expect(scan.finish()).toBe("EN")
    expect(scan.matched).toBeUndefined()
  })

  test("StopScan: without stop sequences every chunk passes through at once", () => {
    const scan = new StopScan([])
    expect(scan.push("abc")).toBe("abc")
    expect(scan.finish()).toBe("")
    expect(scan.matched).toBeUndefined()
  })

  test("StopScan: release sends the held text unchanged (before a tool call or reasoning)", () => {
    const scan = new StopScan(["END"])
    expect(scan.push("Hello EN")).toBe("Hello")
    expect(scan.release()).toBe(" EN")
    expect(scan.finish()).toBe("")
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

  test("#390 a sequence in the middle of the answer ends it there: the text before it, finish_reason stop", async () => {
    const { body } = await collectCompletion(events(ev.text("END of it"), ev.finish("stop")), chatExchange(["END"]))
    expect((body as any).choices[0]).toMatchObject({ message: { content: null }, finish_reason: "stop" })
  })

  test("#390 a length finish that ends on the sequence: the sequence still ends the answer", async () => {
    const { body } = await collectCompletion(events(ev.text("Hello END"), ev.finish("length")), chatExchange(["END"]))
    expect((body as any).choices[0]).toMatchObject({ message: { content: "Hello " }, finish_reason: "stop" })
  })

  test("#390 a tool call after the sequence is not read: the model was stopped at the sequence", async () => {
    const { body } = await collectCompletion(events(ev.text("Hello END"), ev.call("c1", "lookup", { q: 1 }), ev.finish("stop")), chatExchange(["END"]))
    expect((body as any).choices[0].message).toMatchObject({ content: "Hello " })
    expect((body as any).choices[0].message.tool_calls).toBeUndefined()
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

  test("#390 a length finish that ends on the sequence: the sequence still ends the answer", async () => {
    const run = await runGenerate(events(ev.text("Hello END"), ev.finish("length")), gemini(["END"]), () => {})
    expect(textOf(run.response)).toBe("Hello ")
    expect((run.response as any).candidates[0].finishReason).toBe("STOP")
  })
})
