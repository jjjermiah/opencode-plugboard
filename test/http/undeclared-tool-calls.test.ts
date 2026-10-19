/**
 * #463: a tool call must name one of the request's declared caller tools. A host that reports a call to any other name (a
 * garbled name, or a tool the request never offered) sends nothing for it: the call is dropped and logged. An answer left
 * with no text and no call fails the way a failed model run does; an answer with text finishes as `stop`.
 *
 * Driven over loopback HTTP through the real session caller and collector, with a fake host, on Chat Completions, streamed
 * and not. The collector's unit cases are in test/session/collector.test.ts (#463).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createSessionCaller } from "../../src/session/caller.js"
import { createSessionStore } from "../../src/session/state.js"
import { captureLogs } from "../support/logs.js"
import { sseData, startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { isolateRuntime } from "../support/runtime.js"
import { bus, FakeSessionPort, type BusEnvelope } from "../support/session.js"

const logs = captureLogs()
isolateRuntime()

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

/** The garbled name from #463: free text, longer than 64 characters, with a sentence in it. */
const GARBLED = "Realtime-2.5-flash-2025-15‸none…I'm just a language model, so I can't actually play ping pong"
const SECRET_ARGUMENT = "SECRET-ARGUMENT-463"

const WEATHER_TOOL = { type: "function", function: { name: "get_weather", parameters: { type: "object" } } }

/** The fake host: `events` decides what the session reports for each prompt. */
async function serve(events: (sessionID: string) => BusEnvelope[], body: Record<string, unknown> = {}) {
  const port = new FakeSessionPort()
  const sessions = createSessionStore()
  port.script.prompt = async (input) => {
    queueMicrotask(() => {
      for (const event of events(input.sessionID)) sessions.dispatch(event)
    })
  }
  const caller = createSessionCaller({ port, sessions, maxTools: 4 })
  server = await startRoute({ caller })
  const request = (streamed: boolean): SendInit => ({
    method: "POST",
    path: "/v1/chat/completions",
    body: { model: "test/echo", messages: [{ role: "user", content: "what is the weather" }], ...body, ...(streamed ? { stream: true } : {}) },
  })
  return { send: (streamed = false) => server!.send(request(streamed)), open: (streamed = true) => server!.open(request(streamed)) }
}

/** A call the request never declared, with arguments that must not reach any log. */
const garbled = (b: ReturnType<typeof bus>, id = "c1") => b.toolCalled(id, GARBLED, { secret: SECRET_ARGUMENT })

const undeclaredLogs = () => logs.of("tool_call.undeclared")

describe("#463 no tools declared: a call to a name the request never offered is dropped", () => {
  test("not streamed: nothing returned as a tool call; the failed model run answers 502 model_run_failed", async () => {
    const run = await serve((id) => {
      const b = bus(id)
      return [garbled(b), b.stepEnded("tool-calls"), b.executionSucceeded()]
    })
    const reply = await run.send()
    expect(reply.status).toBe(502)
    expect(reply.json().error.code).toBe("model_run_failed")
    expect(reply.text).not.toContain("tool_calls")
    expect(reply.text).not.toContain(GARBLED.slice(0, 20))
  })

  test("the drop is logged once at warn with the app, the request id and the name cut to 64 characters, and no call arguments", async () => {
    const run = await serve((id) => {
      const b = bus(id)
      return [garbled(b), b.stepEnded("tool-calls"), b.executionSucceeded()]
    })
    await run.send()
    expect(undeclaredLogs()).toHaveLength(1)
    const [line] = undeclaredLogs()
    expect(line!.fields.app).toBe("default")
    expect(line!.fields.requestID).toBeTruthy()
    expect(line!.fields.tool).toBe(GARBLED.slice(0, 64))
    expect(line!.raw).not.toContain(SECRET_ARGUMENT)
    expect(line!.raw).not.toContain("secret")
  })

  test("streamed, with no output before the call: the failure is a real HTTP status, not a stream", async () => {
    const run = await serve((id) => {
      const b = bus(id)
      return [garbled(b), b.stepEnded("tool-calls"), b.executionSucceeded()]
    })
    const reply = await run.send(true)
    expect(reply.status).toBe(502)
    expect(reply.json().error.code).toBe("model_run_failed")
  })

  test("streamed, after reasoning has started the stream: it ends with the route's error frame and no tool call", async () => {
    const run = await serve((id) => {
      const b = bus(id)
      return [b.reasoningDelta("thinking"), garbled(b), b.stepEnded("tool-calls"), b.executionSucceeded()]
    })
    const stream = await run.open(true)
    const frames = sseData(await stream.ended)
    expect(JSON.stringify(frames)).not.toContain("tool_calls")
    expect(frames.at(-1)).toMatchObject({ error: { code: "model_run_failed" } })
  })
})

describe("#463 tools declared, but the call names another tool", () => {
  test("the name differs from the declared tool: dropped, not returned, and the request fails", async () => {
    const run = await serve(
      (id) => {
        const b = bus(id)
        return [garbled(b), b.stepEnded("tool-calls"), b.executionSucceeded()]
      },
      { tools: [WEATHER_TOOL] },
    )
    const reply = await run.send()
    expect(reply.status).toBe(502)
    expect(reply.json().error.code).toBe("model_run_failed")
    expect(undeclaredLogs().map((line) => line.fields.tool)).toEqual([GARBLED.slice(0, 64)])
  })

  test("the declared tool called by its own name is returned as a tool call, with finish reason tool_calls (unchanged)", async () => {
    const run = await serve(
      (id) => {
        const b = bus(id)
        return [b.toolCalled("c1", "get_weather", { city: "Paris" }), b.stepEnded("tool-calls"), b.executionSucceeded()]
      },
      { tools: [WEATHER_TOOL] },
    )
    const reply = await run.send()
    expect(reply.status).toBe(200)
    const choice = reply.json().choices[0]
    expect(choice.finish_reason).toBe("tool_calls")
    expect(choice.message.tool_calls).toHaveLength(1)
    expect(choice.message.tool_calls[0].function.name).toBe("get_weather")
    expect(undeclaredLogs()).toHaveLength(0)
  })
})

describe("#463 mixed: text with a garbled call", () => {
  test("not streamed: the text is returned with finish reason stop and no tool call", async () => {
    const run = await serve((id) => {
      const b = bus(id)
      return [b.textDelta("Let me check."), garbled(b), b.stepEnded("tool-calls"), b.executionSucceeded()]
    })
    const reply = await run.send()
    expect(reply.status).toBe(200)
    const choice = reply.json().choices[0]
    expect(choice.finish_reason).toBe("stop")
    expect(choice.message.content).toBe("Let me check.")
    expect(choice.message.tool_calls).toBeUndefined()
    expect(undeclaredLogs()).toHaveLength(1)
  })

  test("streamed: the text streams, the last chunk finishes as stop, and no delta carries a tool call", async () => {
    const run = await serve((id) => {
      const b = bus(id)
      return [b.textDelta("Let me check."), garbled(b), b.stepEnded("tool-calls"), b.executionSucceeded()]
    })
    const stream = await run.open(true)
    const frames = sseData(await stream.ended)
    expect(JSON.stringify(frames)).not.toContain("tool_calls")
    expect(frames.flatMap((frame) => frame.choices ?? []).at(-1).finish_reason).toBe("stop")
    expect(
      frames
        .flatMap((frame) => frame.choices ?? [])
        .map((choice: any) => choice.delta?.content ?? "")
        .join(""),
    ).toBe("Let me check.")
  })
})
