/**
 * #149, #390 Caller stop sequences on the answer text (src/stop.ts). `withStopSequences` scans the text the
 * model streams: the first sequence ends the answer, the sequence and what follows are not sent, the host run
 * is interrupted (`CallContext.stopAnswer`), and the finish is passed on with the usage of the run. Reasoning
 * and tool calls never end the answer. Structured output has no text to scan and passes through.
 */
import { describe, expect, test } from "bun:test"
import type { PlugEvent, PlugRequest } from "../../src/contract.js"
import { StopScan, stopAt, withStopSequences } from "../../src/stop.js"
import { collect, ev, plugRequest } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { FakeModelCaller } from "../support/model-caller.js"

/** The events the wrapped model caller yields for `script`, with the caller so a test can see what it was handed. */
function through(script: PlugEvent[], stop?: string[], extra: Partial<PlugRequest> = {}) {
  const fake = new FakeModelCaller(script)
  const request = plugRequest({ generation: stop ? { stop } : {}, ...extra })
  const out = collect(withStopSequences(fake).stream(request, { app: "test", signal: new AbortController().signal }))
  return { fake, out }
}

const textOf = (events: PlugEvent[]) => events.flatMap((event) => (event.type === "text-delta" ? [event.text] : [])).join("")
const finishOf = (events: PlugEvent[]) => events.find((event) => event.type === "finish")
const usage = { inputTokens: 10, outputTokens: 500 }

describe("#390 the shared stop helpers", () => {
  test("stopAt: the earliest sequence in the text, and the longer one where two start together", () => {
    expect(stopAt("Answer: 4 ###", ["#", "###"])).toEqual({ index: 10, stop: "###" })
    expect(stopAt("END of it", ["END"])).toEqual({ index: 0, stop: "END" })
    expect(stopAt("Hello", ["END"])).toBeUndefined()
    expect(stopAt("abEND cEND", ["cEND", "END"])).toEqual({ index: 2, stop: "END" })
  })

  test("StopScan: a sequence split across pushes is held back, then found and cut", () => {
    const scan = new StopScan(["END"])
    const sent = [scan.push("Hel"), scan.push("lo EN"), scan.push("D more")]
    expect(sent.join("")).toBe("Hello ")
    expect(scan.matched).toBe("END")
    expect(scan.push("never sent")).toBe("")
  })

  test("StopScan: without stop sequences every chunk passes through at once", () => {
    const scan = new StopScan([])
    expect(scan.push("abc")).toBe("abc")
    expect(scan.matched).toBeUndefined()
  })
})

describe("#390 a stop answer closed without host usage is counted and logged, with no estimate (review #429)", () => {
  const logs = captureLogs()

  test("no usage from the host: one count for the app, a warning, and the finish carries no usage", async () => {
    const counted: string[] = []
    const wrapped = withStopSequences(new FakeModelCaller([ev.text("Hello END"), ev.finish("stop")]), (app) => counted.push(app))
    const events = await collect(wrapped.stream(plugRequest({ generation: { stop: ["END"] } }), { app: "test", signal: new AbortController().signal }))
    expect(finishOf(events)).toEqual({ type: "finish", reason: "stop", stopSequence: "END" })
    expect(counted).toEqual(["test"])
    expect(logs.of("request.stop_usage_missing")).toHaveLength(1)
  })

  test("usage reported: nothing is counted", async () => {
    const counted: string[] = []
    const wrapped = withStopSequences(new FakeModelCaller([ev.text("Hello END"), ev.finish("stop", usage)]), (app) => counted.push(app))
    await collect(wrapped.stream(plugRequest({ generation: { stop: ["END"] } }), { app: "test", signal: new AbortController().signal }))
    expect(counted).toEqual([])
  })
})

