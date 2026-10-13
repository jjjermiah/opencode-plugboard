/**
 * #264 `apps.<name>.sampling`: sampling defaults of one app. A field fills the request only where the caller sent none, the
 * caller's value always wins, and the defaults go through the same model drop as the caller's values (`dropRejected`), so a
 * default cannot turn a working app into a 400. Real loopback HTTP, plus the pure `appGeneration` rules.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { parseOptions } from "../../src/config.js"
import type { ModelRef, PlugGeneration } from "../../src/contract.js"
import { appGeneration, dropRejected } from "../../src/openai/sampling.js"
import { ev, model } from "../support/fixtures.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const KEYS = { bot: "k-bot", plain: "k-plain" }
const SAMPLING = { temperature: 0.2, topP: 0.9, maxTokens: 512, stop: ["END"], presencePenalty: 0.1, frequencyPenalty: 0.3 }
const options = { keys: KEYS, apps: { bot: { sampling: SAMPLING } } }

const chat = (key: string, body: Record<string, unknown> = {}): SendInit => ({
  method: "POST",
  path: "/v1/chat/completions",
  headers: { authorization: `Bearer ${key}` },
  body: { model: "test/echo", messages: [{ role: "user", content: "hi" }], ...body },
})

async function route() {
  const caller = new FakeModelCaller(() => [ev.text("answer"), ev.finish()])
  server = await startRoute({ caller, options })
  return caller
}

// #390: the stop sequences are never sent to the model; the answer is matched on them, so they are left out here.
const WIRE = Object.fromEntries(Object.entries(SAMPLING).filter(([key]) => key !== "stop"))

describe("#264 apps.<name>.sampling on the wire", () => {
  test("a request that sends no sampling gets the app's defaults, without the stop sequences (#390)", async () => {
    const caller = await route()
    expect((await server!.send(chat(KEYS.bot))).status).toBe(200)
    expect(caller.call.request.generation).toEqual(WIRE)
  })

  test("the caller's value wins, and the other defaults still fill the rest; the caller's stop ends the answer", async () => {
    const caller = new FakeModelCaller(() => [ev.text("answer STOP more"), ev.finish()])
    server = await startRoute({ caller, options })
    const reply = await server.send(chat(KEYS.bot, { temperature: 0.9, stop: ["STOP"] }))
    expect(caller.call.request.generation).toEqual({ ...WIRE, temperature: 0.9 })
    expect(reply.json().choices[0].message.content).toBe("answer ")
  })

  test("#390 the app's default stop ends the answer when the caller sends none, and the model is not sent it", async () => {
    const caller = new FakeModelCaller(() => [ev.reasoning("quoting END"), ev.text("Hello END there"), ev.finish()])
    server = await startRoute({ caller, options })
    const reply = await server.send(chat(KEYS.bot))
    expect(caller.call.request.generation.stop).toBeUndefined()
    expect(reply.json().choices[0].message.content).toBe("Hello ")
  })

  test("another app without sampling sends only what the caller sent", async () => {
    const caller = await route()
    await server!.send(chat(KEYS.plain))
    expect(caller.call.request.generation).toEqual({})
  })

  test("Responses fills the app's temperature when the caller sends none", async () => {
    const caller = await route()
    await server!.send({ method: "POST", path: "/v1/responses", headers: { authorization: `Bearer ${KEYS.bot}` }, body: { model: "test/echo", input: "hi" } })
    expect(caller.call.request.generation.temperature).toBe(0.2)
  })

  test("Messages fills the app's temperature when the caller sends none", async () => {
    const caller = await route()
    await server!.send({
      method: "POST",
      path: "/v1/messages",
      headers: { authorization: `Bearer ${KEYS.bot}` },
      body: { model: "test/echo", max_tokens: 100, messages: [{ role: "user", content: "hi" }] },
    })
    expect(caller.call.request.generation.temperature).toBe(0.2)
  })
})

describe("#264 a default the model rejects, on the wire", () => {
  test("it is dropped and listed in x-plugboard-dropped-params, and the rest of the default still goes", async () => {
    // opencode-go glm-5.3-flash takes only frequency_penalty 0: the app's 0.3 is dropped, its temperature is kept.
    const caller = new FakeModelCaller(() => [ev.text("answer"), ev.finish()])
    server = await startRoute({
      caller,
      catalog: [model("opencode-go", "glm-5.3-flash")],
      options: { keys: KEYS, models: ["opencode-go/*"], apps: { bot: { sampling: { frequencyPenalty: 0.3, temperature: 0.2 } } } },
    })
    const reply = await server.send(chat(KEYS.bot, { model: "opencode-go/glm-5.3-flash" }))
    expect(reply.status).toBe(200)
    expect(reply.headers["x-plugboard-dropped-params"]).toBe("frequency_penalty")
    expect(caller.call.request.generation).toEqual({ temperature: 0.2 })
  })
})

describe("#264 appGeneration: the defaults and the output cap, in order", () => {
  const policy = (extra: Record<string, unknown>) => parseOptions({ keys: KEYS, apps: { bot: extra } }).apps.bot

  test("a default fills only a field the caller left unset", () => {
    const out = appGeneration(policy({ sampling: { temperature: 0.2 } }), { temperature: 0.9 })
    expect(out.temperature).toBe(0.9)
    expect(appGeneration(policy({ sampling: { temperature: 0.2 } }), {}).temperature).toBe(0.2)
  })

  test("the output cap applies after the default, so a default maxTokens above the cap is lowered", () => {
    const out = appGeneration(policy({ sampling: { maxTokens: 900 }, maxOutputTokens: 400 }), {})
    expect(out.maxTokens).toBe(400)
  })

  test("with no policy the generation is returned as it was", () => {
    const generation: PlugGeneration = { temperature: 0.5 }
    expect(appGeneration(undefined, generation)).toBe(generation)
  })

  test("a default the model rejects is dropped by dropRejected, so it is not sent", () => {
    // opencode-go glm-5.3-flash takes only frequency_penalty 0, so a default of 0.3 is dropped and reported.
    const ref: ModelRef = { providerID: "opencode-go", id: "glm-5.3-flash" }
    const sampled = dropRejected(ref, appGeneration(policy({ sampling: { frequencyPenalty: 0.3, temperature: 0.2 } }), {}))
    expect(sampled.dropped).toEqual(["frequency_penalty"])
    expect(sampled.generation.frequencyPenalty).toBeUndefined()
  })
})

describe("#264 apps.<name>.sampling at load", () => {
  test.each([
    ["a temperature above 2", { temperature: 2.5 }, /sampling\.temperature` must be a number from 0 to 2/],
    ["a topP above 1", { topP: 1.5 }, /sampling\.topP` must be a number from 0 to 1/],
    ["a penalty below -2", { frequencyPenalty: -3 }, /sampling\.frequencyPenalty` must be a number from -2 to 2/],
    ["a zero maxTokens", { maxTokens: 0 }, /sampling\.maxTokens` must be an integer between 1 and 2147483647/],
    ["an empty stop list", { stop: [] }, /sampling\.stop` must be an array of 1 to 4 strings/],
    ["five stop strings", { stop: ["a", "b", "c", "d", "e"] }, /sampling\.stop` must be an array of 1 to 4 strings/],
    ["an unknown field", { topK: 40 }, /Unknown plugboard option `apps\.bot\.sampling\.topK`/],
  ])("%s is refused at load and names the option", (_name, sampling, message) => {
    expect(() => parseOptions({ keys: KEYS, apps: { bot: { sampling } } })).toThrow(message)
  })

  test("valid sampling is kept on the app policy, and an app without it has none", () => {
    expect(parseOptions(options).apps.bot).toMatchObject({ sampling: SAMPLING })
    expect(parseOptions({ keys: KEYS, apps: { bot: { tools: false } } }).apps.bot).not.toHaveProperty("sampling")
  })
})
