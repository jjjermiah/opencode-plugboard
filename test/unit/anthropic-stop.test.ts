/**
 * #145 A stop sequence that ends the answer is reported as `stop_reason: "stop_sequence"` with the
 * matched text, and is not part of the answer. The host reports only `stop`, so the end of the
 * text is checked; the held-back tail keeps a streamed sequence from reaching the client.
 */
import { describe, expect, test } from "bun:test"
import { runMessage, type MessagesStreamEvent } from "../../src/anthropic/response.js"
import { ev, events } from "../support/fixtures.js"

async function run(list: Parameters<typeof events>, stop?: string[]) {
  const emitted: MessagesStreamEvent[] = []
  const result = await runMessage(events(...list), { model: "test/echo", stream: false, thinking: false, ...(stop ? { stop } : {}) }, (event) => emitted.push(event))
  const text = emitted.filter((event) => event.type === "content_block_delta").map((event) => (event.delta as { text?: string }).text ?? "")
  const delta = emitted.find((event) => event.type === "message_delta")!.delta as { stop_reason: string; stop_sequence: string | null }
  return { result, emitted, streamed: text.join(""), delta, message: result.message as { content: Array<Record<string, unknown>>; stop_reason: string; stop_sequence: string | null } }
}

describe("#145 a stop sequence is reported and removed", () => {
  test("a sequence at the end of a plain answer: stop_reason stop_sequence, the text without it", async () => {
    const { message, delta, streamed } = await run([ev.text("Hello END"), ev.finish("stop")], ["END"])
    expect(message.stop_reason).toBe("stop_sequence")
    expect(message.stop_sequence).toBe("END")
    expect(message.content).toEqual([{ type: "text", text: "Hello " }])
    expect(delta).toEqual({ stop_reason: "stop_sequence", stop_sequence: "END" })
    expect(streamed).toBe("Hello ")
  })

  test("a sequence split across streamed deltas is held back, then removed", async () => {
    const { streamed, delta, message } = await run([ev.text("Hel"), ev.text("lo EN"), ev.text("D"), ev.finish("stop")], ["END"])
    expect(streamed).toBe("Hello ")
    expect(delta.stop_reason).toBe("stop_sequence")
    expect(message.content).toEqual([{ type: "text", text: "Hello " }])
  })

  test("the longest matching sequence wins", async () => {
    const { message } = await run([ev.text("Answer: 4 ###"), ev.finish("stop")], ["#", "###"])
    expect(message.stop_sequence).toBe("###")
    expect(message.content).toEqual([{ type: "text", text: "Answer: 4 " }])
  })

  test("a stream that streams text without any stop sequence is unchanged: end_turn, all text sent", async () => {
    const { message, delta, streamed } = await run([ev.text("Hello END"), ev.finish("stop")])
    expect(message.stop_reason).toBe("end_turn")
    expect(message.stop_sequence).toBeNull()
    expect(delta).toEqual({ stop_reason: "end_turn", stop_sequence: null })
    expect(streamed).toBe("Hello END")
  })

  test("a sequence in the middle of the answer is not a stop: only the tail counts", async () => {
    const { message, streamed } = await run([ev.text("END of it"), ev.finish("stop")], ["END"])
    expect(message.stop_reason).toBe("end_turn")
    expect(streamed).toBe("END of it")
  })

  test("text shorter than the sequence is sent whole, with end_turn", async () => {
    const { message, streamed } = await run([ev.text("EN"), ev.finish("stop")], ["END"])
    expect(message.stop_reason).toBe("end_turn")
    expect(streamed).toBe("EN")
  })

  test("a length finish that ends on a sequence is max_tokens, not a stop sequence", async () => {
    const { message } = await run([ev.text("Hello END"), ev.finish("length")], ["END"])
    expect(message.stop_reason).toBe("max_tokens")
    expect(message.content).toEqual([{ type: "text", text: "Hello END" }])
  })
})