describe("#390 withStopSequences on the answer text", () => {
  test("a sequence at the end: the text before it, finish stop with the sequence, the usage of the run", async () => {
    const { out } = through([ev.text("Hello END"), ev.finish("stop", usage)], ["END"])
    const events = await out
    expect(textOf(events)).toBe("Hello ")
    expect(finishOf(events)).toEqual({ type: "finish", reason: "stop", usage, stopSequence: "END" })
  })

  test("a sequence in the middle ends the answer there: nothing after it is sent", async () => {
    const { out } = through([ev.text("END of it"), ev.finish("stop", usage)], ["END"])
    const events = await out
    expect(textOf(events)).toBe("")
    expect(finishOf(events)).toMatchObject({ reason: "stop", stopSequence: "END", usage })
  })

  test("a sequence split across deltas is held back, then cut", async () => {
    const { out } = through([ev.text("Hel"), ev.text("lo EN"), ev.text("D more"), ev.finish("stop")], ["END"])
    expect(textOf(await out)).toBe("Hello ")
  })

  test("the longest sequence wins", async () => {
    const { out } = through([ev.text("Answer: 4 ###"), ev.finish("stop")], ["#", "###"])
    const events = await out
    expect(textOf(events)).toBe("Answer: 4 ")
    expect(finishOf(events)).toMatchObject({ stopSequence: "###" })
  })

  test("reasoning between two text chunks does not reset a partial match", async () => {
    const { out } = through([ev.text("Hel"), ev.text("EN"), ev.reasoning("still thinking"), ev.text("D"), ev.finish("stop")], ["END"])
    const events = await out
    expect(textOf(events)).toBe("Hel")
    expect(finishOf(events)).toMatchObject({ stopSequence: "END" })
  })

  test("reasoning that quotes the sequence is passed through and never ends the answer", async () => {
    const { out } = through([ev.reasoning('reply "Answer", then END'), ev.text("Answer"), ev.finish("stop", usage)], ["END"])
    const events = await out
    expect(events.filter((event) => event.type === "reasoning-delta")).toHaveLength(1)
    expect(textOf(events)).toBe("Answer")
    expect(finishOf(events)).toEqual({ type: "finish", reason: "stop", usage })
  })

  test("reasoning after the sequence is not sent either", async () => {
    const { out } = through([ev.text("A END"), ev.reasoning("late"), ev.finish("stop")], ["END"])
    expect((await out).some((event) => event.type === "reasoning-delta")).toBe(false)
  })

  test("a finish that is not a stop is still a stop when the answer contains the sequence: the sequence ends it", async () => {
    const { out } = through([ev.text("Hello END"), ev.finish("length", usage)], ["END"])
    const events = await out
    expect(textOf(events)).toBe("Hello ")
    expect(finishOf(events)).toEqual({ type: "finish", reason: "stop", usage, stopSequence: "END" })
  })

  test("no sequence in the answer: the text and the finish come through unchanged", async () => {
    const { out } = through([ev.text("Hello"), ev.finish("length", usage)], ["END"])
    const events = await out
    expect(textOf(events)).toBe("Hello")
    expect(finishOf(events)).toEqual({ type: "finish", reason: "length", usage })
  })

  test("without stop sequences nothing changes", async () => {
    const script = [ev.text("Hello END"), ev.finish("stop", usage)]
    const { out } = through(script)
    expect(await out).toEqual(script)
  })

  test("a tool call before the sequence: the text before the call is sent, the call is kept, the finish is stop with the sequence", async () => {
    const { out } = through([ev.text("Let me look"), ev.call("c1", "lookup", { q: 1 }), ev.text(" then END"), ev.finish("stop", usage)], ["END"])
    const events = await out
    expect(events.filter((event) => event.type === "tool-call")).toHaveLength(1)
    expect(textOf(events)).toBe("Let me look then ")
    expect(finishOf(events)).toMatchObject({ reason: "stop", stopSequence: "END" })
  })

  test("a tool call after the sequence is not sent: the model was stopped there", async () => {
    const { out } = through([ev.text("Hi END"), ev.call("c1", "lookup", { q: 1 }), ev.finish("stop")], ["END"])
    expect((await out).some((event) => event.type === "tool-call")).toBe(false)
  })

  test("text held back before a tool call is released before the call", async () => {
    const { out } = through([ev.text("Hi EN"), ev.call("c1", "lookup", { q: 1 }), ev.finish("stop")], ["END"])
    const events = await out
    expect(textOf(events)).toBe("Hi EN")
    expect(events.findIndex((event) => event.type === "tool-call")).toBeGreaterThan(0)
  })

  test("the caller's stop signal aborts only when a sequence matched", async () => {
    const matched = through([ev.text("A END"), ev.finish("stop")], ["END"])
    await matched.out
    expect(matched.fake.call.context.stopAnswer?.aborted).toBe(true)
    const plain = through([ev.text("A"), ev.finish("stop")], ["END"])
    await plain.out
    expect(plain.fake.call.context.stopAnswer?.aborted).toBe(false)
  })

  test("the model is read to its finish after a match: the stream is not cut by the wrapper", async () => {
    const script = [ev.text("A END"), ev.text("never sent"), ev.finish("stop", usage)]
    const { fake, out } = through(script, ["END"])
    await out
    expect(fake.call.yielded).toBe(script.length)
  })

  test("structured output has no text to scan and passes through unchanged", async () => {
    const script = [ev.call("respond", "respond", { city: "END" }), ev.finish("stop", usage)]
    const { out } = through(script, ["END"], { structuredTool: "respond" })
    expect(await out).toEqual(script)
  })

  test("an error event passes through as it is", async () => {
    const error = { status: 500, kind: "server", message: "boom" } as const
    const { out } = through([ev.text("A END"), { type: "error", error }], ["END"])
    expect((await out).at(-1)).toEqual({ type: "error", error })
  })
})
