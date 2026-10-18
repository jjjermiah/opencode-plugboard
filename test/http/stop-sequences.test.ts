/**
 * #390 over the real routes (loopback HTTP, scripted model behind the stop wrapper, as `index.ts` wires it):
 * a stop sequence ends the answer on each dialect, usage after the match is reported on the wire, the app's
 * `sampling.stop` default applies on Responses too, and the response cache never answers a stop request from
 * an entry made without the stop (or the other way round).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { cachedCaller, createCacheStore, type CacheConfig } from "../../src/cache.js"
import { withStopSequences } from "../../src/stop.js"
import { ev } from "../support/fixtures.js"
import { captureLogs } from "../support/logs.js"
import { sseData, startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller, type Script } from "../support/model-caller.js"

captureLogs()
let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

/** Reasoning quotes END, the answer ends at END, and the run is billed 10 in and 500 out up to its finish. */
const script: Script = [ev.reasoning('quote: "Hello", then END'), ev.text("Hello END and more"), ev.finish("stop", { inputTokens: 10, outputTokens: 500 })]
const OPTIONS = { maxN: 2, aliases: { fast: "test/echo" } }

async function routeWith(caller: FakeModelCaller, options: Record<string, unknown> = {}) {
  server = await startRoute({ caller: withStopSequences(caller), options: { ...OPTIONS, ...options } })
  return server
}

const chat = (body: Record<string, unknown> = {}): SendInit => ({
  method: "POST",
  path: "/v1/chat/completions",
  body: { model: "test/echo", messages: [{ role: "user", content: "hi" }], stop: "END", ...body },
})

describe("#424 stop strings: a whitespace stop is matched in the answer, an empty one is a 400 before any model call", () => {
  test("a newline stop passes through and ends the answer before the newline", async () => {
    const caller = new FakeModelCaller([ev.text("Hello\nworld"), ev.finish("stop")])
    await routeWith(caller)
    const reply = await server!.send(chat({ stop: "\n" }))
    expect(reply.status).toBe(200)
    expect(reply.json().choices[0].message.content).toBe("Hello")
  })

  test.each([
    ["an empty stop", ""],
    ["a list with an empty entry", ["", "x"]],
  ])("%s is a 400 naming stop, and the model is never called", async (_name, stop) => {
    const caller = new FakeModelCaller([ev.text("x"), ev.finish("stop")])
    await routeWith(caller)
    const reply = await server!.send(chat({ stop }))
    expect(reply.status).toBe(400)
    expect(reply.json().error).toMatchObject({ param: "stop" })
    expect(caller.calls).toEqual([])
  })
})

