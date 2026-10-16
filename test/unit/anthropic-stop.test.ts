/**
 * #145, #390 A stop sequence in the answer is reported as `stop_reason: "stop_sequence"` with the matched text,
 * and is not part of the answer. The answer is scanned before it reaches the encoder (`withStopSequences`),
 * so a sequence anywhere in the text ends it. A tool call before the sequence makes the turn a tool turn
 * (`tool_use`, no `stop_sequence`), as Anthropic reports a turn that ended on a call.
 */
import { describe, expect, test } from "bun:test"
import type { PlugEvent } from "../../src/contract.js"
import { runMessage, type MessagesStreamEvent } from "../../src/anthropic/response.js"
import { withStopSequences } from "../../src/stop.js"
import { ev, plugRequest } from "../support/fixtures.js"
import { FakeModelCaller } from "../support/model-caller.js"

const usage = { inputTokens: 10, outputTokens: 500 }

async function run(list: PlugEvent[], stop?: string[], stream = false) {
  const emitted: MessagesStreamEvent[] = []
  const caller = withStopSequences(new FakeModelCaller(list))
  const request = plugRequest({ generation: stop ? { stop } : {} })
  const events = caller.stream(request, { app: "test", signal: new AbortController().signal })
  const result = await runMessage(events, { model: "test/echo", stream, thinking: false }, (event) => emitted.push(event))
  const streamed = emitted
    .filter((event) => event.type === "content_block_delta")
    .map((event) => (event.delta as { text?: string }).text ?? "")
    .join("")
  const delta = emitted.find((event) => event.type === "message_delta") as unknown as { delta: { stop_reason: string; stop_sequence: string | null }; usage: Record<string, number> }
  return {
    result,
    emitted,
    streamed,
    delta: delta.delta,
    deltaUsage: delta.usage,
    message: result.message as { content: Array<Record<string, unknown>>; stop_reason: string; stop_sequence: string | null; usage: Record<string, number> } | undefined,
  }
}

describe("#145 a stop sequence is reported and removed", () => {
  test("a sequence at the end of a plain answer: stop_reason stop_sequence, the text without it", async () => {
    const { message, delta, streamed } = await run([ev.text("Hello END"), ev.finish("stop")], ["END"])
    expect(message!.stop_reason).toBe("stop_sequence")
    expect(message!.stop_sequence).toBe("END")
    expect(message!.content).toEqual([{ type: "text", text: "Hello " }])
    expect(delta).toEqual({ stop_reason: "stop_sequence", stop_sequence: "END" })
    expect(streamed).toBe("Hello ")
  })

  test("a sequence split across streamed deltas is held back, then removed", async () => {
    const { streamed, delta } = await run([ev.text("Hel"), ev.text("lo EN"), ev.text("D"), ev.finish("stop")], ["END"], true)
    expect(streamed).toBe("Hello ")
    expect(delta.stop_reason).toBe("stop_sequence")
  })

  test("the longest matching sequence wins", async () => {
    const { message } = await run([ev.text("Answer: 4 ###"), ev.finish("stop")], ["#", "###"])
    expect(message!.stop_sequence).toBe("###")
    expect(message!.content).toEqual([{ type: "text", text: "Answer: 4 " }])
  })

  test("a stream without any stop sequence is unchanged: end_turn, all text sent", async () => {
    const { message, delta, streamed } = await run([ev.text("Hello END"), ev.finish("stop")])
    expect(message!.stop_reason).toBe("end_turn")
    expect(message!.stop_sequence).toBeNull()
    expect(delta).toEqual({ stop_reason: "end_turn", stop_sequence: null })
    expect(streamed).toBe("Hello END")
  })

  test("#390 a sequence in the middle of the answer ends it there", async () => {
    const { delta, streamed } = await run([ev.text("Hello END of it"), ev.finish("stop")], ["END"], true)
    expect(delta).toEqual({ stop_reason: "stop_sequence", stop_sequence: "END" })
    expect(streamed).toBe("Hello ")
  })

  test("text shorter than the sequence is sent whole, with end_turn", async () => {
    const { message, streamed } = await run([ev.text("EN"), ev.finish("stop")], ["END"])
    expect(message!.stop_reason).toBe("end_turn")
    expect(streamed).toBe("EN")
  })

  test("#390 a length finish whose answer contains the sequence: the sequence still ends it", async () => {
    const { message } = await run([ev.text("Hello END"), ev.finish("length")], ["END"])
    expect(message!.stop_reason).toBe("stop_sequence")
    expect(message!.content).toEqual([{ type: "text", text: "Hello " }])
  })
})

describe("#390 a tool call before the sequence: the turn ended on the call", () => {
  test("stop_reason is tool_use and stop_sequence is null, as Anthropic reports a call", async () => {
    const { message, delta } = await run([ev.text("Let me look"), ev.call("c1", "lookup", { q: 1 }), ev.text(" END"), ev.finish("stop")], ["END"])
    expect(message!.stop_reason).toBe("tool_use")
    expect(message!.stop_sequence).toBeNull()
    expect(delta).toEqual({ stop_reason: "tool_use", stop_sequence: null })
    // The answer text after the call is sent as it comes; the sequence is cut from it.
    expect(message!.content.map((block) => block.type)).toEqual(["text", "tool_use", "text"])
  })
})

describe("#390 usage after a stop sequence is counted", () => {
  test("the message and its final delta carry the usage of the run, streamed and not", async () => {
    for (const stream of [false, true]) {
      const { message, deltaUsage } = await run([ev.text("Hello END"), ev.text(" more"), ev.finish("stop", usage)], ["END"], stream)
      expect(deltaUsage).toMatchObject({ input_tokens: 10, output_tokens: 500 })
      if (!stream) expect(message!.usage).toMatchObject({ input_tokens: 10, output_tokens: 500 })
    }
  })
})
