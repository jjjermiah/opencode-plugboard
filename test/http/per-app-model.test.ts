/**
 * #261 `apps.<name>.model`: an app's requests run on one pinned model, whatever model or reasoning effort the caller sends.
 * The pin is checked at load against `models` and the app's `models`; it never widens the allowlist. Real loopback HTTP.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { parseOptions } from "../../src/config.js"
import { model, ev } from "../support/fixtures.js"
import { startRoute, type RouteServer, type SendInit } from "../support/loopback.js"
import { FakeModelCaller } from "../support/model-caller.js"

let server: RouteServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const KEYS = { widget: "k-widget", other: "k-other" }
const CATALOG = [model("test", "echo", { variants: ["low", "high"] }), model("other", "model"), model("opencode-go", "glm-5.3-flash")]
const options = {
  keys: KEYS,
  models: ["test/*", "other/*", "opencode-go/*"],
  aliases: { fast: "opencode-go/glm-5.3-flash" },
  apps: { widget: { model: "opencode-go/glm-5.3-flash" }, other: {} },
}

const bearer = (key: string) => ({ authorization: `Bearer ${key}` })
const chat = (key: string, body: Record<string, unknown> = {}): SendInit => ({
  method: "POST",
  path: "/v1/chat/completions",
  headers: bearer(key),
  body: { model: "other/model", messages: [{ role: "user", content: "hi" }], ...body },
})

async function route(extra: Record<string, unknown> = {}) {
  const caller = new FakeModelCaller(() => [ev.text("answer"), ev.finish()])
  server = await startRoute({ caller, catalog: CATALOG, options: { ...options, ...extra } })
  return caller
}

describe("#261 apps.<name>.model on the wire", () => {
  test("an app with a pin runs on it whatever model the caller names, and the answer names the pinned model", async () => {
    const caller = await route()
    const reply = await server!.send(chat(KEYS.widget, { model: "test/echo" }))
    expect(reply.status).toBe(200)
    expect(caller.call.request.ref).toMatchObject({ providerID: "opencode-go", id: "glm-5.3-flash" })
    expect(caller.call.request.model).toBe("opencode-go/glm-5.3-flash")
    expect(reply.json().model).toBe("opencode-go/glm-5.3-flash")
  })

  test("a caller's reasoning_effort does not move a pinned model", async () => {
    const caller = await route({ apps: { widget: { model: "test/echo#high" } } })
    await server!.send(chat(KEYS.widget, { model: "test/echo", reasoning_effort: "low" }))
    expect(caller.call.request.ref).toMatchObject({ providerID: "test", id: "echo", variant: "high" })
  })

  test("another app without a pin keeps the caller's model", async () => {
    const caller = await route()
    await server!.send(chat(KEYS.other, { model: "test/echo" }))
    expect(caller.call.request.ref).toMatchObject({ providerID: "test", id: "echo" })
  })

  test("a pinned alias runs on its target", async () => {
    const caller = await route({ apps: { widget: { model: "fast" } } })
    expect((await server!.send(chat(KEYS.widget, { model: "other/model" }))).status).toBe(200)
    expect(caller.call.request.ref).toMatchObject({ providerID: "opencode-go", id: "glm-5.3-flash" })
  })

  test("a pin the server does not have is the usual 404 model_not_found, not the caller's model", async () => {
    const caller = await route({ models: ["test/*", "other/*", "opencode-go/*", "missing/*"], apps: { widget: { model: "missing/ghost" } } })
    const reply = await server!.send(chat(KEYS.widget, { model: "test/echo" }))
    expect(reply.status).toBe(404)
    expect(reply.json().error).toMatchObject({ code: "model_not_found", param: "model" })
    expect(caller.calls).toEqual([])
  })

  test("the pin applies to Responses, Messages and Gemini too", async () => {
    const caller = await route()
    await server!.send({ method: "POST", path: "/v1/responses", headers: bearer(KEYS.widget), body: { model: "test/echo", input: "hi" } })
    expect(caller.call.request.ref).toMatchObject({ id: "glm-5.3-flash" })
    await server!.send({ method: "POST", path: "/v1/messages", headers: { "x-api-key": KEYS.widget }, body: { model: "test/echo", max_tokens: 100, messages: [{ role: "user", content: "hi" }] } })
    expect(caller.calls[1]!.request.ref).toMatchObject({ id: "glm-5.3-flash" })
    await server!.send({
      method: "POST",
      path: "/v1beta/models/test%2Fecho:generateContent",
      headers: bearer(KEYS.widget),
      body: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
    })
    expect(caller.calls[2]!.request.ref).toMatchObject({ id: "glm-5.3-flash" })
  })
})

/** A caller that reports the model it served, as the session caller does, so `x-plugboard-model` is set. */
function servingCaller(inner: FakeModelCaller) {
  return {
    stream(request: Parameters<FakeModelCaller["stream"]>[0], context: Parameters<FakeModelCaller["stream"]>[1]) {
      const { providerID, id, variant } = request.ref
      context.onServed?.({ model: `${providerID}/${id}${variant ? `#${variant}` : ""}`, fallbacks: 0 })
      return inner.stream(request, context)
    },
  }
}

describe("#261 the answer names the pinned model on every route", () => {
  const PINNED = "opencode-go/glm-5.3-flash"
  async function serving(extra: Record<string, unknown> = {}) {
    const inner = new FakeModelCaller(() => [ev.text("answer"), ev.finish()])
    server = await startRoute({ caller: servingCaller(inner), catalog: CATALOG, options: { ...options, ...extra } })
    return inner
  }

  test("Chat Completions: x-plugboard-model and the body's model name the pin", async () => {
    await serving()
    const reply = await server!.send(chat(KEYS.widget, { model: "test/echo" }))
    expect(reply.headers["x-plugboard-model"]).toBe(PINNED)
    expect(reply.json().model).toBe(PINNED)
  })

  test("Responses: x-plugboard-model and the echoed model name the pin", async () => {
    const inner = await serving()
    const reply = await server!.send({ method: "POST", path: "/v1/responses", headers: bearer(KEYS.widget), body: { model: "test/echo", input: "hi" } })
    expect(reply.headers["x-plugboard-model"]).toBe(PINNED)
    expect(reply.json().model).toBe(PINNED)
    expect(inner.call.request.ref).toMatchObject({ id: "glm-5.3-flash" })
  })

  test("Messages: x-plugboard-model and the echoed model name the pin", async () => {
    await serving()
    const reply = await server!.send({ method: "POST", path: "/v1/messages", headers: { "x-api-key": KEYS.widget }, body: { model: "test/echo", max_tokens: 100, messages: [{ role: "user", content: "hi" }] } })
    expect(reply.headers["x-plugboard-model"]).toBe(PINNED)
    expect(reply.json().model).toBe(PINNED)
  })

  test("Gemini: x-plugboard-model names the pin", async () => {
    await serving()
    const reply = await server!.send({ method: "POST", path: "/v1beta/models/test%2Fecho:generateContent", headers: bearer(KEYS.widget), body: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } })
    expect(reply.headers["x-plugboard-model"]).toBe(PINNED)
  })

  test("a pin the server does not enable: the 404 names the pinned model, not the caller's", async () => {
    await serving({ models: ["test/*", "other/*", "opencode-go/*", "missing/*"], apps: { widget: { model: "missing/ghost" } } })
    const reply = await server!.send(chat(KEYS.widget, { model: "test/echo" }))
    expect(reply.status).toBe(404)
    expect(reply.json().error.message).toBe("Model missing/ghost is not available")
  })
})

/** The pin's load-time rules, checked without a server. */
const parseApps = (apps: Record<string, unknown>) => parseOptions({ keys: KEYS, models: ["test/*", "other/*"], aliases: { fast: "test/echo" }, apps })

describe("#261 apps.<name>.model at load", () => {
  test("a canonical id that passes the global models is kept on the policy, variant included", () => {
    expect(parseApps({ widget: { model: "test/echo#high" } }).apps.widget).toMatchObject({ model: "test/echo#high" })
  })

  test("an alias whose target matches one of the app's models patterns is accepted, as the request check admits it", () => {
    // `fast` targets test/echo, which `test/*` admits; the app does not list `fast` by name.
    expect(parseApps({ widget: { model: "fast", models: ["test/*"] } }).apps.widget).toMatchObject({ model: "fast" })
  })

  test("an alias the app lists by name is accepted, and an app without models is not restricted", () => {
    expect(parseApps({ widget: { model: "fast", models: ["fast"] } }).apps.widget).toMatchObject({ model: "fast" })
    expect(parseApps({ widget: { model: "other/model" } }).apps.widget).toMatchObject({ model: "other/model" })
  })

  test("a provider pattern cannot pin one model", () => {
    expect(() => parseApps({ widget: { model: "test/*" } })).toThrow(/a `provider\/\*` pattern cannot pin one model/)
  })

  test("a model outside the global models is refused, and the message names the option", () => {
    expect(() => parseApps({ widget: { model: "opencode-go/glm-5.3-flash" } })).toThrow(/`apps\.widget\.model` `opencode-go\/glm-5\.3-flash` is not allowed by the `models` option/)
  })

  test("an alias the app does not list is refused, and the message names the option", () => {
    expect(() => parseApps({ widget: { model: "fast", models: ["other/*"] } })).toThrow(/`apps\.widget\.model` alias `fast` must be listed in `apps\.widget\.models`/)
  })

  test("a canonical id outside the app's own models is refused", () => {
    expect(() => parseApps({ widget: { model: "other/model", models: ["test/*"] } })).toThrow(/`apps\.widget\.model` `other\/model` must be listed in `apps\.widget\.models`/)
  })

  test("a malformed id is refused", () => {
    expect(() => parseApps({ widget: { model: "no-slash" } })).toThrow(/`apps\.widget\.model` must be `provider\/model`/)
  })
})