describe("#390 usage after a stop match, on each dialect", () => {
  test("Chat Completions: the JSON body has the usage of the run and the answer is cut", async () => {
    await routeWith(new FakeModelCaller(script))
    const reply = await server!.send(chat())
    expect(reply.json()).toMatchObject({ choices: [{ message: { content: "Hello " }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 500, total_tokens: 510 } })
  })

  test("Chat Completions stream: the include_usage chunk carries the usage of the run", async () => {
    await routeWith(new FakeModelCaller(script))
    const reply = await server!.send(chat({ stream: true, stream_options: { include_usage: true } }))
    const frames = sseData(reply.text)
    expect(frames.map((frame) => frame.choices?.[0]?.delta?.content ?? "").join("")).toBe("Hello ")
    expect(frames.find((frame) => frame.usage)?.usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 500 })
  })

  test("legacy completions: the usage of the run is in the body", async () => {
    await routeWith(new FakeModelCaller(script))
    const reply = await server!.send({ method: "POST", path: "/v1/completions", body: { model: "test/echo", prompt: "hi", stop: "END" } })
    expect(reply.json()).toMatchObject({ choices: [{ text: "Hello " }], usage: { prompt_tokens: 10, completion_tokens: 500 } })
  })

  test("legacy completions stream: the include_usage chunk carries the usage of the run", async () => {
    await routeWith(new FakeModelCaller(script))
    const reply = await server!.send({ method: "POST", path: "/v1/completions", body: { model: "test/echo", prompt: "hi", stop: "END", stream: true, stream_options: { include_usage: true } } })
    const frames = sseData(reply.text)
    expect(frames.map((frame) => frame.choices?.[0]?.text ?? "").join("")).toBe("Hello ")
    expect(frames.find((frame) => frame.usage)?.usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 500 })
  })

  test("Messages: the usage of the run is on the message, and the stop reason is stop_sequence", async () => {
    await routeWith(new FakeModelCaller(script))
    const reply = await server!.send({ method: "POST", path: "/v1/messages", body: { model: "test/echo", max_tokens: 1024, stop_sequences: ["END"], messages: [{ role: "user", content: "hi" }] } })
    expect(reply.json()).toMatchObject({ stop_reason: "stop_sequence", stop_sequence: "END", content: [{ type: "text", text: "Hello " }], usage: { input_tokens: 10, output_tokens: 500 } })
  })

  test("Messages stream: the final message_delta carries the usage of the run", async () => {
    await routeWith(new FakeModelCaller(script))
    const reply = await server!.send({
      method: "POST",
      path: "/v1/messages",
      body: { model: "test/echo", max_tokens: 1024, stream: true, stop_sequences: ["END"], messages: [{ role: "user", content: "hi" }] },
    })
    const delta = sseData(reply.text).find((frame) => frame.type === "message_delta")
    expect(delta).toMatchObject({ delta: { stop_reason: "stop_sequence", stop_sequence: "END" }, usage: { output_tokens: 500 } })
  })

  test("Gemini: usageMetadata is in the body and the text is cut", async () => {
    await routeWith(new FakeModelCaller(script))
    const reply = await server!.send({
      method: "POST",
      path: "/v1beta/models/fast:generateContent",
      body: { contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: { stopSequences: ["END"] } },
    })
    expect(reply.json()).toMatchObject({
      candidates: [{ content: { parts: [{ text: "Hello " }] } }],
      usageMetadata: { promptTokenCount: 10, totalTokenCount: 510 },
    })
  })
})

describe("#390 the app's sampling.stop default on Responses (Responses has no stop parameter)", () => {
  test("the default ends the output text, and the usage of the run is reported", async () => {
    const caller = new FakeModelCaller(script)
    await routeWith(caller, { keys: { bot: "k-bot" }, apps: { bot: { sampling: { stop: ["END"] } } } })
    const reply = await server!.send({ method: "POST", path: "/v1/responses", headers: { authorization: "Bearer k-bot" }, body: { model: "test/echo", input: "hi" } })
    expect(reply.json().output[0].content[0].text).toBe("Hello ")
    expect(reply.json().usage).toMatchObject({ input_tokens: 10, output_tokens: 500 })
    expect(caller.call.request.generation.stop).toEqual(["END"])
  })
})

describe("#390 the response cache keys on the stop sequences", () => {
  const CONFIG: CacheConfig = { ttlSeconds: 60, maxEntries: 100, maxBytes: 10_000_000 }

  test("a stop request is not answered from a no-stop entry, and a stop entry answers only its stop", async () => {
    const fake = new FakeModelCaller(() => script)
    const store = createCacheStore({ ttlMs: CONFIG.ttlSeconds * 1000, maxEntries: CONFIG.maxEntries, maxBytes: CONFIG.maxBytes })
    const caller = cachedCaller(withStopSequences(fake), CONFIG, store)
    server = await startRoute({ caller, options: OPTIONS })

    const plain = await server.send(chat({ stop: undefined }))
    expect(plain.json().choices[0].message.content).toBe("Hello END and more")
    const stopped = await server.send(chat())
    expect(stopped.json().choices[0].message.content).toBe("Hello ")
    expect(fake.calls).toHaveLength(2)

    const again = await server.send(chat())
    expect(again.json().choices[0].message.content).toBe("Hello ")
    expect(fake.calls).toHaveLength(2)
  })
})
